"""Operaciones: personal, reportes ciudadanos y órdenes de trabajo. Reglas puras."""

import math
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID

from app.domain.entities import Entity
from app.domain.enums import WasteType
from app.domain.errors import ConflictError, ForbiddenError, InvalidDataError, InvalidTransitionError


class Role(StrEnum):
    TECHNICIAN = "technician"
    SUPERVISOR = "supervisor"
    ADMIN = "admin"


MANAGERS = frozenset({Role.SUPERVISOR, Role.ADMIN})


class ReportType(StrEnum):
    TRASH = "trash"
    DISCHARGE = "discharge"
    ODOR = "odor"
    FOAM = "foam"
    DEAD_FISH = "dead_fish"
    OTHER = "other"


class ReportStatus(StrEnum):
    NEW = "new"
    VERIFIED = "verified"
    IN_PROGRESS = "in_progress"
    RESOLVED = "resolved"
    REJECTED = "rejected"


class WorkOrderType(StrEnum):
    CITIZEN_REPORT = "citizen_report"
    MAINTENANCE = "maintenance"
    WASTE_COLLECTION = "waste_collection"
    CALIBRATION = "calibration"


class WorkOrderStatus(StrEnum):
    PENDING = "pending"
    ASSIGNED = "assigned"
    IN_PROGRESS = "in_progress"
    DONE = "done"
    VERIFIED = "verified"
    CANCELLED = "cancelled"


class Priority(StrEnum):
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"
    URGENT = "urgent"


STATUS_LABEL = {
    WorkOrderStatus.PENDING: "pendiente",
    WorkOrderStatus.ASSIGNED: "asignada",
    WorkOrderStatus.IN_PROGRESS: "en curso",
    WorkOrderStatus.DONE: "terminada",
    WorkOrderStatus.VERIFIED: "verificada",
    WorkOrderStatus.CANCELLED: "cancelada",
}

TRANSITIONS: dict[WorkOrderStatus, frozenset[WorkOrderStatus]] = {
    WorkOrderStatus.PENDING: frozenset({WorkOrderStatus.ASSIGNED, WorkOrderStatus.CANCELLED}),
    WorkOrderStatus.ASSIGNED: frozenset(
        {WorkOrderStatus.IN_PROGRESS, WorkOrderStatus.PENDING, WorkOrderStatus.CANCELLED}
    ),
    WorkOrderStatus.IN_PROGRESS: frozenset(
        {WorkOrderStatus.DONE, WorkOrderStatus.ASSIGNED, WorkOrderStatus.CANCELLED}
    ),
    WorkOrderStatus.DONE: frozenset({WorkOrderStatus.VERIFIED, WorkOrderStatus.IN_PROGRESS}),
    WorkOrderStatus.VERIFIED: frozenset(),
    WorkOrderStatus.CANCELLED: frozenset(),
}
FINAL_STATUSES = frozenset({WorkOrderStatus.VERIFIED, WorkOrderStatus.CANCELLED})
CLOSED_STATUSES = FINAL_STATUSES | {WorkOrderStatus.DONE}
TECHNICIAN_TRANSITIONS = frozenset(
    {
        (WorkOrderStatus.ASSIGNED, WorkOrderStatus.IN_PROGRESS),
        (WorkOrderStatus.IN_PROGRESS, WorkOrderStatus.DONE),
    }
)

# Igual que `defaultChecklist()` del frontend (shared/utils/ops.util.ts).
CHECKLISTS: dict[WorkOrderType, list[tuple[str, str]]] = {
    WorkOrderType.MAINTENANCE: [
        ("grid", "Rejilla de entrada limpia (sin basura atorada)"),
        ("centrifuge", "Centrífuga gira sin vibración ni ruido anormal"),
        ("power", "Batería y panel solar limpios, voltaje correcto"),
        ("leaks", "Sin fugas en mangueras ni conexiones"),
        ("housing", "Carcasa y anclaje de la boya en buen estado"),
        ("sensors", "Sensores sumergidos y sin lodo"),
    ],
    WorkOrderType.WASTE_COLLECTION: [
        ("container", "Contenedor de basura vaciado"),
        ("sorted", "Residuos separados por tipo"),
        ("weighed", "Residuos pesados"),
    ],
    WorkOrderType.CALIBRATION: [
        ("clean", "Sensor enjuagado con agua destilada"),
        ("buffer", "Medición con solución patrón"),
        ("reinstalled", "Sensor reinstalado y transmitiendo"),
    ],
    WorkOrderType.CITIZEN_REPORT: [
        ("arrived", "Llegué al punto reportado"),
        ("assessed", "Evalué el problema"),
        ("action", "Realicé la acción correctiva o di aviso a la autoridad"),
    ],
}

