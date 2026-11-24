from uuid import UUID

from fastapi import APIRouter, Depends, status

from app.adapters.inbound.http.deps import ContainerDep, PaginationDep, require_api_key, require_key_or_staff
from app.adapters.inbound.http.schemas import (
    Page,
    SensorIn,
    SensorOut,
    SensorPatch,
    StationIn,
    StationOut,
    StationPatch,
)
from app.domain.enums import SensorLocation, SensorStatus, SensorType, StationStatus

# Efectos de una orden de trabajo: también con el Bearer del personal (no viaja la llave en el teléfono).
key_or_staff = [Depends(require_key_or_staff)]
router = APIRouter(tags=["catálogo"])
# Escribir en el catálogo también requiere la llave (no hay usuarios finales todavía).
auth = [Depends(require_api_key)]


@router.get("/stations", response_model=Page[StationOut], summary="Listar estaciones")
async def list_stations(
    c: ContainerDep,
    page: PaginationDep,
    status: StationStatus | None = None,
    river: str | None = None,
):
    items, total = await c.catalog.list_stations(
        status=status, river=river, limit=page.limit, offset=page.offset
    )
    return Page(items=items, total=total, limit=page.limit, offset=page.offset)


@router.post(
    "/stations",
    response_model=StationOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=auth,
    summary="Crear estación",
)
async def create_station(body: StationIn, c: ContainerDep):
    return await c.catalog.create_station(body.model_dump())


@router.get("/stations/{station_id}", response_model=StationOut, summary="Detalle de estación")
async def get_station(station_id: UUID, c: ContainerDep):
    return await c.catalog.get_station(station_id)


@router.patch(
    "/stations/{station_id}",
    response_model=StationOut,
    dependencies=key_or_staff,
    summary="Actualizar estación (p. ej. estado)",
)
async def update_station(station_id: UUID, body: StationPatch, c: ContainerDep):
    return await c.catalog.update_station(station_id, body.model_dump(exclude_unset=True))


@router.get("/sensors", response_model=Page[SensorOut], summary="Listar sensores")
async def list_sensors(
    c: ContainerDep,
    page: PaginationDep,
    station_id: UUID | None = None,
    type: SensorType | None = None,
    location: SensorLocation | None = None,
    status: SensorStatus | None = None,
):
    items, total = await c.catalog.list_sensors(
        station_id=station_id,
        type=type,
        location=location,
        status=status,
        limit=page.limit,
        offset=page.offset,
    )
    return Page(items=items, total=total, limit=page.limit, offset=page.offset)


@router.post(
    "/sensors",
    response_model=SensorOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=auth,
    summary="Crear sensor",
)
async def create_sensor(body: SensorIn, c: ContainerDep):
    return await c.catalog.create_sensor(body.model_dump(exclude_none=True))


@router.get("/sensors/{sensor_id}", response_model=SensorOut, summary="Detalle de sensor")
async def get_sensor(sensor_id: UUID, c: ContainerDep):
    return await c.catalog.get_sensor(sensor_id)


@router.patch(
    "/sensors/{sensor_id}",
    response_model=SensorOut,
    dependencies=key_or_staff,
    summary="Actualizar estado, rango válido o calibración",
)
async def update_sensor(sensor_id: UUID, body: SensorPatch, c: ContainerDep):
    return await c.catalog.update_sensor(sensor_id, body.model_dump(exclude_unset=True))
