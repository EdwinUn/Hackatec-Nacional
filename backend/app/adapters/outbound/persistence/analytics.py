"""Lado de lectura: SQL agregado (date_bin, FILTER, LATERAL) que devuelve filas listas para DTOs.

Los fragmentos dinámicos son fijos (filtro por estación); todos los valores van como parámetros.
"""

import math
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.domain.enums import SensorLocation, SensorStatus, SensorType, StationStatus, WasteType

ORIGIN = "TIMESTAMPTZ '2000-01-01 00:00:00+00'"


def _bin(column: str) -> str:
    return f"date_bin(CAST(:bucket AS interval), {column}, {ORIGIN})"


def _station(alias: str, station_id: UUID | None) -> str:
    return f" AND {alias}.station_id = :station_id" if station_id else ""


class SqlAnalyticsReader:
    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        self._session_factory = session_factory

    async def _all(self, sql: str, **params: Any) -> list[dict[str, Any]]:
        params = {k: v for k, v in params.items() if f":{k}" in sql}
        async with self._session_factory() as session:
            result = await session.execute(text(sql), params)
            return [dict(row) for row in result.mappings()]

    async def latest_values(self, station_id: UUID | None, at: datetime) -> list[dict[str, Any]]:
        sql = f"""
            SELECT s.station_id, s.type, s.location, r.value, r.ts
            FROM sensors s
            JOIN LATERAL (
                SELECT value, ts FROM readings
                WHERE sensor_id = s.id AND ts <= :at
                ORDER BY ts DESC LIMIT 1
            ) r ON true
            WHERE s.status <> 'fault'{_station("s", station_id)}
        """
        rows = await self._all(sql, at=at, station_id=station_id)
        for row in rows:
            row["type"] = SensorType(row["type"])
            row["location"] = SensorLocation(row["location"])
        return rows

    async def overview_totals(
        self, station_id: UUID | None, start: datetime, end: datetime
    ) -> dict[str, Any]:
        sql = f"""
            SELECT
              (SELECT count(*) FILTER (WHERE s.status <> 'offline') FROM sensors s
                 WHERE true{_station("s", station_id)}) AS sensors_online,
              (SELECT count(*) FROM sensors s WHERE true{_station("s", station_id)}) AS sensors_total,
              b.water_in_l, b.water_clean_l, b.sludge_kg,
              w.waste_kg, w.waste_items,
              (SELECT count(*) FROM centrifuge_cycles c
                 WHERE c.status = 'running'{_station("c", station_id)}) AS cycles_running,
              (SELECT count(*) FROM alerts a
                 WHERE a.status <> 'resolved'{_station("a", station_id)}) AS alerts_open,
              (SELECT count(*) FROM alerts a
                 WHERE a.status <> 'resolved' AND a.severity = 'critical'{_station("a", station_id)})
                 AS alerts_critical_open
            FROM
              (SELECT coalesce(sum(volume_in_l), 0) AS water_in_l,
                      coalesce(sum(volume_clean_l), 0) AS water_clean_l,
                      coalesce(sum(sludge_kg), 0) AS sludge_kg
                 FROM treatment_batches b
                 WHERE b.ts >= :start AND b.ts < :end{_station("b", station_id)}) b,
              (SELECT coalesce(sum(weight_kg), 0) AS waste_kg,
                      coalesce(sum(items_count), 0)::int AS waste_items
                 FROM waste_collections w
                 WHERE w.ts >= :start AND w.ts < :end{_station("w", station_id)}) w
        """
        [row] = await self._all(sql, start=start, end=end, station_id=station_id)
        return _rounded(row)

    async def overview_trend(
        self, station_id: UUID | None, start: datetime, end: datetime, bucket: timedelta
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        params = dict(start=start, end=end, bucket=bucket, station_id=station_id)
        readings = await self._all(
            f"""SELECT {_bin("r.ts")} AS bucket, s.type, s.location, avg(r.value) AS value
                FROM readings r JOIN sensors s ON s.id = r.sensor_id
                WHERE s.status <> 'fault' AND r.ts >= :start AND r.ts < :end{_station("r", station_id)}
                GROUP BY 1, 2, 3""",
            **params,
        )
        for row in readings:
            row["type"] = SensorType(row["type"])
            row["location"] = SensorLocation(row["location"])
        water = await self._all(
            f"""SELECT {_bin("b.ts")} AS bucket, sum(volume_clean_l) AS water_clean_l
                FROM treatment_batches b
                WHERE b.ts >= :start AND b.ts < :end{_station("b", station_id)}
                GROUP BY 1""",
            **params,
        )
        return readings, water

    async def ph_series(
        self, station_id: UUID | None, start: datetime, end: datetime, bucket: timedelta
    ) -> list[dict[str, Any]]:
        sql = f"""
            SELECT {_bin("r.ts")} AS bucket, s.location,
                   avg(r.value) AS avg, min(r.value) AS min, max(r.value) AS max, count(*) AS count
            FROM readings r JOIN sensors s ON s.id = r.sensor_id
            WHERE s.type = 'ph' AND s.location IN ('inlet', 'outlet')
              AND r.ts >= :start AND r.ts < :end{_station("r", station_id)}
            GROUP BY 1, 2
            ORDER BY 1
        """
        return await self._all(sql, start=start, end=end, bucket=bucket, station_id=station_id)

    async def sensor_health(
        self, station_id: UUID | None, start: datetime, end: datetime, bucket: timedelta
    ) -> list[dict[str, Any]]:
        sql = f"""
            SELECT s.id AS sensor_id, s.station_id, st.name AS station_name, s.type, s.location,
                   s.unit, s.status, s.last_seen_at,
                   lr.value AS last_value, lr.ts AS last_reading_at,
                   coalesce(agg.cnt, 0) AS readings_count, agg.avg_quality,
                   coalesce(agg.buckets, 0) AS buckets
            FROM sensors s
            JOIN stations st ON st.id = s.station_id
            LEFT JOIN LATERAL (
                SELECT value, ts FROM readings
                WHERE sensor_id = s.id AND ts < :end
                ORDER BY ts DESC LIMIT 1
            ) lr ON true
            LEFT JOIN LATERAL (
                SELECT count(*) AS cnt, avg(quality) AS avg_quality,
                       count(DISTINCT {_bin("ts")}) AS buckets
                FROM readings
                WHERE sensor_id = s.id AND ts >= :start AND ts < :end
            ) agg ON true
            WHERE true{_station("s", station_id)}
            ORDER BY st.name, s.location, s.type
        """
        rows = await self._all(sql, start=start, end=end, bucket=bucket, station_id=station_id)
        total_buckets = max(math.ceil((end - start) / bucket), 1)
        for row in rows:
            row["uptime_pct"] = round(min(row.pop("buckets") / total_buckets, 1) * 100, 2)
            row["status"] = SensorStatus(row["status"])
            if row["avg_quality"] is not None:
                row["avg_quality"] = round(row["avg_quality"], 3)
        return rows

    async def centrifuge(
        self, station_id: UUID | None, start: datetime, end: datetime, bucket: timedelta
    ) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        where = f"c.started_at >= :start AND c.started_at < :end{_station('c', station_id)}"
        duration = "extract(epoch FROM (c.ended_at - c.started_at))::float8"
        summary_sql = f"""
            SELECT count(*) AS cycles,
                   count(*) FILTER (WHERE status = 'completed') AS completed,
                   count(*) FILTER (WHERE status = 'failed') AS failed,
                   count(*) FILTER (WHERE status = 'running') AS running,
                   avg(rpm_avg) AS rpm_avg, max(rpm_max) AS rpm_max,
                   avg(vibration_mm_s) AS vibration_avg_mm_s,
                   max(vibration_mm_s) AS vibration_max_mm_s,
                   avg(power_w) AS power_avg_w,
                   sum(power_w * {duration}) / 3.6e6 AS energy_kwh,
                   avg({duration}) AS avg_duration_s
            FROM centrifuge_cycles c WHERE {where}
        """
        series_sql = f"""
            SELECT {_bin("c.started_at")} AS bucket, count(*) AS cycles,
                   count(*) FILTER (WHERE status = 'failed') AS failed,
                   avg(rpm_avg) AS rpm_avg, avg(vibration_mm_s) AS vibration_avg_mm_s,
                   avg(power_w) AS power_avg_w
            FROM centrifuge_cycles c WHERE {where}
            GROUP BY 1 ORDER BY 1
        """
        params = dict(start=start, end=end, bucket=bucket, station_id=station_id)
        [summary] = await self._all(summary_sql, **params)
        return _rounded(summary), [_rounded(r) for r in await self._all(series_sql, **params)]

    async def water_recovery(
        self, station_id: UUID | None, start: datetime, end: datetime, bucket: timedelta
    ) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        cols = """count(*) AS batches,
                  coalesce(sum(volume_in_l), 0) AS water_in_l,
                  coalesce(sum(volume_clean_l), 0) AS water_clean_l,
                  coalesce(sum(sludge_kg), 0) AS sludge_kg"""
        where = f"b.ts >= :start AND b.ts < :end{_station('b', station_id)}"
        params = dict(start=start, end=end, bucket=bucket, station_id=station_id)
        [total] = await self._all(f"SELECT {cols} FROM treatment_batches b WHERE {where}", **params)
        series = await self._all(
            f"SELECT {_bin('b.ts')} AS bucket, {cols} FROM treatment_batches b WHERE {where} "
            "GROUP BY 1 ORDER BY 1",
            **params,
        )
        return _rounded(total), [_rounded(r) for r in series]

    async def waste(
        self, station_id: UUID | None, start: datetime, end: datetime, bucket: timedelta
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        where = f"w.ts >= :start AND w.ts < :end{_station('w', station_id)}"
        params = dict(start=start, end=end, bucket=bucket, station_id=station_id)
        by_type = await self._all(
            f"""SELECT waste_type, sum(weight_kg) AS weight_kg,
                       coalesce(sum(items_count), 0)::int AS items, count(*) AS collections
                FROM waste_collections w WHERE {where}
                GROUP BY 1 ORDER BY 2 DESC""",
            **params,
        )
        series = await self._all(
            f"""SELECT {_bin("w.ts")} AS bucket, waste_type, sum(weight_kg) AS weight_kg,
                       coalesce(sum(items_count), 0)::int AS items
                FROM waste_collections w WHERE {where}
                GROUP BY 1, 2 ORDER BY 1, 2""",
            **params,
        )
        for row in by_type + series:
            row["waste_type"] = WasteType(row["waste_type"])
        return [_rounded(r) for r in by_type], [_rounded(r) for r in series]

    async def parameter_series(
        self,
        station_id: UUID,
        parameter: SensorType,
        location: SensorLocation,
        start: datetime,
        end: datetime,
        bucket: timedelta,
    ) -> list[tuple[datetime, float]]:
        sql = f"""
            SELECT {_bin("r.ts")} AS bucket, avg(r.value) AS value
            FROM readings r JOIN sensors s ON s.id = r.sensor_id
            WHERE r.station_id = :station_id AND s.type = :type AND s.location = :location
              AND s.status <> 'fault' AND r.ts >= :start AND r.ts < :end
            GROUP BY 1 ORDER BY 1
        """
        rows = await self._all(
            sql,
            station_id=station_id,
            type=parameter.value,
            location=location.value,
            start=start,
            end=end,
            bucket=bucket,
        )
        return [(r["bucket"], r["value"]) for r in rows]

    async def stations_with_alerts(self) -> list[dict[str, Any]]:
        sql = """
            SELECT st.id AS station_id, st.name, st.river, st.latitude, st.longitude, st.status,
                   count(a.id) AS alerts_open,
                   count(a.id) FILTER (WHERE a.severity = 'critical') AS alerts_critical_open
            FROM stations st
            LEFT JOIN alerts a ON a.station_id = st.id AND a.status <> 'resolved'
            GROUP BY st.id
            ORDER BY st.name
        """
        rows = await self._all(sql)
        for row in rows:
            row["status"] = StationStatus(row["status"])
        return rows


def _rounded(row: dict[str, Any]) -> dict[str, Any]:
    return {k: round(v, 3) if isinstance(v, float) else v for k, v in row.items()}
