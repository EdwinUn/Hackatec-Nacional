from datetime import UTC, datetime, timedelta
from itertools import pairwise

from app.adapters.inbound.telemetry_payload import TelemetryIn
from scripts.buoy import SCENARIOS, BuoyEmulator

T0 = datetime(2026, 11, 24, 18, 0, tzinfo=UTC)


def run(scenario: str, ticks: int) -> list[dict]:
    emu = BuoyEmulator("RM-01", SCENARIOS[scenario], seed=1)
    return [emu.step(T0 + timedelta(seconds=15 * i)) for i in range(ticks)]


def test_messages_match_the_firmware_contract():
    for msg in run("contaminada", 20):
        data = TelemetryIn.model_validate(msg).to_input()
        assert set(data.values) == {"ph", "tds_ppm", "temp_c", "turb_in_ntu", "turb_out_ntu"}
        assert data.ts is not None and data.seq == msg["n"]


def test_contaminated_water_raises_the_local_alarm_and_clean_water_does_not():
    assert all(m["alerta"] and m["ph"] < 6.5 for m in run("contaminada", 50))
    assert not any(m["alerta"] for m in run("limpia", 50))


def test_pump_follows_battery_hysteresis():
    msgs = run("contaminada", 400)
    starts = [m for prev, m in pairwise(msgs) if m["bomba"] and not prev["bomba"]]
    stops = [m for prev, m in pairwise(msgs) if prev["bomba"] and not m["bomba"]]
    assert starts and stops
    assert all(m["bat_pct"] >= 75 for m in starts)
    assert all(m["bat_pct"] <= 35 for m in stops)


def test_low_battery_keeps_the_pump_off():
    assert not any(m["bomba"] for m in run("bateria-baja", 50))
