"""Telemetría de dispositivos (boya ESP32): un mensaje plano → lecturas + estado del dispositivo.

Llega por HTTP (`POST /devices/{code}/telemetry`) o por MQTT (`riomonitor/{code}/telemetria`);
ambos adaptadores llaman a este caso de uso.
"""

from datetime import UTC, datetime
from uuid import UUID

from app.application.commands import IngestResult, ReadingInput, TelemetryInput, TelemetryResult
from app.application.events import device_telemetry_event
from app.application.ports import Clock, EventPublisher, UnitOfWorkFactory
from app.application.services.ingestion import MAX_FUTURE_SKEW, IngestionService
from app.domain.entities import Station, device_code_aliases, ensure_utc
from app.domain.errors import NotFoundError
from app.domain.telemetry import CHANNELS, DeviceTelemetry, resolve_channels

# Antes de esta fecha el reloj del ESP32 no está sincronizado (sin NTP arranca en 1970).
CLOCK_SYNCED_AFTER = datetime(2024, 1, 1, tzinfo=UTC)


class TelemetryService:
    def __init__(
        self,
        uow_factory: UnitOfWorkFactory,
        ingestion: IngestionService,
        publisher: EventPublisher,
        clock: Clock,
    ) -> None:
        self._uow_factory = uow_factory
        self._ingestion = ingestion
        self._publisher = publisher
        self._now = clock

    def _timestamp(self, device_ts: datetime | None) -> datetime:
        """Hora del dispositivo si es creíble; si no (sin NTP, adelantada), la de llegada."""
        now = self._now()
        if device_ts is None:
            return now
        ts = ensure_utc(device_ts)
        return ts if CLOCK_SYNCED_AFTER <= ts <= now + MAX_FUTURE_SKEW else now

    async def _station(self, code: str) -> Station:
        async with self._uow_factory() as uow:
            for candidate in device_code_aliases(code):
                station = await uow.stations.get_by_code(candidate)
                if station is not None:
                    return station
        raise NotFoundError(f"No hay estación con code={code}")

    async def ingest_iot(self, device_id: str, data: TelemetryInput) -> TelemetryResult:
        """Entrada del nodo IoT: acepta el código de la estación (RM-01) o su alias (B-01, BM-01)."""
        return await self.ingest(device_id, data)

    async def ingest(self, code: str, data: TelemetryInput) -> TelemetryResult:
        ts = self._timestamp(data.ts)
        station = await self._station(code)
        async with self._uow_factory() as uow:
            sensors, _ = await uow.sensors.list(station_id=station.id, limit=1000)
        channels = resolve_channels(sensors)

        values = {k: v for k, v in data.values.items() if k in CHANNELS and v is not None}
        items = [ReadingInput(channels[k].id, ts, v) for k, v in values.items() if k in channels]
        readings = await self._ingestion.ingest_readings(items) if items else IngestResult(received=0)

        telemetry = DeviceTelemetry(
            station_id=station.id,
            ts=ts,
            seq=data.seq,
            battery_v=data.battery_v,
            battery_pct=data.battery_pct,
            river_speed_ms=data.river_speed_ms,
            generator_w=data.generator_w,
            generator_v=data.generator_v,
            pump_on=data.pump_on,
            brake_on=data.brake_on,
            alarm_on=data.alarm_on,
            device_efficiency_pct=data.device_efficiency_pct,
            flow_rate_lpm=data.flow_rate_lpm,
            basket_fill_pct=data.basket_fill_pct,
            rssi_dbm=data.rssi_dbm,
            gas_v=data.gas_v,
            values={k: float(v) for k, v in values.items()} or None,
        )
        async with self._uow_factory() as uow:
            await uow.telemetry.add(telemetry)
            await uow.commit()
        await self._publisher.publish([device_telemetry_event(telemetry, station.code or code)])

        return TelemetryResult(
            station_id=station.id,
            code=station.code or code,
            ts=ts,
            readings=readings,
            unmapped=sorted(k for k in values if k not in channels),
        )

    async def history(
        self, code: str, *, since: datetime | None, limit: int
    ) -> tuple[UUID, list[DeviceTelemetry]]:
        station = await self._station(code)
        async with self._uow_factory() as uow:
            items = await uow.telemetry.list(
                station_id=station.id, since=ensure_utc(since) if since else None, limit=limit
            )
        return station.id, items

    async def latest(self, code: str) -> DeviceTelemetry:
        _, items = await self.history(code, since=None, limit=1)
        if not items:
            raise NotFoundError(f"La estación {code} todavía no envía telemetría")
        return items[0]
