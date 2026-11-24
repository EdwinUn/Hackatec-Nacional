from datetime import UTC, datetime, timedelta

import pytest

from app.domain.forecast import linear_forecast

T0 = datetime(2026, 11, 23, 0, 0, tzinfo=UTC)


def series(values, step=timedelta(hours=1)):
    return [(T0 + i * step, v) for i, v in enumerate(values)]


def test_perfect_line_is_extrapolated():
    result = linear_forecast(
        series([7.0, 7.1, 7.2, 7.3]), horizon=timedelta(hours=2), step=timedelta(hours=1)
    )
    assert [round(p.value, 6) for p in result.points] == [7.4, 7.5]
    assert result.slope_per_hour == pytest.approx(0.1)
    assert result.points[0].ts == T0 + timedelta(hours=4)
    assert result.residual_std == pytest.approx(0.0, abs=1e-9)


def test_band_widens_with_noise():
    noisy = series([7.0, 7.4, 6.9, 7.5, 7.0, 7.4])
    result = linear_forecast(noisy, horizon=timedelta(hours=1), step=timedelta(hours=1))
    p = result.points[0]
    assert p.lower < p.value < p.upper


def test_values_are_clamped():
    result = linear_forecast(
        series([13.0, 13.5, 14.0]),
        horizon=timedelta(hours=3),
        step=timedelta(hours=1),
        clamp=(0.0, 14.0),
    )
    assert all(p.value <= 14.0 and p.upper <= 14.0 for p in result.points)


def test_insufficient_data_returns_none():
    assert linear_forecast(series([7.0, 7.1]), horizon=timedelta(hours=1), step=timedelta(hours=1)) is None
