"""DTOs HTTP del módulo de operaciones (login, usuarios, reportes ciudadanos, órdenes de trabajo)."""

import json
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from fastapi import Request
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

from app.adapters.inbound.http.schemas import PatchModel
from app.application.services.work_orders import WorkOrderView
from app.domain.enums import WasteType
from app.domain.operations import (
    CitizenReport,
    Priority,
    ReportStatus,
    ReportType,
    Role,
    User,
    WorkOrderStatus,
    WorkOrderType,
)

# Data URL de ~300 KB en base64 más margen.
MAX_PHOTO_CHARS = 450_000
MAX_AI_CHARS = 200_000


def media_url(request: Request, ref: str | None) -> str | None:
    """`media/<id>.jpg` → URL absoluta con el host por el que llegó la petición (sirve en LAN/celular)."""
    if not ref or ref.startswith(("data:", "http://", "https://")):
        return ref
    return f"{str(request.base_url).rstrip('/')}/{ref}"


class StrictModel(BaseModel):
    """Sin NaN/Infinity: acabarían en columnas JSONB/float y en respuestas JSON inválidas."""

    model_config = ConfigDict(allow_inf_nan=False)


# ── Autenticación y usuarios ────────────────────
class LoginIn(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=200)

    model_config = ConfigDict(
        json_schema_extra={"examples": [{"email": "tecnico@demo.mx", "password": "demo123"}]}
    )


class UserOut(BaseModel):
    id: UUID
    name: str
    email: str
    role: Role
    active: bool

    @classmethod
    def of(cls, u: User) -> "UserOut":
        return cls(id=u.id, name=u.name, email=u.email, role=u.role, active=u.active)


