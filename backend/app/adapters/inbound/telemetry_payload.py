"""Mensaje de telemetría de la boya, tal como lo publica el firmware del ESP32.

Lo comparten el router HTTP y el puente MQTT. Los nombres de campo son los del firmware
(en español); `extra="ignore"` deja que el firmware agregue campos sin romper la ingesta.
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
from app.domain.errors import InvalidDataError
from app.domain.telemetry import CHANNELS

_AWARE = TypeAdapter(AwareDatetime)


class TelemetryIn(BaseModel):
    model_config = ConfigDict(
        extra="ignore",
        json_schema_extra={
            "examples": [
                {
                    "boya": "RM-01",
                    "n": 42,
                    "ph": 6.9,
                    "tds_ppm": 410,
                    "temp_c": 22.0,
                    "turb_in_ntu": 180,
                    "turb_out_ntu": 12,
                    "eficiencia_pct": 93.3,
                    "bat_v": 11.8,
                    "bat_pct": 78,
                    "rio_ms": 0.9,
                    "gen_v": 14.2,
                    "freno": False,
                    "bomba": True,
                    "alerta": False,
                }
            ]
        },
    )

    boya: str | None = Field(default=None, description="Código de la boya; si viene, debe coincidir")
    n: int | None = Field(default=None, ge=0, description="Contador de envíos del firmware")
    ts: AwareDatetime | None = Field(
        default=None,
        description="ISO-8601 con zona o epoch en s. Si falta o no se entiende, se usa la hora de llegada",
    )
    ph: float | None = None
    tds_ppm: float | None = None
    temp_c: float | None = None
    turb_in_ntu: float | None = None
    turb_out_ntu: float | None = None
    eficiencia_pct: float | None = Field(default=None, description="Eficiencia calculada por el firmware")
    bat_v: float | None = Field(default=None, ge=0)
    bat_pct: float | None = Field(default=None, ge=0, le=100)
    rio_ms: float | None = Field(default=None, ge=0, description="Velocidad de la corriente (m/s)")
    gen_w: float | None = Field(default=None, ge=0, description="Potencia del generador (W)")
    gen_v: float | None = Field(default=None, ge=0, description="Voltaje del generador (V)")
    freno: bool | None = Field(default=None, description="Resistencia de descarga (freno del molino) activa")
    bomba: bool | None = None
    alerta: bool | None = None

    @field_validator("ts", mode="before")
    @classmethod
    def _unreadable_ts_is_none(cls, value: Any) -> Any:
        # Sin NTP el firmware puede mandar "sin-hora": no se pierde el mensaje por eso.
        try:
            return _AWARE.validate_python(value) if value is not None else None
        except ValidationError:
            return None

    def check_code(self, code: str) -> None:
        """El código viene en la ruta/tópico; `boya` en el cuerpo es opcional pero no puede contradecirlo."""
        if self.boya is not None and self.boya.strip().upper() != code.strip().upper():
            raise InvalidDataError(f"boya={self.boya} no coincide con el código {code}")

    def to_input(self) -> TelemetryInput:
        return TelemetryInput(
            values={name: getattr(self, name) for name in CHANNELS if getattr(self, name) is not None},
            ts=self.ts,
            seq=self.n,
            battery_v=self.bat_v,
            battery_pct=self.bat_pct,
            river_speed_ms=self.rio_ms,
            generator_w=self.gen_w,
            generator_v=self.gen_v,
            brake_on=self.freno,
            pump_on=self.bomba,
            alarm_on=self.alerta,
            device_efficiency_pct=self.eficiencia_pct,
        )
