from typing import Annotated

from fastapi import APIRouter, File, UploadFile

from app.adapters.inbound.http.deps import ContainerDep
from app.application.read_models import VisionAnalysisOut
from app.domain.errors import VisionUnavailableError

router = APIRouter(prefix="/vision", tags=["visión artificial"])


@router.post(
    "/analyze",
    response_model=VisionAnalysisOut,
    summary="Analiza la foto de un reporte ciudadano (peces muertos, boya skimmer, basura)",
    responses={
        503: {"description": "Visión no disponible (falta `uv sync --extra vision` o el modelo)"},
    },
)
async def analyze_image(
    c: ContainerDep,
    file: Annotated[UploadFile, File(description="Foto JPEG, PNG o WebP (máx. `VISION_MAX_IMAGE_MB`)")],
) -> VisionAnalysisOut:
    """Detecta con YOLO-World y OpenCV (HSV) qué muestra la foto y devuelve categoría, severidad,
    detecciones con confianza y la imagen anotada (data URL).

    Es **abierto** (sin `X-API-Key`): los ciudadanos no tienen cuenta. El tamaño se limita y la
    inferencia se atiende de a una foto para no saturar la CPU.
    """
    if c.vision is None:
        raise VisionUnavailableError("La visión artificial está desactivada (VISION_ENABLED=false)")
    limit = c.settings.vision_max_image_mb * 1024 * 1024
    data = await file.read(limit + 1)  # +1: detecta que se pasó sin leer un archivo gigante completo
    return await c.vision.analyze(data)
