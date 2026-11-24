"""Repositorios SQLAlchemy. El mapeo ORM ↔ dominio es genérico por nombre de campo."""

from collections.abc import Sequence
from dataclasses import fields
from datetime import datetime, timedelta
from typing import Any, ClassVar
from uuid import UUID

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.outbound.persistence.orm import (
    ACTIVE_ALERT,
    AlertRow,
    AlertRuleRow,
    Base,
    BatchRow,
    CycleRow,
    ReadingRow,
    SensorRow,
    StationRow,
    WasteRow,
)
from app.domain.entities import (
    Alert,
    AlertRule,
    CentrifugeCycle,
    Reading,
    Sensor,
    Station,
    TreatmentBatch,
    WasteCollection,
)
from app.domain.enums import (
    AlertStatus,
    CycleStatus,
    RuleKind,
    SensorLocation,
    SensorStatus,
    SensorType,
    Severity,
    StationStatus,
)


class SqlRepository[E, M: Base]:
    entity: ClassVar[type]
    model: ClassVar[type[Base]]

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    def to_entity(self, row: Any) -> E:
        return self.entity(**{f.name: getattr(row, f.name) for f in fields(self.entity) if f.init})

    def to_row(self, entity: E) -> M:
        return self.model(**{f.name: getattr(entity, f.name) for f in fields(entity) if f.init})  # type: ignore[arg-type]

    async def get(self, entity_id: UUID) -> E | None:
        row = await self.session.get(self.model, entity_id)
        return self.to_entity(row) if row else None

    async def add(self, entity: E) -> None:
        self.session.add(self.to_row(entity))
        await self.session.flush()

    async def save(self, entity: E) -> None:
        await self.session.merge(self.to_row(entity))
        await self.session.flush()

    async def _page(
        self, conditions: list[Any], order_by: Any, limit: int, offset: int
    ) -> tuple[list[E], int]:
        where = sa.and_(sa.true(), *conditions)
        total = await self.session.scalar(sa.select(sa.func.count()).select_from(self.model).where(where))
        rows = await self.session.scalars(
            sa.select(self.model).where(where).order_by(order_by).limit(limit).offset(offset)
        )
        return [self.to_entity(r) for r in rows], total or 0


class SqlStationRepository(SqlRepository[Station, StationRow]):
    entity, model = Station, StationRow

    async def list(
        self, *, status: StationStatus | None, river: str | None, limit: int, offset: int
    ) -> tuple[list[Station], int]:
        conds = []
        if status:
            conds.append(StationRow.status == status)
        if river:
            conds.append(StationRow.river.ilike(f"%{river}%"))
        return await self._page(conds, StationRow.name, limit, offset)


class SqlSensorRepository(SqlRepository[Sensor, SensorRow]):
    entity, model = Sensor, SensorRow

    async def record_activity(
        self, sensor_id: UUID, last_seen_at: datetime | None, status: SensorStatus
    ) -> None:
        await self.session.execute(
            sa.update(SensorRow)
            .where(SensorRow.id == sensor_id)
            .values(
                last_seen_at=sa.func.greatest(SensorRow.last_seen_at, last_seen_at),
                status=status,
                updated_at=sa.func.now(),
            )
        )

    async def get_many(self, sensor_ids: Sequence[UUID]) -> dict[UUID, Sensor]:
        if not sensor_ids:
            return {}
        rows = await self.session.scalars(sa.select(SensorRow).where(SensorRow.id.in_(sensor_ids)))
        return {r.id: self.to_entity(r) for r in rows}

    async def list(
        self,
        *,
        station_id: UUID | None = None,
        type: SensorType | None = None,
        location: SensorLocation | None = None,
        status: SensorStatus | None = None,
        limit: int = 1000,
        offset: int = 0,
    ) -> tuple[list[Sensor], int]:
        conds = [
            col == value
            for col, value in (
                (SensorRow.station_id, station_id),
                (SensorRow.type, type),
                (SensorRow.location, location),
                (SensorRow.status, status),
            )
            if value is not None
        ]
        order = (SensorRow.station_id, SensorRow.location, SensorRow.type)
        return await self._page(conds, sa.tuple_(*order), limit, offset)


