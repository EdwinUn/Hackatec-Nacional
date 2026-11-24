"""Eventos de tiempo real. Los publica la capa de aplicación; el gestor WS los reenvía.

Sobre (envelope) que recibe el cliente:
    {"type": "<EventType>", "station_id": "<uuid|null>", "ts": "<iso8601>", "data": {...}}
"""

from dataclasses import asdict, dataclass, field, fields, is_dataclass
from datetime import date, datetime
from enum import Enum, StrEnum
from typing import Any
from uuid import UUID

from app.domain.entities import (
    Alert,
    CentrifugeCycle,
    Reading,
    Sensor,
    TreatmentBatch,
    WasteCollection,
    utcnow,
)
from app.domain.field_ops import SkimmerCollection
from app.domain.telemetry import DeviceTelemetry
from app.domain.treatment import compare_treatment


class EventType(StrEnum):
    READING = "reading"
    SENSOR_STATUS = "sensor_status"
    CYCLE_UPDATE = "cycle_update"
    BATCH_COMPLETED = "batch_completed"
    WASTE_COLLECTED = "waste_collected"
    ALERT = "alert"
    WORK_ORDER_ASSIGNED = "work_order_assigned"
    CITIZEN_REPORT_CREATED = "citizen_report_created"
    DEVICE_TELEMETRY = "device_telemetry"
    SKIMMER_COLLECTED = "skimmer_collected"


@dataclass(frozen=True, slots=True)
class Event:
    type: EventType
    station_id: UUID | None
    data: dict[str, Any]
    ts: datetime = field(default_factory=utcnow)

    def to_dict(self) -> dict[str, Any]:
        return {
            "type": self.type.value,
            "station_id": str(self.station_id) if self.station_id else None,
            "ts": self.ts.isoformat(),
            "data": self.data,
        }


def jsonable(value: Any) -> Any:
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, datetime | date):
        return value.isoformat()
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, dict):
        return {k: jsonable(v) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [jsonable(v) for v in value]
    if is_dataclass(value) and not isinstance(value, type):
        return {f.name: jsonable(getattr(value, f.name)) for f in fields(value)}
    return value


def _payload(entity: Any, *exclude: str) -> dict[str, Any]:
    return {k: jsonable(v) for k, v in asdict(entity).items() if k not in exclude}


def reading_event(reading: Reading, sensor: Sensor) -> Event:
    data = _payload(reading, "created_at")
    data |= {"type": sensor.type.value, "location": sensor.location.value, "unit": sensor.unit}
    return Event(EventType.READING, reading.station_id, data)


def sensor_status_event(sensor: Sensor, previous: str | None) -> Event:
    data = {
        "sensor_id": str(sensor.id),
        "type": sensor.type.value,
        "location": sensor.location.value,
        "status": sensor.status.value,
        "previous_status": previous,
        "last_seen_at": jsonable(sensor.last_seen_at),
    }
    return Event(EventType.SENSOR_STATUS, sensor.station_id, data)


def cycle_event(cycle: CentrifugeCycle) -> Event:
    data = _payload(cycle, "created_at") | {"duration_s": cycle.duration_s}
    return Event(EventType.CYCLE_UPDATE, cycle.station_id, data)


def batch_event(batch: TreatmentBatch) -> Event:
    comparison = compare_treatment(
        ph_in=batch.ph_in,
        ph_out=batch.ph_out,
        turbidity_in=batch.turbidity_in_ntu,
        turbidity_out=batch.turbidity_out_ntu,
    )
    data = _payload(batch, "created_at", "updated_at") | jsonable(comparison)
    return Event(EventType.BATCH_COMPLETED, batch.station_id, data)


def waste_event(waste: WasteCollection) -> Event:
    return Event(EventType.WASTE_COLLECTED, waste.station_id, _payload(waste, "created_at", "updated_at"))


def alert_event(alert: Alert) -> Event:
    return Event(EventType.ALERT, alert.station_id, _payload(alert))


def work_order_assigned_event(order: dict[str, Any], station_id: UUID | None) -> Event:
    """`order` ya serializado (con station_name/assigned_name); sin fotos de evidencia."""
    data = jsonable(order) | {"evidence": [{**e, "photo": None} for e in order.get("evidence", [])]}
    return Event(EventType.WORK_ORDER_ASSIGNED, station_id, data)


def citizen_report_created_event(report: dict[str, Any], station_id: UUID | None) -> Event:
    """Sin la foto: el front vuelve a pedir el listado para mostrarla."""
    return Event(EventType.CITIZEN_REPORT_CREATED, station_id, jsonable(report) | {"photo": None})


def device_telemetry_event(telemetry: DeviceTelemetry, code: str) -> Event:
    data = _payload(telemetry, "created_at") | {"code": code}
    return Event(EventType.DEVICE_TELEMETRY, telemetry.station_id, data)


def skimmer_event(collection: SkimmerCollection) -> Event:
    return Event(
        EventType.SKIMMER_COLLECTED, collection.station_id, _payload(collection, "created_at", "updated_at")
    )
