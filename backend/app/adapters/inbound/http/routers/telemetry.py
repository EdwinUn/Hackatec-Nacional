import secrets
from typing import Annotated, Any

from fastapi import APIRouter, Body, Header
from pydantic import ValidationError

from app.adapters.inbound.http.deps import ContainerDep
from app.adapters.inbound.http.schemas import TelemetryResultOut
from app.adapters.inbound.iot_payload import IotTelemetryIn
from app.adapters.inbound.telemetry_payload import TelemetryIn
from app.domain.errors import InvalidDataError, UnauthorizedError

router = APIRouter(prefix="/telemetry", tags=["dispositivos"])


@router.post(
    "/iot",
    response_model=TelemetryResultOut,
    summary="Ingesta del nodo IoT (ESP32 / Wokwi)",
    description=(
        "Paquete JSON flexible: formato IoT (`device_id` `B-01`/`RM-01` + `ph`, `turbidity`, "
        "`temperature`, "
        "`dissolved_oxygen`, `flow_rate`, `basket_fill_pct`, `battery_pct`, `rssi`…) o el mensaje del "
        "firmware "
        "(`boya` `RM-02`/`BM-02`/`B-02` + `ph`, `temp_c`, `turb_in_ntu`, `turb_out_ntu`, `eficiencia_pct`, "
        "`bat_pct`, `gas_v`, `alerta`…). Guarda las lecturas de calidad, el estado del dispositivo y emite "
        "`device_telemetry` por `/ws/live`. Sin API key; `X-Device-Key` es opcional: si el servidor "
        "define `DEVICE_KEY` y el header viene, debe coincidir (y fuera de dev es obligatorio)."
    ),
)
async def ingest_iot(
    c: ContainerDep,
    body: Annotated[
        dict[str, Any],
        Body(description="Paquete del nodo: `device_id` (formato IoT) o `boya` (formato del firmware)"),
    ],
    x_device_key: Annotated[str | None, Header(description="Opcional: DEVICE_KEY del servidor")] = None,
):
    expected = c.settings.device_key.get_secret_value() if c.settings.device_key else None
    if expected:
        missing_and_required = x_device_key is None and not c.settings.is_dev
        wrong = x_device_key is not None and not secrets.compare_digest(x_device_key, expected)
        if missing_and_required or wrong:
            raise UnauthorizedError("X-Device-Key inválida o ausente")
    try:
        if "device_id" in body:  # formato IoT: ph, turbidity, temperature, …
            iot = IotTelemetryIn.model_validate(body)
            return await c.telemetry.ingest_iot(iot.device_id, iot.to_input())
        if body.get("boya"):  # formato del firmware: boya, ph, temp_c, turb_in_ntu, bat_pct, alerta, gas_v, …
            fw = TelemetryIn.model_validate(body)
            return await c.telemetry.ingest_iot(str(fw.boya), fw.to_input())
    except ValidationError as exc:
        raise InvalidDataError(
            "Paquete inválido", exc.errors(include_url=False, include_context=False)
        ) from exc
    raise InvalidDataError("Falta `device_id` (formato IoT) o `boya` (formato del firmware)")
