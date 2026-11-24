from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query, Request, status

from app.adapters.inbound.http.deps import ContainerDep, CurrentUser
from app.adapters.inbound.http.schemas_ops import WorkOrderIn, WorkOrderOut, WorkOrderPatchIn
from app.domain.errors import InvalidDataError
from app.domain.operations import WorkOrderStatus, WorkOrderType

router = APIRouter(tags=["operaciones · órdenes de trabajo"])


def _statuses(raw: str | None) -> list[WorkOrderStatus]:
    try:
        return [WorkOrderStatus(s.strip()) for s in raw.split(",") if s.strip()] if raw else []
    except ValueError as exc:
        raise InvalidDataError(f"Estado de orden desconocido en «{raw}»") from exc


@router.get(
    "/work-orders", response_model=list[WorkOrderOut], summary="Órdenes (un técnico solo ve las suyas)"
)
async def list_orders(
    request: Request,
    c: ContainerDep,
    me: CurrentUser,
    assigned_to: UUID | None = None,
    status: Annotated[str | None, Query(description="Uno o varios, separados por coma")] = None,
    type: WorkOrderType | None = None,
):
    views = await c.work_orders.list_orders(
        me, assigned_to=assigned_to, statuses=_statuses(status), type=type
    )
    return [WorkOrderOut.of(v, request) for v in views]


@router.get("/work-orders/{order_id}", response_model=WorkOrderOut, summary="Detalle de orden")
async def get_order(order_id: UUID, request: Request, c: ContainerDep, me: CurrentUser):
    return WorkOrderOut.of(await c.work_orders.get(me, order_id), request)


@router.post(
    "/work-orders",
    response_model=WorkOrderOut,
    status_code=status.HTTP_201_CREATED,
    summary="Crear orden (supervisor/admin)",
)
async def create_order(body: WorkOrderIn, request: Request, c: ContainerDep, me: CurrentUser):
    data = body.model_dump()
    if body.location is not None:
        data["location"] = body.location.model_dump(exclude_none=True)
    return WorkOrderOut.of(await c.work_orders.create(me, data), request)


@router.patch("/work-orders/{order_id}", response_model=WorkOrderOut, summary="Avance, cierre o reasignación")
async def update_order(
    order_id: UUID, body: WorkOrderPatchIn, request: Request, c: ContainerDep, me: CurrentUser
):
    return WorkOrderOut.of(await c.work_orders.update(me, order_id, body.changes()), request)
