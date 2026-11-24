"""Emulador del ESP32 de la boya: publica por MQTT el mismo mensaje que firmware/boya-rm01.

    uv run python -m scripts.buoy                                   # RM-01, agua contaminada
    uv run python -m scripts.buoy --code RM-02 --scenario limpia
    uv run python -m scripts.buoy --scenario bateria-baja --interval 5

Sirve cuando Wokwi en línea no da WiFi a dos simulaciones a la vez: una boya corre en Wokwi y
la otra aquí. Para el backend es indistinguible (mismo tópico, mismo JSON, mismas reglas de
bomba, freno y alerta que el firmware). Los valores son SIMULADOS, no mediciones reales.
Usa el broker de MQTT_URL (backend/.env) salvo que se pase --broker.
"""

import argparse
import asyncio
import contextlib
import json
import random
from dataclasses import dataclass
from datetime import datetime

import aiomqtt

from app.adapters.inbound.mqtt.bridge import BrokerConfig
from app.config.settings import get_settings
from app.domain.entities import utcnow

# Mismas constantes que el firmware (firmware/boya-rm01/sketch01.ino).
BAT_VACIA, BAT_LLENA = 9.0, 12.6
BAT_PARAR, BAT_ARRANCAR = 35.0, 75.0
GEN_V_FRENAR, GEN_V_SOLTAR = 26.0, 22.0
BAT_V_LLENA_FRENO, BAT_V_SOLTAR = 12.5, 12.3
PH_MIN, PH_MAX, TDS_MAX, TURB_MAX = 6.5, 8.5, 500.0, 50.0


@dataclass(frozen=True, slots=True)
class Scenario:
    """Valores medios y su variación (desviación estándar) por envío."""

    ph: tuple[float, float]
    tds: tuple[float, float]
    temp: tuple[float, float]
    turb_in: tuple[float, float]
    removal: float  # fracción de turbidez que quitan los filtros
    battery_pct: float  # carga inicial
    gen_v: tuple[float, float]
    charge_per_tick: float  # % que sube la batería con la bomba apagada
    drain_per_tick: float  # % que baja con la bomba encendida


SCENARIOS = {
    # Aguas abajo de una descarga: pH ácido, mucha sal disuelta y agua turbia.
    "contaminada": Scenario(
        ph=(5.3, 0.25),
        tds=(950, 60),
        temp=(23.0, 0.3),
        turb_in=(380, 60),
        removal=0.8,
        battery_pct=68,
        gen_v=(15.0, 3.0),
        charge_per_tick=0.25,
        drain_per_tick=0.35,
    ),
    "limpia": Scenario(
        ph=(7.2, 0.1),
        tds=(320, 20),
        temp=(19.5, 0.2),
        turb_in=(25, 5),
        removal=0.85,
        battery_pct=88,
        gen_v=(18.0, 2.0),
        charge_per_tick=0.25,
        drain_per_tick=0.2,
    ),
    # Contaminada y con poca batería: la bomba se apaga y el agua no se trata.
    "bateria-baja": Scenario(
        ph=(5.6, 0.25),
        tds=(900, 60),
        temp=(23.0, 0.3),
        turb_in=(350, 60),
        removal=0.8,
        battery_pct=36,
        gen_v=(6.0, 2.0),
        charge_per_tick=0.0,
        drain_per_tick=0.35,
    ),
}


