"""Reglas de la visión artificial de los reportes ciudadanos (puras: sin torch ni OpenCV).

El detector (YOLO-World) y la verificación de color (HSV) viven en `adapters/outbound/vision/`;
aquí solo está lo que decide *qué significa* lo que vieron: categoría, severidad y estado de la
boya skimmer. Así las reglas se prueban sin cargar ningún modelo (mismo principio que el
`Detection` de Sentinel Ops).

⚠️ Todos los umbrales son **valores de prototipo** sin validación con fotos reales de campo:
sirven para la demo y se ajustan en `VisionPolicy`.
"""

from dataclasses import dataclass
from enum import StrEnum
from typing import Final


class VisionCategory(StrEnum):
    DEAD_FISH = "peces_muertos"
    DEFECTIVE_BUOY = "boya_defectuosa"
    SATURATED_BUOY = "boya_saturada"
    TRASH_ACCUMULATION = "acumulacion_basura"
    NORMAL = "normal"


class VisionSeverity(StrEnum):
    CRITICAL = "critica"
    HIGH = "alta"
    MEDIUM = "media"
    LOW = "baja"


class BuoyStatus(StrEnum):
    NOT_DETECTED = "no_detectada"
    INTACT = "integra"
    SATURATED = "saturada"
    DEFECTIVE = "defectuosa"


# ── Vocabulario zero-shot (prompts de texto de YOLO-World) ─────────────────
DEAD_FISH: Final = "dead fish"
FLOATING_TRASH: Final = "floating trash"
PLASTIC_BOTTLE: Final = "plastic bottle"
PLASTIC_WASTE: Final = "plastic waste"
FLOATING_BUOY: Final = "floating buoy"
ORANGE_BARRIER: Final = "orange floating barrier"
WIRE_MESH_CAGE: Final = "wire mesh cage"

PROMPTS: Final[tuple[str, ...]] = (
    DEAD_FISH,
    FLOATING_TRASH,
    PLASTIC_BOTTLE,
    PLASTIC_WASTE,
    FLOATING_BUOY,
    ORANGE_BARRIER,
    WIRE_MESH_CAGE,
)
TRASH_LABELS: Final = frozenset({FLOATING_TRASH, PLASTIC_BOTTLE, PLASTIC_WASTE})
BUOY_LABELS: Final = frozenset({FLOATING_BUOY, ORANGE_BARRIER, WIRE_MESH_CAGE})

LABELS_ES: Final[dict[str, str]] = {
    DEAD_FISH: "Pez muerto",
    FLOATING_TRASH: "Basura flotante",
    PLASTIC_BOTTLE: "Botella de plástico",
    PLASTIC_WASTE: "Residuo plástico",
    FLOATING_BUOY: "Boya",
    ORANGE_BARRIER: "Barrera naranja",
    WIRE_MESH_CAGE: "Cesta de malla",
}

# ── Clasificador de escena (CLIP): complementa al detector, que con prompts de texto es poco fiable ──
SCENE_DEAD_FISH: Final = "peces_muertos"
SCENE_LIVE_FISH: Final = "pez_vivo"
SCENE_TRASH: Final = "basura"
SCENE_BUOY: Final = "boya"
SCENE_CLEAN: Final = "agua_limpia"
SCENE_OTHER: Final = "otro"

SCENE_LABELS_ES: Final[dict[str, str]] = {
    SCENE_DEAD_FISH: "Peces muertos",
    SCENE_LIVE_FISH: "Pez vivo",
    SCENE_TRASH: "Basura flotante",
    SCENE_BUOY: "Boya skimmer",
    SCENE_CLEAN: "Agua limpia",
    SCENE_OTHER: "Otra escena",
}

_SEVERITY_ORDER: Final = (
    VisionSeverity.LOW,
    VisionSeverity.MEDIUM,
    VisionSeverity.HIGH,
    VisionSeverity.CRITICAL,
)


def max_severity(*items: VisionSeverity) -> VisionSeverity:
    return max(items, key=_SEVERITY_ORDER.index)


