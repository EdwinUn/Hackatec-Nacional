"""Dibujo de las detecciones sobre la foto (cajas, regiones de color y banner de resultado).

Mismo estilo que `overlay.py` de Sentinel Ops: etiquetas con fondo opaco para que se lean sobre
cualquier escena. Las fuentes de OpenCV no tienen acentos ni «ñ», por eso los textos van sin ellos.
"""

import unicodedata

import cv2
import numpy as np

from app.domain.vision import (
    BUOY_LABELS,
    DEAD_FISH,
    ORANGE_BARRIER,
    SCENE_LABELS_ES,
    TRASH_LABELS,
    WIRE_MESH_CAGE,
    Assessment,
    BuoyInspection,
    Detection,
    VisionSeverity,
)

from . import buoy_color

_FONT = cv2.FONT_HERSHEY_SIMPLEX
# BGR
_RED = (40, 40, 220)
_AMBER = (0, 165, 255)
_TEAL = (170, 170, 0)
_BLUE = (230, 120, 30)
_ORANGE = (0, 120, 255)
_YELLOW = (0, 230, 255)
_WHITE = (255, 255, 255)
_BLACK = (0, 0, 0)

_SEVERITY_COLOR = {
    VisionSeverity.CRITICAL: (30, 30, 200),
    VisionSeverity.HIGH: (20, 90, 220),
    VisionSeverity.MEDIUM: (0, 165, 235),
    VisionSeverity.LOW: (60, 160, 60),
}


def _ascii(text: str) -> str:
    return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")


def _color_for(label: str) -> tuple[int, int, int]:
    if label == DEAD_FISH:
        return _RED
    if label in TRASH_LABELS:
        return _AMBER
    if label == WIRE_MESH_CAGE:
        return _BLUE
    if label == ORANGE_BARRIER:
        return _ORANGE
    return _TEAL


def _label(
    img: np.ndarray, text: str, origin: tuple[int, int], color: tuple[int, int, int], scale: float
) -> None:
    x, y = origin
    thickness = max(1, round(scale * 1.6))
    (w, h), base = cv2.getTextSize(text, _FONT, scale, thickness)
    y = max(y, h + base + 2)
    cv2.rectangle(img, (x - 2, y - h - base - 2), (x + w + 2, y + base - 1), _BLACK, -1)
    cv2.putText(img, text, (x, y - base + 1), _FONT, scale, color, thickness, cv2.LINE_AA)


def annotate(
    image_bgr: np.ndarray,
    detections: list[Detection],
    inspection: BuoyInspection,
    assessment: Assessment,
    min_confidence: float,
    jpeg_quality: int = 82,
) -> bytes:
    """Devuelve un JPEG con las cajas y las regiones de color. Nunca modifica la imagen original."""
    canvas = image_bgr.copy()
    height, width = canvas.shape[:2]
    scale = max(0.5, width / 1100)
    line = max(2, round(width / 400))

    # Regiones de color usadas en la verificación de la boya (naranja = barreras, amarillo = anillo).
    if assessment.buoy_status.value != "no_detectada":
        roi = buoy_color.region_of_interest(canvas.shape, detections)
        orange, yellow = buoy_color.color_masks(canvas, roi)
        area = orange.shape[0] * orange.shape[1]
        off = (roi[0], roi[1])
        cv2.drawContours(
            canvas, buoy_color.contours(orange, off, buoy_color.MIN_FRAGMENT_FRAC * area), -1, _ORANGE, line
        )
        cv2.drawContours(
            canvas, buoy_color.contours(yellow, off, buoy_color.MIN_RING_FRAC * area), -1, _YELLOW, line
        )
        if roi != (0, 0, width, height):
            cv2.rectangle(canvas, (roi[0], roi[1]), (roi[2], roi[3]), _TEAL, 1, cv2.LINE_AA)

    for d in sorted(detections, key=lambda d: d.confidence):
        if d.confidence < min_confidence:
            continue
        color = _color_for(d.label)
        x1, y1, x2, y2 = d.bbox
        cv2.rectangle(canvas, (x1, y1), (x2, y2), color, line)
        _label(canvas, f"{_ascii(d.label_es)} {d.confidence:.2f}", (x1, y1 - 6), color, scale * 0.7)

    # Banner con la categoría y la severidad.
    banner = f"{assessment.category.value.replace('_', ' ').upper()} | {assessment.severity.value.upper()}"
    color = _SEVERITY_COLOR[assessment.severity]
    cv2.rectangle(canvas, (0, 0), (width - 1, int(46 * scale)), color, -1)
    cv2.putText(
        canvas,
        _ascii(banner),
        (10, int(32 * scale)),
        _FONT,
        scale * 0.9,
        _WHITE,
        max(1, round(scale * 1.8)),
        cv2.LINE_AA,
    )
    if assessment.scene:
        top, prob = max(assessment.scene.items(), key=lambda kv: kv[1])
        label = SCENE_LABELS_ES.get(top, top)
        _label(
            canvas,
            _ascii(f"escena: {label} {round(prob * 100)}%"),
            (10, int(46 * scale) + int(26 * scale)),
            _WHITE,
            scale * 0.65,
        )
    cv2.rectangle(canvas, (0, 0), (width - 1, height - 1), color, max(3, line))

    ok, buffer = cv2.imencode(".jpg", canvas, [cv2.IMWRITE_JPEG_QUALITY, jpeg_quality])
    if not ok:
        raise ValueError("No se pudo codificar la imagen anotada")
    return buffer.tobytes()


__all__ = ["BUOY_LABELS", "annotate"]