NOT_FOUND_NOTE = "La brigada no encontró el problema reportado."


def format_folio(prefix: str, n: int) -> str:
    return f"{prefix}-{n:04d}"


def default_checklist(order_type: WorkOrderType) -> list[dict[str, Any]]:
    return [{"key": k, "label": label, "done": False} for k, label in CHECKLISTS[order_type]]


def _check_coords(latitude: float, longitude: float) -> None:
    if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
        raise InvalidDataError("Coordenadas fuera de rango")


@dataclass(kw_only=True)
class User(Entity):
    name: str
    email: str
    role: Role
    password_hash: str
    active: bool = True

    def __post_init__(self) -> None:
        self.email = self.email.strip().lower()
        self.name = self.name.strip()
        if not self.name or "@" not in self.email:
            raise InvalidDataError("Nombre y correo válidos son obligatorios")


@dataclass(kw_only=True)
class CitizenReport(Entity):
    folio: str
    type: ReportType
    description: str
    photo: str | None
    latitude: float
    longitude: float
    accuracy: float | None = None
    status: ReportStatus = ReportStatus.NEW
    station_id: UUID | None = None
    work_order_id: UUID | None = None
    public_note: str | None = None

    def __post_init__(self) -> None:
        self.description = (self.description or "").strip()
        if not self.description and not self.photo:
            raise InvalidDataError("El reporte necesita una descripción o una foto")
        _check_coords(self.latitude, self.longitude)


@dataclass(kw_only=True)
class WorkOrder(Entity):
    folio: str
    type: WorkOrderType
    title: str
    description: str
    created_by: UUID
    priority: Priority = Priority.NORMAL
    status: WorkOrderStatus = WorkOrderStatus.PENDING
    station_id: UUID | None = None
    citizen_report_id: UUID | None = None
    alert_id: UUID | None = None
    location: dict[str, Any] | None = None
    assigned_to: UUID | None = None
    due_at: datetime | None = None
    checklist: list[dict[str, Any]] = field(default_factory=list)
    evidence: list[dict[str, Any]] = field(default_factory=list)
    notes: str = ""
    result: dict[str, Any] | None = None
    check_in: dict[str, Any] | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    verified_at: datetime | None = None

    def __post_init__(self) -> None:
        self.title = self.title.strip()
        if not self.title:
            raise InvalidDataError("La orden necesita un título")

    def ensure_editable(self, role: Role, fields: Iterable[str]) -> None:
        """Una orden cerrada ya no se toca: protege lo que ve el ciudadano y lo que verificó el supervisor.
        - verificada/cancelada: solo se acepta `status` (y cualquier transición desde ahí es inválida);
        - terminada: el técnico ya no edita sus datos (los cambios de estado los valida
          `change_status`: 403 si intenta verificar o reabrir);
        - terminada/verificada/cancelada: no se reasigna."""
        fields = set(fields)
        label = STATUS_LABEL[self.status]
        if self.status in FINAL_STATUSES and fields - {"status"}:
            raise ConflictError(f"La orden ya está {label}; no se puede modificar")
        if self.status is WorkOrderStatus.DONE and role is Role.TECHNICIAN and fields - {"status"}:
            raise ConflictError(
                "La orden ya está terminada; pide a un supervisor que la reabra si hay que corregir algo"
            )
        if "assigned_to" in fields and self.status in CLOSED_STATUSES:
            raise ConflictError(f"No se puede reasignar una orden {label}")

    def assign(self, user_id: UUID | None) -> None:
        """Asignar/reasignar: pending → assigned; quitar el técnico: assigned → pending."""
        self.assigned_to = user_id
        if user_id and self.status is WorkOrderStatus.PENDING:
            self.status = WorkOrderStatus.ASSIGNED
        elif not user_id and self.status is WorkOrderStatus.ASSIGNED:
            self.status = WorkOrderStatus.PENDING

    def set_checklist(self, items: Iterable[dict[str, Any]]) -> None:
        """El cliente marca `done`; las claves y textos los define el tipo de orden."""
        labels = dict(CHECKLISTS[self.type])
        new = []
        for item in items:
            key = item.get("key")
            if key not in labels:
                raise InvalidDataError(f"El punto «{key}» no pertenece al checklist de esta orden")
            new.append({"key": key, "label": labels[key], "done": bool(item.get("done"))})
        self.checklist = new

    def change_status(self, new: WorkOrderStatus, role: Role, now: datetime) -> None:
        current = self.status
        if new is current:
            return
        if new not in TRANSITIONS[current]:
            raise InvalidTransitionError(
                f"No se puede pasar de «{STATUS_LABEL[current]}» a «{STATUS_LABEL[new]}»"
            )
        if role is Role.TECHNICIAN and (current, new) not in TECHNICIAN_TRANSITIONS:
            raise ForbiddenError(
                f"Solo un supervisor puede pasar la orden de «{STATUS_LABEL[current]}» "
                f"a «{STATUS_LABEL[new]}»"
            )
        if new is WorkOrderStatus.DONE:
            validate_result(self.type, self.result)
            self.completed_at = now
        elif new is WorkOrderStatus.IN_PROGRESS:
            self.started_at = self.started_at or now
        elif new is WorkOrderStatus.VERIFIED:
            self.verified_at = now
        self.status = new


