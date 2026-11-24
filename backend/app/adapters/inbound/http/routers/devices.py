from datetime import datetime

from fastapi import APIRouter, Depends, Query

from app.adapters.inbound.http.deps import ContainerDep, require_api_key
from app.adapters.inbound.http.schemas import DeviceTelemetryOut, TelemetryResultOut
from app.adapters.inbound.telemetry_payload import TelemetryIn

router = APIRouter(prefix="/devices", tags=["dispositivos"])


@router.post(
    "/{code}/telemetry",
    response_model=TelemetryResultOut,
    dependencies=[Depends(require_api_key)],
    summary="Telemetría plana de la boya (mismo mensaje que publica por MQTT)",
)
async def ingest_telemetry(code: str, body: TelemetryIn, c: ContainerDep):
    body.check_code(code)
    return await c.telemetry.ingest(code, body.to_input())


@router.get(
    "/{code}/telemetry/latest",
    response_model=DeviceTelemetryOut,
    summary="Último estado del dispositivo (batería, corriente, generador, bomba)",
)
async def latest_telemetry(code: str, c: ContainerDep):
    return await c.telemetry.latest(code)


@router.get(
    "/{code}/telemetry",
    response_model=list[DeviceTelemetryOut],
    summary="Historial del estado del dispositivo (más reciente primero)",
)
async def telemetry_history(
    code: str,
    c: ContainerDep,
    since: datetime | None = None,
    limit: int = Query(default=100, ge=1, le=1000),
):
    _, items = await c.telemetry.history(code, since=since, limit=limit)
    return items
