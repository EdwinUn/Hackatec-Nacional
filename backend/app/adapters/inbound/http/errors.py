"""Formato de error único:

{"error": {"code": "not_found", "message": "Sensor no encontrado", "details": null}}
"""

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.domain.errors import ConflictError, DomainError, InvalidDataError, NotFoundError

log = logging.getLogger(__name__)

STATUS = {NotFoundError: 404, ConflictError: 409, InvalidDataError: 422}
HTTP_CODES = {
    400: "bad_request",
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    405: "method_not_allowed",
    409: "conflict",
    422: "validation_error",
}


def error_body(code: str, message: str, details: object = None) -> dict:
    return {"error": {"code": code, "message": message, "details": details}}


ERROR_SCHEMA = {
    "type": "object",
    "properties": {
        "error": {
            "type": "object",
            "properties": {
                "code": {"type": "string", "example": "not_found"},
                "message": {"type": "string", "example": "Sensor no encontrado"},
                "details": {},
            },
        }
    },
}


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(DomainError)
    async def domain_error(_: Request, exc: DomainError) -> JSONResponse:
        status = next((s for cls, s in STATUS.items() if isinstance(exc, cls)), 400)
        return JSONResponse(error_body(exc.code, exc.message, exc.details), status_code=status)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        details = [{"loc": list(e["loc"]), "msg": e["msg"], "type": e["type"]} for e in exc.errors()]
        return JSONResponse(error_body("validation_error", "Datos inválidos", details), 422)

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = HTTP_CODES.get(exc.status_code, "http_error")
        return JSONResponse(
            error_body(code, str(exc.detail)), exc.status_code, headers=getattr(exc, "headers", None)
        )

    @app.exception_handler(IntegrityError)
    async def integrity_error(_: Request, exc: IntegrityError) -> JSONResponse:
        # La BD es la última defensa (únicos, llaves foráneas, CHECK): nunca responder 500.
        sqlstate = getattr(exc.orig, "sqlstate", None) or getattr(
            getattr(exc.orig, "__cause__", None), "sqlstate", None
        )
        if sqlstate == "23505":
            return JSONResponse(error_body("conflict", "Ya existe un registro con esos datos"), 409)
        if sqlstate == "23503":
            return JSONResponse(error_body("invalid_data", "Referencia a un registro inexistente"), 422)
        return JSONResponse(error_body("invalid_data", "Los datos violan una restricción de la BD"), 422)

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception) -> JSONResponse:
        log.exception("unhandled error", extra={"path": request.url.path})
        return JSONResponse(error_body("internal_error", "Error interno del servidor"), 500)
