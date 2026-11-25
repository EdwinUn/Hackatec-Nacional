"""Entidades del dominio. Dataclasses puras: sin FastAPI, SQLAlchemy ni Redis."""

import re
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from uuid import UUID, uuid4

from app.domain.enums import (
    AlertStatus,
    CycleStatus,
    RuleKind,
    SensorLocation,
    SensorStatus,
    SensorType,
    Severity,
    StationStatus,
    WasteType,
)
from app.domain.errors import ConflictError, InvalidDataError
from app.domain.parameters import PARAMETERS
from app.domain.treatment import treatment_efficiency_pct


def utcnow() -> datetime:
    return datetime.now(UTC)


def ensure_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        raise InvalidDataError("Las fechas deben incluir zona horaria (usar UTC, ej. 2026-11-23T18:00:00Z)")
    return value.astimezone(UTC)


@dataclass(kw_only=True)
class Entity:
    id: UUID = field(default_factory=uuid4)
    created_at: datetime = field(default_factory=utcnow)
    updated_at: datetime = field(default_factory=utcnow)

    def touch(self, now: datetime | None = None) -> None:
        self.updated_at = now or utcnow()


@dataclass(kw_only=True)
class Station(Entity):
    name: str
    river: str
    latitude: float
    longitude: float
    status: StationStatus = StationStatus.ACTIVE
    installed_at: date | None = None
    description: str | None = None
    # Código del dispositivo físico (ej. "RM-01"): así se identifica la boya en MQTT/telemetría.
    code: str | None = None

    def __post_init__(self) -> None:
        if not -90 <= self.latitude <= 90 or not -180 <= self.longitude <= 180:
            raise InvalidDataError("Coordenadas fuera de rango")
        if self.code is not None:
            self.code = normalize_device_code(self.code)


DEVICE_CODE = re.compile(r"^[A-Z0-9][A-Z0-9_-]{0,31}$")


def normalize_device_code(code: str) -> str:
    normalized = code.strip().upper()
    if not DEVICE_CODE.match(normalized):
        raise InvalidDataError("code: 1–32 caracteres A–Z, 0–9, '-' o '_' (ej. RM-01)")
    return normalized


def device_code_aliases(code: str) -> list[str]:
    """Código normalizado + alias de la boya: la maqueta 3D y Wokwi la llaman «B-02» / «BM-02» (= RM-02)."""
    normalized = normalize_device_code(code)
    match = re.fullmatch(r"(?:B|BM)-0*(\d+)", normalized)
    return [normalized, f"RM-{int(match.group(1)):02d}"] if match else [normalized]


@dataclass(kw_only=True)
class Sensor(Entity):
    station_id: UUID
    type: SensorType
    location: SensorLocation
    unit: str = ""
    valid_min: float | None = None
    valid_max: float | None = None
    status: SensorStatus = SensorStatus.OFFLINE
    last_seen_at: datetime | None = None
    # valor_calibrado = valor_crudo * calibration_factor + calibration_offset
    calibration_offset: float = 0.0
    calibration_factor: float = 1.0
    calibrated_at: datetime | None = None
    model: str | None = None

    def __post_init__(self) -> None:
        spec = PARAMETERS[self.type]
        if not self.unit:
            self.unit = spec.unit
        if self.valid_min is None:
            self.valid_min = spec.physical_min
        if self.valid_max is None:
            self.valid_max = spec.physical_max
        if self.valid_min >= self.valid_max:
            raise InvalidDataError("valid_min debe ser menor que valid_max")
        if self.calibration_factor == 0:
            raise InvalidDataError("calibration_factor no puede ser 0")

    def calibrate(self, raw_value: float) -> float:
        return raw_value * self.calibration_factor + self.calibration_offset

    def in_valid_range(self, value: float) -> bool:
        return self.valid_min <= value <= self.valid_max  # type: ignore[operator]

    def mark_seen(self, ts: datetime) -> None:
        if self.last_seen_at is None or ts > self.last_seen_at:
            self.last_seen_at = ts


@dataclass(kw_only=True)
class Reading:
    """Lectura de serie de tiempo. Inmutable: no tiene updated_at."""

    sensor_id: UUID
    station_id: UUID
    ts: datetime
    value: float
    quality: float = 1.0
    id: UUID = field(default_factory=uuid4)
    created_at: datetime = field(default_factory=utcnow)


