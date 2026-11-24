from datetime import UTC, datetime, timedelta

from app.domain.enums import SensorStatus
from app.domain.sensor_health import SensorHealthPolicy, evaluate_sensor_health

NOW = datetime(2026, 11, 23, 18, 0, tzinfo=UTC)
POLICY = SensorHealthPolicy(offline_after=timedelta(minutes=10), min_quality=0.6, stuck_window=5)
PH = dict(valid_min=0.0, valid_max=14.0, physical_min=0.0, physical_max=14.0)


def health(last_seen, values, qualities=None, **kw):
    qualities = qualities if qualities is not None else [1.0] * len(values)
    return evaluate_sensor_health(
        last_seen_at=last_seen,
        now=NOW,
        recent_values=values,
        recent_qualities=qualities,
        policy=POLICY,
        **{**PH, **kw},
    )


def test_never_seen_is_offline():
    assert health(None, []) is SensorStatus.OFFLINE


def test_silent_longer_than_threshold_is_offline():
    assert health(NOW - timedelta(minutes=11), [7.0, 7.1]) is SensorStatus.OFFLINE


def test_recent_varied_good_values_are_ok():
    assert health(NOW - timedelta(minutes=1), [7.0, 7.1, 6.9, 7.2, 7.05]) is SensorStatus.OK


def test_low_average_quality_is_degraded():
    status = health(NOW, [7.0, 7.1, 6.9], qualities=[0.3, 0.5, 0.4])
    assert status is SensorStatus.DEGRADED


def test_values_outside_sensor_valid_range_are_degraded():
    status = health(NOW, [7.0, 11.5, 7.2], valid_min=4.0, valid_max=10.0)
    assert status is SensorStatus.DEGRADED


def test_impossible_values_are_fault():
    assert health(NOW, [7.0, 15.2]) is SensorStatus.FAULT


def test_constant_values_over_window_are_fault():
    assert health(NOW, [7.0] * 5) is SensorStatus.FAULT


def test_constant_values_shorter_than_window_are_not_fault():
    assert health(NOW, [7.0] * 4) is SensorStatus.OK
