from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from app.domain.alerting import (
    evaluate_cycle,
    evaluate_reading,
    evaluate_sensor_silence,
    evaluate_treatment,
)
from app.domain.entities import AlertRule, CentrifugeCycle, Sensor, TreatmentBatch
from app.domain.enums import (
    RuleKind,
    SensorLocation,
    SensorType,
    Severity,
)
from app.domain.errors import InvalidDataError

NOW = datetime(2026, 11, 23, 18, 0, tzinfo=UTC)
STATION = uuid4()


def ph_sensor(location=SensorLocation.INLET):
    return Sensor(station_id=STATION, type=SensorType.PH, location=location)


def ph_rule(**kw):
    defaults = dict(
        name="pH fuera de rango",
        kind=RuleKind.READING_RANGE,
        severity=Severity.WARNING,
        parameter=SensorType.PH,
        min_value=6.5,
        max_value=8.5,
    )
    return AlertRule(**{**defaults, **kw})


def test_reading_inside_range_triggers_nothing():
    assert evaluate_reading([ph_rule()], ph_sensor(), 7.2, NOW) == []


@pytest.mark.parametrize("value", [5.9, 9.1])
def test_reading_outside_range_triggers_alert(value):
    [alert] = evaluate_reading([ph_rule()], ph_sensor(), value, NOW)
    assert alert.trigger_value == value
    assert alert.severity is Severity.WARNING
    assert alert.threshold_min == 6.5 and alert.threshold_max == 8.5


def test_subject_key_is_rule_scoped_to_sensor_for_anti_spam():
    sensor = ph_sensor()
    [a1] = evaluate_reading([ph_rule()], sensor, 5.0, NOW)
    [a2] = evaluate_reading([ph_rule()], sensor, 4.9, NOW + timedelta(seconds=5))
    assert a1.subject_key == a2.subject_key == f"sensor:{sensor.id}"


def test_rule_for_other_parameter_or_location_is_ignored():
    turbidity_rule = ph_rule(parameter=SensorType.TURBIDITY)
    outlet_rule = ph_rule(location=SensorLocation.OUTLET)
    assert evaluate_reading([turbidity_rule, outlet_rule], ph_sensor(), 3.0, NOW) == []


def test_rule_for_other_station_or_disabled_is_ignored():
    rules = [ph_rule(station_id=uuid4()), ph_rule(enabled=False)]
    assert evaluate_reading(rules, ph_sensor(), 3.0, NOW) == []


def test_only_max_rule():
    rule = ph_rule(parameter=SensorType.TURBIDITY, min_value=None, max_value=100)
    sensor = Sensor(station_id=STATION, type=SensorType.TURBIDITY, location=SensorLocation.INLET)
    assert evaluate_reading([rule], sensor, 99, NOW) == []
    assert len(evaluate_reading([rule], sensor, 150, NOW)) == 1


def test_sensor_silence_alert():
    rule = AlertRule(
        name="Sensor sin señal",
        kind=RuleKind.SENSOR_OFFLINE,
        severity=Severity.WARNING,
        max_value=10,
    )
    sensor = ph_sensor()
    sensor.last_seen_at = NOW - timedelta(minutes=30)
    [alert] = evaluate_sensor_silence([rule], sensor, NOW)
    assert alert.trigger_value == pytest.approx(30)
    sensor.last_seen_at = NOW - timedelta(minutes=2)
    assert evaluate_sensor_silence([rule], sensor, NOW) == []


def test_high_vibration_alert():
    rule = AlertRule(
        name="Vibración",
        kind=RuleKind.CENTRIFUGE_VIBRATION,
        severity=Severity.CRITICAL,
        max_value=7.1,
    )
    cycle = CentrifugeCycle(station_id=STATION, started_at=NOW, vibration_mm_s=9.0)
    [alert] = evaluate_cycle([rule], cycle, NOW)
    assert alert.subject_key == f"station:{STATION}"
    cycle.vibration_mm_s = 3.0
    assert evaluate_cycle([rule], cycle, NOW) == []


def test_low_efficiency_alert():
    rule = AlertRule(
        name="Eficiencia baja",
        kind=RuleKind.TREATMENT_EFFICIENCY,
        severity=Severity.WARNING,
        min_value=70,
    )
    batch = TreatmentBatch(station_id=STATION, ts=NOW, volume_in_l=100, volume_clean_l=50)
    assert len(evaluate_treatment([rule], batch, NOW)) == 1


def test_rule_needs_a_threshold():
    with pytest.raises(InvalidDataError):
        ph_rule(min_value=None, max_value=None)
