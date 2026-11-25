"""Clasificador de escena zero-shot con CLIP (ViT-B/32).

Complementa a YOLO-World: con prompts de texto el detector casi no distingue un pez muerto de uno
vivo ni ve una botella transparente en el agua, mientras que CLIP, a nivel de imagen completa, sí
separa estas escenas. Los pesos son los mismos que YOLO-World usa para codificar sus prompts
(`~/.cache/clip`), así que no hay descarga extra.

⚠️ Prototipo: probado con muy pocas fotos (ver README); puede equivocarse con imágenes ambiguas.
"""

import logging
import threading
from typing import Any

from app.domain.vision import (
    SCENE_BUOY,
    SCENE_CLEAN,
    SCENE_DEAD_FISH,
    SCENE_LIVE_FISH,
    SCENE_OTHER,
    SCENE_TRASH,
)

log = logging.getLogger(__name__)

# Una frase por clase; las probabilidades se reparten (softmax) entre todas.
SCENE_PROMPTS: dict[str, str] = {
    SCENE_DEAD_FISH: "a photo of many dead fish floating belly-up on polluted water",
    SCENE_LIVE_FISH: "a photo of a live fish swimming in water",
    SCENE_TRASH: "a photo of plastic bottles and garbage floating on river water",
    SCENE_BUOY: "a photo of a floating buoy with a wire mesh basket collecting trash on a river",
    SCENE_CLEAN: "a photo of clean river water with nothing floating on it",
    SCENE_OTHER: "a photo of something unrelated to water, rivers or pollution",
}


class ClipSceneClassifier:
    def __init__(self, model_name: str = "ViT-B/32") -> None:
        self._model_name = model_name
        self._lock = threading.Lock()
        self._loaded = False
        self._failed = False
        self._model: Any = None
        self._preprocess: Any = None
        self._text: Any = None

    def _load(self) -> bool:
        if self._loaded:
            return True
        if self._failed:
            return False
        try:
            import clip
            import torch

            model, preprocess = clip.load(self._model_name, device="cpu")
            with torch.no_grad():
                text = model.encode_text(clip.tokenize(list(SCENE_PROMPTS.values())))
                text = text / text.norm(dim=-1, keepdim=True)
        except Exception:
            # La escena es opcional: sin ella se sigue con YOLO-World + HSV.
            log.warning("scene classifier unavailable; continuing without it", exc_info=True)
            self._failed = True
            return False
        self._model, self._preprocess, self._text, self._loaded = model, preprocess, text, True
        return True

    def classify(self, image_bgr: Any) -> dict[str, float] | None:
        """Probabilidad (suma 1) de cada escena, o None si CLIP no está disponible."""
        with self._lock:
            if not self._load():
                return None
            import cv2
            import torch
            from PIL import Image

            rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
            tensor = self._preprocess(Image.fromarray(rgb)).unsqueeze(0)
            with torch.no_grad():
                feats = self._model.encode_image(tensor)
                feats = feats / feats.norm(dim=-1, keepdim=True)
                probs = (100.0 * feats @ self._text.T).softmax(dim=-1)[0].tolist()
        return {label: round(p, 4) for label, p in zip(SCENE_PROMPTS, probs, strict=True)}
