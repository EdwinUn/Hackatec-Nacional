"""Barrido periódico: detecta sensores que dejaron de reportar (no hay lectura que lo dispare)."""

from app.application.events import Event, alert_event
from app.application.ports import Clock, EventPublisher, UnitOfWorkFactory
from app.application.services.ingestion import raise_alerts, refresh_sensor_health
from app.domain.alerting import evaluate_sensor_silence
from app.domain.enums import RuleKind
from app.domain.sensor_health import SensorHealthPolicy


class MonitoringService:
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

    async def sweep(self) -> int:
        """Devuelve cuántos eventos se emitieron."""
        now = self._now()
        events: list[Event] = []
        async with self._uow_factory() as uow:
            sensors, _ = await uow.sensors.list(limit=100_000)
            sensors.sort(key=lambda s: s.id)
            rules = await uow.rules.list(kind=RuleKind.SENSOR_OFFLINE, enabled_only=True)
            # Mismo orden de locks que la ingesta: alertas → sensores.
            candidates = [a for s in sensors for a in evaluate_sensor_silence(rules, s, now)]
            events += [alert_event(a) for a in await raise_alerts(uow, candidates)]
            for sensor in sensors:
                event = await refresh_sensor_health(uow, sensor, now, self._policy, seen=False)
                if event:
                    events.append(event)
            await uow.commit()
        await self._publisher.publish(events)
        return len(events)
