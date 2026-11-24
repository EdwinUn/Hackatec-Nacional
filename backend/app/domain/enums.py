from enum import StrEnum


class StationStatus(StrEnum):
    ACTIVE = "active"
    MAINTENANCE = "maintenance"
    OFFLINE = "offline"


class SensorType(StrEnum):
    PH = "ph"
    TURBIDITY = "turbidity"
    TEMPERATURE = "temperature"
    DISSOLVED_OXYGEN = "dissolved_oxygen"
    CONDUCTIVITY = "conductivity"
    TDS = "tds"


class SensorLocation(StrEnum):
    INLET = "inlet"
    OUTLET = "outlet"
    RIVER = "river"


class SensorStatus(StrEnum):
    OK = "ok"
    DEGRADED = "degraded"
    FAULT = "fault"
    OFFLINE = "offline"


class CycleStatus(StrEnum):
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class WasteType(StrEnum):
    PLASTIC = "plastic"
    ORGANIC = "organic"
    METAL = "metal"
    GLASS = "glass"
    OTHER = "other"


class Severity(StrEnum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


class AlertStatus(StrEnum):
    OPEN = "open"
    ACKNOWLEDGED = "acknowledged"
    RESOLVED = "resolved"


class RuleKind(StrEnum):
    """Qué evalúa una regla de alerta.

    - reading_range: una lectura de `parameter` (opcionalmente en `location`) sale de [min, max].
    - sensor_offline: un sensor no reporta en más de `max_value` minutos.
    - centrifuge_vibration: la vibración de un ciclo supera `max_value` mm/s.
    - treatment_efficiency: la eficiencia de un lote cae debajo de `min_value` %.
    """

    READING_RANGE = "reading_range"
    SENSOR_OFFLINE = "sensor_offline"
    CENTRIFUGE_VIBRATION = "centrifuge_vibration"
    TREATMENT_EFFICIENCY = "treatment_efficiency"


# ── Bandeja del operador y bitácora de boyas skimmer ──────────────────────────
class TaskKind(StrEnum):
    REPORT = "report"  # atender un reporte ciudadano
    REPAIR = "repair"  # reparar una boya / equipo
    SKIMMER_COLLECTION = "skimmer_collection"  # vaciar una boya skimmer
    MAINTENANCE = "maintenance"


class TaskPriority(StrEnum):
    NORMAL = "normal"
    URGENT = "urgent"


class TaskStatus(StrEnum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    DONE = "done"


class TaskView(StrEnum):
    """Pestañas de la bandeja del operador (nombres de la API en español)."""

    ASSIGNED = "asignadas"
    PENDING_REPAIRS = "reparaciones_pendientes"
    URGENT = "urgentes"
    DONE = "listos"


class BuoyCondition(StrEnum):
    """Estado físico de la boya skimmer al vaciarla."""

    OK = "ok"
    DAMAGED = "danada"
    SATURATED = "saturada"
    MISSING_PARTS = "faltan_piezas"
