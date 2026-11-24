"""Genera datos SIMULADOS para demos y pruebas.

    uv run python -m scripts.simulate --hours 24            # histórico (directo a la BD)
    uv run python -m scripts.simulate --live                # en vivo vía HTTP contra la API
    uv run python -m scripts.simulate --hours 24 --live     # ambos

El modo --live hace peticiones reales (POST /api/v1/readings, ciclos, lotes, basura) con
X-API-Key: ejercita validación, alertas, Redis y WebSocket de punta a punta.
Requiere haber corrido antes `python -m scripts.seed`.
"""

import argparse
import asyncio
import contextlib
import logging
from datetime import timedelta

from app.adapters.outbound.messaging.brokers import InMemoryBroker
from app.adapters.outbound.simulation.generator import RiverSimulator
from app.adapters.outbound.simulation.runner import LiveRunner, backfill
from app.adapters.outbound.simulation.sinks import HttpSink, ServiceSink
from app.config.container import Container
from app.config.settings import get_settings
from app.domain.entities import utcnow

log = logging.getLogger("simulate")


async def run_history(sim: RiverSimulator, hours: float) -> None:
    container = Container(get_settings(), broker=InMemoryBroker())
    try:
        sink = ServiceSink(container.catalog, container.ingestion, container.operations)
        if not await sink.topology():
            raise SystemExit("No hay estaciones. Corre primero: python -m scripts.seed")
        end = sim.anchor
        print(f"Generando {hours:g} h de histórico simulado…")
        stats = await backfill(sim, sink, end - timedelta(hours=hours), end)
        await container.monitoring.sweep()  # marca offline al sensor silenciado + alerta
        print("✓ " + ", ".join(f"{v} {k}" for k, v in stats.items()))
    finally:
        await container.engine.dispose()


async def run_live(
    sim: RiverSimulator, base_url: str, api_key: str, interval: float, spike_in: float | None
) -> None:
    sink = HttpSink(base_url, api_key)
    runner = LiveRunner(sim, sink)
    try:
        await runner.refresh_topology()
        if not runner.stations:
            raise SystemExit("No hay estaciones. Corre primero: python -m scripts.seed")
        if spike_in is not None:
            at = utcnow() + timedelta(minutes=spike_in)
            station = sim.schedule_demo_spike(at)
            print(f"⚠ Descarga ácida simulada en «{station}» a las {at:%H:%M:%S} UTC")
        print(f"En vivo contra {base_url} cada {interval:g} s (Ctrl+C para salir)…")
        ticks = 0
        while True:
            try:
                await runner.tick(utcnow())
                ticks += 1
                if ticks % 12 == 0:
                    print(f"  {ticks} ticks enviados")
            except Exception as exc:
                print(f"  ✗ {exc}")
            await asyncio.sleep(interval)
    finally:
        await sink.aclose()


async def main() -> None:
    settings = get_settings()
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    parser.add_argument("--hours", type=float, default=None, help="Horas de histórico a generar")
    parser.add_argument("--live", action="store_true", help="Emitir en vivo vía HTTP")
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument("--api-key", default=settings.ingest_api_key.get_secret_value())
    parser.add_argument("--interval", type=float, default=settings.simulation_interval_s)
    parser.add_argument("--seed", type=int, default=settings.simulation_seed or 42)
    parser.add_argument(
        "--spike-in",
        type=float,
        default=2.0,
        help="Minutos hasta la descarga ácida de demo en vivo (-1 = sin evento)",
    )
    args = parser.parse_args()
    if args.hours is None and not args.live:
        args.hours = 24

    sim = RiverSimulator(anchor=utcnow(), seed=args.seed)
    if args.hours:
        await run_history(sim, args.hours)
    if args.live:
        spike = None if args.spike_in < 0 else args.spike_in
        await run_live(sim, args.base_url, args.api_key, args.interval, spike)


if __name__ == "__main__":
    logging.basicConfig(level=logging.WARNING)
    with contextlib.suppress(KeyboardInterrupt):
        asyncio.run(main())
