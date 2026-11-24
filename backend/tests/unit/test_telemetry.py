from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from app.adapters.inbound.mqtt.bridge import BrokerConfig, code_from_topic
from app.adapters.inbound.telemetry_payload import TelemetryIn
from app.domain.entities import Sensor, Station, normalize_device_code
from app.domain.enums import SensorLocation as L
from app.domain.enums import SensorType as T
from app.domain.errors import InvalidDataError
from app.domain.telemetry import resolve_channels

STATION = uuid4()


def sensor(type_: T, location: L, age_s: int = 0) -> Sensor:
    return Sensor(
        station_id=STATION,
        type=type_,
        location=location,
        created_at=datetime.now(UTC) - timedelta(seconds=age_s),
    )


def test_channels_map_to_inlet_and_outlet_sensors():
    ph_in = sensor(T.PH, L.INLET)
    turb_in = sensor(T.TURBIDITY, L.INLET)
    turb_out = sensor(T.TURBIDITY, L.OUTLET)
    tds = sensor(T.TDS, L.INLET)
    resolved = resolve_channels([ph_in, turb_in, turb_out, tds, sensor(T.PH, L.OUTLET)])
    assert resolved["ph"] is ph_in
    assert resolved["turb_in_ntu"] is turb_in
    assert resolved["turb_out_ntu"] is turb_out
    assert resolved["tds_ppm"] is tds
    assert "temp_c" not in resolved  # sin sensor de temperatura: queda como unmapped


def test_channels_fall_back_to_river_and_prefer_oldest_duplicate():
    old, new = sensor(T.TEMPERATURE, L.RIVER, age_s=60), sensor(T.TEMPERATURE, L.RIVER)
    assert resolve_channels([new, old])["temp_c"] is old


@pytest.mark.parametrize(("raw", "code"), [("rm-01", "RM-01"), (" RM_02 ", "RM_02")])
def test_device_code_is_normalized(raw, code):
    assert normalize_device_code(raw) == code
    station = Station(name="x", river="y", latitude=19, longitude=-98, code=raw)
    assert station.code == code


@pytest.mark.parametrize("raw", ["", "RM 01", "-RM", "R" * 33, "rm/01"])
def test_device_code_rejects_invalid(raw):
    with pytest.raises(InvalidDataError):
        normalize_device_code(raw)


def test_firmware_payload_is_split_into_readings_and_device_state():
    msg = TelemetryIn.model_validate(
        {
            "boya": "RM-01",
            "n": 2,
            "ph": 14.0,
            "tds_ppm": 0,
            "temp_c": 22.0,
            "turb_in_ntu": 1000,
            "turb_out_ntu": 1000,
            "eficiencia_pct": 0,
            "bat_v": 0.0,
            "bat_pct": 0,
            "rio_ms": 0.0,
            "gen_v": 0.0,
            "freno": True,
            "bomba": False,
            "alerta": True,
            "campo_nuevo": 1,
        }
    )
    data = msg.to_input()
    assert data.values == {
        "ph": 14.0,
        "tds_ppm": 0,
        "temp_c": 22.0,
        "turb_in_ntu": 1000,
        "turb_out_ntu": 1000,
    }
    assert (data.seq, data.pump_on, data.alarm_on, data.battery_pct) == (2, False, True, 0)
    assert data.ts is None
    assert (data.generator_v, data.brake_on) == (0.0, True)


@pytest.mark.parametrize(("raw", "expected"), [("sin-hora", None), (None, None), (1_764_000_000, 2025)])
def test_unreadable_ts_falls_back_to_arrival_time(raw, expected):
    ts = TelemetryIn(ts=raw).ts
    assert (ts.year if ts else None) == expected


def test_payload_code_must_match_topic():
    msg = TelemetryIn(boya="rm-01")
    msg.check_code("RM-01")
    with pytest.raises(InvalidDataError):
        msg.check_code("RM-02")


def test_code_comes_from_wildcard_segment():
    assert code_from_topic("riomonitor/+/telemetria", "riomonitor/RM-01/telemetria") == "RM-01"
    assert code_from_topic("riomonitor/telemetria", "riomonitor/telemetria") is None


def test_broker_url():
    plain = BrokerConfig.from_url("mqtt://broker.hivemq.com")
    assert (plain.host, plain.port, plain.tls, plain.username) == ("broker.hivemq.com", 1883, False, None)
    tls = BrokerConfig.from_url("mqtts://u%40x:p%3Ass@host:9999")
    assert (tls.port, tls.tls, tls.username, tls.password) == (9999, True, "u@x", "p:ss")
    with pytest.raises(ValueError):
        BrokerConfig.from_url("http://host")
