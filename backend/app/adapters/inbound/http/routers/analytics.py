from datetime import timedelta
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query

from app.adapters.inbound.http.deps import BucketQuery, ContainerDep, TimeRangeDep
from app.application.read_models import (
    CentrifugeAnalytics,
    CriticalPoint,
    Hotspot,
    Overview,
    PhForecast,
    PhSeries,
    SensorHealthItem,
    WasteAnalytics,
    WaterRecovery,
)
from app.application.time_range import Bucket, TimeRange
from app.domain.enums import SensorLocation

router = APIRouter(tags=["dashboard"])
StationQuery = Annotated[UUID | None, Query(description="Omitir = todas las estaciones")]


@router.get(
    "/dashboard/overview", response_model=Overview, response_model_by_alias=True, summary="KPIs del dashboard"
)
async def overview(c: ContainerDep, tr: TimeRangeDep, station_id: StationQuery = None):
    return await c.analytics.overview(station_id, tr)


@router.get("/analytics/ph", response_model=PhSeries, summary="pH entrada vs. salida por bucket")
async def ph(
    c: ContainerDep, tr: TimeRangeDep, station_id: StationQuery = None, bucket: BucketQuery = Bucket.M5
):
    tr.check_buckets(bucket, c.settings.max_buckets)
    return await c.analytics.ph_series(station_id, tr, bucket)


@router.get(
    "/analytics/sensors/health",
    response_model=list[SensorHealthItem],
    summary="Estado, última lectura y % de uptime por sensor",
)
async def sensors_health(c: ContainerDep, tr: TimeRangeDep, station_id: StationQuery = None):
    return await c.analytics.sensors_health(station_id, tr)


@router.get(
    "/analytics/centrifuge",
    response_model=CentrifugeAnalytics,
    summary="Ciclos, RPM, vibración, consumo y tasa de fallas",
)
async def centrifuge(
    c: ContainerDep, tr: TimeRangeDep, station_id: StationQuery = None, bucket: BucketQuery = Bucket.H1
):
    tr.check_buckets(bucket, c.settings.max_buckets)
    return await c.analytics.centrifuge(station_id, tr, bucket)


@router.get(
    "/analytics/water-recovery",
    response_model=WaterRecovery,
    summary="Litros entrada vs. limpios vs. lodo y eficiencia",
)
async def water_recovery(
    c: ContainerDep, tr: TimeRangeDep, station_id: StationQuery = None, bucket: BucketQuery = Bucket.H1
):
    tr.check_buckets(bucket, c.settings.max_buckets)
    return await c.analytics.water_recovery(station_id, tr, bucket)


@router.get("/analytics/waste", response_model=WasteAnalytics, summary="kg por tipo y periodo")
async def waste(
    c: ContainerDep, tr: TimeRangeDep, station_id: StationQuery = None, bucket: BucketQuery = Bucket.H1
):
    tr.check_buckets(bucket, c.settings.max_buckets)
    return await c.analytics.waste(station_id, tr, bucket)


@router.get(
    "/analytics/forecast/ph", response_model=PhForecast, summary="Proyección simple de pH (regresión lineal)"
)
async def forecast_ph(
    c: ContainerDep,
    station_id: UUID,
    horizon: Annotated[int, Query(ge=1, le=48, description="Horas a proyectar")] = 6,
    lookback: Annotated[int, Query(ge=1, le=168, description="Horas de historia a usar")] = 6,
    location: SensorLocation = SensorLocation.INLET,
):
    now = c.clock()
    tr = TimeRange(now - timedelta(hours=lookback), now)
    return await c.analytics.ph_forecast(station_id, location, tr, timedelta(hours=horizon))


@router.get(
    "/analytics/critical-points",
    response_model=list[CriticalPoint],
    summary="Ranking de puntos críticos (índice de criticidad con motivos)",
)
async def critical_points(c: ContainerDep, tr: TimeRangeDep):
    return await c.analytics.critical_points(tr)


@router.get(
    "/analytics/hotspots",
    response_model=list[Hotspot],
    summary="Estaciones geolocalizadas con su WQI actual (mapa de puntos críticos)",
)
async def hotspots(c: ContainerDep):
    return await c.analytics.hotspots(c.clock())
