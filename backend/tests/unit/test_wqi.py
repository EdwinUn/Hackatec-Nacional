import pytest

from app.domain.enums import SensorType
from app.domain.wqi import DEFAULT_WQI_CONFIG, WqiCategory, WqiConfig, compute_wqi, sub_index


def test_sub_index_interpolates_linearly_between_breakpoints():
    curve = ((0.0, 0.0), (10.0, 100.0))
    assert sub_index(curve, 5.0) == pytest.approx(50.0)


def test_sub_index_clamps_outside_curve():
    curve = ((0.0, 20.0), (10.0, 100.0))
    assert sub_index(curve, -5.0) == 20.0
    assert sub_index(curve, 50.0) == 100.0


def test_clean_water_scores_excellent():
    result = compute_wqi(
        {
            SensorType.PH: 7.2,
            SensorType.TURBIDITY: 2.0,
            SensorType.DISSOLVED_OXYGEN: 8.5,
            SensorType.TEMPERATURE: 20.0,
        }
    )
    assert result.score >= 90
    assert result.category is WqiCategory.EXCELLENT


def test_polluted_water_scores_bad_or_critical():
    result = compute_wqi({SensorType.PH: 4.8, SensorType.TURBIDITY: 250.0, SensorType.DISSOLVED_OXYGEN: 1.5})
    assert result.category in (WqiCategory.BAD, WqiCategory.CRITICAL)


def test_weights_are_renormalised_over_available_parameters():
    only_ph = compute_wqi({SensorType.PH: 7.2})
    assert only_ph.score == pytest.approx(100.0)
    assert only_ph.components[SensorType.PH].weight == pytest.approx(1.0)


def test_result_explains_each_component():
    result = compute_wqi({SensorType.PH: 7.0, SensorType.TURBIDITY: 25.0})
    comp = result.components[SensorType.TURBIDITY]
    assert comp.value == 25.0
    assert 0 <= comp.sub_index <= 100
    assert sum(c.weight for c in result.components.values()) == pytest.approx(1.0)


def test_no_data_returns_none():
    assert compute_wqi({}) is None


def test_parameters_without_curve_are_ignored():
    config = WqiConfig(curves={SensorType.PH: ((0, 0), (14, 100))}, weights={SensorType.PH: 1})
    result = compute_wqi({SensorType.PH: 7.0, SensorType.TDS: 300.0}, config)
    assert set(result.components) == {SensorType.PH}


@pytest.mark.parametrize(
    ("score", "category"),
    [
        (95, WqiCategory.EXCELLENT),
        (75, WqiCategory.GOOD),
        (55, WqiCategory.FAIR),
        (30, WqiCategory.BAD),
        (10, WqiCategory.CRITICAL),
    ],
)
def test_categories(score, category):
    assert DEFAULT_WQI_CONFIG.categorize(score) is category