@dataclass(frozen=True, slots=True)
class Detection:
    """Objeto detectado. `bbox` = (x1, y1, x2, y2) en píxeles de la imagen analizada."""

    label: str
    confidence: float
    bbox: tuple[int, int, int, int]

    @property
    def label_es(self) -> str:
        return LABELS_ES.get(self.label, self.label)

    @property
    def area(self) -> int:
        x1, y1, x2, y2 = self.bbox
        return max(0, x2 - x1) * max(0, y2 - y1)

    @property
    def center(self) -> tuple[float, float]:
        x1, y1, x2, y2 = self.bbox
        return ((x1 + x2) / 2, (y1 + y2) / 2)

    def intersection_area(self, other: "Detection") -> int:
        ax1, ay1, ax2, ay2 = self.bbox
        bx1, by1, bx2, by2 = other.bbox
        w = min(ax2, bx2) - max(ax1, bx1)
        h = min(ay2, by2) - max(ay1, by1)
        return w * h if w > 0 and h > 0 else 0

    def overlap_ratio(self, other: "Detection") -> float:
        """Intersección sobre la caja más pequeña (detecta duplicados anidados)."""
        smaller = min(self.area, other.area)
        return self.intersection_area(other) / smaller if smaller else 0.0

    def contains_center_of(self, other: "Detection") -> bool:
        cx, cy = other.center
        x1, y1, x2, y2 = self.bbox
        return x1 <= cx <= x2 and y1 <= cy <= y2


@dataclass(frozen=True, slots=True)
class BuoyInspection:
    """Verificación de color (HSV) de la boya skimmer; la calcula el adaptador OpenCV.

    - `ring_found`: hay un anillo amarillo (el collar de la boya).
    - `barrier_count`: barreras naranjas completas (cada brazo de la "V").
    - `barrier_fragments`: trozos naranjas sueltos y pequeños (señal de barrera rota/desconectada).
    - `barrier_balance`: área de la barrera menor / mayor (1 = simétricas; 0 si hay menos de dos).
    """

    ring_found: bool = False
    barrier_count: int = 0
    barrier_fragments: int = 0
    barrier_balance: float = 0.0
    orange_ratio: float = 0.0
    yellow_ratio: float = 0.0


NO_INSPECTION: Final = BuoyInspection()


@dataclass(frozen=True, slots=True)
class VisionPolicy:
    """Umbrales de prototipo (ver el aviso del módulo)."""

    min_confidence: float = 0.25
    buoy_min_confidence: float = 0.30
    # Barreras naranjas: la boya tiene dos en "V".
    expected_barriers: int = 2
    min_barrier_balance: float = 0.4
    max_barrier_fragments: int = 3
    # Cesta de malla: fracción de su área cubierta por residuos.
    cage_saturation_medium: float = 0.25
    cage_saturation_high: float = 0.50
    # Basura suelta: nº de objetos y fracción de la imagen que ocupan.
    trash_items_medium: int = 3
    trash_items_high: int = 8
    trash_area_medium: float = 0.05
    trash_area_high: float = 0.20
    # Detecciones de basura que se solapan más que esto son la misma.
    duplicate_overlap: float = 0.6
    # Escena (CLIP, probabilidades que suman 1): umbral para dar por válida cada categoría.
    scene_dead_fish_min: float = 0.90
    scene_trash_min: float = 0.60
    scene_trash_medium: float = 0.85
    scene_buoy_min: float = 0.50


DEFAULT_POLICY: Final = VisionPolicy()


@dataclass(frozen=True, slots=True)
class Assessment:
    category: VisionCategory
    severity: VisionSeverity
    summary: str
    reasons: tuple[str, ...]
    buoy_status: BuoyStatus
    cage_saturation: float | None
    trash_items: int
    dead_fish: int
    scene: dict[str, float] | None = None


