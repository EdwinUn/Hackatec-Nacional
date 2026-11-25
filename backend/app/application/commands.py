"""Datos de entrada de los casos de uso (independientes de HTTP)."""

from dataclasses import dataclass, field
from datetime import datetime
from uuid import UUID


@dataclass(frozen=True, slots=True)
class ReadingInput:
    sensor_id: UUID
    ts: datetime
    value: float
    quality: float = 1.0


@dataclass(frozen=True, slots=True)
class Rejection:
    index: int
    sensor_id: UUID
    ts: datetime
    reason: str  # unknown_sensor | impossible_value | future_timestamp
    detail: str


@dataclass(slots=True)
class IngestResult:
    received: int
    accepted: int = 0
    duplicates: int = 0
    rejected: list[Rejection] = field(default_factory=list)
    alerts_triggered: int = 0


@dataclass(frozen=True, slots=True)
class TelemetryInput:
    """Mensaje plano de la boya. `values` usa los nombres de campo del firmware (ver
    domain/telemetry.CHANNELS); el resto es estado del dispositivo."""

    values: dict[str, float]
    ts: datetime | None = None
    seq: int | None = None
    battery_v: float | None = None
    battery_pct: float | None = None
    river_speed_ms: float | None = None
    generator_w: float | None = None
    generator_v: float | None = None
    pump_on: bool | None = None
    brake_on: bool | None = None
    alarm_on: bool | None = None
    device_efficiency_pct: float | None = None
    flow_rate_lpm: float | None = None
    basket_fill_pct: float | None = None
    rssi_dbm: float | None = None
    gas_v: float | None = None
    signal_csq: int | None = None
    pump_current_a: float | None = None
    water_liters_total: float | None = None
    pump_cycles: int | None = None
    tilt_deg: float | None = None
    shock: bool | None = None


@dataclass(slots=True)
class TelemetryResult:
    station_id: UUID
    code: str
    ts: datetime
    readings: IngestResult
    unmapped: list[str] = field(default_factory=list)  # campos sin sensor en la estación
