"""Pruebas de integración contra PostgreSQL real.

Usa TEST_DATABASE_URL (default: BD `rio_test` del Postgres de compose). El esquema se crea con
`alembic upgrade head` desde cero, así que también validan las migraciones.
Si la BD no está disponible, las pruebas se omiten.
"""

import asyncio
import os
from pathlib import Path

import asyncpg
import pytest
from alembic import command
from alembic.config import Config
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.adapters.outbound.messaging.brokers import InMemoryBroker
from app.config.container import Container
from app.config.settings import Settings
from app.main import create_app

pytestmark = pytest.mark.integration

TEST_DB_URL = os.getenv("TEST_DATABASE_URL", "postgresql+asyncpg://hackatec:hackatec@localhost:5432/rio_test")
API_KEY = "test-key"
BACKEND = Path(__file__).resolve().parents[2]
TABLES = (
    "alerts, alert_rules, readings, treatment_batches, centrifuge_cycles, waste_collections, "
    "sensors, stations"
)


def make_settings(**overrides) -> Settings:
    values = {
        "database_url": TEST_DB_URL,
        "redis_url": "",
        "environment": "test",
        "ingest_api_key": API_KEY,
        "log_json": False,
        "log_level": "WARNING",
    }
    return Settings(_env_file=None, **(values | overrides))


async def _reset_schema() -> None:
    dsn = TEST_DB_URL.replace("postgresql+asyncpg", "postgresql")
    conn = await asyncpg.connect(dsn, timeout=3)
    try:
        await conn.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
    finally:
        await conn.close()


@pytest.fixture(scope="session")
def migrated_db() -> str:
    try:
        asyncio.run(_reset_schema())
    except (OSError, asyncpg.PostgresError) as exc:
        pytest.skip(f"PostgreSQL de pruebas no disponible ({exc}); ver README")
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "migrations"))
    cfg.cmd_opts = type("Opts", (), {"x": [f"db_url={TEST_DB_URL}"]})()
    command.upgrade(cfg, "head")
    return TEST_DB_URL


@pytest.fixture(scope="session")
async def container(migrated_db):
    c = Container(make_settings(), broker=InMemoryBroker())
    yield c
    await c.engine.dispose()


@pytest.fixture(autouse=True)
async def clean_db(container):
    async with container.engine.begin() as conn:
        await conn.execute(text(f"TRUNCATE {TABLES} CASCADE"))
    await container.alerts.install_default_rules()
    container.broker.published.clear()


@pytest.fixture
async def client(container):
    app = create_app(container.settings, container)
    app.state.container = container  # sin lifespan: sin tareas de fondo, pruebas deterministas
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test", headers={"X-API-Key": API_KEY}
    ) as c:
        yield c


@pytest.fixture
async def station(client):
    r = await client.post(
        "/api/v1/stations",
        json={"name": "Estación prueba", "river": "Río Atoyac", "latitude": 19.0185, "longitude": -98.2435},
    )
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture
async def sensors(client, station):
    """{(type, location): sensor} para pH entrada/salida y turbidez entrada."""
    result = {}
    for type_, location in (("ph", "inlet"), ("ph", "outlet"), ("turbidity", "inlet")):
        r = await client.post(
            "/api/v1/sensors",
            json={"station_id": station["id"], "type": type_, "location": location},
        )
        assert r.status_code == 201, r.text
        result[(type_, location)] = r.json()
    return result
