"""Telemetría de la boya física (ESP32): un mensaje plano por envío.

Los campos de calidad del agua (pH de entrada y de salida, TDS, temperatura, turbidez) se convierten
en lecturas de los sensores de la estación. El resto (batería, generador, bomba, caudal, cesta,
inclinación, módem) no es calidad del agua: se guarda como estado del dispositivo (`DeviceTelemetry`).
El formato del mensaje es el de `firmware/boya-rm01/sketch.ino`.
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
    "ph_out": Channel(SensorType.PH, (L.OUTLET,)),  # pH después de los filtros (calcita)
    "tds_ppm": Channel(SensorType.TDS, (L.INLET, L.RIVER)),
    "temp_c": Channel(SensorType.TEMPERATURE, (L.INLET, L.RIVER)),
    "turb_in_ntu": Channel(SensorType.TURBIDITY, (L.INLET,)),
    "turb_out_ntu": Channel(SensorType.TURBIDITY, (L.OUTLET,)),
    "do_mgl": Channel(SensorType.DISSOLVED_OXYGEN, (L.INLET, L.RIVER)),
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
    flow_rate_lpm: float | None = None  # caudal de la bomba (L/min)
    basket_fill_pct: float | None = None  # llenado de la cesta de basura (0–100)
    gas_v: float | None = None  # sensor de gas (V)
    rssi_dbm: float | None = None  # intensidad de la señal (dBm, negativo); de CSQ si es el módem 4G
    signal_csq: int | None = None  # calidad de señal del módem A7670SA tal cual (AT+CSQ, 0–31)
    pump_current_a: float | None = None  # corriente de la bomba (ACS712)
    water_liters_total: float | None = None  # agua procesada desde que arrancó el ESP32 (suma del caudal)
    pump_cycles: int | None = None  # encendidos de la bomba desde que arrancó el ESP32
    tilt_deg: float | None = None  # inclinación de la boya (MPU6050)
    shock: bool | None = None  # golpe detectado por el MPU6050 en esa lectura
    values: dict[str, float] | None = None  # calidad del agua de ese envío (nombres del firmware)
    id: UUID = field(default_factory=uuid4)
    created_at: datetime = field(default_factory=utcnow)
