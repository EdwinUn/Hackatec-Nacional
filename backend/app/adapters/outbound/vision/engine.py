"""Motor de visión: une YOLO-World (detección), HSV (boya) y el dibujado (`VisionEngine`)."""

import logging
from typing import Any

from app.application.ports import VisionEngine
from app.domain.errors import VisionUnavailableError
from app.domain.vision import Assessment, BuoyInspection, Detection

from .clip_scene import ClipSceneClassifier
from .yolo_world import INSTALL_HINT, YoloWorldDetector

log = logging.getLogger(__name__)

# Se analiza una versión reducida: la inferencia ya reescala a `imgsz` y el HSV en 12 MP sobra.
MAX_SIDE_PX = 1280


class OpenCvYoloEngine(VisionEngine):
    def __init__(
        self,
        detector: YoloWorldDetector,
        min_confidence: float,
        scene: ClipSceneClassifier | None = None,
    ) -> None:
        self._detector = detector
        self._scene = scene
        self._min_confidence = min_confidence

    @staticmethod
    def _cv2() -> Any:
        try:
            import cv2
        except ImportError as exc:
            raise VisionUnavailableError(INSTALL_HINT) from exc
        return cv2

    def preload(self) -> None:
        self._cv2()
        self._detector.load()

    def decode(self, data: bytes) -> Any:
        cv2 = self._cv2()
        import numpy as np

        # IMREAD_COLOR aplica la orientación EXIF: las fotos verticales del celular salen derechas.
        image = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
        if image is None or image.size == 0:
            raise ValueError("no es una imagen")
        h, w = image.shape[:2]
        longest = max(h, w)
        if longest > MAX_SIDE_PX:
            f = MAX_SIDE_PX / longest
            image = cv2.resize(image, (round(w * f), round(h * f)), interpolation=cv2.INTER_AREA)
        return image

    def image_size(self, image: Any) -> tuple[int, int]:
        h, w = image.shape[:2]
        return w, h

    def detect(self, image: Any) -> list[Detection]:
        return self._detector.detect(image)

    def classify_scene(self, image: Any) -> dict[str, float] | None:
        return self._scene.classify(image) if self._scene is not None else None

    def inspect_buoy(self, image: Any, detections: list[Detection]) -> BuoyInspection:
        self._cv2()
        from . import buoy_color

        return buoy_color.inspect_buoy(image, detections)

    def annotate(
        self, image: Any, detections: list[Detection], inspection: BuoyInspection, assessment: Assessment
    ) -> bytes:
        self._cv2()
        from . import annotator

        return annotator.annotate(image, detections, inspection, assessment, self._min_confidence)