class SqlReadingRepository:
    CHUNK = 2000  # asyncpg admite ≤ 32767 parámetros por sentencia

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def add_many(self, readings: Sequence[Reading]) -> list[Reading]:
        inserted_ids: set[UUID] = set()
        for start in range(0, len(readings), self.CHUNK):
            chunk = readings[start : start + self.CHUNK]
            stmt = (
                pg_insert(ReadingRow)
                .values(
                    [
                        {
                            "id": r.id,
                            "sensor_id": r.sensor_id,
                            "station_id": r.station_id,
                            "ts": r.ts,
                            "value": r.value,
                            "quality": r.quality,
                        }
                        for r in chunk
                    ]
                )
                .on_conflict_do_nothing(index_elements=["sensor_id", "ts"])
                .returning(ReadingRow.id)
            )
            inserted_ids.update((await self.session.scalars(stmt)).all())
        return [r for r in readings if r.id in inserted_ids]

    async def recent(self, sensor_id: UUID, limit: int) -> list[tuple[float, float]]:
        rows = await self.session.execute(
            sa.select(ReadingRow.value, ReadingRow.quality)
            .where(ReadingRow.sensor_id == sensor_id)
            .order_by(ReadingRow.ts.desc())
            .limit(limit)
        )
        return [(v, q) for v, q in rows]


class SqlCycleRepository(SqlRepository[CentrifugeCycle, CycleRow]):
    entity, model = CentrifugeCycle, CycleRow

    async def list(
        self, *, station_id: UUID | None, status: CycleStatus | None, limit: int, offset: int
    ) -> tuple[list[CentrifugeCycle], int]:
        conds = []
        if station_id:
            conds.append(CycleRow.station_id == station_id)
        if status:
            conds.append(CycleRow.status == status)
        return await self._page(conds, CycleRow.started_at.desc(), limit, offset)


class SqlBatchRepository(SqlRepository[TreatmentBatch, BatchRow]):
    entity, model = TreatmentBatch, BatchRow


class SqlWasteRepository(SqlRepository[WasteCollection, WasteRow]):
    entity, model = WasteCollection, WasteRow


class SqlAlertRuleRepository(SqlRepository[AlertRule, AlertRuleRow]):
    entity, model = AlertRule, AlertRuleRow

    async def list(self, *, kind: RuleKind | None = None, enabled_only: bool = False) -> list[AlertRule]:
        stmt = sa.select(AlertRuleRow).order_by(
            AlertRuleRow.kind, AlertRuleRow.parameter, AlertRuleRow.severity, AlertRuleRow.name
        )
        if kind:
            stmt = stmt.where(AlertRuleRow.kind == kind)
        if enabled_only:
            stmt = stmt.where(AlertRuleRow.enabled.is_(True))
        return [self.to_entity(r) for r in await self.session.scalars(stmt)]


class SqlAlertRepository(SqlRepository[Alert, AlertRow]):
    entity, model = Alert, AlertRow

    def __init__(self, session: AsyncSession, renotify_after: timedelta = timedelta(minutes=15)) -> None:
        super().__init__(session)
        self.renotify_after = renotify_after

    async def upsert_open(self, alert: Alert) -> tuple[Alert, bool]:
        alert.last_notified_at = alert.last_triggered_at
        values = {f.name: getattr(alert, f.name) for f in fields(alert)}
        ins = pg_insert(AlertRow).values(**values)
        table = AlertRow.__table__
        # Re-notificar (sin crear otra fila) si la alerta activa vuelve a dispararse tras un rato.
        renotify = ins.excluded.last_triggered_at >= table.c.last_notified_at + self.renotify_after
        stmt = ins.on_conflict_do_update(
            index_elements=["rule_id", "subject_key"],
            index_where=sa.text(ACTIVE_ALERT),
            set_={
                "trigger_value": ins.excluded.trigger_value,
                "message": ins.excluded.message,
                "last_triggered_at": sa.func.greatest(
                    table.c.last_triggered_at, ins.excluded.last_triggered_at
                ),
                "occurrences": table.c.occurrences + 1,
                "last_notified_at": sa.case(
                    (renotify, ins.excluded.last_triggered_at), else_=table.c.last_notified_at
                ),
                "updated_at": sa.func.now(),
            },
        ).returning(
            *table.c,
            sa.literal_column("(xmax = 0)").label("inserted"),
            (table.c.last_notified_at == alert.last_triggered_at).label("notified"),
        )
        row = (await self.session.execute(stmt)).one()
        # Las filas devueltas por un INSERT…RETURNING no pasan por el identity map:
        # sincronizamos para que un get() posterior en la misma sesión vea el estado nuevo.
        self.session.expire_all()
        return self.to_entity(row), bool(row.inserted or row.notified)

    async def list(
        self,
        *,
        station_id: UUID | None,
        status: AlertStatus | None,
        severity: Severity | None,
        since: datetime | None,
        limit: int,
        offset: int,
    ) -> tuple[list[Alert], int]:
        conds = []
        if station_id:
            conds.append(AlertRow.station_id == station_id)
        if status:
            conds.append(AlertRow.status == status)
        if severity:
            conds.append(AlertRow.severity == severity)
        if since:
            conds.append(AlertRow.last_triggered_at >= since)
        return await self._page(conds, AlertRow.last_triggered_at.desc(), limit, offset)
