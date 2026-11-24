"""DTOs HTTP (Pydantic). Solo traducen JSON ↔ casos de uso."""

from datetime import date, datetime
from typing import Annotated, Any, ClassVar, Literal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, computed_field, model_validator

from app.domain.enums import (
    AlertStatus,
    BuoyCondition,
    CycleStatus,
    RuleKind,
    SensorLocation,
    SensorStatus,
    SensorType,
    Severity,
    StationStatus,
    TaskKind,
    TaskPriority,
    TaskStatus,
    UserRole,
    WasteType,
)
from app.domain.treatment import compare_treatment

NonNeg = Annotated[float, Field(ge=0)]
EX_STATION = "6f1c2a8e-3b4d-4e5f-8a9b-0c1d2e3f4a5b"
EX_SENSOR = "0b7e9c1a-2d3f-4a5b-9c8d-7e6f5a4b3c2d"
EX_CYCLE = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"


class Out(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class PatchModel(BaseModel):
    """PATCH parcial: un campo omitido no cambia; `null` solo se acepta en `nullable`."""

    nullable: ClassVar[frozenset[str]] = frozenset()

    @model_validator(mode="before")
    @classmethod
    def _reject_null(cls, data: Any) -> Any:
        if isinstance(data, dict):
            bad = sorted(k for k, v in data.items() if v is None and k not in cls.nullable)
            if bad:
                raise ValueError(f"Estos campos no aceptan null: {', '.join(bad)}")
        return data


class Page[T](BaseModel):
    items: list[T]
    total: int
    limit: int
    offset: int


# ── Ingesta ─────────────────────────────────────
class ReadingIn(BaseModel):
    sensor_id: UUID
    ts: AwareDatetime = Field(description="Instante de la medición, ISO-8601 con zona (UTC)")
    value: float = Field(description="Valor crudo; el backend aplica la calibración del sensor")
    quality: float = Field(default=1.0, ge=0, le=1, description="Calidad de señal 0–1")


class ReadingsBatchIn(BaseModel):
    readings: list[ReadingIn] = Field(min_length=1)

    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "readings": [
                        {
                            "sensor_id": EX_SENSOR,
                            "ts": "2026-11-23T18:00:00Z",
                            "value": 6.82,
                            "quality": 0.97,
                        },
                        {"sensor_id": EX_SENSOR, "ts": "2026-11-23T18:00:05Z", "value": 6.85},
                    ]
                }
            ]
        }
    )


class RejectionOut(Out):
    index: int
    sensor_id: UUID
    ts: datetime
    reason: Literal["unknown_sensor", "impossible_value", "future_timestamp"]
    detail: str


class IngestResultOut(Out):
    received: int
    accepted: int
    duplicates: int = Field(description="Ya existían (sensor_id, ts); se ignoran (idempotencia)")
    rejected: list[RejectionOut]
    alerts_triggered: int


class HeartbeatIn(BaseModel):
    ts: AwareDatetime | None = Field(default=None, description="Default: hora del servidor")


class CycleMeasures(BaseModel):
    rpm_avg: NonNeg | None = None
    rpm_max: NonNeg | None = None
    vibration_mm_s: NonNeg | None = None
    power_w: NonNeg | None = None
    water_in_l: NonNeg | None = None
    water_out_clean_l: NonNeg | None = None
    sludge_kg: NonNeg | None = None


class CycleStartIn(CycleMeasures):
    station_id: UUID
    started_at: AwareDatetime | None = Field(default=None, description="Default: ahora")

    model_config = ConfigDict(
        json_schema_extra={
            "examples": [{"station_id": EX_STATION, "started_at": "2026-11-23T18:00:00Z", "rpm_avg": 2800}]
        }
    )


