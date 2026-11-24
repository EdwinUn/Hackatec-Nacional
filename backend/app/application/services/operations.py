"""Casos de uso de la operación de la máquina: centrifugado, lotes tratados y basura."""

from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

from app.application.events import Event, alert_event, batch_event, cycle_event, waste_event
from app.application.ports import Clock, EventPublisher, UnitOfWork, UnitOfWorkFactory
from app.application.services.ingestion import raise_alerts
from app.domain.alerting import evaluate_cycle, evaluate_treatment
from app.domain.entities import (
    Alert,
    CentrifugeCycle,
    TreatmentBatch,
    WasteCollection,
    ensure_utc,
)
from app.domain.enums import CycleStatus, RuleKind
from app.domain.errors import InvalidDataError, NotFoundError


@dataclass(frozen=True, slots=True)
class CyclePatch:
    status: CycleStatus | None = None
    ended_at: datetime | None = None
    failure_reason: str | None = None
    measures: dict[str, float | None] | None = None


class OperationsService:
    def __init__(self, uow_factory: UnitOfWorkFactory, publisher: EventPublisher, clock: Clock) -> None:
        self._uow_factory = uow_factory
        self._publisher = publisher
        self._now = clock

    async def _require_station(self, uow: UnitOfWork, station_id: UUID) -> None:
        if await uow.stations.get(station_id) is None:
            raise NotFoundError("Estación no encontrada")

    @staticmethod
    async def _raise_alerts(uow: UnitOfWork, candidates: list[Alert]) -> list[Event]:
        return [alert_event(a) for a in await raise_alerts(uow, candidates)]

    async def start_cycle(
        self, station_id: UUID, started_at: datetime | None, measures: dict[str, Any]
    ) -> CentrifugeCycle:
        async with self._uow_factory() as uow:
            await self._require_station(uow, station_id)
            cycle = CentrifugeCycle(
                station_id=station_id,
                started_at=ensure_utc(started_at) if started_at else self._now(),
            )
            cycle.apply(**measures)
            await uow.cycles.add(cycle)
            rules = await uow.rules.list(kind=RuleKind.CENTRIFUGE_VIBRATION, enabled_only=True)
            events = [cycle_event(cycle)]
            events += await self._raise_alerts(
                uow, evaluate_cycle(rules, cycle, cycle.ended_at or self._now())
            )
            await uow.commit()
        await self._publisher.publish(events)
        return cycle

    async def update_cycle(self, cycle_id: UUID, patch: CyclePatch) -> CentrifugeCycle:
        async with self._uow_factory() as uow:
            cycle = await uow.cycles.get(cycle_id)
            if cycle is None:
                raise NotFoundError("Ciclo no encontrado")
            cycle.apply(
                status=patch.status,
                ended_at=patch.ended_at,
                failure_reason=patch.failure_reason,
                **(patch.measures or {}),
            )
            await uow.cycles.save(cycle)
            rules = await uow.rules.list(kind=RuleKind.CENTRIFUGE_VIBRATION, enabled_only=True)
            events = [cycle_event(cycle)]
            events += await self._raise_alerts(
                uow, evaluate_cycle(rules, cycle, cycle.ended_at or self._now())
            )
            await uow.commit()
        await self._publisher.publish(events)
        return cycle

    async def get_cycle(self, cycle_id: UUID) -> CentrifugeCycle:
        async with self._uow_factory() as uow:
            cycle = await uow.cycles.get(cycle_id)
        if cycle is None:
            raise NotFoundError("Ciclo no encontrado")
        return cycle

    async def list_cycles(
        self, *, station_id: UUID | None, status: CycleStatus | None, limit: int, offset: int
    ) -> tuple[list[CentrifugeCycle], int]:
        async with self._uow_factory() as uow:
            return await uow.cycles.list(station_id=station_id, status=status, limit=limit, offset=offset)

    async def record_batch(self, data: dict[str, Any]) -> TreatmentBatch:
        async with self._uow_factory() as uow:
            await self._require_station(uow, data["station_id"])
            if data.get("cycle_id"):
                cycle = await uow.cycles.get(data["cycle_id"])
                if cycle is None:
                    raise NotFoundError("Ciclo no encontrado")
                if cycle.station_id != data["station_id"]:
                    raise InvalidDataError("El ciclo pertenece a otra estación")
            ts = data.get("ts")
            batch = TreatmentBatch(**{**data, "ts": ensure_utc(ts) if ts else self._now()})
            await uow.batches.add(batch)
            rules = await uow.rules.list(kind=RuleKind.TREATMENT_EFFICIENCY, enabled_only=True)
            events = [batch_event(batch)]
            events += await self._raise_alerts(uow, evaluate_treatment(rules, batch, batch.ts))
            await uow.commit()
        await self._publisher.publish(events)
        return batch

    async def record_waste(self, data: dict[str, Any]) -> WasteCollection:
        async with self._uow_factory() as uow:
            await self._require_station(uow, data["station_id"])
            ts = data.get("ts")
            waste = WasteCollection(**{**data, "ts": ensure_utc(ts) if ts else self._now()})
            await uow.waste.add(waste)
            await uow.commit()
        await self._publisher.publish([waste_event(waste)])
        return waste
