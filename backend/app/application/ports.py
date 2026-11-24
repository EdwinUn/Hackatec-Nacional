"""Puertos (interfaces) que la capa de aplicación necesita del exterior."""

from collections.abc import AsyncIterator, Callable, Sequence
from datetime import datetime, timedelta
from typing import Any, Protocol, Self
from uuid import UUID

from app.application.events import Event
from app.domain.entities import (
    Alert,
    AlertRule,
    CentrifugeCycle,
    Reading,
    Sensor,
    SkimmerCollection,
    StaffUser,
    Station,
    Task,
    TreatmentBatch,
    WasteCollection,
)
from app.domain.enums import (
    AlertStatus,
    CycleStatus,
    RuleKind,
    SensorLocation,
    SensorStatus,
    SensorType,
    Severity,
    StationStatus,
    TaskView,
)
from app.domain.vision import Assessment, BuoyInspection, Detection

Page = tuple[list[Any], int]  # (items, total)


class StationRepository(Protocol):
    async def get(self, station_id: UUID) -> Station | None: ...
    async def add(self, station: Station) -> None: ...
    async def save(self, station: Station) -> None: ...
    async def list(
        self, *, status: StationStatus | None, river: str | None, limit: int, offset: int
    ) -> tuple[list[Station], int]: ...


class SensorRepository(Protocol):
    async def get(self, sensor_id: UUID) -> Sensor | None: ...
    async def get_many(self, sensor_ids: Sequence[UUID]) -> dict[UUID, Sensor]: ...
    async def add(self, sensor: Sensor) -> None: ...
    async def save(self, sensor: Sensor) -> None: ...
    async def record_activity(
        self, sensor_id: UUID, last_seen_at: datetime | None, status: SensorStatus
    ) -> None:
        """Escritura dirigida: last_seen_at solo avanza (GREATEST) y no pisa otros campos."""
        ...

    async def list(
        self,
        *,
        station_id: UUID | None = None,
        type: SensorType | None = None,
        location: SensorLocation | None = None,
        status: SensorStatus | None = None,
        limit: int = 1000,
        offset: int = 0,
    ) -> tuple[list[Sensor], int]: ...


class ReadingRepository(Protocol):
    async def add_many(self, readings: Sequence[Reading]) -> list[Reading]:
        """Inserta ignorando duplicados (sensor_id, ts). Devuelve solo las insertadas."""
        ...

    async def recent(self, sensor_id: UUID, limit: int) -> list[tuple[float, float]]:
        """(value, quality) de las últimas `limit` lecturas, de la más nueva a la más vieja."""
        ...


class CycleRepository(Protocol):
    async def get(self, cycle_id: UUID) -> CentrifugeCycle | None: ...
    async def add(self, cycle: CentrifugeCycle) -> None: ...
    async def save(self, cycle: CentrifugeCycle) -> None: ...
    async def list(
        self, *, station_id: UUID | None, status: CycleStatus | None, limit: int, offset: int
    ) -> tuple[list[CentrifugeCycle], int]: ...


class BatchRepository(Protocol):
    async def add(self, batch: TreatmentBatch) -> None: ...


class WasteRepository(Protocol):
    async def add(self, waste: WasteCollection) -> None: ...


class AlertRuleRepository(Protocol):
    async def get(self, rule_id: UUID) -> AlertRule | None: ...
    async def add(self, rule: AlertRule) -> None: ...
    async def save(self, rule: AlertRule) -> None: ...
    async def list(self, *, kind: RuleKind | None = None, enabled_only: bool = False) -> list[AlertRule]: ...


class AlertRepository(Protocol):
    async def upsert_open(self, alert: Alert) -> tuple[Alert, bool]:
        """Crea la alerta o, si ya hay una abierta/reconocida con el mismo (rule_id, subject_key),
        incrementa occurrences y actualiza el último valor.

        Devuelve (alerta, notificar): notificar es True si se creó o si se re-disparó después
        del intervalo de re-notificación (para avisar en tiempo real sin spam)."""
        ...

    async def get(self, alert_id: UUID) -> Alert | None: ...
    async def save(self, alert: Alert) -> None: ...
    async def list(
        self,
        *,
        station_id: UUID | None,
        status: AlertStatus | None,
        severity: Severity | None,
        since: datetime | None,
        limit: int,
        offset: int,
    ) -> tuple[list[Alert], int]: ...


class StaffUserRepository(Protocol):
    async def get(self, user_id: UUID) -> StaffUser | None: ...
    async def get_by_email(self, email: str) -> StaffUser | None: ...
    async def add(self, user: StaffUser) -> None: ...
    async def save(self, user: StaffUser) -> None: ...


