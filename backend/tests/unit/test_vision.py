"""Reglas de la visión de reportes ciudadanos: no cargan ningún modelo (dominio puro)."""

import pytest

from app.domain.vision import (
    DEAD_FISH,
    FLOATING_BUOY,
    FLOATING_TRASH,
    PLASTIC_BOTTLE,
    PLASTIC_WASTE,
    WIRE_MESH_CAGE,
    Assessment,
    BuoyInspection,
    BuoyStatus,
    Detection,
    VisionCategory,
    VisionPolicy,
    VisionSeverity,
    assess,
    cage_saturation,
    merge_duplicates,
)

SIZE = (1000, 800)  # 800 000 px²
INTACT = BuoyInspection(ring_found=True, barrier_count=2, barrier_balance=0.9)


def det(label: str, bbox: tuple[int, int, int, int], conf: float = 0.6) -> Detection:
    return Detection(label, conf, bbox)


def trash(n: int, size: int = 30, conf: float = 0.5) -> list[Detection]:
    """n objetos de basura separados entre sí."""
    return [det(PLASTIC_BOTTLE, (i * 100, 700, i * 100 + size, 700 + size), conf) for i in range(n)]


def run(dets: list[Detection], insp: BuoyInspection | None = None, **policy) -> Assessment:
    return assess(dets, insp or BuoyInspection(), SIZE, VisionPolicy(**policy) if policy else VisionPolicy())


# ── peces muertos ──────────────────────────────────────────────────────────
def test_dead_fish_is_critical():
    a = run([det(DEAD_FISH, (10, 10, 120, 60))])
    assert (a.category, a.severity) == (VisionCategory.DEAD_FISH, VisionSeverity.CRITICAL)
    assert a.dead_fish == 1


def test_dead_fish_wins_over_everything_else():
    dets = [det(DEAD_FISH, (10, 10, 120, 60)), *trash(10)]
    a = run(dets, BuoyInspection(ring_found=True, barrier_count=0))
    assert a.category is VisionCategory.DEAD_FISH and a.severity is VisionSeverity.CRITICAL


def test_low_confidence_detections_are_ignored():
    assert run([det(DEAD_FISH, (10, 10, 120, 60), conf=0.10)]).category is VisionCategory.NORMAL


# ── boya skimmer ───────────────────────────────────────────────────────────
def test_intact_buoy_is_normal():
    a = run([det(FLOATING_BUOY, (300, 200, 700, 600))], INTACT)
    assert (a.category, a.severity, a.buoy_status) == (
        VisionCategory.NORMAL,
        VisionSeverity.LOW,
        BuoyStatus.INTACT,
    )
    assert "íntegra" in a.summary


@pytest.mark.parametrize(
    ("insp", "fragment"),
    [
        (BuoyInspection(ring_found=True, barrier_count=0), "ninguna barrera"),
        (BuoyInspection(ring_found=True, barrier_count=1), "una de las dos"),
        (BuoyInspection(ring_found=True, barrier_count=2, barrier_balance=0.2), "desiguales"),
        (
            BuoyInspection(ring_found=True, barrier_count=2, barrier_balance=0.9, barrier_fragments=6),
            "fragmentos",
        ),
    ],
)
def test_broken_or_disconnected_barriers_make_the_buoy_defective(insp, fragment):
    a = run([det(FLOATING_BUOY, (300, 200, 700, 600))], insp)
    assert (a.category, a.severity, a.buoy_status) == (
        VisionCategory.DEFECTIVE_BUOY,
        VisionSeverity.HIGH,
        BuoyStatus.DEFECTIVE,
    )
    assert any(fragment in r for r in a.reasons)


def test_missing_yellow_ring_alone_is_not_a_defect():
    a = run(
        [det(FLOATING_BUOY, (300, 200, 700, 600))],
        BuoyInspection(ring_found=False, barrier_count=2, barrier_balance=0.9),
    )
    assert a.category is VisionCategory.NORMAL and a.buoy_status is BuoyStatus.INTACT
    assert any("anillo amarillo" in r for r in a.reasons)


