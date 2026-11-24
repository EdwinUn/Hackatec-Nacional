from uuid import UUID

from fastapi import APIRouter, Depends, status

from app.adapters.inbound.http.deps import ContainerDep, PaginationDep, require_api_key, require_key_or_staff
from app.adapters.inbound.http.schemas import (
    BatchIn,
    BatchOut,
    CycleOut,
    CyclePatchIn,
    CycleStartIn,
    HeartbeatIn,
    IngestResultOut,
    Page,
    ReadingsBatchIn,
    SensorOut,
    WasteIn,
    WasteOut,
)
from app.application.commands import ReadingInput
from app.application.services.operations import CyclePatch
from app.domain.enums import CycleStatus
from app.domain.errors import InvalidDataError

# Efectos de una orden de trabajo: también con el Bearer del personal (no viaja la llave en el teléfono).
key_or_staff = [Depends(require_key_or_staff)]
router = APIRouter(tags=["ingesta"])
auth = [Depends(require_api_key)]


@router.post(
    "/readings",
    response_model=IngestResultOut,
    dependencies=auth,
    summary="Ingerir un lote de lecturas (idempotente por sensor_id + ts)",
)
async def ingest_readings(body: ReadingsBatchIn, c: ContainerDep):
    if len(body.readings) > c.settings.max_readings_per_request:
        raise InvalidDataError(f"Máximo {c.settings.max_readings_per_request} lecturas por petición")
    items = [ReadingInput(r.sensor_id, r.ts, r.value, r.quality) for r in body.readings]
    return await c.ingestion.ingest_readings(items)


@router.post(
    "/sensors/{sensor_id}/heartbeat",
    response_model=SensorOut,
    dependencies=auth,
    summary="Señal de vida del sensor (sin lectura)",
)
async def heartbeat(sensor_id: UUID, c: ContainerDep, body: HeartbeatIn | None = None):
    return await c.ingestion.heartbeat(sensor_id, body.ts if body else None)


@router.post(
    "/centrifuge-cycles",
    response_model=CycleOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=auth,
    summary="Iniciar un ciclo de centrifugado",
)
async def start_cycle(body: CycleStartIn, c: ContainerDep):
    measures = body.model_dump(exclude={"station_id", "started_at"}, exclude_none=True)
    return await c.operations.start_cycle(body.station_id, body.started_at, measures)


@router.patch(
    "/centrifuge-cycles/{cycle_id}",
    response_model=CycleOut,
    dependencies=auth,
    summary="Actualizar mediciones o cerrar (completed|failed) un ciclo",
)
async def update_cycle(cycle_id: UUID, body: CyclePatchIn, c: ContainerDep):
    measures = body.model_dump(exclude={"status", "ended_at", "failure_reason"}, exclude_none=True)
    patch = CyclePatch(
        status=body.status, ended_at=body.ended_at, failure_reason=body.failure_reason, measures=measures
    )
    return await c.operations.update_cycle(cycle_id, patch)


@router.get("/centrifuge-cycles", response_model=Page[CycleOut], summary="Listar ciclos")
async def list_cycles(
    c: ContainerDep,
    page: PaginationDep,
    station_id: UUID | None = None,
    status: CycleStatus | None = None,
):
    items, total = await c.operations.list_cycles(
        station_id=station_id, status=status, limit=page.limit, offset=page.offset
    )
    return Page(items=items, total=total, limit=page.limit, offset=page.offset)


@router.get("/centrifuge-cycles/{cycle_id}", response_model=CycleOut, summary="Detalle de ciclo")
async def get_cycle(cycle_id: UUID, c: ContainerDep):
    return await c.operations.get_cycle(cycle_id)


@router.post(
    "/treatment-batches",
    response_model=BatchOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=auth,
    summary="Registrar un lote tratado (balance de agua)",
)
async def record_batch(body: BatchIn, c: ContainerDep):
    return await c.operations.record_batch(body.model_dump())


@router.post(
    "/waste-collections",
    response_model=WasteOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=key_or_staff,
    summary="Registrar basura recolectada",
)
async def record_waste(body: WasteIn, c: ContainerDep):
    return await c.operations.record_waste(body.model_dump())
