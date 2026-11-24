"""POST /api/v1/vision/analyze con un motor falso (no carga YOLO ni OpenCV)."""

import base64
from typing import Any

import pytest
from httpx import AsyncClient

from app.application.services.vision import VisionService
from app.domain.errors import VisionUnavailableError
from app.domain.vision import DEAD_FISH, NO_INSPECTION, Detection

pytestmark = pytest.mark.integration

JPEG = b"\xff\xd8\xff\xe0" + b"0" * 64


class FakeEngine:
    def __init__(self, *, fail: Exception | None = None, bad_image: bool = False) -> None:
        self.fail = fail
        self.bad_image = bad_image

    def decode(self, data: bytes) -> Any:
        if self.fail:
            raise self.fail
        if self.bad_image:
            raise ValueError("no es una imagen")
        return data

    def image_size(self, image: Any) -> tuple[int, int]:
        return 640, 480

    def detect(self, image: Any) -> list[Detection]:
        return [Detection(DEAD_FISH, 0.62, (10, 20, 200, 120))]

    def inspect_buoy(self, image: Any, detections: list[Detection]):
        return NO_INSPECTION

    def classify_scene(self, image: Any):
        return {
            "peces_muertos": 0.9,
            "pez_vivo": 0.01,
            "basura": 0.02,
            "boya": 0.02,
            "agua_limpia": 0.02,
            "otro": 0.03,
        }

    def annotate(self, image, detections, inspection, assessment) -> bytes:
        return b"\xff\xd8annotated"


def use_engine(container, engine: FakeEngine, max_mb: int = 8) -> None:
    container.vision = VisionService(engine, model_name="fake", max_bytes=max_mb * 1024 * 1024)


@pytest.fixture
async def anonymous(client: AsyncClient):
    """Cliente SIN X-API-Key: los ciudadanos no tienen cuenta."""
    async with AsyncClient(transport=client._transport, base_url="http://test") as c:
        yield c


@pytest.fixture(autouse=True)
def restore_vision(container):
    original = container.vision
    yield
    container.vision = original


async def post(c: AsyncClient, data: bytes = JPEG, name: str = "foto.jpg"):
    return await c.post("/api/v1/vision/analyze", files={"file": (name, data, "image/jpeg")})


async def test_analyze_returns_category_detections_and_annotated_image(container, anonymous):
    use_engine(container, FakeEngine())
    r = await post(anonymous)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["category"] == "peces_muertos" and body["severity"] == "critica"
    assert body["detections"] == [
        {"label": "dead fish", "label_es": "Pez muerto", "confidence": 0.62, "bbox": [10, 20, 200, 120]}
    ]
    assert body["buoy"]["status"] == "no_detectada"
    assert body["scene"][0] == {"label": "peces_muertos", "label_es": "Peces muertos", "probability": 0.9}
    assert body["image"] == {"width": 640, "height": 480}
    assert body["annotated_image"].startswith("data:image/jpeg;base64,")
    assert base64.b64decode(body["annotated_image"].split(",", 1)[1]) == b"\xff\xd8annotated"
    assert body["model"] == "fake" and body["note"]


async def test_empty_file_is_rejected(container, anonymous):
    use_engine(container, FakeEngine())
    r = await post(anonymous, b"")
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_data"


async def test_oversized_image_is_rejected(container, anonymous):
    use_engine(container, FakeEngine(), max_mb=1)
    r = await post(anonymous, b"0" * (1024 * 1024 + 10))
    assert r.status_code == 422 and "máximo" in r.json()["error"]["message"]


async def test_unreadable_image_is_a_422_not_a_500(container, anonymous):
    use_engine(container, FakeEngine(bad_image=True))
    r = await post(anonymous, b"esto no es una imagen", "x.jpg")
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_data"


async def test_missing_file_is_a_validation_error(anonymous):
    r = await anonymous.post("/api/v1/vision/analyze")
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"


async def test_vision_unavailable_is_a_503_with_the_install_hint(container, anonymous):
    use_engine(container, FakeEngine(fail=VisionUnavailableError("Falta el extra de visión")))
    r = await post(anonymous)
    assert r.status_code == 503
    assert r.json()["error"] == {
        "code": "vision_unavailable",
        "message": "Falta el extra de visión",
        "details": None,
    }


async def test_vision_disabled_is_a_503(container, anonymous):
    container.vision = None
    r = await post(anonymous)
    assert r.status_code == 503 and r.json()["error"]["code"] == "vision_unavailable"