def merge_duplicates(detections: list[Detection], overlap: float) -> list[Detection]:
    """Quita detecciones de basura repetidas (varios prompts sobre el mismo objeto).

    Se conserva la de mayor confianza. Las demás clases pasan sin tocar.
    """
    trash = sorted((d for d in detections if d.label in TRASH_LABELS), key=lambda d: -d.confidence)
    kept: list[Detection] = []
    for d in trash:
        if all(d.overlap_ratio(k) < overlap for k in kept):
            kept.append(d)
    others = [d for d in detections if d.label not in TRASH_LABELS]
    return others + kept


def cage_saturation(cage: Detection | None, trash: list[Detection]) -> float | None:
    """Fracción (0–1) del área de la cesta cubierta por residuos; None si no se ve la cesta."""
    if cage is None or cage.area == 0:
        return None
    covered = sum(cage.intersection_area(t) for t in trash if cage.contains_center_of(t))
    return min(1.0, covered / cage.area)


def _barrier_damage(i: BuoyInspection, p: VisionPolicy) -> list[str]:
    reasons: list[str] = []
    if i.barrier_count == 0:
        reasons.append("No se ve ninguna barrera naranja flotante: están rotas o desconectadas.")
    elif i.barrier_count < p.expected_barriers:
        reasons.append("Solo se ve una de las dos barreras naranjas en «V»: la otra está desconectada.")
    elif i.barrier_balance < p.min_barrier_balance:
        reasons.append("Las dos barreras naranjas son muy desiguales: una parece rota o recogida.")
    if i.barrier_fragments > p.max_barrier_fragments:
        reasons.append("Hay muchos fragmentos naranjas sueltos: la barrera está despedazada.")
    return reasons


