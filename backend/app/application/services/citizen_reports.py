"""Reportes ciudadanos: alta pública (con límite por IP), consulta pública y moderación."""

from dataclasses import dataclass
from typing import Any
from uuid import UUID

from app.application.events import citizen_report_created_event, jsonable
from app.application.photos import decode_photo
from app.application.ports import (
    Clock,
    EventPublisher,
    MediaStorage,
    RateLimiter,
    UnitOfWorkFactory,
)
from app.application.services.staff import require_role
from app.domain.errors import NotFoundError, RateLimitedError
from app.domain.operations import (
    MANAGERS,
    CitizenReport,
    ReportStatus,
    User,
    format_folio,
    nearest_station,
)

MAX_LIST = 500


@dataclass(frozen=True, slots=True)
class ReportPolicy:
    max_photo_kb: int = 300
    rate_limit: int = 5
    rate_window_s: int = 600
    station_radius_km: float = 8.0


class CitizenReportService:
    def __init__(
        self,
        uow_factory: UnitOfWorkFactory,
        publisher: EventPublisher,
        media: MediaStorage,
        limiter: RateLimiter,
        clock: Clock,
        policy: ReportPolicy,
    ) -> None:
        self._uow_factory = uow_factory
        self._publisher = publisher
        self._media = media
        self._limiter = limiter
        self._now = clock
        self._policy = policy

    async def create(self, data: dict[str, Any], client_ip: str) -> CitizenReport:
        p = self._policy
        if not await self._limiter.allow(f"citizen-report:{client_ip}", p.rate_limit, p.rate_window_s):
            minutes = p.rate_window_s // 60
            raise RateLimitedError(
                f"Recibimos varios reportes desde tu conexión; intenta de nuevo en {minutes} minutos"
            )
        photo = data.pop("photo", None)
        # Validar antes de guardar archivos (descripción o foto, coordenadas).
        CitizenReport(folio="RC-0", photo=photo, **data)
        stored = self._media.save(*decode_photo(photo, p.max_photo_kb)) if photo else None
        async with self._uow_factory() as uow:
            stations, _ = await uow.stations.list(status=None, river=None, limit=1000, offset=0)
            station_id = nearest_station(
                data["latitude"],
                data["longitude"],
                ((s.id, s.latitude, s.longitude) for s in stations),
                p.station_radius_km,
            )
            report = CitizenReport(
                folio=format_folio("RC", await uow.reports.next_folio()),
                photo=stored,
                station_id=station_id,
                **data,
            )
            await uow.reports.add(report)
            await uow.commit()
        await self._publisher.publish([citizen_report_created_event(jsonable(report), report.station_id)])
        return report

    async def list_reports(self) -> list[CitizenReport]:
        async with self._uow_factory() as uow:
            return await uow.reports.list(MAX_LIST)

    async def by_folio(self, folio: str) -> CitizenReport:
        async with self._uow_factory() as uow:
            report = await uow.reports.get_by_folio(folio.strip().upper())
        if report is None:
            raise NotFoundError(f"No encontramos el folio {folio.strip().upper()}")
        return report

    async def update(self, actor: User, report_id: UUID, changes: dict[str, Any]) -> CitizenReport:
        """Moderación (descartar, nota pública). El resto de estados los mueve la orden de trabajo."""
        require_role(actor, *MANAGERS)
        async with self._uow_factory() as uow:
            report = await uow.reports.get(report_id)
            if report is None:
                raise NotFoundError("Reporte no encontrado")
            if "status" in changes:
                report.status = ReportStatus(changes["status"])
            if "public_note" in changes:
                report.public_note = changes["public_note"]
            report.touch(self._now())
            await uow.reports.save(report)
            await uow.commit()
        return report