@dataclass(kw_only=True)
class CentrifugeCycle(Entity):
    station_id: UUID
    started_at: datetime
    ended_at: datetime | None = None
    status: CycleStatus = CycleStatus.RUNNING
    rpm_avg: float | None = None
    rpm_max: float | None = None
    vibration_mm_s: float | None = None
    power_w: float | None = None
    water_in_l: float | None = None
    water_out_clean_l: float | None = None
    sludge_kg: float | None = None
    failure_reason: str | None = None

    _MEASURES = (
        "rpm_avg",
        "rpm_max",
        "vibration_mm_s",
        "power_w",
        "water_in_l",
        "water_out_clean_l",
        "sludge_kg",
    )

    @property
    def is_closed(self) -> bool:
        return self.status is not CycleStatus.RUNNING

    @property
    def duration_s(self) -> float | None:
        return (self.ended_at - self.started_at).total_seconds() if self.ended_at else None

    def apply(
        self,
        *,
        status: CycleStatus | None = None,
        ended_at: datetime | None = None,
        failure_reason: str | None = None,
        **measures: float | None,
    ) -> None:
        """Actualiza mediciones y, opcionalmente, cierra el ciclo (completed|failed)."""
        if self.is_closed:
            raise ConflictError(f"El ciclo ya está cerrado ({self.status})")
        for name, value in measures.items():
            if name not in self._MEASURES:
                raise InvalidDataError(f"Campo desconocido: {name}")
            if value is not None:
                if value < 0:
                    raise InvalidDataError(f"{name} no puede ser negativo")
                setattr(self, name, value)
        if (
            self.water_in_l is not None
            and self.water_out_clean_l is not None
            and self.water_out_clean_l > self.water_in_l
        ):
            raise InvalidDataError("water_out_clean_l no puede ser mayor que water_in_l")
        if status is not None and status is not CycleStatus.RUNNING:
            end = ensure_utc(ended_at) if ended_at else utcnow()
            if end < self.started_at:
                raise InvalidDataError("ended_at no puede ser anterior a started_at")
            self.status = status
            self.ended_at = end
            if status is CycleStatus.FAILED:
                self.failure_reason = failure_reason
        self.touch()


@dataclass(kw_only=True)
class TreatmentBatch(Entity):
    """Balance de agua de un lote tratado. efficiency_pct la calcula el dominio."""

    station_id: UUID
    ts: datetime
    volume_in_l: float
    volume_clean_l: float
    cycle_id: UUID | None = None
    sludge_kg: float | None = None
    ph_in: float | None = None
    ph_out: float | None = None
    turbidity_in_ntu: float | None = None
    turbidity_out_ntu: float | None = None
    efficiency_pct: float = 0.0

    def __post_init__(self) -> None:
        self.efficiency_pct = treatment_efficiency_pct(self.volume_in_l, self.volume_clean_l)
        for name in ("ph_in", "ph_out"):
            value = getattr(self, name)
            if value is not None and not PARAMETERS[SensorType.PH].is_possible(value):
                raise InvalidDataError(f"{name} fuera de 0–14")
        for name in ("turbidity_in_ntu", "turbidity_out_ntu", "sludge_kg"):
            value = getattr(self, name)
            if value is not None and value < 0:
                raise InvalidDataError(f"{name} no puede ser negativo")


@dataclass(kw_only=True)
class WasteCollection(Entity):
    station_id: UUID
    ts: datetime
    weight_kg: float
    waste_type: WasteType
    items_count: int | None = None
    collector_id: str | None = None

    def __post_init__(self) -> None:
        if self.weight_kg < 0:
            raise InvalidDataError("weight_kg no puede ser negativo")
        if self.items_count is not None and self.items_count < 0:
            raise InvalidDataError("items_count no puede ser negativo")


@dataclass(kw_only=True)
class AlertRule(Entity):
    name: str
    kind: RuleKind
    severity: Severity
    parameter: SensorType | None = None
    location: SensorLocation | None = None
    station_id: UUID | None = None  # None = aplica a todas las estaciones
    min_value: float | None = None
    max_value: float | None = None
    enabled: bool = True
    description: str | None = None  # criterio / fuente del umbral

    def __post_init__(self) -> None:
        if self.min_value is None and self.max_value is None:
            raise InvalidDataError("La regla necesita min_value, max_value o ambos")
        if self.min_value is not None and self.max_value is not None and self.min_value > self.max_value:
            raise InvalidDataError("min_value no puede ser mayor que max_value")
        if self.kind is RuleKind.READING_RANGE and self.parameter is None:
            raise InvalidDataError("Las reglas reading_range necesitan parameter")

    def applies_to_station(self, station_id: UUID) -> bool:
        return self.enabled and (self.station_id is None or self.station_id == station_id)


@dataclass(kw_only=True)
class Alert(Entity):
    rule_id: UUID
    station_id: UUID
    subject_key: str  # qué disparó la alerta (sensor/ciclo/lote/estación); clave anti-spam
    kind: RuleKind
    severity: Severity
    message: str
    trigger_value: float
    sensor_id: UUID | None = None
    parameter: SensorType | None = None
    threshold_min: float | None = None
    threshold_max: float | None = None
    status: AlertStatus = AlertStatus.OPEN
    first_triggered_at: datetime = field(default_factory=utcnow)
    last_triggered_at: datetime = field(default_factory=utcnow)
    occurrences: int = 1
    last_notified_at: datetime | None = None  # última vez que se emitió el evento en tiempo real
    acknowledged_at: datetime | None = None
    resolved_at: datetime | None = None
    note: str | None = None

    def transition(self, new_status: AlertStatus, note: str | None = None) -> None:
        if self.status is AlertStatus.RESOLVED:
            raise ConflictError("La alerta ya está resuelta")
        if new_status is AlertStatus.OPEN:
            raise InvalidDataError("Solo se puede pasar a acknowledged o resolved")
        now = utcnow()
        if new_status is AlertStatus.ACKNOWLEDGED:
            self.acknowledged_at = now
        else:
            self.resolved_at = now
            self.acknowledged_at = self.acknowledged_at or now
        self.status = new_status
        if note:
            self.note = note
        self.touch(now)
