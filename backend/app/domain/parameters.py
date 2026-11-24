"""Catálogo de parámetros medidos: unidad por defecto y límites físicos absolutos.

Los límites físicos sirven para rechazar valores *imposibles* (pH 17, turbidez negativa).
No son umbrales de calidad: esos viven en las reglas de alerta (ver defaults.py).
"""

from dataclasses import dataclass

from app.domain.enums import SensorType


@dataclass(frozen=True, slots=True)
class ParameterSpec:
    unit: str
    physical_min: float
    physical_max: float

    def is_possible(self, value: float) -> bool:
        return self.physical_min <= value <= self.physical_max


PARAMETERS: dict[SensorType, ParameterSpec] = {
    SensorType.PH: ParameterSpec("pH", 0.0, 14.0),
    SensorType.TURBIDITY: ParameterSpec("NTU", 0.0, 4000.0),
    SensorType.TEMPERATURE: ParameterSpec("°C", -5.0, 60.0),
    SensorType.DISSOLVED_OXYGEN: ParameterSpec("mg/L", 0.0, 25.0),
    SensorType.CONDUCTIVITY: ParameterSpec("µS/cm", 0.0, 100_000.0),
    SensorType.TDS: ParameterSpec("mg/L", 0.0, 100_000.0),
}
