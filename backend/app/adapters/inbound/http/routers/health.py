from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.adapters.inbound.http.deps import ContainerDep
from app.adapters.inbound.http.schemas import HealthOut

router = APIRouter(tags=["utilidad"])


@router.get(
    "/health",
    response_model=HealthOut,
    responses={503: {"model": HealthOut, "description": "Alguna dependencia falla"}},
    summary="Estado de API, PostgreSQL y Redis",
)
async def health(c: ContainerDep):
    checks = await c.check_health()
    ok = all(v in ("ok", "disabled") for v in checks.values())
    body = HealthOut(status="ok" if ok else "degraded", api="ok", version=c.version, **checks)
    return JSONResponse(body.model_dump(), status_code=200 if ok else 503)