class LoginOut(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int = Field(description="Segundos de vigencia del token")
    user: UserOut


class UserIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: str = Field(max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$", examples=["tecnico@demo.mx"])
    role: Role
    password: str = Field(min_length=6, max_length=200)


class UserPatchIn(PatchModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    role: Role | None = None
    active: bool | None = None


# ── Reportes ciudadanos ─────────────────────────
class CitizenReportIn(StrictModel):
    type: ReportType
    description: str = Field(default="", max_length=2000)
    photo: str | None = Field(
        default=None, max_length=MAX_PHOTO_CHARS, description="data:image/jpeg;base64,…"
    )
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    accuracy: float | None = Field(default=None, ge=0, description="Metros")
    ai: dict[str, Any] | None = Field(
        default=None,
        description="Resultado de POST /vision/analyze (imagen anotada reducida); máx. 200 KB",
    )

    @model_validator(mode="after")
    def _ai_size(self) -> "CitizenReportIn":
        if self.ai is not None and len(json.dumps(self.ai, separators=(",", ":"))) > MAX_AI_CHARS:
            raise ValueError("El análisis de IA es demasiado grande (máx. 200 KB)")
        return self

    @model_validator(mode="after")
    def _description_or_photo(self) -> "CitizenReportIn":
        if not self.description.strip() and not self.photo:
            raise ValueError("El reporte necesita una descripción o una foto")
        return self

    model_config = ConfigDict(allow_inf_nan=False, json_schema_extra={"examples": [{
        "type": "discharge", "description": "Tubo descargando agua gris con espuma",
        "photo": None, "latitude": 19.051, "longitude": -98.251, "accuracy": 12,
    }]})  # fmt: skip


class CitizenReportOut(BaseModel):
    id: UUID
    folio: str
    type: ReportType
    description: str
    photo: str | None
    latitude: float
    longitude: float
    accuracy: float | None
    status: ReportStatus
    station_id: UUID | None
    work_order_id: UUID | None
    public_note: str | None
    ai: dict[str, Any] | None = None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, r: CitizenReport, request: Request) -> "CitizenReportOut":
        return cls(
            id=r.id, folio=r.folio, type=r.type, description=r.description, photo=media_url(request, r.photo),
            latitude=r.latitude, longitude=r.longitude, accuracy=r.accuracy, status=r.status,
            station_id=r.station_id, work_order_id=r.work_order_id, public_note=r.public_note,
            ai=r.ai, created_at=r.created_at, updated_at=r.updated_at,
        )  # fmt: skip


class ReportPatchIn(PatchModel):
    nullable = frozenset({"public_note"})

    status: ReportStatus | None = None
    public_note: str | None = Field(default=None, max_length=1000)


# ── Órdenes de trabajo ──────────────────────────
class GeoPoint(StrictModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    accuracy: float | None = Field(default=None, ge=0)


class CheckIn(GeoPoint):
    ts: AwareDatetime


class ChecklistItem(BaseModel):
    key: str
    label: str = ""
    done: bool = False


class Evidence(BaseModel):
    kind: Literal["before", "after"]
    photo: str = Field(max_length=MAX_PHOTO_CHARS)
    ts: AwareDatetime


class WorkResult(StrictModel):
    confirmed: bool | None = None
    action_taken: str | None = Field(default=None, max_length=1000)
    waste_type: WasteType | None = None
    weight_kg: float | None = None
    items_count: int | None = Field(default=None, ge=0)
    sensor_id: UUID | None = None
    sensor_name: str | None = None
    reference_value: float | None = None
    measured_value: float | None = None
    calibration_offset: float | None = None
    calibration_factor: float | None = None


class WorkOrderIn(StrictModel):
    type: WorkOrderType
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    priority: Priority = Priority.NORMAL
    station_id: UUID | None = None
    citizen_report_id: UUID | None = None
    alert_id: UUID | None = None
    location: GeoPoint | None = None
    assigned_to: UUID | None = None
    due_at: AwareDatetime | None = None

    model_config = ConfigDict(allow_inf_nan=False, json_schema_extra={"examples": [{
        "type": "waste_collection", "title": "Vaciar contenedor", "description": "Contenedor al 90 %",
        "priority": "normal", "station_id": "6f1c2a8e-3b4d-4e5f-8a9b-0c1d2e3f4a5b",
    }]})  # fmt: skip


class WorkOrderPatchIn(PatchModel, StrictModel):
    nullable = frozenset({"assigned_to", "due_at", "result", "check_in", "notes"})

    status: WorkOrderStatus | None = None
    assigned_to: UUID | None = None
    priority: Priority | None = None
    due_at: AwareDatetime | None = None
    checklist: list[ChecklistItem] | None = None
    evidence: list[Evidence] | None = None
    notes: str | None = Field(default=None, max_length=4000)
    result: WorkResult | None = None
    check_in: CheckIn | None = None

    def changes(self) -> dict[str, Any]:
        """Solo lo que vino en el cuerpo, en formato JSON (para las columnas JSONB)."""
        data = self.model_dump(mode="json", exclude_unset=True)
        if data.get("result") is not None:
            data["result"] = {k: v for k, v in data["result"].items() if v is not None}
        for key in ("assigned_to",):
            if data.get(key):
                data[key] = UUID(data[key])
        return data


class WorkOrderOut(BaseModel):
    id: UUID
    folio: str
    type: WorkOrderType
    title: str
    description: str
    priority: Priority
    status: WorkOrderStatus
    station_id: UUID | None
    station_name: str | None
    citizen_report_id: UUID | None
    alert_id: UUID | None
    location: dict[str, Any] | None
    assigned_to: UUID | None
    assigned_name: str | None
    created_by: UUID | None
    due_at: datetime | None
    checklist: list[dict[str, Any]]
    evidence: list[dict[str, Any]]
    notes: str
    result: dict[str, Any] | None
    check_in: dict[str, Any] | None
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None
    verified_at: datetime | None

    @classmethod
    def of(cls, v: WorkOrderView, request: Request) -> "WorkOrderOut":
        o = v.order
        evidence = [{**e, "photo": media_url(request, e.get("photo"))} for e in o.evidence]
        return cls(
            id=o.id, folio=o.folio, type=o.type, title=o.title, description=o.description,
            priority=o.priority, status=o.status, station_id=o.station_id, station_name=v.station_name,
            citizen_report_id=o.citizen_report_id, alert_id=o.alert_id, location=o.location,
            assigned_to=o.assigned_to, assigned_name=v.assigned_name, created_by=o.created_by,
            due_at=o.due_at, checklist=o.checklist, evidence=evidence, notes=o.notes, result=o.result,
            check_in=o.check_in, created_at=o.created_at, started_at=o.started_at,
            completed_at=o.completed_at, verified_at=o.verified_at,
        )  # fmt: skip