def test_buoy_is_recognised_from_colour_alone():
    a = run([], BuoyInspection(ring_found=True, barrier_count=1))
    assert a.category is VisionCategory.DEFECTIVE_BUOY


def test_colour_without_ring_is_not_a_buoy():
    assert (
        run([], BuoyInspection(ring_found=False, barrier_count=2, barrier_balance=0.9)).buoy_status
        is BuoyStatus.NOT_DETECTED
    )


# ── cesta saturada ─────────────────────────────────────────────────────────
CAGE = det(WIRE_MESH_CAGE, (100, 100, 300, 300))  # 40 000 px²


def covered(fraction: float) -> list[Detection]:
    """Una botella dentro de la cesta que cubre `fraction` de su área."""
    side = int((fraction * 40_000) ** 0.5)
    return [det(PLASTIC_BOTTLE, (110, 110, 110 + side, 110 + side))]


def test_cage_saturation_is_the_covered_fraction():
    assert cage_saturation(CAGE, covered(0.5)) == pytest.approx(0.5, abs=0.02)
    assert cage_saturation(None, covered(0.5)) is None
    assert cage_saturation(CAGE, trash(2)) == 0.0  # fuera de la cesta


def test_half_full_cage_is_high():
    a = run([CAGE, *covered(0.6)], INTACT)
    assert (a.category, a.severity, a.buoy_status) == (
        VisionCategory.SATURATED_BUOY,
        VisionSeverity.HIGH,
        BuoyStatus.SATURATED,
    )
    assert a.cage_saturation and a.cage_saturation >= 0.5


def test_partly_full_cage_is_medium():
    a = run([CAGE, *covered(0.3)], INTACT)
    assert (a.category, a.severity) == (VisionCategory.SATURATED_BUOY, VisionSeverity.MEDIUM)


def test_a_little_trash_in_the_cage_is_still_normal():
    a = run([CAGE, *covered(0.02)], INTACT)
    assert a.category is VisionCategory.NORMAL and a.buoy_status is BuoyStatus.INTACT


def test_defective_and_saturated_is_critical():
    a = run([CAGE, *covered(0.6)], BuoyInspection(ring_found=True, barrier_count=1))
    assert (a.category, a.severity) == (VisionCategory.DEFECTIVE_BUOY, VisionSeverity.CRITICAL)


# ── acumulación de basura ──────────────────────────────────────────────────
@pytest.mark.parametrize(
    ("items", "severity"),
    [
        (1, VisionSeverity.LOW),
        (3, VisionSeverity.MEDIUM),
        (7, VisionSeverity.MEDIUM),
        (8, VisionSeverity.HIGH),
    ],
)
def test_trash_severity_by_item_count(items, severity):
    a = run(trash(items))
    assert (a.category, a.severity) == (VisionCategory.TRASH_ACCUMULATION, severity)
    assert a.trash_items == items


def test_trash_severity_by_covered_area():
    big = [det(FLOATING_TRASH, (0, 0, 500, 330))]  # ≈ 20.6 % de la imagen
    assert run(big).severity is VisionSeverity.HIGH
    medium = [det(FLOATING_TRASH, (0, 0, 250, 200))]  # 6.25 %
    assert run(medium).severity is VisionSeverity.MEDIUM


def test_overlapping_prompts_on_one_object_count_once():
    one_bottle = [
        det(PLASTIC_BOTTLE, (100, 100, 160, 200), 0.7),
        det(PLASTIC_WASTE, (102, 101, 158, 198), 0.5),
        det(FLOATING_TRASH, (98, 99, 162, 202), 0.4),
    ]
    merged = merge_duplicates(one_bottle, 0.6)
    assert [d.label for d in merged] == [PLASTIC_BOTTLE]
    assert run(one_bottle).trash_items == 1


def test_trash_outside_an_intact_cage_still_counts():
    a = run([CAGE, *trash(4)], INTACT)
    assert a.category is VisionCategory.TRASH_ACCUMULATION and a.severity is VisionSeverity.MEDIUM


def test_nothing_found_is_normal():
    a = run([])
    assert (a.category, a.severity, a.buoy_status) == (
        VisionCategory.NORMAL,
        VisionSeverity.LOW,
        BuoyStatus.NOT_DETECTED,
    )


