"""Alertas y reglas de alerta (umbrales configurables)."""

from dataclasses import replace
from datetime import datetime
from typing import Any
from uuid import UUID

from app.application.events import alert_event
from app.application.ports import EventPublisher, UnitOfWorkFactory
from app.domain.defaults import default_alert_rules
from app.domain.entities import Alert, AlertRule
from app.domain.enums import AlertStatus, Severity
from app.domain.errors import NotFoundError


class AlertService:
    def __init__(self, uow_factory: UnitOfWorkFactory, publisher: EventPublisher) -> None:
        self._uow_factory = uow_factory
        self._publisher = publisher

    async def list_alerts(
        self,
        *,
        station_id: UUID | None,
        status: AlertStatus | None,
        severity: Severity | None,
        since: datetime | None,
        limit: int,
        offset: int,
    ) -> tuple[list[Alert], int]:
        async with self._uow_factory() as uow:
            return await uow.alerts.list(
                station_id=station_id,
                status=status,
                severity=severity,
                since=since,
                limit=limit,
                offset=offset,
            )

    async def change_status(self, alert_id: UUID, status: AlertStatus, note: str | None) -> Alert:
        async with self._uow_factory() as uow:
            alert = await uow.alerts.get(alert_id)
            if alert is None:
                raise NotFoundError("Alerta no encontrada")
            alert.transition(status, note)
            await uow.alerts.save(alert)
            await uow.commit()
        await self._publisher.publish([alert_event(alert)])
        return alert

    async def list_rules(self) -> list[AlertRule]:
        async with self._uow_factory() as uow:
            return await uow.rules.list()

    async def install_default_rules(self) -> int:
        """Siembra las reglas por defecto si la tabla está vacía. Devuelve cuántas creó."""
        async with self._uow_factory() as uow:
            if await uow.rules.list():
                return 0
            rules = default_alert_rules()
            for rule in rules:
                await uow.rules.add(rule)
            await uow.commit()
        return len(rules)

    async def create_rule(self, data: dict[str, Any]) -> AlertRule:
        rule = AlertRule(**data)
        async with self._uow_factory() as uow:
            if rule.station_id and await uow.stations.get(rule.station_id) is None:
                raise NotFoundError("Estación no encontrada")
            await uow.rules.add(rule)
            await uow.commit()
        return rule

    async def update_rule(self, rule_id: UUID, changes: dict[str, Any]) -> AlertRule:
        async with self._uow_factory() as uow:
            current = await uow.rules.get(rule_id)
            if current is None:
                raise NotFoundError("Regla no encontrada")
            rule = replace(current, **changes)
            rule.touch()
            await uow.rules.save(rule)
            await uow.commit()
        return rule
