"""Verificación de color (HSV, OpenCV) de la boya skimmer.

La boya tiene un anillo amarillo y dos barreras flotantes naranjas en «V» (una a cada lado del
núcleo). Aquí se miden esos colores para saber si la boya está íntegra:

- anillo amarillo: ¿hay una mancha amarilla con tamaño suficiente?
- barreras naranjas: se parte la máscara naranja por el eje vertical de la boya y se cuenta
  cuántos lados tienen una barrera completa; los trozos pequeños y sueltos indican una barrera rota.

⚠️ Rangos HSV y fracciones son valores de prototipo, calibrados a ojo: dependen de la luz.
"""

from typing import Any

import cv2
import numpy as np

from app.domain.vision import BUOY_LABELS, BuoyInspection, Detection

# OpenCV: H 0–179, S/V 0–255.
ORANGE_LOW = np.array([4, 130, 120], dtype=np.uint8)
ORANGE_HIGH = np.array([20, 255, 255], dtype=np.uint8)
YELLOW_LOW = np.array([22, 110, 140], dtype=np.uint8)
YELLOW_HIGH = np.array([36, 255, 255], dtype=np.uint8)

ROI_PADDING = 0.15  # holgura alrededor de la boya detectada
MIN_BARRIER_FRAC = 0.006  # una barrera completa ocupa ≥ 0.6 % de la región
MIN_FRAGMENT_FRAC = 0.0005  # por debajo de 0.05 % es ruido
MIN_RING_FRAC = 0.0015
MIN_SIDE_PX = 6


def region_of_interest(shape: tuple[int, ...], detections: list[Detection]) -> tuple[int, int, int, int]:
    """Caja (x1, y1, x2, y2) donde buscar los colores: la boya detectada con holgura, o toda la imagen."""
    height, width = shape[:2]
    boxes = [d.bbox for d in detections if d.label in BUOY_LABELS]
    if not boxes:
        return 0, 0, width, height
    x1 = min(b[0] for b in boxes)
    y1 = min(b[1] for b in boxes)
    x2 = max(b[2] for b in boxes)
    y2 = max(b[3] for b in boxes)
    px, py = int((x2 - x1) * ROI_PADDING), int((y2 - y1) * ROI_PADDING)
    return max(0, x1 - px), max(0, y1 - py), min(width, x2 + px), min(height, y2 + py)


def color_masks(image_bgr: np.ndarray, roi: tuple[int, int, int, int]) -> tuple[np.ndarray, np.ndarray]:
    """Máscaras (naranja, amarillo) de la región, ya limpias de ruido."""
    x1, y1, x2, y2 = roi
    hsv = cv2.cvtColor(image_bgr[y1:y2, x1:x2], cv2.COLOR_BGR2HSV)
    orange = cv2.inRange(hsv, ORANGE_LOW, ORANGE_HIGH)
    yellow = cv2.inRange(hsv, YELLOW_LOW, YELLOW_HIGH)
    k3, k5 = np.ones((3, 3), np.uint8), np.ones((5, 5), np.uint8)
    orange = cv2.morphologyEx(cv2.morphologyEx(orange, cv2.MORPH_OPEN, k3), cv2.MORPH_CLOSE, k5)
    yellow = cv2.morphologyEx(cv2.morphologyEx(yellow, cv2.MORPH_OPEN, k3), cv2.MORPH_CLOSE, k5)
    return orange, yellow


def _components(mask: np.ndarray, min_area: float) -> list[tuple[float, float, float]]:
    """(área, centro x, ancho) de cada mancha con al menos `min_area` px."""
    n, _, stats, centroids = cv2.connectedComponentsWithStats(mask, connectivity=8)
    out = []
    for i in range(1, n):
        area = float(stats[i, cv2.CC_STAT_AREA])
        if area >= min_area and stats[i, cv2.CC_STAT_WIDTH] >= MIN_SIDE_PX:
            out.append((area, float(centroids[i][0]), float(stats[i, cv2.CC_STAT_WIDTH])))
    return out


def inspect_buoy(image_bgr: np.ndarray, detections: list[Detection]) -> BuoyInspection:
    roi = region_of_interest(image_bgr.shape, detections)
    if roi[2] - roi[0] < 8 or roi[3] - roi[1] < 8:
        return BuoyInspection()
    orange, yellow = color_masks(image_bgr, roi)
    area = float(orange.shape[0] * orange.shape[1])

    ring = _components(yellow, MIN_RING_FRAC * area)
    ring_found = bool(ring)

    # Eje vertical de la boya: el anillo si se ve; si no, el centro de la boya detectada o de lo naranja.
    if ring:
        axis = max(ring)[1]
    else:
        buoy = [d for d in detections if d.label in BUOY_LABELS]
        if buoy:
            axis = float(np.mean([d.center[0] for d in buoy])) - roi[0]
        else:
            xs = np.where(orange.any(axis=0))[0]
            axis = float((xs.min() + xs.max()) / 2) if xs.size else orange.shape[1] / 2

    parts: dict[str, list[float]] = {"left": [], "right": []}
    fragments = 0
    for comp_area, cx, _ in _components(orange, MIN_FRAGMENT_FRAC * area):
        side = "left" if cx < axis else "right"
        if comp_area >= MIN_BARRIER_FRAC * area:
            parts[side].append(comp_area)
        else:
            fragments += 1
    # Una barrera rota en varios trozos grandes cuenta como una sola: el resto son fragmentos.
    barrier_areas = []
    for areas in parts.values():
        if areas:
            areas.sort(reverse=True)
            barrier_areas.append(sum(areas))
            fragments += len(areas) - 1

    barrier_areas.sort(reverse=True)
    balance = barrier_areas[1] / barrier_areas[0] if len(barrier_areas) >= 2 else 0.0
    return BuoyInspection(
        ring_found=ring_found,
        barrier_count=len(barrier_areas),
        barrier_fragments=fragments,
        barrier_balance=round(balance, 3),
        orange_ratio=round(float(np.count_nonzero(orange)) / area, 4),
        yellow_ratio=round(float(np.count_nonzero(yellow)) / area, 4),
    )


def contours(mask: np.ndarray, offset: tuple[int, int], min_area: float) -> list[Any]:
    """Contornos de la máscara, trasladados a coordenadas de la imagen completa."""
    found, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    return [c + np.array(offset, dtype=c.dtype) for c in found if cv2.contourArea(c) >= min_area]
