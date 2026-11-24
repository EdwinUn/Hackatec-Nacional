"""Salud de sensor a partir de su última señal y de sus lecturas recientes.

Orden de precedencia: offline > fault > degraded > ok.
- offline: no reporta en más de `offline_after`.
- fault: algún valor físicamente imposible, o valores idénticos en las últimas `stuck_window` lecturas.
- degraded: calidad promedio baja, o valores fuera del rango válido configurado del sensor.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta

from app.domain.enums import SensorStatus


@dataclass(frozen=True, slots=True)
class SensorHealthPolicy:
    offline_after: timedelta = timedelta(minutes=10)
    min_quality: float = 0.6
    stuck_window: int = 10
    stuck_tolerance: float = 1e-9


def evaluate_sensor_health(
    *,
    last_seen_at: datetime | None,
    now: datetime,
    recent_values: Sequence[float],
    recent_qualities: Sequence[float],
    valid_min: float,
    valid_max: float,
    physical_min: float,
    physical_max: float,
    policy: SensorHealthPolicy,
) -> SensorStatus:
    """`recent_values` / `recent_qualities` van de la más reciente a la más antigua."""
    if last_seen_at is None or now - last_seen_at > policy.offline_after:
        return SensorStatus.OFFLINE
    if any(not physical_min <= v <= physical_max for v in recent_values):
        return SensorStatus.FAULT
    window = recent_values[: policy.stuck_window]
    if len(window) >= policy.stuck_window and max(window) - min(window) <= policy.stuck_tolerance:
        return SensorStatus.FAULT
    if recent_qualities and sum(recent_qualities) / len(recent_qualities) < policy.min_quality:
        return SensorStatus.DEGRADED
    if any(not valid_min <= v <= valid_max for v in recent_values):
        return SensorStatus.DEGRADED
    return SensorStatus.OK