class CyclePatchIn(CycleMeasures):
    status: CycleStatus | None = Field(
        default=None, description="completed|failed cierran el ciclo; running solo actualiza"
    )
    ended_at: AwareDatetime | None = Field(default=None, description="Default al cerrar: ahora")
    failure_reason: str | None = Field(default=None, max_length=500)

    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {"rpm_avg": 2850, "rpm_max": 3010, "vibration_mm_s": 2.8, "power_w": 750},
                {
                    "status": "completed",
                    "ended_at": "2026-11-23T18:20:00Z",
                    "water_in_l": 520,
                    "water_out_clean_l": 468,
                    "sludge_kg": 3.4,
                },
            ]
        }
    )


class CycleOut(Out):
    id: UUID
    station_id: UUID
    started_at: datetime
    ended_at: datetime | None
    status: CycleStatus
    rpm_avg: float | None
    rpm_max: float | None
    vibration_mm_s: float | None
    power_w: float | None
    water_in_l: float | None
    water_out_clean_l: float | None
    sludge_kg: float | None
    failure_reason: str | None
    duration_s: float | None
    created_at: datetime
    updated_at: datetime


class BatchIn(BaseModel):
    station_id: UUID
    cycle_id: UUID | None = None
    ts: AwareDatetime | None = Field(default=None, description="Default: ahora")
    volume_in_l: float = Field(gt=0)
    volume_clean_l: NonNeg
    sludge_kg: NonNeg | None = None
    ph_in: float | None = Field(default=None, ge=0, le=14)
    ph_out: float | None = Field(default=None, ge=0, le=14)
    turbidity_in_ntu: NonNeg | None = None
    turbidity_out_ntu: NonNeg | None = None

    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "station_id": EX_STATION,
                    "cycle_id": EX_CYCLE,
                    "ts": "2026-11-23T18:20:00Z",
                    "volume_in_l": 520,
                    "volume_clean_l": 468,
                    "sludge_kg": 3.4,
                    "ph_in": 5.6,
                    "ph_out": 6.9,
                    "turbidity_in_ntu": 85,
                    "turbidity_out_ntu": 3.2,
                }
            ]
        }
    )


class BatchOut(Out):
    id: UUID
    station_id: UUID
    cycle_id: UUID | None
    ts: datetime
    volume_in_l: float
    volume_clean_l: float
    sludge_kg: float | None
    ph_in: float | None
    ph_out: float | None
    turbidity_in_ntu: float | None
    turbidity_out_ntu: float | None
    efficiency_pct: float = Field(description="volume_clean_l / volume_in_l · 100 (dominio)")
    created_at: datetime

    @computed_field
    @property
    def ph_shift_toward_neutral(self) -> float | None:
        return compare_treatment(
            ph_in=self.ph_in, ph_out=self.ph_out, turbidity_in=None, turbidity_out=None
        ).ph_shift_toward_neutral

    @computed_field
    @property
    def turbidity_removal_pct(self) -> float | None:
        return compare_treatment(
            ph_in=None, ph_out=None, turbidity_in=self.turbidity_in_ntu, turbidity_out=self.turbidity_out_ntu
        ).turbidity_removal_pct


class WasteIn(BaseModel):
    station_id: UUID
    ts: AwareDatetime | None = Field(default=None, description="Default: ahora")
    weight_kg: NonNeg
    items_count: int | None = Field(default=None, ge=0)
    waste_type: WasteType
    collector_id: str | None = Field(default=None, max_length=120, description="Robot/mecanismo")

    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "station_id": EX_STATION,
                    "ts": "2026-11-23T18:30:00Z",
                    "weight_kg": 1.25,
                    "items_count": 14,
                    "waste_type": "plastic",
                    "collector_id": "banda-1",
                }
            ]
        }
    )


class WasteOut(Out):
    id: UUID
    station_id: UUID
    ts: datetime
    weight_kg: float
    items_count: int | None
    waste_type: WasteType
    collector_id: str | None
    created_at: datetime


# ── Catálogo ────────────────────────────────────
class StationIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    river: str = Field(min_length=1, max_length=120)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    status: StationStatus = StationStatus.ACTIVE
    installed_at: date | None = None
    description: str | None = None

    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "name": "Atoyac · Parque Lineal",
                    "river": "Río Atoyac",
                    "latitude": 19.0185,
                    "longitude": -98.2435,
                    "installed_at": "2026-11-01",
                }
            ]
        }
    )


