import logging
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.adapters.inbound.http.errors import ERROR_SCHEMA, install_error_handlers
from app.adapters.inbound.http.routers import alerts, analytics, catalog, health, ingest, vision
from app.adapters.inbound.websocket import endpoint as ws_endpoint
from app.config.container import VERSION, Container
from app.config.logging import configure_logging
from app.config.settings import Settings, get_settings

access_log = logging.getLogger("app.access")

DESCRIPTION = """
API del prototipo de monitoreo y limpieza de agua de ríos (Hackatec Nacional 2026 · SECIHTI Puebla).

- **Ingesta** (`X-API-Key`): lecturas de sensores, ciclos de centrifugado, lotes tratados, basura.
- **Dashboard**: KPIs, series de pH, salud de sensores, centrífuga, recuperación de agua, basura,
  proyección de pH y mapa de puntos críticos.
- **Visión artificial**: `POST /api/v1/vision/analyze` analiza las fotos de los reportes ciudadanos.
- **Tiempo real**: `WS /ws/live?station_id=` (ver `API.md`).

⚠️ Umbrales, WQI y proyección son **valores de prototipo configurables**, no criterios validados.
"""


def create_app(settings: Settings | None = None, container: Container | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level, settings.log_json)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.container = container or Container(settings)
        await app.state.container.start()
        try:
            yield
        finally:
            await app.state.container.stop()

    app = FastAPI(
        title=settings.app_name,
        version=VERSION,
        description=DESCRIPTION,
        lifespan=lifespan,
        responses={
            401: {
                "description": "X-API-Key inválida",
                "content": {"application/json": {"schema": ERROR_SCHEMA}},
            },
            404: {"description": "No encontrado", "content": {"application/json": {"schema": ERROR_SCHEMA}}},
            422: {
                "description": "Datos inválidos",
                "content": {"application/json": {"schema": ERROR_SCHEMA}},
            },
        },
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        # En dev, cualquier puerto de localhost (ng serve cambia de puerto si el 4200 está ocupado).
        allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?" if settings.is_dev else None,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    install_error_handlers(app)

    @app.middleware("http")
    async def request_log(request: Request, call_next):
        request_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
        start = time.perf_counter()
        response = await call_next(request)
        response.headers["x-request-id"] = request_id
        access_log.info(
            "request",
            extra={
                "request_id": request_id,
                "method": request.method,
                "path": request.url.path,
                "status": response.status_code,
                "ms": round((time.perf_counter() - start) * 1000, 1),
            },
        )
        return response

    v1 = APIRouter(prefix="/api/v1")
    for module in (ingest, catalog, alerts, analytics, vision, health):
        v1.include_router(module.router)
    app.include_router(v1)
    app.include_router(health.router)  # /health también en la raíz (lo usa el frontend actual)
    app.include_router(ws_endpoint.router)
    return app


app = create_app()
