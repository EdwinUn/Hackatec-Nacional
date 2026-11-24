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
