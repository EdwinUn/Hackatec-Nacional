import pytest

from app.domain.errors import InvalidDataError
from app.domain.treatment import compare_treatment, treatment_efficiency_pct


def test_efficiency_is_clean_over_in():
    assert treatment_efficiency_pct(500, 450) == pytest.approx(90.0)


@pytest.mark.parametrize(("vin", "vclean"), [(0, 0), (-1, 0), (100, 120), (100, -1)])
def test_efficiency_rejects_impossible_volumes(vin, vclean):
    with pytest.raises(InvalidDataError):
        treatment_efficiency_pct(vin, vclean)


def test_compare_reports_ph_toward_neutral_and_turbidity_removal():
    result = compare_treatment(ph_in=5.2, ph_out=6.9, turbidity_in=120, turbidity_out=6)
    # |5.2-7| = 1.8 → |6.9-7| = 0.1  ⇒ se acercó 1.7 unidades a neutro
    assert result.ph_shift_toward_neutral == pytest.approx(1.7)
    assert result.turbidity_removal_pct == pytest.approx(95.0)


def test_compare_handles_missing_values():
    result = compare_treatment(ph_in=None, ph_out=7.0, turbidity_in=0, turbidity_out=0)
    assert result.ph_shift_toward_neutral is None
    assert result.turbidity_removal_pct is None