def test_detection_geometry():
    a, b = det("x", (0, 0, 100, 100)), det("y", (60, 60, 160, 160))
    assert a.area == 10_000 and a.intersection_area(b) == 1_600
    assert a.overlap_ratio(b) == 0.16
    assert a.contains_center_of(det("z", (40, 40, 60, 60))) and not a.contains_center_of(b)
    assert det("dead fish", (0, 0, 1, 1)).label_es == "Pez muerto"


# ── clasificador de escena (CLIP) ───────────────────────────────────────────
def scene(**p: float) -> dict[str, float]:
    base = {
        "peces_muertos": 0.0,
        "pez_vivo": 0.0,
        "basura": 0.0,
        "boya": 0.0,
        "agua_limpia": 0.0,
        "otro": 0.0,
    }
    return {**base, **p}


def with_scene(dets, sc, insp=None) -> Assessment:
    return assess(dets, insp or BuoyInspection(), SIZE, VisionPolicy(), sc)


def test_scene_confirms_dead_fish_without_any_box():
    a = with_scene([], scene(peces_muertos=0.96, otro=0.04))
    assert (a.category, a.severity) == (VisionCategory.DEAD_FISH, VisionSeverity.CRITICAL)
    assert any("clasificador de escena" in r for r in a.reasons) and a.scene is not None


def test_scene_below_threshold_is_not_enough():
    assert with_scene([], scene(peces_muertos=0.84, otro=0.16)).category is VisionCategory.NORMAL


def test_scene_vetoes_a_live_fish_detection():
    a = with_scene(
        [det(DEAD_FISH, (10, 10, 200, 100), 0.66)], scene(pez_vivo=0.89, otro=0.10, peces_muertos=0.01)
    )
    assert a.category is VisionCategory.NORMAL


def test_dead_fish_box_counts_when_scene_does_not_contradict_it():
    a = with_scene(
        [det(DEAD_FISH, (10, 10, 200, 100), 0.5)], scene(peces_muertos=0.4, pez_vivo=0.1, otro=0.5)
    )
    assert a.category is VisionCategory.DEAD_FISH


def test_scene_alone_can_report_trash_with_low_or_medium_severity():
    low = with_scene([], scene(basura=0.69, boya=0.23))
    assert (low.category, low.severity) == (VisionCategory.TRASH_ACCUMULATION, VisionSeverity.LOW)
    medium = with_scene([], scene(basura=0.90, boya=0.05))
    assert medium.severity is VisionSeverity.MEDIUM


def test_scene_trash_must_be_the_top_class():
    assert (
        with_scene([], scene(basura=0.62, agua_limpia=0.38 + 0.0, otro=0.0)).category
        is VisionCategory.TRASH_ACCUMULATION
    )
    assert with_scene([], scene(basura=0.55, agua_limpia=0.45)).category is VisionCategory.NORMAL


def test_boxes_and_scene_take_the_worst_severity():
    a = with_scene(trash(8), scene(basura=0.7, otro=0.3))
    assert a.severity is VisionSeverity.HIGH and a.trash_items == 8


def test_without_scene_behaviour_is_unchanged():
    assert with_scene([], None).category is VisionCategory.NORMAL
    assert with_scene([det(DEAD_FISH, (10, 10, 120, 60))], None).category is VisionCategory.DEAD_FISH


def test_scene_recognises_a_buoy_whose_barriers_are_all_gone():
    ring_only = BuoyInspection(ring_found=True, barrier_count=0)
    assert with_scene([], scene(boya=0.2, otro=0.8), ring_only).buoy_status is BuoyStatus.NOT_DETECTED
    a = with_scene([], scene(boya=0.9, otro=0.1), ring_only)
    assert (a.category, a.severity, a.buoy_status) == (
        VisionCategory.DEFECTIVE_BUOY,
        VisionSeverity.HIGH,
        BuoyStatus.DEFECTIVE,
    )


def test_scene_buoy_with_intact_colours_is_normal():
    a = with_scene([], scene(boya=0.9, otro=0.1), INTACT)
    assert a.category is VisionCategory.NORMAL and a.buoy_status is BuoyStatus.INTACT
