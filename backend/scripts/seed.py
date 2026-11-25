"""Crea las estaciones de ejemplo en Puebla, sus sensores y las reglas de alerta por defecto.

- 3 estaciones simuladas (sin `code`): las alimenta el simulador, con sus escenarios demo.
- 2 boyas con dispositivo (`code` RM-01 y RM-02): las alimenta el ESP32 (Wokwi o boya real) por
  MQTT, con solo los 5 sensores que trae el firmware. El simulador no las toca.

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
from app.domain.telemetry import CHANNELS

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

# Boyas alimentadas por un ESP32 (firmware/boya-rm01). Dos para mostrar estados distintos:
# una aguas abajo de una descarga fuerte y otra en la estación testigo aguas arriba.
DEVICE_STATIONS = [
    {
        "name": "Boya RM-01 — Atoyac, colector Panzacola",
        "code": "RM-01",  # tópico MQTT riomonitor/RM-01/telemetria
        "river": "Río Atoyac",
        "latitude": 19.1561,
        "longitude": -98.2373,
        "installed_at": date(2026, 11, 24),
        "description": "Boya ESP32 (Wokwi) aguas abajo de la descarga del colector Panzacola.",
    },
    {
        "name": "Boya RM-02 — Atoyac, estación testigo Tlahuapan",
        "code": "RM-02",
        "river": "Río Atoyac",
        "latitude": 19.3678,
        "longitude": -98.5152,
        "installed_at": date(2026, 11, 24),
        "description": "Boya ESP32 (Wokwi) en el punto de referencia aguas arriba del Atoyac.",
    },
]

# Un sensor por campo del firmware, en su ubicación preferida; rangos válidos del layout simulado.
VALID_RANGE = {(t, loc): (vmin, vmax) for t, loc, vmin, vmax in SENSOR_LAYOUT}
DEVICE_LAYOUT = [
    (ch.type, ch.locations[0], *VALID_RANGE.get((ch.type, ch.locations[0]), (None, None)))
    for ch in CHANNELS.values()
]

# Solo en ENVIRONMENT de desarrollo (el seed no crea estas cuentas en producción).
DEMO_USERS = [
    {
        "name": "Operador de Brigada",
        "email": "operador@atlmonitor.mx",
        "role": "technician",
        "password": "atoyac2026",
    },
    {"name": "Luis Hernández", "email": "tecnico@demo.mx", "role": "technician", "password": "demo123"},
    {"name": "Ana Ramírez", "email": "tecnico2@demo.mx", "role": "technician", "password": "demo123"},
    {"name": "Mariana López", "email": "supervisor@demo.mx", "role": "supervisor", "password": "demo123"},
    {"name": "Admin Demo", "email": "admin@demo.mx", "role": "admin", "password": "demo123"},
]

TABLES = (
    "skimmer_collections, tasks, work_orders, citizen_reports, users, "
    "alerts, alert_rules, readings, treatment_batches, centrifuge_cycles, waste_collections, "
    "sensors, stations"
)


async def seed(container: Container, reset: bool = False) -> None:
    if reset:
        async with container.engine.begin() as conn:
            await conn.execute(text(f"TRUNCATE {TABLES} CASCADE"))
            await conn.execute(text("ALTER SEQUENCE citizen_report_folio_seq RESTART"))
            await conn.execute(text("ALTER SEQUENCE work_order_folio_seq RESTART"))
        print("Tablas vaciadas.")

    existing, _ = await container.catalog.list_stations(status=None, river=None, limit=500, offset=0)
    names = {s.name for s in existing}
    for stations, layout, model in (
        (STATIONS, SENSOR_LAYOUT, "Sensor simulado v0"),
        (DEVICE_STATIONS, DEVICE_LAYOUT, "Boya ESP32 v0"),
    ):
        for data in stations:
            if data["name"] in names:
                print(f"· ya existe: {data['name']}")
                continue
            station = await container.catalog.create_station(data)
            for sensor_type, location, vmin, vmax in layout:
                await container.catalog.create_sensor(
                    {
                        "station_id": station.id,
                        "type": sensor_type,
                        "location": location,
                        "valid_min": vmin,
                        "valid_max": vmax,
                        "model": model,
                    }
                )
            print(f"✓ {station.name}: {len(layout)} sensores")

    created = await container.alerts.install_default_rules()
    print(f"✓ {created} reglas de alerta por defecto" if created else "· reglas de alerta ya existen")

    if container.settings.is_dev:
        users = await container.staff.ensure_demo_users(DEMO_USERS)
        print(f"✓ {users} cuentas demo (contraseña demo123)" if users else "· cuentas demo ya existen")
        tasks = await container.field_ops.ensure_demo_tasks("tecnico@demo.mx")
        print(f"✓ {tasks} tareas demo en la bandeja del operador" if tasks else "· tareas demo ya existen")


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