def validate_result(order_type: WorkOrderType, result: dict[str, Any] | None) -> None:
    """Al cerrar, el resultado debe ser coherente con el tipo de orden."""
    if order_type is WorkOrderType.MAINTENANCE:
        return
    r = result or {}
    if order_type is WorkOrderType.WASTE_COLLECTION:
        weight = r.get("weight_kg")
        if r.get("waste_type") not in set(WasteType) or not isinstance(weight, int | float) or weight <= 0:
            raise InvalidDataError(
                "Para cerrar la recolección indica el tipo de residuo y un peso mayor a 0 kg"
            )
    elif order_type is WorkOrderType.CALIBRATION:
        if (
            not r.get("sensor_id")
            or r.get("calibration_offset") is None
            or r.get("calibration_factor") is None
        ):
            raise InvalidDataError("Para cerrar la calibración indica el sensor, el offset y el factor")
    elif order_type is WorkOrderType.CITIZEN_REPORT and r.get("confirmed") is None:
        raise InvalidDataError("Para cerrar indica si se confirmó el problema reportado")


def report_update_for(order: WorkOrder) -> tuple[ReportStatus, str | None] | None:
    """Estado (y nota pública) que debe tener el reporte ciudadano según su orden."""
    result = order.result or {}
    action = result.get("action_taken") or None
    if order.status in (WorkOrderStatus.DONE, WorkOrderStatus.VERIFIED):
        if result.get("confirmed") is False:
            return ReportStatus.REJECTED, action or NOT_FOUND_NOTE
        return ReportStatus.RESOLVED, action
    return {
        WorkOrderStatus.PENDING: (ReportStatus.VERIFIED, None),
        WorkOrderStatus.ASSIGNED: (ReportStatus.VERIFIED, None),
        WorkOrderStatus.IN_PROGRESS: (ReportStatus.IN_PROGRESS, None),
        WorkOrderStatus.CANCELLED: (ReportStatus.VERIFIED, None),
    }[order.status]


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def nearest_station(
    latitude: float, longitude: float, stations: Iterable[tuple[UUID, float, float]], max_km: float
) -> UUID | None:
    """Estación más cercana dentro de `max_km` (criterio de prototipo: 8 km)."""
    best, best_km = None, max_km
    for station_id, lat, lon in stations:
        km = haversine_km(latitude, longitude, lat, lon)
        if km <= best_km:
            best, best_km = station_id, km
    return best
