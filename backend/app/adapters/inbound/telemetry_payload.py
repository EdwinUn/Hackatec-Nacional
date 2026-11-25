"""Mensaje de telemetría de la boya, tal como lo publica el firmware del ESP32.

Lo comparten el router HTTP y el puente MQTT. Los nombres de campo son los del firmware
(`firmware/boya-rm01/sketch.ino`, en español); `extra="ignore"` deja que el firmware agregue campos
sin romper la ingesta. Si un sensor no responde, el firmware omite su clave: aquí queda en `None`.
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
from app.domain.entities import device_code_aliases
from app.domain.errors import InvalidDataError
from app.domain.telemetry import CHANNELS

_AWARE = TypeAdapter(AwareDatetime)

#: AT+CSQ responde 99 cuando el módem no sabe la señal.
CSQ_UNKNOWN = 99


def csq_to_dbm(csq: int | None) -> float | None:
    """CSQ (3GPP TS 27.007) → dBm: 0 = −113 dBm o menos, 31 = −51 dBm o más, 99 = desconocido."""
    if csq is None or csq == CSQ_UNKNOWN:
        return None
    return float(-113 + 2 * csq)


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
    gas_v: float | None = Field(default=None, description="Sensor de gas (V)")
    # Campos del firmware con la electrónica completa (ADS1115 ×2, YF-S401, ACS712, MPU6050, A7670SA).
    ph_out: float | None = Field(default=None, description="pH después de los filtros")
    caudal_lpm: float | None = Field(default=None, ge=0, description="Caudal de la bomba, YF-S401 (L/min)")
    litros_total: float | None = Field(default=None, ge=0, description="Agua procesada desde el arranque (L)")
    cesta_pct: float | None = Field(default=None, ge=0, le=100, description="Cesta llena, JSN-SR04T (%)")
    bomba_a: float | None = Field(default=None, ge=0, description="Corriente de la bomba, ACS712 (A)")
    ciclos_bomba: int | None = Field(default=None, ge=0, description="Encendidos de la bomba")
    inclinacion_deg: float | None = Field(default=None, ge=0, le=180, description="Inclinación, MPU6050 (°)")
    golpe: bool | None = Field(default=None, description="Golpe detectado por el MPU6050")
    senal_csq: int | None = Field(default=None, ge=0, le=99, description="CSQ del módem, 99 = sin dato")

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
        if self.boya is not None and device_code_aliases(self.boya)[-1] != device_code_aliases(code)[-1]:
            raise InvalidDataError(f"boya={self.boya} no coincide con el código {code}")

    def to_input(self) -> TelemetryInput:
        return TelemetryInput(
            values={name: v for name in CHANNELS if (v := getattr(self, name, None)) is not None},
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
            gas_v=self.gas_v,
            flow_rate_lpm=self.caudal_lpm,
            basket_fill_pct=self.cesta_pct,
            signal_csq=None if self.senal_csq == CSQ_UNKNOWN else self.senal_csq,
            rssi_dbm=csq_to_dbm(self.senal_csq),
            pump_current_a=self.bomba_a,
            water_liters_total=self.litros_total,
            pump_cycles=self.ciclos_bomba,
            tilt_deg=self.inclinacion_deg,
            shock=self.golpe,
        )
