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


IOT = {
    "device_id": "B-01",
    "ph": 6.8,
    "turbidity": 180,
    "temperature": 22.5,
    "flow_rate": 12.5,
    "river_speed_ms": 0.9,
    "basket_fill_pct": 37,
    "battery_pct": 78,
    "rssi": -61,
}


async def test_iot_endpoint_open_alias_saves_and_streams(client, container, buoy, sensors):
    # sin X-API-Key ni X-Device-Key; B-01 es el alias de la boya RM-01
    r = await client.post(f"{V1}/telemetry/iot", json=IOT, headers={"X-API-Key": ""})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["code"] == "RM-01" and body["readings"]["accepted"] == 2 and body["unmapped"] == ["temp_c"]
    [device] = [e for e in container.broker.published if e.type is EventType.DEVICE_TELEMETRY]
    d = device.data
    assert (d["basket_fill_pct"], d["rssi_dbm"], d["flow_rate_lpm"], d["battery_pct"]) == (37, -61, 12.5, 78)
    assert d["values"] == {"ph": 6.8, "turb_in_ntu": 180.0, "temp_c": 22.5}
    latest = (await client.get(f"{V1}/devices/RM-01/telemetry/latest")).json()
    assert latest["basket_fill_pct"] == 37 and latest["values"]["ph"] == 6.8


async def test_iot_unknown_device_and_device_key(client, container, buoy):
    assert (await client.post(f"{V1}/telemetry/iot", json={**IOT, "device_id": "B-99"})).status_code == 404
    assert (await client.post(f"{V1}/telemetry/iot", json={"ph": 7})).status_code == 422

    from pydantic import SecretStr

    container.settings.device_key = SecretStr("wokwi-key")
    try:
        assert (await client.post(f"{V1}/telemetry/iot", json=IOT)).status_code == 200  # dev: opcional
        bad = await client.post(f"{V1}/telemetry/iot", json=IOT, headers={"X-Device-Key": "otra"})
        assert bad.status_code == 401
        ok = await client.post(f"{V1}/telemetry/iot", json=IOT, headers={"X-Device-Key": "wokwi-key"})
        assert ok.status_code == 200
    finally:
        container.settings.device_key = None


WOKWI = {  # lo que imprime el firmware de Wokwi por Serial (boya «BM-02»)
    "boya": "BM-02", "ts": "sin-hora", "ph": 14.0, "temp_c": 22.8, "turb_in_ntu": 1000, "turb_out_ntu": 1000,
    "eficiencia_pct": 0.0, "bat_v": 4.2, "bat_pct": 0, "gas_v": 0.0,
    "freno": False, "bomba": False, "alerta": True,
}  # fmt: skip


async def test_wokwi_message_with_bm_02_reaches_boat_rm_02(client, container, station, sensors):
    await client.patch(f"{V1}/stations/{station['id']}", json={"code": "RM-02"})
    # por HTTP genérico (sin código en la ruta) y por la ruta del dispositivo con el alias
    r = await client.post(f"{V1}/telemetry/iot", json=WOKWI)
    assert r.status_code == 200, r.text
    assert r.json()["code"] == "RM-02" and r.json()["readings"]["accepted"] == 2
    r2 = await client.post(f"{V1}/devices/B-02/telemetry", json=WOKWI)
    assert r2.status_code == 200 and r2.json()["code"] == "RM-02"
    events = [e.data for e in container.broker.published if e.type is EventType.DEVICE_TELEMETRY]
    assert len(events) == 2
    d = events[0]
    assert d["code"] == "RM-02" and d["alarm_on"] is True and d["battery_pct"] == 0 and d["gas_v"] == 0.0
    assert d["device_efficiency_pct"] == 0.0
    assert d["values"] == {"ph": 14.0, "temp_c": 22.8, "turb_in_ntu": 1000.0, "turb_out_ntu": 1000.0}
    latest = (await client.get(f"{V1}/devices/BM-02/telemetry/latest")).json()
    assert latest["alarm_on"] is True and latest["values"]["ph"] == 14.0


async def test_iot_needs_device_id_or_boya(client, buoy):
    assert (await client.post(f"{V1}/telemetry/iot", json={"ph": 7})).status_code == 422


async def test_full_electronics_message_saves_ph_out_and_device_state(client, container, buoy, sensors):
    """Mensaje de firmware/boya-rm01/sketch.ino con ENVIAR_CAMPOS_NUEVOS 1."""
    msg = PAYLOAD | {
        "ts": None,
        "ph": 6.7,
        "ph_out": 6.81,
        "caudal_lpm": 2.5,
        "litros_total": 120.5,
        "cesta_pct": 37,
        "bomba_a": 0.4,
        "ciclos_bomba": 3,
        "inclinacion_deg": 2.3,
        "golpe": False,
        "senal_csq": 22,
    }
    r = await client.post(f"{V1}/devices/RM-01/telemetry", json=msg)
    assert r.status_code == 200, r.text
    assert r.json()["readings"]["accepted"] == 3  # pH entrada + pH salida + turbidez entrada
    readings = [e for e in container.broker.published if e.type is EventType.READING]
    ph_out = [e for e in readings if e.data["value"] == 6.81]
    assert [e.data["sensor_id"] for e in ph_out] == [sensors[("ph", "outlet")]["id"]]

    latest = (await client.get(f"{V1}/devices/RM-01/telemetry/latest")).json()
    assert (latest["flow_rate_lpm"], latest["basket_fill_pct"], latest["pump_current_a"]) == (2.5, 37, 0.4)
    assert (latest["water_liters_total"], latest["pump_cycles"], latest["tilt_deg"]) == (120.5, 3, 2.3)
    assert (latest["shock"], latest["signal_csq"], latest["rssi_dbm"]) == (False, 22, -69)
    assert latest["values"]["ph_out"] == 6.81
