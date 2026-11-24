"""Índice simple de calidad del agua (WQI 0–100).

Método (explicable a propósito):
1. Cada parámetro se convierte a un sub-índice 0–100 con una curva lineal por tramos
   (puntos de quiebre valor → puntaje).
2. El WQI es el promedio ponderado de los sub-índices de los parámetros disponibles;
   los pesos se re-normalizan si falta alguno.
3. El puntaje se clasifica en categorías.

⚠️ Curvas, pesos y cortes son VALORES DE PROTOTIPO, inspirados en la forma de índices
conocidos (p. ej. NSF-WQI / CCME-WQI) pero NO calibrados ni validados. Configurables vía WqiConfig.
"""

from bisect import bisect_right
from collections.abc import Mapping
from dataclasses import dataclass, field
from enum import StrEnum

from app.domain.enums import SensorType

Curve = tuple[tuple[float, float], ...]


class WqiCategory(StrEnum):
    EXCELLENT = "excelente"
    GOOD = "buena"
    FAIR = "regular"
    BAD = "mala"
    CRITICAL = "critica"


def sub_index(curve: Curve, value: float) -> float:
    """Interpola linealmente `value` sobre la curva; fuera de los extremos se satura."""
    xs = [x for x, _ in curve]
    if value <= xs[0]:
        return curve[0][1]
    if value >= xs[-1]:
        return curve[-1][1]
    i = bisect_right(xs, value)
    (x0, y0), (x1, y1) = curve[i - 1], curve[i]
    return y0 + (y1 - y0) * (value - x0) / (x1 - x0)


@dataclass(frozen=True)
class WqiConfig:
    curves: Mapping[SensorType, Curve]
    weights: Mapping[SensorType, float]
    # (puntaje mínimo, categoría), de mayor a menor.
    cuts: tuple[tuple[float, WqiCategory], ...] = (
        (90, WqiCategory.EXCELLENT),
        (70, WqiCategory.GOOD),
        (50, WqiCategory.FAIR),
        (25, WqiCategory.BAD),
    )

    def categorize(self, score: float) -> WqiCategory:
        for minimum, category in self.cuts:
            if score >= minimum:
                return category
        return WqiCategory.CRITICAL


DEFAULT_WQI_CONFIG = WqiConfig(
    curves={
        # pH: óptimo cerca de neutro; 6.5–8.5 es el rango aceptable usual.
        SensorType.PH: (
            (4.0, 0),
            (5.5, 30),
            (6.5, 90),
            (7.0, 100),
            (7.5, 100),
            (8.5, 90),
            (9.5, 30),
            (11.0, 0),
        ),
        # Turbidez (NTU): a mayor turbidez, menor puntaje.
        SensorType.TURBIDITY: ((0, 100), (5, 90), (25, 60), (100, 20), (300, 0)),
        # Oxígeno disuelto (mg/L): < 2 hipoxia; ≥ 7 bueno para vida acuática.
        SensorType.DISSOLVED_OXYGEN: ((0, 0), (2, 10), (5, 70), (7, 95), (9, 100)),
        # Temperatura (°C): penaliza extremos.
        SensorType.TEMPERATURE: ((0, 40), (10, 90), (15, 100), (25, 100), (30, 70), (40, 20)),
        # Conductividad (µS/cm) y SDT (mg/L): proxies de sales/contaminantes disueltos.
        SensorType.CONDUCTIVITY: ((0, 100), (500, 100), (1500, 60), (3000, 10)),
        SensorType.TDS: ((0, 100), (500, 90), (1000, 50), (2000, 0)),
    },
    weights={
        SensorType.PH: 0.25,
        SensorType.TURBIDITY: 0.25,
        SensorType.DISSOLVED_OXYGEN: 0.25,
        SensorType.TEMPERATURE: 0.10,
        SensorType.CONDUCTIVITY: 0.10,
        SensorType.TDS: 0.05,
    },
)


@dataclass(frozen=True, slots=True)
class WqiComponent:
    value: float
    sub_index: float
    weight: float  # peso efectivo tras re-normalizar


@dataclass(frozen=True)
class WqiResult:
    score: float
    category: WqiCategory
    components: dict[SensorType, WqiComponent] = field(default_factory=dict)


def compute_wqi(
    values: Mapping[SensorType, float], config: WqiConfig = DEFAULT_WQI_CONFIG
) -> WqiResult | None:
    usable = {p: v for p, v in values.items() if p in config.curves and config.weights.get(p, 0) > 0}
    if not usable:
        return None
    total_weight = sum(config.weights[p] for p in usable)
    components = {
        p: WqiComponent(
            value=v,
            sub_index=round(sub_index(config.curves[p], v), 2),
            weight=config.weights[p] / total_weight,
        )
        for p, v in usable.items()
    }
    score = round(sum(c.sub_index * c.weight for c in components.values()), 1)
    return WqiResult(score=score, category=config.categorize(score), components=components)
