"""Consultas del dashboard. Las agregaciones las hace SQL (AnalyticsReader); aquí solo se
combinan con reglas del dominio (WQI, proyección)."""

from collections import defaultdict
from datetime import timedelta
from statistics import fmean
from uuid import UUID

from app.application.ports import AnalyticsReader
from app.application.read_models import (
    Agg,
    CentrifugeAnalytics,
    CentrifugePoint,
    CentrifugeSummary,
    CriticalIssue,
    CriticalPoint,
    ForecastPointOut,
    Hotspot,
    LatestValue,
    Overview,
    PhForecast,
    PhPoint,
    PhSeries,
    SensorHealthItem,
    SeriesPoint,
    TrendPoint,
    WasteAnalytics,
    WasteByType,
    WastePoint,
    WaterPoint,
    WaterRecovery,
    WaterTotals,
    WqiOut,
)
from app.application.time_range import Bucket, TimeRange
from app.domain.criticality import CriticalityInput, score_criticality
from app.domain.enums import SensorLocation, SensorType
from app.domain.forecast import linear_forecast
from app.domain.treatment import NEUTRAL_PH
from app.domain.wqi import DEFAULT_WQI_CONFIG, WqiConfig, WqiResult, compute_wqi

RAW_LOCATIONS = (SensorLocation.INLET, SensorLocation.RIVER)


def _efficiency(water_in: float, water_clean: float) -> float | None:
    return round(water_clean / water_in * 100, 2) if water_in else None


