"""Telemetría de la boya física (ESP32): un mensaje plano por envío.

Los campos de calidad del agua (pH, TDS, temperatura, turbidez) se convierten en lecturas de los
sensores de la estación. El resto (batería, corriente del río, generador, bomba) no es calidad del
agua: se guarda como estado del dispositivo (`DeviceTelemetry`).
"""

from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import datetime
from uuid import UUID, uuid4

from app.domain.entities import Sensor, utcnow
from app.domain.enums import SensorLocation, SensorType

L = SensorLocation


@dataclass(frozen=True, slots=True)
class Channel:
    """Campo del mensaje → sensor de la estación. `locations` en orden de preferencia."""

    type: SensorType
    locations: tuple[SensorLocation, ...]


# Las sondas de pH, TDS y temperatura de la boya miden el agua que entra; si la estación no tiene
# sensor de entrada se usa el del río.
CHANNELS: dict[str, Channel] = {
    "ph": Channel(SensorType.PH, (L.INLET, L.RIVER)),
    "tds_ppm": Channel(SensorType.TDS, (L.INLET, L.RIVER)),
    "temp_c": Channel(SensorType.TEMPERATURE, (L.INLET, L.RIVER)),
    "turb_in_ntu": Channel(SensorType.TURBIDITY, (L.INLET,)),
    "turb_out_ntu": Channel(SensorType.TURBIDITY, (L.OUTLET,)),
}


def resolve_channels(sensors: Iterable[Sensor]) -> dict[str, Sensor]:
    """Sensor que recibe cada campo. Los campos sin sensor quedan fuera del resultado."""
    by_slot: dict[tuple[SensorType, SensorLocation], Sensor] = {}
    for sensor in sorted(sensors, key=lambda s: s.created_at):
        by_slot.setdefault((sensor.type, sensor.location), sensor)  # si hay dos, gana el más antiguo
    resolved = {}
    for name, channel in CHANNELS.items():
        for location in channel.locations:
            sensor = by_slot.get((channel.type, location))
            if sensor is not None:
                resolved[name] = sensor
                break
    return resolved


@dataclass(kw_only=True)
class DeviceTelemetry:
    """Estado del dispositivo en un envío. Inmutable, como una lectura."""

    station_id: UUID
    ts: datetime
    seq: int | None = None  # contador `n` del firmware (se reinicia al reiniciar el ESP32)
    battery_v: float | None = None
    battery_pct: float | None = None
    river_speed_ms: float | None = None
    generator_w: float | None = None
    generator_v: float | None = None
    pump_on: bool | None = None
    brake_on: bool | None = None  # resistencia de descarga que frena el molino
    alarm_on: bool | None = None
    # Eficiencia que calcula el firmware (por turbidez). No es la `efficiency_pct` de los lotes,
    # que se calcula por volumen de agua.
    device_efficiency_pct: float | None = None
    id: UUID = field(default_factory=uuid4)
    created_at: datetime = field(default_factory=utcnow)
