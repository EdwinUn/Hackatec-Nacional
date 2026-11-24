"""Detección zero-shot con YOLO-World (Ultralytics): clases definidas por prompts de texto.

Sigue el patrón del `ThreatDetector` de Sentinel Ops: el modelo se carga una sola vez, la
importación de `ultralytics` es diferida (la API arranca sin el extra) y las cajas se recortan
al marco de la imagen.
"""

import logging
import threading
from pathlib import Path
from typing import Any

from app.domain.errors import VisionUnavailableError
from app.domain.vision import PROMPTS, Detection

log = logging.getLogger(__name__)

INSTALL_HINT = "Falta el extra de visión: ejecuta `uv sync --extra vision` en backend/ y reinicia la API."


class YoloWorldDetector:
    def __init__(self, model_name: str, models_dir: str, conf: float, imgsz: int) -> None:
        self._model_name = model_name
        self._models_dir = Path(models_dir)
        self._conf = conf
        self._imgsz = imgsz
        self._model: Any = None
        self._lock = threading.Lock()  # cargar una vez y no inferir en paralelo (el modelo no es thread-safe)

    def load(self) -> None:
        """Carga el modelo (descarga los pesos la primera vez). Idempotente."""
        with self._lock:
            self._ensure_model()

    def _ensure_model(self) -> Any:
        if self._model is not None:
            return self._model
        try:
            from ultralytics import YOLOWorld
            from ultralytics.utils.downloads import attempt_download_asset
        except ImportError as exc:
            raise VisionUnavailableError(INSTALL_HINT) from exc

        self._models_dir.mkdir(parents=True, exist_ok=True)
        weights = self._models_dir / self._model_name
        try:
            log.info("loading vision model", extra={"model": str(weights)})
            attempt_download_asset(str(weights))  # no-op si el archivo ya existe
            model = YOLOWorld(str(weights))
            model.set_classes(list(PROMPTS))  # prompts de texto → CLIP
        except Exception as exc:
            log.exception("vision model failed to load")
            raise VisionUnavailableError(f"No se pudo cargar el modelo de visión: {exc}") from exc
        self._model = model
        return model

    def detect(self, image_bgr: Any) -> list[Detection]:
        with self._lock:
            model = self._ensure_model()
            results = model.predict(image_bgr, conf=self._conf, imgsz=self._imgsz, verbose=False)
        if not results or results[0].boxes is None or len(results[0].boxes) == 0:
            return []

        height, width = image_bgr.shape[:2]
        boxes = results[0].boxes
        xyxy = boxes.xyxy.cpu().numpy()
        conf = boxes.conf.cpu().numpy()
        cls = boxes.cls.cpu().numpy()
        found: list[Detection] = []
        for i in range(len(xyxy)):
            idx = int(cls[i])
            if not 0 <= idx < len(PROMPTS):
                continue
            x1, y1, x2, y2 = (float(v) for v in xyxy[i])
            bbox = (
                max(0, round(x1)),
                max(0, round(y1)),
                min(width - 1, round(x2)),
                min(height - 1, round(y2)),
            )
            if bbox[2] <= bbox[0] or bbox[3] <= bbox[1]:
                continue  # el recorte degeneró la caja
            found.append(Detection(PROMPTS[idx], round(float(conf[i]), 3), bbox))
        return found