class AnalyticsService:
    def __init__(self, reader: AnalyticsReader, wqi_config: WqiConfig = DEFAULT_WQI_CONFIG) -> None:
        self._reader = reader
        self._wqi = wqi_config

    def _wqi_by_station(
        self, latest: list[dict], locations: tuple[SensorLocation, ...]
    ) -> dict[UUID, WqiResult | None]:
        """Último valor por parámetro (si hay río y entrada, se promedian) → WQI por estación."""
        values: dict[UUID, dict[SensorType, list[float]]] = defaultdict(lambda: defaultdict(list))
        for row in latest:
            if row["location"] in locations:
                values[row["station_id"]][row["type"]].append(row["value"])
        return {
            sid: compute_wqi({p: fmean(v) for p, v in params.items()}, self._wqi)
            for sid, params in values.items()
        }

    def _wqi_of_rows(self, rows: list[dict], locations: tuple[SensorLocation, ...]) -> WqiResult | None:
        """WQI sobre el promedio de cada parámetro (varias sondas/estaciones se promedian)."""
        values: dict[SensorType, list[float]] = defaultdict(list)
        for row in rows:
            if row["location"] in locations:
                values[row["type"]].append(row["value"])
        return compute_wqi({p: fmean(v) for p, v in values.items()}, self._wqi)

    def _wqi_combined(self, latest: list[dict], locations: tuple[SensorLocation, ...]) -> WqiOut | None:
        return WqiOut.from_result(self._wqi_of_rows(latest, locations))

    async def _trend(self, station_id: UUID | None, tr: TimeRange) -> tuple[Bucket, list[TrendPoint]]:
        bucket = Bucket.H1 if tr.end - tr.start <= timedelta(hours=48) else Bucket.D1
        readings, water = await self._reader.overview_trend(station_id, tr.start, tr.end, bucket.delta)
        by_bucket: dict = defaultdict(list)
        for row in readings:
            by_bucket[row["bucket"]].append(row)
        clean = {row["bucket"]: row["water_clean_l"] for row in water}

        def ph(rows: list[dict], location: SensorLocation) -> float | None:
            v = [r["value"] for r in rows if r["type"] == SensorType.PH and r["location"] == location]
            return round(fmean(v), 3) if v else None

        points = []
        for b in sorted(set(by_bucket) | set(clean)):
            rows = by_bucket.get(b, [])
            wqi = self._wqi_of_rows(rows, RAW_LOCATIONS)
            points.append(
                TrendPoint(
                    bucket=b,
                    wqi=wqi.score if wqi else None,
                    ph_inlet=ph(rows, SensorLocation.INLET),
                    ph_outlet=ph(rows, SensorLocation.OUTLET),
                    water_clean_l=round(clean.get(b, 0.0), 2),
                )
            )
        return bucket, points

    @staticmethod
    def _latest_ph(latest: list[dict], location: SensorLocation) -> LatestValue | None:
        rows = [r for r in latest if r["type"] == SensorType.PH and r["location"] == location]
        if not rows:
            return None
        return LatestValue(value=round(fmean(r["value"] for r in rows), 3), ts=max(r["ts"] for r in rows))

    async def overview(self, station_id: UUID | None, tr: TimeRange) -> Overview:
        latest = await self._reader.latest_values(station_id, tr.end)
        totals = await self._reader.overview_totals(station_id, tr.start, tr.end)
        trend_bucket, trend = await self._trend(station_id, tr)
        return Overview(
            trend_bucket=trend_bucket.value,
            trend=trend,
            station_id=station_id,
            start=tr.start,
            end=tr.end,
            wqi=self._wqi_combined(latest, RAW_LOCATIONS),
            wqi_outlet=self._wqi_combined(latest, (SensorLocation.OUTLET,)),
            ph_inlet=self._latest_ph(latest, SensorLocation.INLET),
            ph_outlet=self._latest_ph(latest, SensorLocation.OUTLET),
            efficiency_pct=_efficiency(totals["water_in_l"], totals["water_clean_l"]),
            **totals,
        )

    async def ph_series(self, station_id: UUID | None, tr: TimeRange, bucket: Bucket) -> PhSeries:
        rows = await self._reader.ph_series(station_id, tr.start, tr.end, bucket.delta)
        points: dict = {}
        for row in rows:
            point = points.setdefault(row["bucket"], PhPoint(bucket=row["bucket"]))
            agg = Agg(avg=round(row["avg"], 3), min=row["min"], max=row["max"], count=row["count"])
            setattr(point, SensorLocation(row["location"]).value, agg)
        ordered = sorted(points.values(), key=lambda p: p.bucket)
        inlet = [p.inlet.avg for p in ordered if p.inlet]
        outlet = [p.outlet.avg for p in ordered if p.outlet]
        paired = [p for p in ordered if p.inlet and p.outlet]
        shift = (
            round(
                fmean(
                    abs(p.inlet.avg - NEUTRAL_PH) - abs(p.outlet.avg - NEUTRAL_PH)  # type: ignore[union-attr]
                    for p in paired
                ),
                3,
            )
            if paired
            else None
        )
        return PhSeries(
            station_id=station_id,
            bucket=bucket.value,
            points=ordered,
            inlet_avg=round(fmean(inlet), 3) if inlet else None,
            outlet_avg=round(fmean(outlet), 3) if outlet else None,
            avg_shift_toward_neutral=shift,
        )

    async def sensors_health(self, station_id: UUID | None, tr: TimeRange) -> list[SensorHealthItem]:
        # Uptime en ventanas de 5 min: el simulador y los sensores reportan cada ≤ 1 min.
        rows = await self._reader.sensor_health(station_id, tr.start, tr.end, timedelta(minutes=5))
        return [SensorHealthItem(**row) for row in rows]

    async def centrifuge(self, station_id: UUID | None, tr: TimeRange, bucket: Bucket) -> CentrifugeAnalytics:
        summary, series = await self._reader.centrifuge(station_id, tr.start, tr.end, bucket.delta)
        closed = summary["completed"] + summary["failed"]
        summary["failure_rate_pct"] = round(summary["failed"] / closed * 100, 2) if closed else None
        return CentrifugeAnalytics(
            summary=CentrifugeSummary(**summary),
            series=[CentrifugePoint(**row) for row in series],
        )

    async def water_recovery(self, station_id: UUID | None, tr: TimeRange, bucket: Bucket) -> WaterRecovery:
        total, series = await self._reader.water_recovery(station_id, tr.start, tr.end, bucket.delta)

        def build(row: dict, cls: type) -> WaterTotals:
            return cls(
                **row,
                water_lost_l=round(row["water_in_l"] - row["water_clean_l"], 2),
                efficiency_pct=_efficiency(row["water_in_l"], row["water_clean_l"]),
            )

        return WaterRecovery(
            total=build(total, WaterTotals),
            series=[build(row, WaterPoint) for row in series],  # type: ignore[misc]
        )

    async def waste(self, station_id: UUID | None, tr: TimeRange, bucket: Bucket) -> WasteAnalytics:
        by_type, series = await self._reader.waste(station_id, tr.start, tr.end, bucket.delta)
        return WasteAnalytics(
            total_kg=round(sum(r["weight_kg"] for r in by_type), 2),
            total_items=sum(r["items"] for r in by_type),
            by_type=[WasteByType(**r) for r in by_type],
            series=[WastePoint(**r) for r in series],
        )

    async def ph_forecast(
        self,
        station_id: UUID,
        location: SensorLocation,
        tr: TimeRange,
        horizon: timedelta,
    ) -> PhForecast:
        # Se ajusta sobre promedios de 15 min para suavizar ruido sin ocultar la tendencia.
        step = timedelta(minutes=15)
        history = await self._reader.parameter_series(
            station_id, SensorType.PH, location, tr.start, tr.end, step
        )
        lookback_h = round((tr.end - tr.start).total_seconds() / 3600)
        result = linear_forecast(history, horizon=horizon, step=step, clamp=(0.0, 14.0))
        base = dict(
            station_id=station_id,
            location=location,
            method="Regresión lineal (mínimos cuadrados) sobre promedios de 15 min; "
            "banda ±1.96·σ de residuos. Valor de prototipo.",
            lookback_hours=lookback_h,
            horizon_hours=round(horizon.total_seconds() / 3600),
            history=[SeriesPoint(ts=ts, value=round(v, 3)) for ts, v in history],
        )
        if result is None:
            return PhForecast(
                **base,
                samples=len(history),
                slope_per_hour=None,
                residual_std=None,
                points=[],
                note="Datos insuficientes (se necesitan ≥ 3 puntos)",
            )
        return PhForecast(
            **base,
            samples=result.samples,
            slope_per_hour=round(result.slope_per_hour, 4),
            residual_std=round(result.residual_std, 4),
            points=[
                ForecastPointOut(
                    ts=p.ts, value=round(p.value, 3), lower=round(p.lower, 3), upper=round(p.upper, 3)
                )
                for p in result.points
            ],
        )

    async def critical_points(self, tr: TimeRange) -> list[CriticalPoint]:
        """Ranking de estaciones por índice de criticidad, con los motivos de cada una."""
        latest = await self._reader.latest_values(None, tr.end)
        wqi = self._wqi_by_station(latest, RAW_LOCATIONS)
        stations = await self._reader.stations_with_alerts()
        active_rows, recurrent_rows = await self._reader.alert_pressure(tr.start, tr.end)

        active: dict = defaultdict(lambda: {"critical": 0, "warning": 0, "info": 0})
        for row in active_rows:
            active[row["station_id"]][row["severity"]] = row["n"]
        issues: dict = defaultdict(list)
        for row in recurrent_rows:
            issues[row["station_id"]].append(row)

        points = []
        for s in stations:
            sid = s["station_id"]
            w = wqi.get(sid)
            wqi_out = WqiOut.from_result(w)
            act = active[sid]
            occurrences = sum(i["occurrences"] for i in issues[sid])
            result = score_criticality(
                CriticalityInput(
                    wqi=w.score if w else None,
                    critical_active=act["critical"],
                    warning_active=act["warning"],
                    info_active=act["info"],
                    occurrences=occurrences,
                )
            )
            top = [CriticalIssue(**i) for i in issues[sid][:3]]
            points.append(
                CriticalPoint(
                    rank=0,
                    station_id=sid,
                    name=s["name"],
                    river=s["river"],
                    latitude=s["latitude"],
                    longitude=s["longitude"],
                    score=result.score,
                    level=result.level,
                    components=result.components,
                    wqi=w.score if w else None,
                    wqi_category=w.category if w else None,
                    dominant_parameter=wqi_out.dominant_parameter if wqi_out else None,
                    alerts_active=dict(act),
                    occurrences=occurrences,
                    top_issues=top,
                    reasons=_reasons(result.components, wqi_out, act, top),
                )
            )
        points.sort(key=lambda p: p.score, reverse=True)
        for i, p in enumerate(points, start=1):
            p.rank = i
        return points

    async def hotspots(self, at) -> list[Hotspot]:
        latest = await self._reader.latest_values(None, at)
        wqi = self._wqi_by_station(latest, RAW_LOCATIONS)
        last_ts: dict[UUID, object] = {}
        for row in latest:
            last_ts[row["station_id"]] = max(row["ts"], last_ts.get(row["station_id"], row["ts"]))
        stations = await self._reader.stations_with_alerts()
        return [
            Hotspot(
                **s,
                wqi=WqiOut.from_result(wqi.get(s["station_id"])),
                last_reading_at=last_ts.get(s["station_id"]),
            )
            for s in stations
        ]


