"""Eficiencia de tratamiento: cuánta agua sale limpia y cuánto mejora entre entrada y salida."""

from dataclasses import dataclass

from app.domain.errors import InvalidDataError

NEUTRAL_PH = 7.0


def treatment_efficiency_pct(volume_in_l: float, volume_clean_l: float) -> float:
    """Porcentaje del agua de entrada que regresa limpia: volume_clean_l / volume_in_l · 100."""
    if volume_in_l <= 0:
        raise InvalidDataError("volume_in_l debe ser mayor que 0")
    if volume_clean_l < 0 or volume_clean_l > volume_in_l:
        raise InvalidDataError("volume_clean_l debe estar entre 0 y volume_in_l")
    return round(volume_clean_l / volume_in_l * 100, 2)


@dataclass(frozen=True, slots=True)
class TreatmentComparison:
    # Cuántas unidades de pH se acercó el agua a neutro (7). Negativo = empeoró.
    ph_shift_toward_neutral: float | None
    # % de turbidez removida: (entrada - salida) / entrada · 100.
    turbidity_removal_pct: float | None


def compare_treatment(
    *,
    ph_in: float | None,
    ph_out: float | None,
    turbidity_in: float | None,
    turbidity_out: float | None,
) -> TreatmentComparison:
    ph_shift = None
    if ph_in is not None and ph_out is not None:
        ph_shift = round(abs(ph_in - NEUTRAL_PH) - abs(ph_out - NEUTRAL_PH), 3)
    removal = None
    if turbidity_in is not None and turbidity_out is not None and turbidity_in > 0:
        removal = round((turbidity_in - turbidity_out) / turbidity_in * 100, 2)
    return TreatmentComparison(ph_shift, removal)
