from datetime import UTC, datetime, timedelta
from itertools import pairwise

from app.adapters.inbound.telemetry_payload import TelemetryIn
from app.domain.defaults import default_alert_rules
from app.domain.enums import RuleKind
from scripts.buoy import SCENARIOS, BuoyEmulator

T0 = datetime(2026, 11, 24, 18, 0, tzinfo=UTC)


def run(scenario: str, ticks: int) -> list[dict]:
    emu = BuoyEmulator("RM-01", SCENARIOS[scenario], seed=1)
    return [emu.step(T0 + timedelta(seconds=15 * i)) for i in range(ticks)]


def test_messages_match_the_firmware_contract():
    for msg in run("contaminada", 20):
        data = TelemetryIn.model_validate(msg).to_input()
        inlet = {"ph", "tds_ppm", "temp_c", "turb_in_ntu"}
        assert set(data.values) == (inlet | {"ph_out", "turb_out_ntu"} if msg["bomba"] else inlet)
        assert data.ts is not None and data.seq == msg["n"]
        assert data.signal_csq == 22 and data.rssi_dbm == -69
        assert msg["tds_ppm"] <= 1000  # el TDS Meter V1.0 se satura en 1000 ppm


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


def test_filters_only_work_with_the_pump_on():
    for m in run("contaminada", 400):
        if m["bomba"]:
            assert m["caudal_lpm"] > 2 and m["bomba_a"] > 0
            assert m["ph_out"] > m["ph"]  # agua ácida: la calcita la sube hacia 7
            assert m["turb_out_ntu"] < m["turb_in_ntu"]
        else:  # sin flujo las sondas de salida no se reportan, como en el firmware
            assert m["caudal_lpm"] == 0 and m["bomba_a"] == 0
            assert not {"ph_out", "turb_out_ntu", "eficiencia_pct"} & m.keys()


def test_calcite_does_not_lower_alkaline_water():
    emu = BuoyEmulator("RM-02", SCENARIOS["limpia"], seed=3)
    for i in range(200):
        m = emu.step(T0 + timedelta(seconds=15 * i))
        if m["bomba"] and m["ph"] >= 7:
            assert abs(m["ph_out"] - m["ph"]) < 0.1


def test_processed_water_and_pump_cycles_accumulate():
    msgs = run("contaminada", 400)
    liters = [m["litros_total"] for m in msgs]
    assert liters == sorted(liters) and liters[-1] > 0
    starts = sum(1 for prev, m in pairwise(msgs) if m["bomba"] and not prev["bomba"])
    assert msgs[-1]["ciclos_bomba"] == msgs[0]["ciclos_bomba"] + starts


def test_local_alarm_uses_the_backend_default_thresholds():
    """El LED de alerta (firmware y emulador) se prende con las mismas reglas por defecto del backend."""
    keys = {  # (parámetro, ubicación) → claves del mensaje
        ("ph", "inlet"): ["ph"],
        ("ph", "outlet"): ["ph_out"],
        ("turbidity", "inlet"): ["turb_in_ntu"],
        ("turbidity", "outlet"): ["turb_out_ntu"],
        ("temperature", "inlet"): ["temp_c"],
    }
    rules = [r for r in default_alert_rules() if r.kind is RuleKind.READING_RANGE]

    def backend_alert(m: dict) -> bool:
        for r in rules:
            for (param, loc), names in keys.items():
                if r.parameter.value != param or (r.location is not None and r.location.value != loc):
                    continue
                for v in (m[k] for k in names if k in m):
                    low = r.min_value is not None and v < r.min_value
                    high = r.max_value is not None and v > r.max_value
                    if low or high:
                        return True
        return False

    for scenario in SCENARIOS:
        for m in run(scenario, 200):
            assert m["alerta"] == (backend_alert(m) or m["inclinacion_deg"] > 30), (scenario, m)
