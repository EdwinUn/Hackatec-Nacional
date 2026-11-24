"""Órdenes de trabajo del personal de campo, con su cascada hacia el reporte ciudadano."""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from app.application.events import Event, jsonable, work_order_assigned_event
from app.application.photos import decode_photo
from app.application.ports import Clock, EventPublisher, MediaStorage, UnitOfWork, UnitOfWorkFactory
from app.application.services.staff import require_role
from app.domain.entities import ensure_utc
from app.domain.errors import ConflictError, ForbiddenError, InvalidDataError, NotFoundError
from app.domain.operations import (
    MANAGERS,
    CitizenReport,
    Priority,
    Role,
    User,
    WorkOrder,
    WorkOrderStatus,
    WorkOrderType,
    default_checklist,
    format_folio,
    report_update_for,
)

MAX_LIST = 500
MAX_EVIDENCE = 2
MANAGER_ONLY_FIELDS = frozenset({"assigned_to", "priority", "due_at"})


@dataclass(frozen=True, slots=True)
class WorkOrderView:
    """La orden más los nombres que resuelve el servidor."""

    order: WorkOrder
    station_name: str | None
    assigned_name: str | None

    def to_dict(self) -> dict[str, Any]:
        return jsonable(self.order) | {"station_name": self.station_name, "assigned_name": self.assigned_name}