class TaskRepository(Protocol):
    async def get(self, task_id: UUID) -> Task | None: ...
    async def add(self, task: Task) -> None: ...
    async def save(self, task: Task) -> None: ...
    async def count(self) -> int: ...
    async def list(
        self, *, view: TaskView | None, user_id: UUID | None, limit: int, offset: int
    ) -> tuple[list[Task], int]: ...
    async def counts(self, user_id: UUID | None) -> dict[TaskView, int]: ...


class SkimmerRepository(Protocol):
    async def add(self, collection: SkimmerCollection) -> None: ...
    async def list(
        self,
        *,
        station_id: UUID | None,
        start: datetime | None,
        end: datetime | None,
        limit: int,
        offset: int,
    ) -> tuple[list[SkimmerCollection], int]: ...
    async def all_in(
        self, *, station_id: UUID | None, start: datetime | None, end: datetime | None
    ) -> Sequence[SkimmerCollection]: ...


class UnitOfWork(Protocol):
    stations: StationRepository
    sensors: SensorRepository
    readings: ReadingRepository
    cycles: CycleRepository
    batches: BatchRepository
    waste: WasteRepository
    rules: AlertRuleRepository
    alerts: AlertRepository
    users: StaffUserRepository
    tasks: TaskRepository
    skimmers: SkimmerRepository

    async def __aenter__(self) -> Self: ...
    async def __aexit__(self, *exc: object) -> None: ...
    async def commit(self) -> None: ...


UnitOfWorkFactory = Callable[[], UnitOfWork]
Clock = Callable[[], datetime]


class EventPublisher(Protocol):
    async def publish(self, events: Sequence[Event]) -> None: ...


class EventSubscriber(Protocol):
    def listen(self) -> AsyncIterator[dict[str, Any]]:
        """Itera los eventos (ya como dict JSON) publicados por cualquier worker."""
        ...


class AnalyticsReader(Protocol):
    """Lado de lectura: consultas agregadas en SQL que devuelven DTOs/filas directamente."""

    async def latest_values(self, station_id: UUID | None, at: datetime) -> list[dict[str, Any]]: ...
    async def overview_totals(
        self, station_id: UUID | None, start: datetime, end: datetime
    ) -> dict[str, Any]: ...
    async def overview_trend(
        self, station_id: UUID | None, start: datetime, end: datetime, bucket: timedelta
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        """(promedios por bucket/tipo/ubicación de lecturas, litros limpios por bucket)."""
        ...

    async def ph_series(
        self, station_id: UUID | None, start: datetime, end: datetime, bucket: timedelta
    ) -> list[dict[str, Any]]: ...
    async def sensor_health(
        self, station_id: UUID | None, start: datetime, end: datetime, bucket: timedelta
    ) -> list[dict[str, Any]]: ...
    async def centrifuge(
        self, station_id: UUID | None, start: datetime, end: datetime, bucket: timedelta
    ) -> tuple[dict[str, Any], list[dict[str, Any]]]: ...
    async def water_recovery(
        self, station_id: UUID | None, start: datetime, end: datetime, bucket: timedelta
    ) -> tuple[dict[str, Any], list[dict[str, Any]]]: ...
    async def waste(
        self, station_id: UUID | None, start: datetime, end: datetime, bucket: timedelta
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]: ...
    async def parameter_series(
        self,
        station_id: UUID,
        parameter: SensorType,
        location: SensorLocation,
        start: datetime,
        end: datetime,
        bucket: timedelta,
    ) -> list[tuple[datetime, float]]: ...
    async def stations_with_alerts(self) -> list[dict[str, Any]]: ...
    async def alert_pressure(
        self, start: datetime, end: datetime
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        """Solo alertas de calidad del agua: (activas por estación/severidad,
        repeticiones por estación/regla en el periodo)."""
        ...


class HealthProbe(Protocol):
    async def check(self) -> dict[str, str]: ...


class VisionEngine(Protocol):
    """Motor de visión artificial (YOLO-World + verificación HSV + dibujado).

    La imagen decodificada es opaca para la aplicación (`Any`): solo la entiende el adaptador.
    Si falta el extra `vision` o el modelo, los métodos lanzan `VisionUnavailableError`;
    si los bytes no son una imagen, `decode` lanza `ValueError`.
    """

    def decode(self, data: bytes) -> Any: ...
    def image_size(self, image: Any) -> tuple[int, int]:
        """(ancho, alto) en píxeles."""
        ...

    def detect(self, image: Any) -> list[Detection]: ...
    def inspect_buoy(self, image: Any, detections: list[Detection]) -> BuoyInspection: ...
    def classify_scene(self, image: Any) -> dict[str, float] | None:
        """Probabilidad de cada escena (peces muertos, basura…); None si no hay clasificador."""
        ...

    def annotate(
        self, image: Any, detections: list[Detection], inspection: BuoyInspection, assessment: Assessment
    ) -> bytes:
        """JPEG con las cajas de detección y las regiones de color dibujadas."""
        ...
