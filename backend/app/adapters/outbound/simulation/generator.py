"""Generador de datos SIMULADOS (no son mediciones reales).

Determinista en función de (semilla, sensor, instante): el histórico y el modo en vivo
producen la misma serie, y dos corridas con la misma semilla dan los mismos datos.

Escenario demo (relativo a `anchor`, normalmente "ahora"):
- Atoyac: descarga ácida en la entrada (pH ≈ 5.1) hace ~3 h → alerta crítica; la salida mejora.
- Alseseca: pico alcalino (pH ≈ 9.7) hace ~9 h; turbidez de salida con sensor DEGRADADO
  (calidad baja y valores erráticos); un ciclo con vibración excesiva que falla.
- Valsequillo: oxígeno disuelto bajo (hipoxia) hace ~5 h; el sensor de turbidez del río deja
  de reportar los últimos 45 min (OFFLINE).
- Atoyac: tormenta con turbidez alta hace ~14 h (la eficiencia baja durante el evento).
"""

import math
import random
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from app.domain.enums import SensorLocation, SensorType, WasteType

L, T = SensorLocation, SensorType

# Sensores que se siembran por estación: (tipo, ubicación, valid_min, valid_max).
SENSOR_LAYOUT: list[tuple[SensorType, SensorLocation, float, float]] = [
    (T.PH, L.INLET, 2, 12),
    (T.TURBIDITY, L.INLET, 0, 1000),
    (T.TEMPERATURE, L.INLET, 0, 40),
    (T.DISSOLVED_OXYGEN, L.INLET, 0, 20),
    (T.CONDUCTIVITY, L.INLET, 0, 5000),
    (T.TDS, L.INLET, 0, 3500),
    (T.PH, L.OUTLET, 2, 12),
    (T.TURBIDITY, L.OUTLET, 0, 100),
    (T.DISSOLVED_OXYGEN, L.OUTLET, 0, 20),
    (T.CONDUCTIVITY, L.OUTLET, 0, 5000),
    (T.PH, L.RIVER, 2, 12),
    (T.TURBIDITY, L.RIVER, 0, 1000),
]


@dataclass(frozen=True)
class Episode:
    """Evento de contaminación: desplaza un parámetro de entrada/río hacia `target`."""

    parameter: SensorType
    start: timedelta  # relativo al anchor (negativo = pasado)
    duration: timedelta
    target: float


@dataclass(frozen=True)
class StationProfile:
    name: str
    ph: float
    turbidity: float
    do: float
    temp: float
    conductivity: float
    episodes: tuple[Episode, ...] = ()
    degraded: tuple[tuple[SensorType, SensorLocation], ...] = ()
    silent_last: dict[tuple[SensorType, SensorLocation], timedelta] = field(default_factory=dict)
    bad_cycle_ago: timedelta | None = None


def _h(hours: float) -> timedelta:
    return timedelta(hours=hours)


# Nombres = los que crea scripts/seed.py. Líneas base ILUSTRATIVAS, no mediciones reales.
PROFILES: dict[str, StationProfile] = {
    p.name: p
    for p in [
        StationProfile(
            "Río Atoyac — Parque Lineal / Echeverría",
            ph=7.5,
            turbidity=55,
            do=6.0,
            temp=19,
            conductivity=1150,
            episodes=(
                Episode(T.PH, -_h(3), timedelta(minutes=45), 5.1),
                Episode(T.TURBIDITY, -_h(14), _h(1.5), 380),
            ),
        ),
        StationProfile(
            "Río Alseseca — La Hacienda / Xilotzingo",
            ph=7.3,
            turbidity=40,
            do=6.6,
            temp=18,
            conductivity=900,
            episodes=(Episode(T.PH, -_h(9), timedelta(minutes=35), 9.7),),
            degraded=((T.TURBIDITY, L.OUTLET),),
            bad_cycle_ago=_h(2),
        ),
        StationProfile(
            "Presa de Valsequillo — Oasis / Embarcadero",
            ph=8.0,
            turbidity=18,
            do=7.0,
            temp=21,
            conductivity=820,
            episodes=(Episode(T.DISSOLVED_OXYGEN, -_h(5), _h(1), 1.6),),
            silent_last={(T.TURBIDITY, L.RIVER): timedelta(minutes=45)},
        ),
    ]
}
DEFAULT_PROFILE = StationProfile("default", ph=7.2, turbidity=30, do=6.5, temp=20, conductivity=700)

