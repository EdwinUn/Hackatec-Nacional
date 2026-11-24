"""Bandeja del operador y bitácora de vaciado de boyas skimmer (personal con sesión)."""

from uuid import UUID

from fastapi import APIRouter, Query, status
from pydantic import AwareDatetime

from app.adapters.inbound.http.deps import ContainerDep, CurrentUser, PaginationDep
from app.adapters.inbound.http.schemas import Page
from app.adapters.inbound.http.schemas_field_ops import (
    ClassificationOut,
    CollectionIn,
    CollectionOut,
    TaskCounts,
    TaskIn,
    TaskOut,
    TaskPage,
    TaskPatch,
)
from app.domain.enums import TaskView

router = APIRouter(tags=["operaciones · bandeja y skimmers"])


@router.get(
    "/tasks",
    response_model=TaskPage,
    summary="Bandeja del operador",
    description="`view`: `asignadas` (mías sin cerrar), `reparaciones_pendientes`, `urgentes`, "
    "`listos` (resueltas). Sin `view` devuelve todas. `counts` trae el número de cada pestaña.",
)
async def list_tasks(user: CurrentUser, c: ContainerDep, page: PaginationDep, view: TaskView | None = None):
    items, total, counts = await c.field_ops.list_tasks(user, view, page.limit, page.offset)
    return TaskPage(
        items=items,
        total=total,
        limit=page.limit,
        offset=page.offset,
        counts=TaskCounts(**{v.value: n for v, n in counts.items()}),
    )


@router.post(
    "/tasks", response_model=TaskOut, status_code=status.HTTP_201_CREATED, summary="Crear tarea (supervisor)"
)
async def create_task(body: TaskIn, user: CurrentUser, c: ContainerDep):
    return await c.field_ops.create_task(user, body.model_dump())


@router.get("/tasks/{task_id}", response_model=TaskOut, summary="Detalle de una tarea")
async def get_task(task_id: UUID, user: CurrentUser, c: ContainerDep):
    return await c.field_ops.get_task(task_id)


@router.patch(
    "/tasks/{task_id}",
    response_model=TaskOut,
    summary="Atender, reasignar o resolver una tarea",
    description="Resolver exige `status: done` y `closing_note` (mín. 3 caracteres). "
    "Una tarea resuelta no cambia (409).",
)
async def patch_task(task_id: UUID, body: TaskPatch, user: CurrentUser, c: ContainerDep):
    return await c.field_ops.update_task(user, task_id, body.model_dump(exclude_unset=True))


@router.post(
    "/skimmers/recoleccion",
    response_model=CollectionOut,
    status_code=status.HTTP_201_CREATED,
    summary="Registrar el vaciado de una boya skimmer",
    description="Guarda el pesaje por material y el estado físico de la boya, "
    "suma los kg a «Clasificación de basura» "
    "y emite `waste_collected` (uno por material) y `skimmer_collected` por `/ws/live`.",
)
async def record_collection(body: CollectionIn, user: CurrentUser, c: ContainerDep):
    data = body.model_dump(exclude={"plastico", "organico", "vidrio", "otros", "metal"})
    data["materials"] = body.materials()
    return await c.field_ops.record_collection(user, data)


@router.get("/skimmers/recoleccion", response_model=Page[CollectionOut], summary="Bitácora de recolecciones")
async def list_collections(
    c: ContainerDep,
    page: PaginationDep,
    station_id: UUID | None = None,
    start: AwareDatetime | None = Query(default=None, alias="from"),
    end: AwareDatetime | None = Query(default=None, alias="to"),
):
    items, total = await c.field_ops.list_collections(station_id, start, end, page.limit, page.offset)
    return Page(items=items, total=total, limit=page.limit, offset=page.offset)


@router.get(
    "/skimmers/clasificacion-basura",
    response_model=ClassificationOut,
    summary="Totales acumulados por material",
    description="Suma de todas las recolecciones (o del rango `from`/`to`): kg, piezas y % por material.",
)
async def classification(
    c: ContainerDep,
    station_id: UUID | None = None,
    start: AwareDatetime | None = Query(default=None, alias="from"),
    end: AwareDatetime | None = Query(default=None, alias="to"),
):
    return await c.field_ops.classification(station_id, start, end)
