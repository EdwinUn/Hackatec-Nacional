from datetime import timedelta
from typing import Self

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.adapters.outbound.persistence.repositories import (
    SqlAlertRepository,
    SqlAlertRuleRepository,
    SqlBatchRepository,
    SqlCitizenReportRepository,
    SqlCycleRepository,
    SqlDeviceTelemetryRepository,
    SqlReadingRepository,
    SqlSensorRepository,
    SqlStationRepository,
    SqlUserRepository,
    SqlWasteRepository,
    SqlWorkOrderRepository,
)


class SqlUnitOfWork:
    """Una transacción por caso de uso. Sin commit explícito → rollback."""

    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        alert_renotify_after: timedelta = timedelta(minutes=15),
    ) -> None:
        self._session_factory = session_factory
        self._renotify_after = alert_renotify_after

    async def __aenter__(self) -> Self:
        self.session = self._session_factory()
        self.stations = SqlStationRepository(self.session)
        self.sensors = SqlSensorRepository(self.session)
        self.readings = SqlReadingRepository(self.session)
        self.cycles = SqlCycleRepository(self.session)
        self.batches = SqlBatchRepository(self.session)
        self.waste = SqlWasteRepository(self.session)
        self.telemetry = SqlDeviceTelemetryRepository(self.session)
        self.rules = SqlAlertRuleRepository(self.session)
        self.alerts = SqlAlertRepository(self.session, self._renotify_after)
        self.users = SqlUserRepository(self.session)
        self.reports = SqlCitizenReportRepository(self.session)
        self.work_orders = SqlWorkOrderRepository(self.session)
        return self

    async def __aexit__(self, *exc: object) -> None:
        try:
            await self.session.rollback()
        finally:
            await self.session.close()

    async def commit(self) -> None:
        await self.session.commit()