def assess(
    detections: list[Detection],
    inspection: BuoyInspection,
    image_size: tuple[int, int],
    policy: VisionPolicy = DEFAULT_POLICY,
    scene: dict[str, float] | None = None,
) -> Assessment:
    """Decide categoría y severidad. Prioridad: peces muertos > boya defectuosa > boya saturada
    > acumulación de basura > normal.

    `scene` (opcional) son las probabilidades del clasificador de escena. Se usa para dos cosas:
    arbitrar «pez vivo vs. muerto» (el detector zero-shot no distingue) y confirmar peces muertos o
    basura cuando el detector no encuentra cajas."""
    width, height = image_size
    image_area = max(1, width * height)
    found = merge_duplicates(
        [d for d in detections if d.confidence >= policy.min_confidence], policy.duplicate_overlap
    )

    fish = [d for d in found if d.label == DEAD_FISH]
    scene_dead = scene.get(SCENE_DEAD_FISH, 0.0) if scene else 0.0
    scene_live = scene.get(SCENE_LIVE_FISH, 0.0) if scene else 0.0
    scene_trash = scene.get(SCENE_TRASH, 0.0) if scene else 0.0
    # El detector no sabe si el pez está muerto: si la escena dice «pez vivo», se descarta su caja.
    alive_veto = scene is not None and scene_live > scene_dead
    fish_confirmed = bool(fish) and not alive_veto
    fish_by_scene = scene_dead >= policy.scene_dead_fish_min and scene_dead > scene_live
    scene_says_trash = (
        scene is not None and scene_trash >= policy.scene_trash_min and scene_trash >= max(scene.values())
    )
    trash = [d for d in found if d.label in TRASH_LABELS]
    buoy_dets = [d for d in found if d.label in BUOY_LABELS and d.confidence >= policy.buoy_min_confidence]
    cage = max((d for d in found if d.label == WIRE_MESH_CAGE), key=lambda d: d.confidence, default=None)

    # ── ¿Hay boya? Detección visual o, si no, el color (anillo amarillo + naranja) ──
    color_evidence = inspection.ring_found and (inspection.barrier_count + inspection.barrier_fragments) >= 1
    scene_buoy = scene.get(SCENE_BUOY, 0.0) if scene else 0.0
    # Con la boya muy dañada (sin barreras) ni el detector ni el color bastan: la escena sí la reconoce.
    buoy_present = bool(buoy_dets) or color_evidence or scene_buoy >= policy.scene_buoy_min

    saturation = cage_saturation(cage, trash) if buoy_present else None
    outside = [d for d in trash if not (buoy_present and cage is not None and cage.contains_center_of(d))]
    trash_area = sum(d.area for d in outside) / image_area

    reasons: list[str] = []
    damage = _barrier_damage(inspection, policy) if buoy_present else []
    if buoy_present and not inspection.ring_found:
        reasons.append("No se distingue el anillo amarillo de la boya (puede ser la iluminación).")

    saturated = saturation is not None and saturation >= policy.cage_saturation_medium
    if not buoy_present:
        buoy_status = BuoyStatus.NOT_DETECTED
    elif damage:
        buoy_status = BuoyStatus.DEFECTIVE
    elif saturated:
        buoy_status = BuoyStatus.SATURATED
    else:
        buoy_status = BuoyStatus.INTACT

    def result(
        category: VisionCategory,
        severity: VisionSeverity,
        summary: str,
        why: list[str],
        trash_n: int,
        fish_n: int,
    ) -> Assessment:
        return Assessment(
            category, severity, summary, tuple(why), buoy_status, saturation, trash_n, fish_n, scene
        )

    # ── Categoría y severidad ──────────────────────────────────────────────
    if fish_confirmed or fish_by_scene:
        n = len(fish) if fish_confirmed else 0
        if n:
            reasons.insert(0, f"{n} pez(es) muerto(s) en el agua: posible mortandad por contaminación.")
        if fish_by_scene:
            reasons.insert(
                0, f"El clasificador de escena ve peces muertos en el agua ({round(scene_dead * 100)} %)."
            )
        return result(
            VisionCategory.DEAD_FISH,
            VisionSeverity.CRITICAL,
            "Peces muertos detectados: alerta ambiental crítica.",
            reasons,
            len(trash),
            n,
        )

    if buoy_status is BuoyStatus.DEFECTIVE:
        severity = VisionSeverity.CRITICAL if saturated else VisionSeverity.HIGH
        if saturated:
            reasons.append("Además la cesta está llena de residuos: la boya ya no retiene basura.")
        return result(
            VisionCategory.DEFECTIVE_BUOY,
            severity,
            "La boya skimmer está dañada y no contiene los residuos.",
            damage + reasons,
            len(trash),
            0,
        )

    if buoy_status is BuoyStatus.SATURATED:
        assert saturation is not None
        high = saturation >= policy.cage_saturation_high
        reasons.append(f"La cesta de malla está cubierta de residuos en un {round(saturation * 100)} %.")
        return result(
            VisionCategory.SATURATED_BUOY,
            VisionSeverity.HIGH if high else VisionSeverity.MEDIUM,
            "La cesta de la boya skimmer está saturada: hay que vaciarla.",
            reasons,
            len(trash),
            0,
        )

    n_out = len(outside)
    if n_out or scene_says_trash:
        severity = VisionSeverity.LOW
        if n_out:
            if n_out >= policy.trash_items_high or trash_area >= policy.trash_area_high:
                severity = VisionSeverity.HIGH
            elif n_out >= policy.trash_items_medium or trash_area >= policy.trash_area_medium:
                severity = VisionSeverity.MEDIUM
            reasons.insert(
                0, f"{n_out} objeto(s) de basura flotante ocupan el {round(trash_area * 100)} % de la imagen."
            )
        if scene_says_trash:
            if scene_trash >= policy.scene_trash_medium:
                severity = max_severity(severity, VisionSeverity.MEDIUM)
            reasons.insert(
                0, f"El clasificador de escena ve basura flotando en el agua ({round(scene_trash * 100)} %)."
            )
        return result(
            VisionCategory.TRASH_ACCUMULATION,
            severity,
            "Acumulación de basura flotante en el agua.",
            reasons,
            n_out,
            0,
        )

    summary = (
        "La boya skimmer se ve íntegra y la cesta no está saturada."
        if buoy_status is BuoyStatus.INTACT
        else "No se detectó ningún problema en la imagen."
    )
    return result(VisionCategory.NORMAL, VisionSeverity.LOW, summary, reasons, 0, 0)