class BuoyEmulator:
    """Genera un envío por llamada. Los valores derivan suavemente (no saltan al azar)."""

    def __init__(self, code: str, scenario: Scenario, seed: int | None = None) -> None:
        self.code = code
        self.s = scenario
        self.rng = random.Random(seed)
        self.n = 0
        self.battery_pct = scenario.battery_pct
        self.pump = self.battery_pct > BAT_ARRANCAR
        self.brake = False
        self._state = {k: getattr(scenario, k)[0] for k in ("ph", "tds", "temp", "turb_in", "gen_v")}

    def _walk(self, name: str) -> float:
        mean, sd = getattr(self.s, name)
        value = mean + (self._state[name] - mean) * 0.8 + self.rng.gauss(0, sd * 0.6)
        self._state[name] = value
        return value

    def step(self, now: datetime) -> dict:
        self.n += 1
        ph = min(max(self._walk("ph"), 0.0), 14.0)
        tds = max(self._walk("tds"), 0.0)
        temp = self._walk("temp")
        turb_in = min(max(self._walk("turb_in"), 0.0), 1000.0)
        turb_out = turb_in * (1 - self.s.removal) * self.rng.uniform(0.85, 1.15)
        gen_v = max(self._walk("gen_v"), 0.0)

        # Batería: carga con el generador y se descarga mientras la bomba trabaja.
        delta = -self.s.drain_per_tick if self.pump else self.s.charge_per_tick
        self.battery_pct = min(max(self.battery_pct + delta, 0.0), 100.0)
        bat_v = BAT_VACIA + self.battery_pct / 100 * (BAT_LLENA - BAT_VACIA)

        # Mismas histéresis que controlarBomba() y controlarFreno() del firmware.
        if self.pump and self.battery_pct < BAT_PARAR:
            self.pump = False
        if not self.pump and self.battery_pct > BAT_ARRANCAR:
            self.pump = True
        if not self.brake and (gen_v > GEN_V_FRENAR or (bat_v >= BAT_V_LLENA_FRENO and gen_v > bat_v)):
            self.brake = True
        if self.brake and gen_v < GEN_V_SOLTAR and bat_v < BAT_V_SOLTAR:
            self.brake = False

        alerta = ph < PH_MIN or ph > PH_MAX or tds > TDS_MAX or turb_in > TURB_MAX
        eficiencia = (turb_in - turb_out) / turb_in * 100 if turb_in > 0 else 0.0
        return {
            "boya": self.code,
            "n": self.n,
            "ts": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "ph": round(ph, 2),
            "tds_ppm": round(tds),
            "temp_c": round(temp, 1),
            "turb_in_ntu": round(turb_in),
            "turb_out_ntu": round(turb_out),
            "eficiencia_pct": round(min(max(eficiencia, 0.0), 100.0), 1),
            "bat_v": round(bat_v, 2),
            "bat_pct": round(self.battery_pct),
            "gen_v": round(gen_v, 1),
            "freno": self.brake,
            "bomba": self.pump,
            "alerta": alerta,
        }


async def run(emulator: BuoyEmulator, broker_url: str, topic: str, interval: float, count: int) -> None:
    b = BrokerConfig.from_url(broker_url)
    print(f"=== Emulador ESP32 · boya {emulator.code} ===")
    print(f"Broker {b.host}:{b.port} · tópico {topic} · cada {interval:g} s (Ctrl+C para salir)")
    sent = 0
    while not count or sent < count:
        try:
            async with aiomqtt.Client(
                b.host, b.port, username=b.username, password=b.password, identifier=f"emu-{emulator.code}"
            ) as client:
                print("Conectando a MQTT... listo")
                while not count or sent < count:
                    message = json.dumps(emulator.step(utcnow()), separators=(",", ":"))
                    print(message)
                    await client.publish(topic, message, qos=1)
                    print(f"  -> enviado a {topic}")
                    sent += 1
                    if not count or sent < count:
                        await asyncio.sleep(interval)
        except aiomqtt.MqttError as exc:
            print(f"  ✗ MQTT: {exc}; reintento en 5 s")
            await asyncio.sleep(5)


async def main() -> None:
    settings = get_settings()
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    parser.add_argument("--code", default="RM-01", help="`code` de la estación (default RM-01)")
    parser.add_argument("--scenario", choices=sorted(SCENARIOS), default="contaminada")
    parser.add_argument(
        "--broker",
        default=settings.mqtt_url.get_secret_value() or None,
        help="mqtt://host:1883 (default: MQTT_URL de backend/.env)",
    )
    parser.add_argument("--interval", type=float, default=15, help="Segundos entre envíos (firmware: 15)")
    parser.add_argument("--count", type=int, default=0, help="Envíos y termina (0 = sin fin)")
    parser.add_argument("--seed", type=int, default=None)
    args = parser.parse_args()
    if not args.broker:
        raise SystemExit("Falta el broker: define MQTT_URL en backend/.env o pasa --broker mqtt://host:1883")
    code = args.code.strip().upper()
    topic = settings.mqtt_topic.replace("+", code, 1)
    emulator = BuoyEmulator(code, SCENARIOS[args.scenario], args.seed)
    await run(emulator, args.broker, topic, args.interval, args.count)


if __name__ == "__main__":
    with contextlib.suppress(KeyboardInterrupt):
        asyncio.run(main())
