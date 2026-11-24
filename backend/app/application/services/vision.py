"""Análisis de las fotos de los reportes ciudadanos con visión artificial."""

import asyncio
import base64
import time
from typing import Any

from app.application.ports import VisionEngine
from app.application.read_models import (
    BuoyReportOut,
    ImageSizeOut,
    SceneScoreOut,
    VisionAnalysisOut,
    VisionDetectionOut,
)
from app.domain.errors import InvalidDataError
from app.domain.vision import DEFAULT_POLICY, SCENE_LABELS_ES, VisionPolicy, assess

NOTE = (
    "Resultado de un modelo zero-shot (YOLO-World) y reglas de color de prototipo, sin validar con "
    "fotos reales de campo: úsalo como apoyo, no como diagnóstico."
)


class VisionService:
    def __init__(
        self,
        engine: VisionEngine,
        *,
        model_name: str,
        max_bytes: int,
        max_concurrency: int = 1,
        policy: VisionPolicy = DEFAULT_POLICY,
    ) -> None:
        self._engine = engine
        self._model_name = model_name
        self._max_bytes = max_bytes
        self._policy = policy
        # La inferencia en CPU es pesada: se atiende de a pocas fotos para no ahogar la API.
        self._slots = asyncio.Semaphore(max_concurrency)

    async def analyze(self, data: bytes) -> VisionAnalysisOut:
        if not data:
            raise InvalidDataError("La imagen está vacía")
        if len(data) > self._max_bytes:
            raise InvalidDataError(f"La imagen supera el máximo de {self._max_bytes // (1024 * 1024)} MB")
        async with self._slots:
            # No bloquear el event loop: torch/OpenCV son síncronos.
            return await asyncio.to_thread(self._analyze_sync, data)

    def _analyze_sync(self, data: bytes) -> VisionAnalysisOut:
        started = time.perf_counter()
        try:
            image: Any = self._engine.decode(data)
        except ValueError as exc:
            raise InvalidDataError("No se pudo leer la imagen (usa JPEG, PNG o WebP)") from exc
        width, height = self._engine.image_size(image)

        detections = self._engine.detect(image)
        inspection = self._engine.inspect_buoy(image, detections)
        scene = self._engine.classify_scene(image)
        assessment = assess(detections, inspection, (width, height), self._policy, scene)
        annotated = self._engine.annotate(image, detections, inspection, assessment)

        return VisionAnalysisOut(
            category=assessment.category,
            severity=assessment.severity,
            summary=assessment.summary,
            reasons=list(assessment.reasons),
            detections=[
                VisionDetectionOut(
                    label=d.label, label_es=d.label_es, confidence=round(d.confidence, 3), bbox=d.bbox
                )
                for d in sorted(detections, key=lambda d: -d.confidence)
                if d.confidence >= self._policy.min_confidence
            ],
            buoy=BuoyReportOut(
                status=assessment.buoy_status,
                ring_found=inspection.ring_found,
                barrier_count=inspection.barrier_count,
                barrier_fragments=inspection.barrier_fragments,
                barrier_balance=round(inspection.barrier_balance, 3),
                cage_saturation=None
                if assessment.cage_saturation is None
                else round(assessment.cage_saturation, 3),
            ),
            scene=(
                [
                    SceneScoreOut(label=k, label_es=SCENE_LABELS_ES.get(k, k), probability=round(v, 3))
                    for k, v in sorted(scene.items(), key=lambda kv: -kv[1])
                ]
                if scene
                else None
            ),
            annotated_image="data:image/jpeg;base64," + base64.b64encode(annotated).decode("ascii"),
            image=ImageSizeOut(width=width, height=height),
            model=self._model_name,
            elapsed_ms=round((time.perf_counter() - started) * 1000, 1),
            note=NOTE,
        )
