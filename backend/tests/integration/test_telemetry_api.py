import json
from uuid import UUID

import pytest

from app.adapters.inbound.mqtt.bridge import MqttTelemetryBridge
from app.adapters.outbound.simulation.sinks import ServiceSink
from app.application.events import EventType

V1 = "/api/v1"

PAYLOAD = {
    "boya": "RM-01",
    "n": 7,
    "ph": 6.8,
    "tds_ppm": 410,
    "temp_c": 22.5,
    "turb_in_ntu": 180,
    "turb_out_ntu": 12,
    "eficiencia_pct": 93.3,
    "bat_v": 11.8,
    "bat_pct": 78,
    "rio_ms": 0.9,
    "gen_v": 14.2,
    "freno": False,
    "ts": "sin-hora",
    "bomba": True,
    "alerta": False,
}


@pytest.fixture
async def buoy(client, station, sensors):
    """La estación de prueba como boya RM-01, con pH entrada/salida y turbidez entrada."""
    r = await client.patch(f"{V1}/stations/{station['id']}", json={"code": "rm-01"})
    assert r.status_code == 200, r.text
    assert r.json()["code"] == "RM-01"
    return r.json()


async def test_telemetry_becomes_readings_and_device_state(client, container, buoy, sensors):
    r = await client.post(f"{V1}/devices/RM-01/telemetry", json=PAYLOAD)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["station_id"] == buoy["id"] and body["code"] == "RM-01"
    assert body["readings"]["accepted"] == 2  # pH entrada + turbidez entrada
    assert body["unmapped"] == ["tds_ppm", "temp_c", "turb_out_ntu"]

    events = [e for e in container.broker.published if e.type is EventType.READING]
    assert {e.data["sensor_id"] for e in events} == {
        sensors[("ph", "inlet")]["id"],
        sensors[("turbidity", "inlet")]["id"],
    }
    [device] = [e for e in container.broker.published if e.type is EventType.DEVICE_TELEMETRY]
    assert device.data["code"] == "RM-01" and device.data["pump_on"] is True

    latest = (await client.get(f"{V1}/devices/rm-01/telemetry/latest")).json()
    assert (latest["seq"], latest["battery_pct"], latest["river_speed_ms"]) == (7, 78, 0.9)
    history = (await client.get(f"{V1}/devices/RM-01/telemetry")).json()
    assert len(history) == 1


async def test_telemetry_errors(client, buoy):
    r = await client.post(f"{V1}/devices/RM-01/telemetry", json=PAYLOAD, headers={"X-API-Key": "nope"})
    assert r.status_code == 401
    r = await client.post(f"{V1}/devices/RM-09/telemetry", json=PAYLOAD | {"boya": None})
    assert r.status_code == 404
    r = await client.post(f"{V1}/devices/RM-01/telemetry", json=PAYLOAD | {"boya": "RM-02"})
    assert r.status_code == 422
    r = await client.get(f"{V1}/devices/RM-01/telemetry/latest")
    assert r.status_code == 404


async def test_impossible_ph_is_rejected_but_device_state_is_kept(client, buoy):
    body = (await client.post(f"{V1}/devices/RM-01/telemetry", json=PAYLOAD | {"ph": 15})).json()
    assert [x["reason"] for x in body["readings"]["rejected"]] == ["impossible_value"]
    assert (await client.get(f"{V1}/devices/RM-01/telemetry/latest")).status_code == 200


async def test_mqtt_bridge_ingests_and_survives_bad_messages(client, container, buoy):
    bridge = MqttTelemetryBridge(container.telemetry, "mqtt://localhost", "riomonitor/+/telemetria")
    await bridge.handle("riomonitor/RM-01/telemetria", b"no es json")
    await bridge.handle("riomonitor/RM-09/telemetria", json.dumps(PAYLOAD | {"boya": None}).encode())
    await bridge.handle("riomonitor/RM-01/telemetria", json.dumps(PAYLOAD).encode())
    history = (await client.get(f"{V1}/devices/RM-01/telemetry")).json()
    assert len(history) == 1


async def test_simulator_skips_device_stations(client, container, buoy):
    r = await client.post(
        f"{V1}/stations",
        json={"name": "Simulada", "river": "Río Alseseca", "latitude": 19.0, "longitude": -98.2},
    )
    sink = ServiceSink(container.catalog, container.ingestion, container.operations)
    assert [st.id for st in await sink.topology()] == [UUID(r.json()["id"])]
