"""Bandeja del operador (tareas rápidas) y bitácora de vaciado de boyas skimmer. Reglas puras.

Complementa a las órdenes de trabajo (`operations.py`): una tarea es un pendiente ligero para la
brigada (vaciar o reparar una boya, revisar un reporte) sin checklist ni evidencias.
"""

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from app.domain.entities import Entity
from app.domain.enums import BuoyCondition, TaskKind, TaskPriority, TaskStatus, WasteType
from app.domain.errors import ConflictError, InvalidDataError

#: material de la encuesta (español) → `waste_type` del dashboard
SKIMMER_MATERIALS: dict[str, WasteType] = {
    "plastico": WasteType.PLASTIC,
    "organico": WasteType.ORGANIC,
    "vidrio": WasteType.GLASS,
    "otros": WasteType.OTHER,
    "metal": WasteType.METAL,
}


@dataclass(kw_only=True)
class Task(Entity):
    title: str
    kind: TaskKind
    description: str = ""
    priority: TaskPriority = TaskPriority.NORMAL
    status: TaskStatus = TaskStatus.PENDING
    assigned_to: UUID | None = None
    station_id: UUID | None = None
    buoy_code: str | None = None
    closing_note: str | None = None
    resolved_at: datetime | None = None
    resolved_by: UUID | None = None

    def resolve(self, note: str, by: UUID, now: datetime) -> None:
        note = note.strip()
        if self.status is TaskStatus.DONE:
            raise ConflictError("La tarea ya está resuelta")
        if len(note) < 3:
            raise InvalidDataError("Escribe una nota de cierre (mínimo 3 caracteres)")
        self.status, self.closing_note, self.resolved_by, self.resolved_at = TaskStatus.DONE, note, by, now
        self.touch(now)


@dataclass(kw_only=True)
class SkimmerCollection(Entity):
    """Un vaciado de boya: pesaje por material y estado físico. `materials[m] = {"kg": .., "piezas": ..}`."""

    station_id: UUID
    ts: datetime
    buoy_code: str
    buoy_condition: BuoyCondition
    materials: dict[str, dict[str, float]]
    total_kg: float
    total_pieces: int
    operator_id: UUID | None = None
    operator_name: str | None = None
    notes: str | None = None
    task_id: UUID | None = None

    def __post_init__(self) -> None:
        unknown = set(self.materials) - set(SKIMMER_MATERIALS)
        if unknown:
            raise InvalidDataError(f"Material desconocido: {', '.join(sorted(unknown))}")
        for name, m in self.materials.items():
            if m.get("kg", 0) < 0 or m.get("piezas", 0) < 0:
                raise InvalidDataError(f"{name}: kg y piezas no pueden ser negativos")
        if self.total_kg <= 0 and self.total_pieces <= 0:
            raise InvalidDataError("Registra al menos un material con peso o piezas")
