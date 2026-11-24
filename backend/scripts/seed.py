"""Crea las 3 estaciones de ejemplo en Puebla, sus sensores y las reglas de alerta por defecto.

Uso (desde backend/):  uv run python -m scripts.seed [--reset]
Es idempotente: no duplica estaciones (por nombre) ni reglas.
"""

import argparse
import asyncio
from datetime import date

from sqlalchemy import text

from app.adapters.outbound.messaging.brokers import InMemoryBroker
from app.adapters.outbound.simulation.generator import SENSOR_LAYOUT
from app.config.container import Container
from app.config.settings import get_settings

STATIONS = [
    {
        "name": "Río Atoyac — Parque Lineal / Echeverría",
        "river": "Río Atoyac",
        "latitude": 19.0185,
        "longitude": -98.2435,
        "installed_at": date(2026, 11, 1),
        "description": "Boya prototipo en el tramo urbano del Atoyac (zona Parque Lineal / Echeverría).",
    },
    {
        "name": "Río Alseseca — La Hacienda / Xilotzingo",
        "river": "Río Alseseca",
        "latitude": 18.9950,
        "longitude": -98.1880,
        "installed_at": date(2026, 11, 5),
        "description": "Boya prototipo en el Alseseca (zona La Hacienda / Xilotzingo).",
    },
    {
        "name": "Presa de Valsequillo — Oasis / Embarcadero",
        "river": "Presa de Valsequillo",
        "latitude": 18.9180,
        "longitude": -98.1550,
        "installed_at": date(2026, 11, 10),
        "description": "Boya prototipo en la presa Manuel Ávila Camacho (zona Oasis / Embarcadero).",
    },
]

TABLES = (
    "alerts, alert_rules, readings, treatment_batches, centrifuge_cycles, waste_collections, "
    "sensors, stations, skimmer_collections, tasks, staff_users"
)


async def seed(container: Container, reset: bool = False) -> None:
    if reset:
        async with container.engine.begin() as conn:
            await conn.execute(text(f"TRUNCATE {TABLES} CASCADE"))
        print("Tablas vaciadas.")

    existing, _ = await container.catalog.list_stations(status=None, river=None, limit=500, offset=0)
    names = {s.name for s in existing}
    for data in STATIONS:
        if data["name"] in names:
            print(f"· ya existe: {data['name']}")
            continue
        station = await container.catalog.create_station(data)
        for sensor_type, location, vmin, vmax in SENSOR_LAYOUT:
            await container.catalog.create_sensor(
                {
                    "station_id": station.id,
                    "type": sensor_type,
                    "location": location,
                    "valid_min": vmin,
                    "valid_max": vmax,
                    "model": "Sensor simulado v0",
                }
            )
        print(f"✓ {station.name}: {len(SENSOR_LAYOUT)} sensores")

    await container.staff.ensure_demo_data()
    print("✓ cuentas demo (operador@/supervisor@/admin@atlmonitor.mx, contraseña atoyac2026) y tareas")

    created = await container.alerts.install_default_rules()
    print(f"✓ {created} reglas de alerta por defecto" if created else "· reglas de alerta ya existen")


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reset", action="store_true", help="Vacía todas las tablas antes de sembrar")
    args = parser.parse_args()
    container = Container(get_settings(), broker=InMemoryBroker())
    try:
        await seed(container, args.reset)
    finally:
        await container.engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
