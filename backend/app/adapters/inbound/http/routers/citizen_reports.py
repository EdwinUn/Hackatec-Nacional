from uuid import UUID

from fastapi import APIRouter, Request, status

from app.adapters.inbound.http.deps import ContainerDep, CurrentUser
from app.adapters.inbound.http.schemas_ops import CitizenReportIn, CitizenReportOut, ReportPatchIn

router = APIRouter(tags=["operaciones · reportes ciudadanos"])


@router.post(
    "/citizen-reports",
    response_model=CitizenReportOut,
    status_code=status.HTTP_201_CREATED,
    summary="Reportar un problema ambiental (público, límite por IP)",
)
async def create_report(body: CitizenReportIn, request: Request, c: ContainerDep):
    client_ip = request.client.host if request.client else "desconocida"
    report = await c.citizen_reports.create(body.model_dump(), client_ip)
    return CitizenReportOut.of(report, request)


@router.get("/citizen-reports", response_model=list[CitizenReportOut], summary="Reportes (público)")
async def list_reports(request: Request, c: ContainerDep):
    return [CitizenReportOut.of(r, request) for r in await c.citizen_reports.list_reports()]


@router.get(
    "/citizen-reports/by-folio/{folio}",
    response_model=CitizenReportOut,
    summary="Seguimiento por folio (público)",
)
async def report_by_folio(folio: str, request: Request, c: ContainerDep):
    return CitizenReportOut.of(await c.citizen_reports.by_folio(folio), request)


@router.patch(
    "/citizen-reports/{report_id}",
    response_model=CitizenReportOut,
    summary="Moderar un reporte (supervisor/admin)",
)
async def update_report(
    report_id: UUID, body: ReportPatchIn, request: Request, c: ContainerDep, me: CurrentUser
):
    report = await c.citizen_reports.update(me, report_id, body.model_dump(exclude_unset=True))
    return CitizenReportOut.of(report, request)
