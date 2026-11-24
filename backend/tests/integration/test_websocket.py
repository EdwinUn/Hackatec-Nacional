"""WebSocket de punta a punta: petición HTTP de ingesta → broker → gestor WS → cliente."""

from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.main import create_app
from tests.integration.conftest import API_KEY, make_settings


def test_live_websocket_receives_reading_events(migrated_db):
    app = create_app(make_settings(health_sweep_interval_s=3600))
    with TestClient(app, headers={"X-API-Key": API_KEY}) as client:  # corre el lifespan real
        station = client.post(
            "/api/v1/stations",
            json={"name": "WS", "river": "Río Alseseca", "latitude": 18.995, "longitude": -98.188},
        ).json()
        sensor = client.post(
            "/api/v1/sensors", json={"station_id": station["id"], "type": "ph", "location": "inlet"}
        ).json()

        with client.websocket_connect(f"/ws/live?station_id={station['id']}") as ws:
            hello = ws.receive_json()
            assert hello["type"] == "hello" and "reading" in hello["data"]["events"]
            ws.send_json({"type": "ping"})
            assert ws.receive_json()["type"] == "pong"

            ts = datetime.now(UTC).isoformat()
            r = client.post(
                "/api/v1/readings", json={"readings": [{"sensor_id": sensor["id"], "ts": ts, "value": 7.2}]}
            )
            assert r.json()["accepted"] == 1

            received = [ws.receive_json() for _ in range(2)]
            by_type = {m["type"]: m for m in received}
            assert by_type["reading"]["station_id"] == station["id"]
            assert by_type["reading"]["data"]["value"] == 7.2
            assert by_type["reading"]["data"]["type"] == "ph"
            assert by_type["sensor_status"]["data"]["status"] == "ok"


def test_websocket_requires_api_key_outside_dev(migrated_db):
    app = create_app(
        make_settings(
            environment="production",
            ingest_api_key="prod-key",
            jwt_secret="x" * 32,
            health_sweep_interval_s=3600,
        )
    )
    with TestClient(app) as client:
        with pytest.raises(WebSocketDisconnect) as rejected, client.websocket_connect("/ws/live") as ws:
            ws.receive_json()
        assert rejected.value.code == 1008
        with client.websocket_connect("/ws/live?api_key=prod-key") as ws:
            assert ws.receive_json()["type"] == "hello"