class WorkOrderService:
    def __init__(
        self,
        uow_factory: UnitOfWorkFactory,
        publisher: EventPublisher,
        media: MediaStorage,
        clock: Clock,
        max_photo_kb: int,
    ) -> None:
        self._uow_factory = uow_factory
        self._publisher = publisher
        self._media = media
        self._now = clock
        self._max_photo_kb = max_photo_kb

    # ── Lectura ─────────────────────────────────
    async def list_orders(
        self,
        actor: User,
        *,
        assigned_to: UUID | None,
        statuses: list[WorkOrderStatus],
        type: WorkOrderType | None,
    ) -> list[WorkOrderView]:
        if actor.role is Role.TECHNICIAN:
            assigned_to = actor.id  # un técnico solo ve lo suyo, pida lo que pida
        async with self._uow_factory() as uow:
            orders = await uow.work_orders.list(
                assigned_to=assigned_to, statuses=statuses, type=type, limit=MAX_LIST
            )
            return await self._views(uow, orders)

    async def get(self, actor: User, order_id: UUID) -> WorkOrderView:
        async with self._uow_factory() as uow:
            order = await self._visible(uow, actor, order_id)
            [view] = await self._views(uow, [order])
            return view

    # ── Escritura ───────────────────────────────
    async def create(self, actor: User, data: dict[str, Any]) -> WorkOrderView:
        require_role(actor, *MANAGERS)
        async with self._uow_factory() as uow:
            station = await self._existing(uow.stations.get, data.get("station_id"), "La estación")
            report = await self._existing(
                uow.reports.get, data.get("citizen_report_id"), "El reporte ciudadano"
            )
            await self._existing(uow.alerts.get, data.get("alert_id"), "La alerta")
            if report is not None and report.work_order_id:
                linked = await uow.work_orders.get(report.work_order_id)
                if linked is not None and linked.status is not WorkOrderStatus.CANCELLED:
                    raise ConflictError(f"El reporte {report.folio} ya lo atiende la orden {linked.folio}")
            assignee = await self._assignee(uow, data.get("assigned_to"))
            location = data.get("location")
            if location is None and report is not None:
                location = {"latitude": report.latitude, "longitude": report.longitude}
            elif location is None and station is not None:
                location = {"latitude": station.latitude, "longitude": station.longitude}
            order = WorkOrder(
                folio=format_folio("OT", await uow.work_orders.next_folio()),
                type=WorkOrderType(data["type"]),
                title=data["title"],
                description=data.get("description") or "",
                priority=Priority(data.get("priority") or Priority.NORMAL),
                station_id=data.get("station_id"),
                citizen_report_id=data.get("citizen_report_id"),
                alert_id=data.get("alert_id"),
                location=location,
                due_at=ensure_utc(data["due_at"]) if data.get("due_at") else None,
                created_by=actor.id,
                checklist=default_checklist(WorkOrderType(data["type"])),
            )
            order.assign(assignee.id if assignee else None)
            await uow.work_orders.add(order)
            if report is not None:
                report.work_order_id = order.id
                await self._cascade(uow, order, report, linked=True)
            [view] = await self._views(uow, [order])
            await uow.commit()
        if assignee:
            await self._publish_assignment(view)
        return view

    async def update(self, actor: User, order_id: UUID, changes: dict[str, Any]) -> WorkOrderView:
        if actor.role is Role.TECHNICIAN and MANAGER_ONLY_FIELDS & changes.keys():
            raise ForbiddenError("Solo un supervisor puede reasignar, cambiar la prioridad o la fecha límite")
        now = self._now()
        async with self._uow_factory() as uow:
            order = await self._visible(uow, actor, order_id)
            order.ensure_editable(actor.role, changes.keys())
            previous_status = order.status
            reassigned = False
            if "assigned_to" in changes:
                assignee = await self._assignee(uow, changes["assigned_to"])
                new_id = assignee.id if assignee else None
                reassigned = new_id != order.assigned_to
                order.assign(new_id)
            if "priority" in changes:
                order.priority = Priority(changes["priority"])
            if "due_at" in changes:
                order.due_at = ensure_utc(changes["due_at"]) if changes["due_at"] else None
            if "checklist" in changes:
                order.set_checklist(changes["checklist"])
            if "evidence" in changes:
                order.evidence = self._store_evidence(changes["evidence"])
            if "notes" in changes:
                order.notes = changes["notes"] or ""
            if "result" in changes:
                order.result = changes["result"] or None  # mantenimiento: `{}` → sin resultado
            if "check_in" in changes:
                order.check_in = changes["check_in"]
            if "status" in changes:
                order.change_status(WorkOrderStatus(changes["status"]), actor.role, now)
            order.touch(now)
            await uow.work_orders.save(order)
            # La cascada responde a eventos de la orden (cambio de estado), no a cada guardado:
            # así no pisa la moderación manual del supervisor.
            if order.citizen_report_id and order.status is not previous_status:
                report = await uow.reports.get(order.citizen_report_id)
                if report is not None:
                    await self._cascade(uow, order, report)
            [view] = await self._views(uow, [order])
            await uow.commit()
        if reassigned and order.assigned_to:
            await self._publish_assignment(view)
        return view

    # ── Apoyo ───────────────────────────────────
    async def _visible(self, uow: UnitOfWork, actor: User, order_id: UUID) -> WorkOrder:
        order = await uow.work_orders.get(order_id)
        # A un técnico, las órdenes ajenas le responden 404 para no revelar que existen.
        if order is None or (actor.role is Role.TECHNICIAN and order.assigned_to != actor.id):
            raise NotFoundError("Orden no encontrada")
        return order

    @staticmethod
    async def _existing(getter: Callable[[UUID], Awaitable[Any]], entity_id: UUID | None, label: str) -> Any:
        if entity_id is None:
            return None
        entity = await getter(entity_id)
        if entity is None:
            raise InvalidDataError(f"{label} indicado no existe")
        return entity

    @staticmethod
    async def _assignee(uow: UnitOfWork, user_id: UUID | None) -> User | None:
        if user_id is None:
            return None
        user = await uow.users.get(user_id)
        if user is None or not user.active:
            raise InvalidDataError("El técnico asignado no existe o su cuenta está desactivada")
        return user

    def _store_evidence(self, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if len(items) > MAX_EVIDENCE:
            raise InvalidDataError(f"Se permiten hasta {MAX_EVIDENCE} fotos de evidencia (antes y después)")
        kinds = [item["kind"] for item in items]
        if len(set(kinds)) != len(kinds):
            raise InvalidDataError("Solo puede haber una foto «antes» y una «después»")
        stored = []
        for item in items:
            photo = item["photo"]
            if photo.startswith("data:"):
                photo = self._media.save(*decode_photo(photo, self._max_photo_kb))
            else:
                # URL que devolvió el servidor → referencia relativa; debe ser un archivo nuestro.
                ref = photo[photo.index("/media/") + 1 :] if "/media/" in photo else photo
                if not self._media.exists(ref):
                    raise InvalidDataError(
                        "La evidencia debe ser una foto data:image/… o una foto ya guardada"
                    )
                photo = ref
            stored.append({"kind": item["kind"], "photo": photo, "ts": item["ts"]})
        return stored

    async def _cascade(
        self, uow: UnitOfWork, order: WorkOrder, report: CitizenReport, *, linked: bool = False
    ) -> None:
        """El ciudadano ve el avance de la orden que atiende su reporte.
        `linked`: la orden se acaba de vincular, hay que guardar `work_order_id` aunque nada más cambie."""
        status, note = report_update_for(order)
        if not linked and report.status is status and (note is None or report.public_note == note):
            return
        report.status = status
        if note is not None:
            report.public_note = note
        report.touch(self._now())
        await uow.reports.save(report)

    async def _views(self, uow: UnitOfWork, orders: list[WorkOrder]) -> list[WorkOrderView]:
        users = {u.id: u.name for u in await uow.users.list()} if orders else {}
        stations = (
            {
                s.id: s.name
                for s in (await uow.stations.list(status=None, river=None, limit=1000, offset=0))[0]
            }
            if orders
            else {}
        )
        return [
            WorkOrderView(
                o,
                stations.get(o.station_id) if o.station_id else None,
                users.get(o.assigned_to) if o.assigned_to else None,
            )
            for o in orders
        ]

    async def _publish_assignment(self, view: WorkOrderView) -> None:
        event: Event = work_order_assigned_event(view.to_dict(), view.order.station_id)
        await self._publisher.publish([event])
