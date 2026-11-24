import pytest

from app.domain.criticality import CriticalityInput, CriticalityLevel, score_criticality


def inp(**kw):
    base = dict(wqi=90.0, critical_active=0, warning_active=0, info_active=0, occurrences=0)
    return CriticalityInput(**{**base, **kw})


def test_clean_station_without_alerts_is_stable():
    r = score_criticality(inp(wqi=92))
    assert r.level is CriticalityLevel.STABLE
    assert r.score == pytest.approx(0.5 * 8)


def test_bad_water_with_critical_alerts_is_critical():
    r = score_criticality(inp(wqi=35, critical_active=2, warning_active=3, occurrences=120))
    assert r.level is CriticalityLevel.CRITICAL
    assert r.score >= 50


def test_components_are_explained_and_bounded():
    r = score_criticality(inp(wqi=10, critical_active=10, warning_active=10, occurrences=10_000))
    assert r.components == {"calidad": 90.0, "alertas": 100.0, "recurrencia": 100.0}
    assert r.score <= 100


def test_alert_pressure_weights_critical_more_than_warning():
    critical = score_criticality(inp(critical_active=1)).components["alertas"]
    warning = score_criticality(inp(warning_active=1)).components["alertas"]
    assert critical > warning > 0


def test_recurrence_grows_with_repetitions_but_saturates():
    few = score_criticality(inp(occurrences=5)).components["recurrencia"]
    many = score_criticality(inp(occurrences=500)).components["recurrencia"]
    assert 0 < few < many <= 100


def test_without_wqi_quality_does_not_count_and_is_flagged():
    r = score_criticality(inp(wqi=None, critical_active=1))
    assert r.components["calidad"] == 0
    assert r.has_quality_data is False
