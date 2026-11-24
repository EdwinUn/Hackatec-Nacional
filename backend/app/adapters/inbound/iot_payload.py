"""Paquete JSON flexible del nodo IoT (ESP32 en Wokwi) → `TelemetryInput`.

Nombres en inglés y unidades simples. Todo es opcional salvo `device_id`; los campos que el nodo
agregue después se ignoran (`extra="ignore"`), y un texto en un campo numérico se descarta en vez de
rechazar el paquete completo (un sensor desconectado no debe tumbar el envío).
"""

from typing import Any

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    TypeAdapter,
    ValidationError,
    field_validator,
)

from app.application.commands import TelemetryInput

_NUMBER = TypeAdapter(float)
_AWARE = TypeAdapter(AwareDatetime)

#: campo del paquete → nombre de canal de la estación (ver domain/telemetry.CHANNELS)
QUALITY_FIELDS = {
    "ph": "ph",
    "turbidity": "turb_in_ntu",
    "temperature": "temp_c",
    "dissolved_oxygen": "do_mgl",
    "tds": "tds_ppm",
}


class IotTelemetryIn(BaseModel):
    model_config = ConfigDict(
        extra="ignore",
        json_schema_extra={
            "examples": [
                {
                    "device_id": "B-01",
                    "ph": 6.9,
                    "turbidity": 180,
                    "temperature": 22.4,
                    "dissolved_oxygen": 5.8,
                    "flow_rate": 12.5,
                    "river_speed_ms": 0.9,
                    "basket_fill_pct": 37,
                    "battery_pct": 78,
                    "rssi": -61,
                }
            ]
        },
    )

    device_id: str = Field(
        min_length=1, max_length=40, description="B-01 (alias) o RM-01 (código de la estación)"
    )
    ts: AwareDatetime | None = Field(default=None, description="ISO-8601 con zona; si falta, hora de llegada")
    seq: int | None = Field(default=None, ge=0)
    ph: float | None = Field(default=None, description="pH (0–14)")
    turbidity: float | None = Field(default=None, description="NTU del agua que entra")
    temperature: float | None = Field(default=None, description="°C")
    dissolved_oxygen: float | None = Field(default=None, description="mg/L")
    tds: float | None = Field(default=None, description="mg/L")
    flow_rate: float | None = Field(default=None, description="Caudal de la bomba (L/min)")
    river_speed_ms: float | None = Field(default=None, description="Corriente del río (m/s)")
    basket_fill_pct: float | None = Field(default=None, description="Llenado de la cesta (0–100)")
    battery_pct: float | None = Field(default=None, description="0–100")
    battery_v: float | None = None
    rssi: float | None = Field(default=None, description="dBm (negativo)")
    pump_on: bool | None = None
    alarm_on: bool | None = None

    @field_validator("*", mode="before")
    @classmethod
    def _bad_value_is_none(cls, value: Any, info) -> Any:
        if info.field_name == "device_id" or value is None:
            return value
        try:
            if info.field_name == "ts":
                return _AWARE.validate_python(value)
            if info.field_name in ("pump_on", "alarm_on"):
                return bool(value)
            return _NUMBER.validate_python(value) if not isinstance(value, bool) else None
        except ValidationError:
            return None

    @field_validator("basket_fill_pct", "battery_pct", mode="after")
    @classmethod
    def _percentage(cls, value: float | None) -> float | None:
        return None if value is None else min(100.0, max(0.0, value))

    def to_input(self) -> TelemetryInput:
        values = {
            channel: v for field, channel in QUALITY_FIELDS.items() if (v := getattr(self, field)) is not None
        }
        speed = None if self.river_speed_ms is None else max(0.0, self.river_speed_ms)
        return TelemetryInput(
            values=values,
            ts=self.ts,
            seq=self.seq,
            battery_v=self.battery_v,
            battery_pct=self.battery_pct,
            river_speed_ms=speed,
            pump_on=self.pump_on,
            alarm_on=self.alarm_on,
            flow_rate_lpm=self.flow_rate,
            basket_fill_pct=self.basket_fill_pct,
            rssi_dbm=self.rssi,
        )
