"""Índice de criticidad (0–100) para ordenar los puntos críticos de contaminación.

Combina tres componentes explicables, cada uno en 0–100:
- calidad:     100 − WQI actual del agua cruda (qué tan mala está el agua ahora).
- alertas:     presión de alertas activas (crítica 25, advertencia 8, informativa 2; tope 100).
- recurrencia: repeticiones de alertas en el periodo, en escala logarítmica
               (10 → ~43, 100 → ~87, ≥ 200 → 100): un evento aislado pesa menos que uno persistente.

criticidad = 0.5 · calidad + 0.3 · alertas + 0.2 · recurrencia

⚠️ Pesos y cortes son VALORES DE PROTOTIPO, configurables vía CriticalityConfig.
"""

import math
from dataclasses import dataclass, field
from enum import StrEnum


class CriticalityLevel(StrEnum):
    CRITICAL = "critico"
    ATTENTION = "atencion"
    STABLE = "estable"


@dataclass(frozen=True, slots=True)
class CriticalityInput:
    wqi: float | None
    critical_active: int
    warning_active: int
    info_active: int
    occurrences: int  # repeticiones de alertas en el periodo


@dataclass(frozen=True)
class CriticalityConfig:
    weights: dict[str, float] = field(
        default_factory=lambda: {"calidad": 0.5, "alertas": 0.3, "recurrencia": 0.2}
    )
    alert_points: dict[str, float] = field(default_factory=lambda: {"critical": 25, "warning": 8, "info": 2})
    recurrence_saturation: int = 200
    critical_from: float = 50
    attention_from: float = 30


@dataclass(frozen=True)
class CriticalityResult:
    score: float
    level: CriticalityLevel
    components: dict[str, float]
    has_quality_data: bool


DEFAULT_CRITICALITY = CriticalityConfig()


def score_criticality(
    data: CriticalityInput, config: CriticalityConfig = DEFAULT_CRITICALITY
) -> CriticalityResult:
    quality = 0.0 if data.wqi is None else max(0.0, min(100.0, 100.0 - data.wqi))
    p = config.alert_points
    alerts = min(
        100.0,
        data.critical_active * p["critical"]
        + data.warning_active * p["warning"]
        + data.info_active * p["info"],
    )
    recurrence = min(
        100.0,
        100.0 * math.log1p(max(data.occurrences, 0)) / math.log1p(config.recurrence_saturation),
    )
    components = {
        "calidad": round(quality, 1),
        "alertas": round(alerts, 1),
        "recurrencia": round(recurrence, 1),
    }
    score = round(sum(components[k] * w for k, w in config.weights.items()), 1)
    if score >= config.critical_from:
        level = CriticalityLevel.CRITICAL
    elif score >= config.attention_from:
        level = CriticalityLevel.ATTENTION
    else:
        level = CriticalityLevel.STABLE
    return CriticalityResult(score, level, components, data.wqi is not None)