class StationPatch(PatchModel):
    nullable = frozenset({"installed_at", "description"})

    name: str | None = Field(default=None, min_length=1, max_length=120)
    river: str | None = Field(default=None, min_length=1, max_length=120)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    status: StationStatus | None = None
    installed_at: date | None = None
    description: str | None = None


class StationOut(Out):
    id: UUID
    name: str
    river: str
    latitude: float
    longitude: float
    status: StationStatus
    installed_at: date | None
    description: str | None
    created_at: datetime
    updated_at: datetime


class SensorIn(BaseModel):
    station_id: UUID
    type: SensorType
    location: SensorLocation
    unit: str | None = Field(default=None, max_length=16, description="Default según el tipo")
    valid_min: float | None = Field(default=None, description="Default: límite físico del tipo")
    valid_max: float | None = None
    calibration_offset: float = 0.0
    calibration_factor: float = 1.0
    model: str | None = Field(default=None, max_length=120)

    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "station_id": EX_STATION,
                    "type": "ph",
                    "location": "inlet",
                    "valid_min": 2,
                    "valid_max": 12,
                }
            ]
        }
    )


class SensorPatch(PatchModel):
    nullable = frozenset({"calibrated_at", "model", "valid_min", "valid_max"})

    status: SensorStatus | None = None
    valid_min: float | None = None
    valid_max: float | None = None
    calibration_offset: float | None = None
    calibration_factor: float | None = None
    calibrated_at: AwareDatetime | None = None
    model: str | None = Field(default=None, max_length=120)


class SensorOut(Out):
    id: UUID
    station_id: UUID
    type: SensorType
    location: SensorLocation
    unit: str
    valid_min: float
    valid_max: float
    status: SensorStatus
    last_seen_at: datetime | None
    calibration_offset: float
    calibration_factor: float
    calibrated_at: datetime | None
    model: str | None
    created_at: datetime
    updated_at: datetime


# ── Alertas ─────────────────────────────────────
class AlertOut(Out):
    id: UUID
    rule_id: UUID
    station_id: UUID
    sensor_id: UUID | None
    subject_key: str
    kind: RuleKind
    parameter: SensorType | None
    severity: Severity
    status: AlertStatus
    message: str
    trigger_value: float
    threshold_min: float | None
    threshold_max: float | None
    first_triggered_at: datetime
    last_triggered_at: datetime
    occurrences: int
    acknowledged_at: datetime | None
    resolved_at: datetime | None
    note: str | None


class AlertPatch(BaseModel):
    status: Literal[AlertStatus.ACKNOWLEDGED, AlertStatus.RESOLVED]
    note: str | None = Field(default=None, max_length=1000)

    model_config = ConfigDict(
        json_schema_extra={
            "examples": [{"status": "acknowledged", "note": "Revisando descarga aguas arriba"}]
        }
    )


class AlertRuleIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    kind: RuleKind
    severity: Severity
    parameter: SensorType | None = None
    location: SensorLocation | None = None
    station_id: UUID | None = Field(default=None, description="null = todas las estaciones")
    min_value: float | None = None
    max_value: float | None = None
    enabled: bool = True
    description: str | None = None

    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "name": "pH fuera del rango aceptable",
                    "kind": "reading_range",
                    "severity": "warning",
                    "parameter": "ph",
                    "min_value": 6.5,
                    "max_value": 8.5,
                }
            ]
        }
    )


class AlertRulePatch(PatchModel):
    nullable = frozenset({"location", "min_value", "max_value", "description"})

    name: str | None = Field(default=None, min_length=1, max_length=200)
    severity: Severity | None = None
    location: SensorLocation | None = None
    min_value: float | None = None
    max_value: float | None = None
    enabled: bool | None = None
    description: str | None = None


