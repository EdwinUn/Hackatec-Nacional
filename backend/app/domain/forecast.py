"""Proyección simple por regresión lineal (mínimos cuadrados) sobre una serie reciente.

Es deliberadamente básica y explicable: pendiente + banda de ±1.96·σ de los residuos
(≈95% si los residuos fueran normales). Primer paso hacia el modelo predictivo del reto.
"""

import math
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta


@dataclass(frozen=True, slots=True)
class ForecastPoint:
    ts: datetime
    value: float
    lower: float
    upper: float


@dataclass(frozen=True)
class ForecastResult:
    slope_per_hour: float
    intercept: float  # valor estimado en el instante de la última observación
    residual_std: float
    points: list[ForecastPoint]
    samples: int


MIN_SAMPLES = 3


def linear_forecast(
    series: Sequence[tuple[datetime, float]],
    *,
    horizon: timedelta,
    step: timedelta,
    clamp: tuple[float, float] | None = None,
) -> ForecastResult | None:
    if len(series) < MIN_SAMPLES:
        return None
    t_last = series[-1][0]
    xs = [(ts - t_last).total_seconds() / 3600 for ts, _ in series]  # horas relativas (≤ 0)
    ys = [v for _, v in series]
    n = len(xs)
    mean_x, mean_y = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mean_x) ** 2 for x in xs)
    if sxx == 0:
        return None
    slope = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys, strict=True)) / sxx
    intercept = mean_y - slope * mean_x
    residuals = [y - (intercept + slope * x) for x, y in zip(xs, ys, strict=True)]
    std = math.sqrt(sum(r * r for r in residuals) / max(n - 2, 1))

    def bound(v: float) -> float:
        return min(max(v, clamp[0]), clamp[1]) if clamp else v

    points = []
    k = 1
    while k * step <= horizon:
        h = (k * step).total_seconds() / 3600
        value = intercept + slope * h
        points.append(
            ForecastPoint(
                ts=t_last + k * step,
                value=bound(value),
                lower=bound(value - 1.96 * std),
                upper=bound(value + 1.96 * std),
            )
        )
        k += 1
    return ForecastResult(slope, intercept, std, points, n)
