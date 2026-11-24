"""Personal operativo: sesión, bandeja de tareas y bitácora de recolección de boyas skimmer."""

from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

from app.application.events import Event, skimmer_event, waste_event
from app.application.ports import Clock, EventPublisher, UnitOfWork, UnitOfWorkFactory
from app.domain.entities import (
    SKIMMER_MATERIALS,
    SkimmerCollection,
    StaffUser,
    Task,
    WasteCollection,
    ensure_utc,
)
from app.domain.enums import TaskKind, TaskPriority, TaskStatus, TaskView, UserRole
from app.domain.errors import (
    AuthenticationError,
    ConflictError,
    ForbiddenError,
    InvalidDataError,
    NotFoundError,
)

DEMO_PASSWORD = "atoyac2026"
DEMO_USERS = [
    ("operador@atlmonitor.mx", "Operador de Brigada", UserRole.TECHNICIAN),
    ("supervisor@atlmonitor.mx", "Supervisor de Brigada", UserRole.SUPERVISOR),
    ("admin@atlmonitor.mx", "Administrador", UserRole.ADMIN),
]


@dataclass(frozen=True, slots=True)
class Session:
    access_token: str
    expires_in: int
    user: StaffUser


class StaffService:
    def __init__(
        self,
        uow_factory: UnitOfWorkFactory,
        publisher: EventPublisher,
        clock: Clock,
        *,
        hash_password,
        verify_password,
        jwt,
    ) -> None:
        self._uow_factory = uow_factory
        self._publisher = publisher
        self._now = clock
        self._hash = hash_password
        self._verify = verify_password
        self._jwt = jwt

    # ── Sesión ───────────────────────────────────
    async def login(self, email: str, password: str) -> Session:
        async with self._uow_factory() as uow:
            user = await uow.users.get_by_email(email.strip().lower())
        # Mismo mensaje y mismo trabajo (scrypt) exista o no la cuenta.
        stored = user.password_hash if user else self._hash("x")
        ok = self._verify(password, stored)
        if not user or not ok:
            raise AuthenticationError("Correo o contraseña incorrectos")
        if not user.active:
            raise ForbiddenError("La cuenta está desactivada")
        token = self._jwt.encode({"sub": str(user.id), "role": user.role.value})
        return Session(token, self._jwt.expire_s, user)

    async def authenticate(self, token: str) -> StaffUser:
        claims = self._jwt.decode(token)
        try:
            user_id = UUID(claims["sub"])
        except (KeyError, ValueError) as exc:
            raise AuthenticationError("Sesión inválida o expirada") from exc
        async with self._uow_factory() as uow:
            user = await uow.users.get(user_id)
        if user is None or not user.active:
            raise AuthenticationError("Sesión inválida o expirada")
        return user

    # ── Tareas ───────────────────────────────────
    async def list_tasks(
        self, user: StaffUser, view: TaskView | None, limit: int, offset: int
    ) -> tuple[list[Task], int, dict[TaskView, int]]:
        async with self._uow_factory() as uow:
            items, total = await uow.tasks.list(view=view, user_id=user.id, limit=limit, offset=offset)
            counts = await uow.tasks.counts(user.id)
        return items, total, counts

    async def get_task(self, task_id: UUID) -> Task:
        async with self._uow_factory() as uow:
            task = await uow.tasks.get(task_id)
        if task is None:
            raise NotFoundError("Tarea no encontrada")
        return task

    async def create_task(self, user: StaffUser, data: dict[str, Any]) -> Task:
        if user.role is UserRole.TECHNICIAN:
            raise ForbiddenError("Solo supervisores y administradores crean tareas")
        async with self._uow_factory() as uow:
            await self._check_refs(uow, data.get("station_id"), data.get("assigned_to"))
            task = Task(**data)
            await uow.tasks.add(task)
            await uow.commit()
        return task

    async def update_task(self, user: StaffUser, task_id: UUID, patch: dict[str, Any]) -> Task:
        """Atender (`in_progress`), reasignar, cambiar prioridad o resolver (`done` + `closing_note`)."""
        async with self._uow_factory() as uow:
            task = await uow.tasks.get(task_id)
            if task is None:
                raise NotFoundError("Tarea no encontrada")
            if task.status is TaskStatus.DONE:
                raise ConflictError("La tarea ya está resuelta")
            if "assigned_to" in patch:
                if user.role is UserRole.TECHNICIAN and patch["assigned_to"] not in (None, user.id):
                    raise ForbiddenError("Un operador solo puede asignarse tareas a sí mismo")
                await self._check_refs(uow, None, patch["assigned_to"])
                task.assigned_to = patch["assigned_to"]
            if "priority" in patch:
                task.priority = patch["priority"]
            new_status = patch.get("status")
            now = self._now()
            if new_status is TaskStatus.DONE:
                task.resolve(patch.get("closing_note") or "", user.id, now)
            elif new_status is not None:
                task.status = new_status
                if new_status is TaskStatus.IN_PROGRESS and task.assigned_to is None:
                    task.assigned_to = user.id
            task.touch(now)
            await uow.tasks.save(task)
            await uow.commit()
        return task

    @staticmethod
    async def _check_refs(uow: UnitOfWork, station_id: UUID | None, user_id: UUID | None) -> None:
        if station_id and await uow.stations.get(station_id) is None:
            raise InvalidDataError("La estación indicada no existe")
        if user_id and await uow.users.get(user_id) is None:
            raise InvalidDataError("El usuario asignado no existe")

    # ── Bitácora de boyas skimmer ────────────────
    async def record_collection(self, user: StaffUser, data: dict[str, Any]) -> SkimmerCollection:
        """Guarda el pesaje y lo refleja en `waste_collections` (por material), que alimenta el
        dashboard «Clasificación de basura»: ambos eventos salen por el WebSocket."""
        materials = {
            name: {"kg": round(float(m.get("kg", 0)), 3), "piezas": int(m.get("piezas", 0))}
            for name, m in data["materials"].items()
        }
        ts = ensure_utc(data["ts"]) if data.get("ts") else self._now()
        async with self._uow_factory() as uow:
            if await uow.stations.get(data["station_id"]) is None:
                raise NotFoundError("Estación no encontrada")
            collection = SkimmerCollection(
                station_id=data["station_id"],
                ts=ts,
                buoy_code=data["buoy_code"].strip(),
                buoy_condition=data["buoy_condition"],
                materials=materials,
                total_kg=round(sum(m["kg"] for m in materials.values()), 3),
                total_pieces=sum(m["piezas"] for m in materials.values()),
                operator_id=user.id,
                operator_name=user.name,
                notes=data.get("notes"),
                task_id=data.get("task_id"),
            )
            await uow.skimmers.add(collection)
            wastes = [
                WasteCollection(
                    station_id=collection.station_id,
                    ts=ts,
                    weight_kg=m["kg"],
                    items_count=m["piezas"],
                    waste_type=SKIMMER_MATERIALS[name],
                    collector_id=f"skimmer:{collection.buoy_code}",
                )
                for name, m in materials.items()
                if m["kg"] > 0 or m["piezas"] > 0
            ]
            for w in wastes:
                await uow.waste.add(w)
            if collection.task_id:
                task = await uow.tasks.get(collection.task_id)
                if task and task.status is not TaskStatus.DONE:
                    task.resolve(
                        f"Boya {collection.buoy_code} vaciada: {collection.total_kg:g} kg, "
                        f"{collection.total_pieces} piezas.",
                        user.id,
                        self._now(),
                    )
                    await uow.tasks.save(task)
            await uow.commit()
        events: list[Event] = [waste_event(w) for w in wastes] + [skimmer_event(collection)]
        await self._publisher.publish(events)
        return collection

    async def list_collections(
        self, station_id: UUID | None, start: datetime | None, end: datetime | None, limit: int, offset: int
    ) -> tuple[list[SkimmerCollection], int]:
        async with self._uow_factory() as uow:
            return await uow.skimmers.list(
                station_id=station_id, start=start, end=end, limit=limit, offset=offset
            )

    async def classification(
        self, station_id: UUID | None, start: datetime | None, end: datetime | None
    ) -> dict[str, Any]:
        async with self._uow_factory() as uow:
            rows = await uow.skimmers.all_in(station_id=station_id, start=start, end=end)
        totals = {name: {"kg": 0.0, "piezas": 0} for name in SKIMMER_MATERIALS}
        for row in rows:
            for name, m in row.materials.items():
                totals[name]["kg"] += m.get("kg", 0)
                totals[name]["piezas"] += int(m.get("piezas", 0))
        total_kg = sum(t["kg"] for t in totals.values())
        total_pieces = sum(t["piezas"] for t in totals.values())
        by_material = [
            {
                "material": name,
                "waste_type": SKIMMER_MATERIALS[name].value,
                "kg": round(t["kg"], 3),
                "piezas": t["piezas"],
                "pct": round(t["kg"] / total_kg * 100, 1) if total_kg else 0.0,
            }
            for name, t in sorted(totals.items(), key=lambda kv: -kv[1]["kg"])
        ]
        return {
            "total_kg": round(total_kg, 3),
            "total_piezas": total_pieces,
            "recolecciones": len(rows),
            "ultima": max((r.ts for r in rows), default=None),
            "por_material": by_material,
        }

    # ── Arranque (dev) ───────────────────────────
    async def ensure_demo_data(self) -> None:
        """Cuentas demo (contraseña `atoyac2026`) y algunas tareas de ejemplo. Idempotente."""
        async with self._uow_factory() as uow:
            users: dict[str, StaffUser] = {}
            for email, name, role in DEMO_USERS:
                existing = await uow.users.get_by_email(email)
                if existing is None:
                    existing = StaffUser(
                        email=email, name=name, role=role, password_hash=self._hash(DEMO_PASSWORD)
                    )
                    await uow.users.add(existing)
                users[email] = existing
            if await uow.tasks.count() == 0:
                stations, _ = await uow.stations.list(status=None, river=None, limit=10, offset=0)
                op = users["operador@atlmonitor.mx"].id
                s = [st.id for st in stations] or [None]
                demo = [
                    Task(
                        title="Vaciar boya skimmer SK-01",
                        kind=TaskKind.SKIMMER_COLLECTION,
                        buoy_code="SK-01",
                        station_id=s[0],
                        assigned_to=op,
                        priority=TaskPriority.URGENT,
                        description="Cesta de malla casi llena según el último reporte con IA.",
                    ),
                    Task(
                        title="Reparar barrera naranja de SK-02",
                        kind=TaskKind.REPAIR,
                        buoy_code="SK-02",
                        station_id=s[min(1, len(s) - 1)],
                        priority=TaskPriority.NORMAL,
                        description="Una de las dos barreras en V está desprendida.",
                    ),
                    Task(
                        title="Reparar anillo flotante de SK-03",
                        kind=TaskKind.REPAIR,
                        buoy_code="SK-03",
                        station_id=s[-1],
                        assigned_to=op,
                        priority=TaskPriority.URGENT,
                        description="El anillo amarillo no se ve en la foto ciudadana.",
                    ),
                    Task(
                        title="Verificar peces muertos reportados",
                        kind=TaskKind.REPORT,
                        station_id=s[-1],
                        priority=TaskPriority.URGENT,
                        description="Reporte ciudadano con severidad crítica (IA).",
                    ),
                    Task(
                        title="Revisar basura acumulada en la orilla",
                        kind=TaskKind.REPORT,
                        station_id=s[0],
                        assigned_to=op,
                        priority=TaskPriority.NORMAL,
                        description="Reporte ciudadano: botellas y bolsas junto al puente.",
                    ),
                ]
                for t in demo:
                    await uow.tasks.add(t)
            await uow.commit()
