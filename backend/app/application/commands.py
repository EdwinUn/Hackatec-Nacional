"""Datos de entrada de los casos de uso (independientes de HTTP)."""

from dataclasses import dataclass, field
from datetime import datetime
from uuid import UUID


@dataclass(frozen=True, slots=True)
class ReadingInput:
    sensor_id: UUID
    ts: datetime
    value: float
    quality: float = 1.0


@dataclass(frozen=True, slots=True)
class Rejection:
    index: int
    sensor_id: UUID
    ts: datetime
    reason: str  # unknown_sensor | impossible_value | future_timestamp
    detail: str


@dataclass(slots=True)
class IngestResult:
    received: int
    accepted: int = 0
    duplicates: int = 0
    rejected: list[Rejection] = field(default_factory=list)
    alerts_triggered: int = 0