PARAMETER_LABEL = {
    SensorType.PH: "pH",
    SensorType.TURBIDITY: "turbidez",
    SensorType.TEMPERATURE: "temperatura",
    SensorType.DISSOLVED_OXYGEN: "oxígeno disuelto",
    SensorType.CONDUCTIVITY: "conductividad",
    SensorType.TDS: "sólidos disueltos",
}


def _reasons(
    components: dict[str, float], wqi: WqiOut | None, active: dict, top: list[CriticalIssue]
) -> list[str]:
    """Motivos en español, ordenados por el componente que más aporta al índice."""
    texts: dict[str, str | None] = {
        "calidad": (
            f"Calidad del agua {wqi.category.value} (WQI {wqi.score:g})"
            + (
                f", sobre todo por {PARAMETER_LABEL[wqi.dominant_parameter]}"
                if wqi.dominant_parameter
                else ""
            )
            if wqi
            else None
        ),
        "alertas": (
            ", ".join(
                f"{n} {one if n == 1 else many}"
                for n, one, many in (
                    (active["critical"], "alerta crítica activa", "alertas críticas activas"),
                    (active["warning"], "advertencia activa", "advertencias activas"),
                )
                if n
            )
            or None
        ),
        "recurrencia": (
            f"Lo más repetido: {top[0].rule} ({top[0].occurrences} veces)"
            if top and top[0].occurrences
            else None
        ),
    }
    order = sorted(components, key=lambda k: components[k], reverse=True)
    reasons = [texts[k] for k in order if texts.get(k)]
    return reasons or ["Sin alertas ni datos de calidad en el periodo"]
