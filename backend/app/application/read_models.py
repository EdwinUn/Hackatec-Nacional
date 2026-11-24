"""Modelos de lectura (DTOs) del dashboard.

Hexagonal pragmática: el lado de lectura usa Pydantic directamente para que el adaptador SQL
y los routers compartan el mismo esquema sin mappers intermedios.
"""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from app.domain.enums import SensorLocation, SensorStatus, SensorType, StationStatus, WasteType
from app.domain.wqi import WqiCategory, WqiResult


class WqiComponentOut(BaseModel):
    parameter: SensorType
    value: float
    sub_index: float
    weight: float


class WqiOut(BaseModel):
    score: float = Field(description="0–100 (valor de prototipo, ver README)")
    category: WqiCategory
    dominant_parameter: SensorType | None = Field(
        description="Parámetro con el sub-índice más bajo: el que más empeora la calidad"
    )
    components: list[WqiComponentOut]

    @classmethod
    def from_result(cls, result: WqiResult | None) -> "WqiOut | None":
        if result is None:
            return None
        worst = min(result.components.items(), key=lambda kv: kv[1].sub_index, default=(None, None))[0]
        return cls(
            score=result.score,
            category=result.category,
            dominant_parameter=worst,
            components=[
                WqiComponentOut(
                    parameter=p, value=round(c.value, 3), sub_index=c.sub_index, weight=round(c.weight, 4)
                )
                for p, c in result.components.items()
            ],
        )


class LatestValue(BaseModel):
    value: float
    ts: datetime


class Overview(BaseModel):
    station_id: UUID | None
    start: datetime = Field(serialization_alias="from")
    end: datetime = Field(serialization_alias="to")
    wqi: WqiOut | None = Field(description="WQI del agua del río/entrada (lo que entra a la máquina)")
    wqi_outlet: WqiOut | None = Field(description="WQI del agua que regresa al río")
    ph_inlet: LatestValue | None
    ph_outlet: LatestValue | None
    sensors_online: int
    sensors_total: int
    water_in_l: float
    water_clean_l: float
    sludge_kg: float
    efficiency_pct: float | None
    waste_kg: float
    waste_items: int
    cycles_running: int
    alerts_open: int
    alerts_critical_open: int
    trend_bucket: str = Field(description="Tamaño de bucket de `trend` (1h hasta 48 h de rango, 1d después)")
    trend: list["TrendPoint"] = Field(description="Serie corta para sparklines de los KPI")


class TrendPoint(BaseModel):
    bucket: datetime
    wqi: float | None = Field(description="WQI del agua cruda (río + entrada) en el bucket")
    ph_inlet: float | None
    ph_outlet: float | None
    water_clean_l: float


class Agg(BaseModel):
    avg: float
    min: float
    max: float
    count: int


class PhPoint(BaseModel):
    bucket: datetime
    inlet: Agg | None = None
    outlet: Agg | None = None


class PhSeries(BaseModel):
    station_id: UUID | None
    bucket: str
    points: list[PhPoint]
    inlet_avg: float | None
    outlet_avg: float | None
    avg_shift_toward_neutral: float | None = Field(
        description="|pH_entrada−7| − |pH_salida−7| promedio. Positivo = la máquina acerca a neutro."
    )


class SensorHealthItem(BaseModel):
    sensor_id: UUID
    station_id: UUID
    station_name: str
    type: SensorType
    location: SensorLocation
    unit: str
    status: SensorStatus
    last_seen_at: datetime | None
    last_value: float | None
    last_reading_at: datetime | None
    readings_count: int
    avg_quality: float | None
    uptime_pct: float = Field(description="% de buckets del rango con al menos una lectura")


class CentrifugeSummary(BaseModel):
    cycles: int
    completed: int
    failed: int
    running: int
    failure_rate_pct: float | None
    rpm_avg: float | None
    rpm_max: float | None
    vibration_avg_mm_s: float | None
    vibration_max_mm_s: float | None
    power_avg_w: float | None
    energy_kwh: float | None = Field(description="Σ power_w · duración de ciclos cerrados")
    avg_duration_s: float | None


class CentrifugePoint(BaseModel):
    bucket: datetime
    cycles: int
    failed: int
    rpm_avg: float | None
    vibration_avg_mm_s: float | None
    power_avg_w: float | None


class CentrifugeAnalytics(BaseModel):
    summary: CentrifugeSummary
    series: list[CentrifugePoint]


class WaterTotals(BaseModel):
    batches: int
    water_in_l: float
    water_clean_l: float
    water_lost_l: float
    sludge_kg: float
    efficiency_pct: float | None


class WaterPoint(WaterTotals):
    bucket: datetime


class WaterRecovery(BaseModel):
    total: WaterTotals
    series: list[WaterPoint]


class WasteByType(BaseModel):
    waste_type: WasteType
    weight_kg: float
    items: int
    collections: int


class WastePoint(BaseModel):
    bucket: datetime
    waste_type: WasteType
    weight_kg: float
    items: int


class WasteAnalytics(BaseModel):
    total_kg: float
    total_items: int
    by_type: list[WasteByType]
    series: list[WastePoint]


class SeriesPoint(BaseModel):
    ts: datetime
    value: float


class ForecastPointOut(BaseModel):
    ts: datetime
    value: float
    lower: float
    upper: float


class PhForecast(BaseModel):
    station_id: UUID
    location: SensorLocation
    method: str
    lookback_hours: int
    horizon_hours: int
    samples: int
    slope_per_hour: float | None
    residual_std: float | None
    history: list[SeriesPoint]
    points: list[ForecastPointOut]
    note: str | None = None


class Hotspot(BaseModel):
    station_id: UUID
    name: str
    river: str
    latitude: float
    longitude: float
    status: StationStatus
    wqi: WqiOut | None
    alerts_open: int
    alerts_critical_open: int
    last_reading_at: datetime | None
