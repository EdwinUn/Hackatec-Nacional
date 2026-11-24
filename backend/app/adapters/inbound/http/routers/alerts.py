from uuid import UUID

from fastapi import APIRouter, Depends, status
from pydantic import AwareDatetime

from app.adapters.inbound.http.deps import ContainerDep, PaginationDep, require_api_key, require_key_or_staff
from app.adapters.inbound.http.schemas import (
    AlertOut,
    AlertPatch,
    AlertRuleIn,
    AlertRuleOut,
    AlertRulePatch,
    Page,
)
from app.domain.enums import AlertStatus, Severity

# Efectos de una orden de trabajo: también con el Bearer del personal (no viaja la llave en el teléfono).
key_or_staff = [Depends(require_key_or_staff)]
router = APIRouter(tags=["alertas"])


@router.get("/alerts", response_model=Page[AlertOut], summary="Listar alertas (más recientes primero)")
async def list_alerts(
    c: ContainerDep,
    page: PaginationDep,
    station_id: UUID | None = None,
    status: AlertStatus | None = None,
    severity: Severity | None = None,
    since: AwareDatetime | None = None,
):
    items, total = await c.alerts.list_alerts(
        station_id=station_id,
        status=status,
        severity=severity,
        since=since,
        limit=page.limit,
        offset=page.offset,
    )
    return Page(items=items, total=total, limit=page.limit, offset=page.offset)


@router.patch("/alerts/{alert_id}", response_model=AlertOut, summary="Reconocer o resolver una alerta")
async def update_alert(alert_id: UUID, body: AlertPatch, c: ContainerDep):
    # Abierto a propósito: el operador del dashboard reconoce alertas (sin usuarios todavía).
    return await c.alerts.change_status(alert_id, AlertStatus(body.status), body.note)


@router.get(
    "/alert-rules", response_model=list[AlertRuleOut], summary="Umbrales configurables (reglas de alerta)"
)
async def list_rules(c: ContainerDep):
    return await c.alerts.list_rules()


@router.post(
    "/alert-rules",
    response_model=AlertRuleOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_api_key)],
    summary="Crear regla",
)
async def create_rule(body: AlertRuleIn, c: ContainerDep):
    return await c.alerts.create_rule(body.model_dump())


@router.patch(
    "/alert-rules/{rule_id}",
    response_model=AlertRuleOut,
    dependencies=key_or_staff,
    summary="Ajustar umbral / activar",
)
async def update_rule(rule_id: UUID, body: AlertRulePatch, c: ContainerDep):
    return await c.alerts.update_rule(rule_id, body.model_dump(exclude_unset=True))
