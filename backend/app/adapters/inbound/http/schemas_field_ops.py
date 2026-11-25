"""DTOs HTTP de la bandeja del operador (`/tasks`) y la bitácora de boyas skimmer (`/skimmers`)."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, Field

from app.adapters.inbound.http.schemas import NonNeg, Out, Page
from app.domain.enums import BuoyCondition, TaskKind, TaskPriority, TaskStatus, WasteType


class TaskOut(Out):
    id: UUID
    title: str
    description: str
    kind: TaskKind
    priority: TaskPriority
    status: TaskStatus
    assigned_to: UUID | None
    station_id: UUID | None
    buoy_code: str | None
    closing_note: str | None
    resolved_at: datetime | None
    resolved_by: UUID | None
    created_at: datetime
    updated_at: datetime


class TaskCounts(BaseModel):
    asignadas: int
    reparaciones_pendientes: int
    urgentes: int
    listos: int


class TaskPage(Page[TaskOut]):
    counts: TaskCounts


class TaskIn(BaseModel):
    title: str = Field(min_length=3, max_length=200)
    kind: TaskKind
    description: str = Field(default="", max_length=2000)
    priority: TaskPriority = TaskPriority.NORMAL
    assigned_to: UUID | None = None
    station_id: UUID | None = None
    buoy_code: str | None = Field(default=None, max_length=60)


class TaskPatch(BaseModel):
    """Atender: `{"status": "in_progress"}`. Resolver: `{"status": "done", "closing_note": "…"}`."""

    status: TaskStatus | None = None
    closing_note: str | None = Field(default=None, max_length=2000)
    priority: TaskPriority | None = None
    assigned_to: UUID | None = None


class MaterialIn(BaseModel):
    kg: NonNeg = 0
    piezas: int = Field(default=0, ge=0)


class CollectionIn(BaseModel):
    station_id: UUID
    buoy_code: str = Field(min_length=1, max_length=60, examples=["SK-01"])
    buoy_condition: BuoyCondition
    plastico: MaterialIn = MaterialIn()
    organico: MaterialIn = MaterialIn()
    vidrio: MaterialIn = MaterialIn()
    otros: MaterialIn = MaterialIn()
    metal: MaterialIn = MaterialIn()
    ts: AwareDatetime | None = Field(default=None, description="Default: ahora")
    notes: str | None = Field(default=None, max_length=1000)
    task_id: UUID | None = Field(default=None, description="Si se manda, la tarea de vaciado se cierra sola")

    def materials(self) -> dict[str, dict[str, float]]:
        return {
            n: {"kg": getattr(self, n).kg, "piezas": getattr(self, n).piezas}
            for n in ("plastico", "organico", "vidrio", "otros", "metal")
        }


class CollectionOut(Out):
    id: UUID
    station_id: UUID
    ts: datetime
    buoy_code: str
    buoy_condition: BuoyCondition
    materials: dict[str, MaterialIn]
    total_kg: float
    total_pieces: int
    operator_name: str | None
    notes: str | None
    task_id: UUID | None


class MaterialTotal(BaseModel):
    material: Literal["plastico", "organico", "vidrio", "otros", "metal"]
    waste_type: WasteType
    kg: float
    piezas: int
    pct: float = Field(description="% del peso total")


class ClassificationOut(BaseModel):
    total_kg: float
    total_piezas: int
    recolecciones: int
    ultima: datetime | None
    por_material: list[MaterialTotal]