class AlertRuleOut(Out):
    id: UUID
    name: str
    kind: RuleKind
    severity: Severity
    parameter: SensorType | None
    location: SensorLocation | None
    station_id: UUID | None
    min_value: float | None
    max_value: float | None
    enabled: bool
    description: str | None
    created_at: datetime
    updated_at: datetime


class HealthOut(BaseModel):
    status: Literal["ok", "degraded"]
    api: str
    postgres: str
    redis: str
    version: str


# ── Personal operativo ─────────────────────────────────────────────────────────
class LoginIn(BaseModel):
    email: str = Field(min_length=3, max_length=200)
    password: str = Field(min_length=1, max_length=200)

    model_config = ConfigDict(
        json_schema_extra={"examples": [{"email": "operador@atlmonitor.mx", "password": "atoyac2026"}]}
    )


class StaffUserOut(Out):
    id: UUID
    name: str
    email: str
    role: UserRole
    active: bool


class LoginOut(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int = Field(description="Segundos")
    user: StaffUserOut


class TaskOut(Out):
    id: UUID
    title: str
    description: str
    kind: TaskKind
    priority: TaskPriority
    status: TaskStatus
    assigned_to: UUID | None
    station_id: UUID | None
    buoy_code: str | None
    closing_note: str | None
    resolved_at: datetime | None
    resolved_by: UUID | None
    created_at: datetime
    updated_at: datetime


class TaskCounts(BaseModel):
    asignadas: int
    reparaciones_pendientes: int
    urgentes: int
    listos: int


class TaskPage(Page[TaskOut]):
    counts: TaskCounts


class TaskIn(BaseModel):
    title: str = Field(min_length=3, max_length=200)
    kind: TaskKind
    description: str = Field(default="", max_length=2000)
    priority: TaskPriority = TaskPriority.NORMAL
    assigned_to: UUID | None = None
    station_id: UUID | None = None
    buoy_code: str | None = Field(default=None, max_length=60)


class TaskPatch(BaseModel):
    """Atender: `{"status": "in_progress"}`. Resolver: `{"status": "done", "closing_note": "…"}`."""

    status: TaskStatus | None = None
    closing_note: str | None = Field(default=None, max_length=2000)
    priority: TaskPriority | None = None
    assigned_to: UUID | None = None


class MaterialIn(BaseModel):
    kg: NonNeg = 0
    piezas: int = Field(default=0, ge=0)


class CollectionIn(BaseModel):
    station_id: UUID
    buoy_code: str = Field(min_length=1, max_length=60, examples=["SK-01"])
    buoy_condition: BuoyCondition
    plastico: MaterialIn = MaterialIn()
    organico: MaterialIn = MaterialIn()
    vidrio: MaterialIn = MaterialIn()
    otros: MaterialIn = MaterialIn()
    metal: MaterialIn = MaterialIn()
    ts: AwareDatetime | None = Field(default=None, description="Default: ahora")
    notes: str | None = Field(default=None, max_length=1000)
    task_id: UUID | None = Field(default=None, description="Si se manda, la tarea de vaciado se cierra sola")

    def materials(self) -> dict[str, dict[str, float]]:
        return {
            n: {"kg": getattr(self, n).kg, "piezas": getattr(self, n).piezas}
            for n in ("plastico", "organico", "vidrio", "otros", "metal")
        }


class CollectionOut(Out):
    id: UUID
    station_id: UUID
    ts: datetime
    buoy_code: str
    buoy_condition: BuoyCondition
    materials: dict[str, MaterialIn]
    total_kg: float
    total_pieces: int
    operator_name: str | None
    notes: str | None
    task_id: UUID | None


class MaterialTotal(BaseModel):
    material: Literal["plastico", "organico", "vidrio", "otros", "metal"]
    waste_type: WasteType
    kg: float
    piezas: int
    pct: float = Field(description="% del peso total")


class ClassificationOut(BaseModel):
    total_kg: float
    total_piezas: int
    recolecciones: int
    ultima: datetime | None
    por_material: list[MaterialTotal]