CYCLE_EVERY = timedelta(minutes=30)
CYCLE_LENGTH = timedelta(minutes=20)
WASTE_EVERY = timedelta(minutes=45)
EPOCH = datetime(2000, 1, 1, tzinfo=UTC)


@dataclass(frozen=True)
class ReadingSample:
    ts: datetime
    value: float
    quality: float


@dataclass(frozen=True)
class CyclePlan:
    started_at: datetime
    ended_at: datetime
    failed: bool
    rpm_avg: float
    rpm_max: float
    vibration_mm_s: float
    power_w: float
    water_in_l: float
    water_out_clean_l: float
    sludge_kg: float
    ph_in: float
    ph_out: float
    turbidity_in: float
    turbidity_out: float


@dataclass(frozen=True)
class WastePlan:
    ts: datetime
    waste_type: WasteType
    weight_kg: float
    items_count: int


class RiverSimulator:
    def __init__(
        self, *, anchor: datetime, seed: int = 42, extra_episodes: dict[str, list[Episode]] | None = None
    ) -> None:
        self.anchor = anchor
        self.seed = seed
        self.extra_episodes = extra_episodes or {}

    def schedule_demo_spike(self, at: datetime, minutes: int = 10) -> str:
        """Programa una descarga ácida en Atoyac para mostrar una alerta crítica en vivo."""
        name = next(iter(PROFILES))
        episode = Episode(T.PH, at - self.anchor, timedelta(minutes=minutes), 5.0)
        self.extra_episodes.setdefault(name, []).append(episode)
        return name

    def profile(self, station_name: str) -> StationProfile:
        return PROFILES.get(station_name, DEFAULT_PROFILE)

    def _rng(self, *key: object) -> random.Random:
        return random.Random(f"{self.seed}|{'|'.join(map(str, key))}")

    def _episode_factor(self, p: StationProfile, parameter: SensorType, ts: datetime) -> tuple[float, float]:
        """(peso 0–1, objetivo) del episodio activo; rampa suave de entrada/salida."""
        for e in (*p.episodes, *self.extra_episodes.get(p.name, ())):
            if e.parameter is not parameter:
                continue
            start = self.anchor + e.start
            x = (ts - start) / e.duration
            if 0 <= x <= 1:
                return math.sin(math.pi * x) ** 0.5, e.target
        return 0.0, 0.0

    def _raw(self, p: StationProfile, parameter: SensorType, ts: datetime, rng: random.Random) -> float:
        """Agua cruda (río/entrada)."""
        hours = (ts - EPOCH).total_seconds() / 3600
        day = math.sin(2 * math.pi * ((hours % 24) - 9) / 24)  # máximo ~15 h
        drift = math.sin(2 * math.pi * hours / 37)  # deriva lenta
        base = {
            T.PH: p.ph + 0.15 * drift + 0.1 * day + rng.gauss(0, 0.04),
            T.TURBIDITY: p.turbidity * (1 + 0.25 * drift) + rng.gauss(0, p.turbidity * 0.06),
            T.TEMPERATURE: p.temp + 3 * day + 0.5 * drift + rng.gauss(0, 0.15),
            T.DISSOLVED_OXYGEN: p.do + 0.8 * day + 0.3 * drift + rng.gauss(0, 0.12),
            T.CONDUCTIVITY: p.conductivity * (1 + 0.08 * drift) + rng.gauss(0, 12),
        }
        if parameter is T.TDS:
            return max(self._raw(p, T.CONDUCTIVITY, ts, rng) * 0.65, 0)
        value = base[parameter]
        weight, target = self._episode_factor(p, parameter, ts)
        value = value * (1 - weight) + target * weight
        return max(value, 0.0)

    def value(
        self, station_name: str, parameter: SensorType, location: SensorLocation, ts: datetime
    ) -> ReadingSample | None:
        p = self.profile(station_name)
        silent = p.silent_last.get((parameter, location))
        if silent and ts > self.anchor - silent:
            return None
        rng = self._rng(station_name, parameter.value, location.value, int(ts.timestamp()))
        # El sensor del río ve la misma agua que la entrada con un poco más de ruido.
        raw = self._raw(p, parameter, ts, self._rng(station_name, parameter.value, int(ts.timestamp())))
        if location is L.OUTLET:
            value = {
                T.PH: 7.1 + (raw - 7.1) * 0.22 + rng.gauss(0, 0.03),
                T.TURBIDITY: raw * 0.04 + 0.8 + abs(rng.gauss(0, 0.3)),
                T.DISSOLVED_OXYGEN: min(raw + 1.6, 9.5) + rng.gauss(0, 0.1),
                T.CONDUCTIVITY: raw * 0.92,
                T.TDS: raw * 0.92,
                T.TEMPERATURE: raw + 0.3,
            }[parameter]
        elif location is L.RIVER:
            value = raw * (1 + rng.gauss(0, 0.01))
        else:
            value = raw
        quality = min(1.0, 0.93 + rng.random() * 0.07)
        if (parameter, location) in p.degraded:
            quality = 0.3 + rng.random() * 0.25
            if rng.random() < 0.15:
                value *= 3 + rng.random() * 4  # lecturas erráticas
        return ReadingSample(ts=ts, value=round(max(value, 0.0), 3), quality=round(quality, 3))

    # ── Operación de la máquina ──────────────────
    @staticmethod
    def slot_start(ts: datetime, every: timedelta) -> datetime:
        return EPOCH + ((ts - EPOCH) // every) * every

    def cycle(self, station_name: str, started_at: datetime) -> CyclePlan:
        p = self.profile(station_name)
        rng = self._rng("cycle", station_name, int(started_at.timestamp()))
        mid = started_at + CYCLE_LENGTH / 2
        turbidity_in = self._raw(p, T.TURBIDITY, mid, rng)
        ph_in = self._raw(p, T.PH, mid, rng)
        failed = bool(
            p.bad_cycle_ago
            and abs((started_at - (self.anchor - p.bad_cycle_ago)).total_seconds())
            < CYCLE_EVERY.total_seconds() / 2
        )
        water_in = rng.uniform(450, 600)
        # Más sedimento → menor recuperación y más lodo.
        efficiency = max(0.6, min(0.96, rng.uniform(0.88, 0.95) - turbidity_in / 2500))
        if failed:
            efficiency *= 0.5
        rpm = rng.uniform(2700, 2950)
        return CyclePlan(
            started_at=started_at,
            ended_at=started_at + (CYCLE_LENGTH * (0.4 if failed else 1)),
            failed=failed,
            rpm_avg=round(rpm, 1),
            rpm_max=round(rpm + rng.uniform(120, 260), 1),
            vibration_mm_s=round(rng.uniform(8.0, 9.5) if failed else rng.uniform(1.8, 3.6), 2),
            power_w=round(rng.uniform(720, 880), 1),
            water_in_l=round(water_in, 1),
            water_out_clean_l=round(water_in * efficiency, 1),
            sludge_kg=round(water_in * (0.002 + turbidity_in / 60000), 2),
            ph_in=round(ph_in, 2),
            ph_out=round(7.1 + (ph_in - 7.1) * 0.22, 2),
            turbidity_in=round(turbidity_in, 1),
            turbidity_out=round(turbidity_in * 0.04 + 0.8, 2),
        )

    def waste(self, station_name: str, ts: datetime) -> WastePlan:
        rng = self._rng("waste", station_name, int(ts.timestamp()))
        waste_type = rng.choices(list(WasteType), weights=[0.5, 0.25, 0.08, 0.07, 0.10])[0]
        weight = rng.uniform(0.2, 2.5) * (1.5 if waste_type is WasteType.ORGANIC else 1)
        return WastePlan(
            ts=ts,
            waste_type=waste_type,
            weight_kg=round(weight, 2),
            items_count=max(1, int(weight * rng.uniform(4, 12))),
        )
