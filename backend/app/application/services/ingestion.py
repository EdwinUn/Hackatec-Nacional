"""Casos de uso de ingesta: lecturas de sensores y heartbeats."""

import logging
from collections.abc import Sequence
from datetime import datetime, timedelta
from uuid import UUID

from app.application.commands import IngestResult, ReadingInput, Rejection
from app.application.events import (
    Event,
    alert_event,
    reading_event,
    sensor_status_event,
)
from app.application.ports import Clock, EventPublisher, UnitOfWork, UnitOfWorkFactory
from app.domain.alerting import evaluate_reading
from app.domain.entities import Alert, Reading, Sensor, ensure_utc
from app.domain.enums import RuleKind, SensorStatus
from app.domain.errors import NotFoundError
from app.domain.parameters import PARAMETERS
from app.domain.sensor_health import SensorHealthPolicy, evaluate_sensor_health

log = logging.getLogger(__name__)

MAX_FUTURE_SKEW = timedelta(minutes=5)


def evaluate_health(
    sensor: Sensor, recent: list[tuple[float, float]], now: datetime, policy: SensorHealthPolicy
) -> SensorStatus:
    spec = PARAMETERS[sensor.type]
    return evaluate_sensor_health(
        last_seen_at=sensor.last_seen_at,
        now=now,
        recent_values=[v for v, _ in recent],
        recent_qualities=[q for _, q in recent],
        valid_min=sensor.valid_min,  # type: ignore[arg-type]
        valid_max=sensor.valid_max,  # type: ignore[arg-type]
        physical_min=spec.physical_min,
        physical_max=spec.physical_max,
        policy=policy,
    )


async def refresh_sensor_health(
    uow: UnitOfWork, sensor: Sensor, now: datetime, policy: SensorHealthPolicy, *, seen: bool
) -> Event | None:
    """Recalcula el estado del sensor y lo persiste si cambió (o si `seen`, para avanzar
    last_seen_at). Devuelve el evento sensor_status si el estado cambió."""
    recent = await uow.readings.recent(sensor.id, policy.stuck_window)
    status = evaluate_health(sensor, recent, now, policy)
    previous = sensor.status
    if status is previous and not seen:
        return None
    sensor.status = status
    await uow.sensors.record_activity(sensor.id, sensor.last_seen_at, status)
    return sensor_status_event(sensor, previous.value) if status is not previous else None


async def raise_alerts(uow: UnitOfWork, candidates: list[Alert]) -> list[Alert]:
    """Upsert de alertas en un orden fijo (rule_id, subject_key, instante) para que dos
    transacciones concurrentes tomen los locks en el mismo orden y no se bloqueen entre sí.
    Devuelve las que hay que notificar."""
    notify = []
    for candidate in sorted(candidates, key=lambda a: (a.rule_id, a.subject_key, a.last_triggered_at)):
        alert, should_notify = await uow.alerts.upsert_open(candidate)
        if should_notify:
            notify.append(alert)
    return notify


class IngestionService:
    def __init__(
        self,
        uow_factory: UnitOfWorkFactory,
        publisher: EventPublisher,
        clock: Clock,
        health_policy: SensorHealthPolicy,
    ) -> None:
        self._uow_factory = uow_factory
        self._publisher = publisher
        self._now = clock
        self._policy = health_policy

    async def ingest_readings(self, items: Sequence[ReadingInput]) -> IngestResult:
        now = self._now()
        result = IngestResult(received=len(items))
        events: list[Event] = []
        async with self._uow_factory() as uow:
            sensors = await uow.sensors.get_many(list({i.sensor_id for i in items}))
            candidates: list[Reading] = []
            for index, item in enumerate(items):
                ts = ensure_utc(item.ts)
                sensor = sensors.get(item.sensor_id)
                if sensor is None:
                    result.rejected.append(
                        Rejection(index, item.sensor_id, ts, "unknown_sensor", "El sensor no existe")
                    )
                    continue
                if ts > now + MAX_FUTURE_SKEW:
                    result.rejected.append(
                        Rejection(index, item.sensor_id, ts, "future_timestamp", "ts está en el futuro")
                    )
                    continue
                value = sensor.calibrate(item.value)
                spec = PARAMETERS[sensor.type]
                if not spec.is_possible(value):
                    result.rejected.append(
                        Rejection(
                            index,
                            item.sensor_id,
                            ts,
                            "impossible_value",
                            f"{value:g} fuera del rango físico {spec.physical_min:g}–"
                            f"{spec.physical_max:g} {spec.unit}",
                        )
                    )
                    continue
                candidates.append(
                    Reading(
                        sensor_id=sensor.id,
                        station_id=sensor.station_id,
                        ts=ts,
                        value=value,
                        quality=item.quality,
                    )
                )

            # Orden fijo de locks en todo el caso de uso: lecturas → alertas → sensores, cada
            # grupo ordenado por su clave. Evita deadlocks entre lotes concurrentes.
            candidates.sort(key=lambda r: (r.sensor_id, r.ts))
            inserted = await uow.readings.add_many(candidates) if candidates else []
            result.accepted = len(inserted)
            result.duplicates = len(candidates) - len(inserted)

            rules = await uow.rules.list(kind=RuleKind.READING_RANGE, enabled_only=True)
            alert_candidates: list[Alert] = []
            for reading in inserted:
                sensor = sensors[reading.sensor_id]
                sensor.mark_seen(reading.ts)
                events.append(reading_event(reading, sensor))
                alert_candidates += evaluate_reading(rules, sensor, reading.value, reading.ts)
            for alert in await raise_alerts(uow, alert_candidates):
                result.alerts_triggered += 1
                events.append(alert_event(alert))

            for sensor_id in sorted({r.sensor_id for r in inserted}):
                event = await refresh_sensor_health(uow, sensors[sensor_id], now, self._policy, seen=True)
                if event:
                    events.append(event)
            await uow.commit()

        await self._publisher.publish(events)
        if result.rejected:
            log.info("readings rejected", extra={"rejected": len(result.rejected)})
        return result

    async def heartbeat(self, sensor_id: UUID, ts: datetime | None = None) -> Sensor:
        now = self._now()
        events: list[Event] = []
        async with self._uow_factory() as uow:
            sensor = await uow.sensors.get(sensor_id)
            if sensor is None:
                raise NotFoundError("Sensor no encontrado")
            sensor.mark_seen(min(ensure_utc(ts), now) if ts else now)
            event = await refresh_sensor_health(uow, sensor, now, self._policy, seen=True)
            if event:
                events.append(event)
            await uow.commit()
        await self._publisher.publish(events)
        return sensor
