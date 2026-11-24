class DomainError(Exception):
    """Error de negocio. `code` es estable y lo consume el frontend."""

    code = "domain_error"

    def __init__(self, message: str, details: object | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details


class NotFoundError(DomainError):
    code = "not_found"


class InvalidDataError(DomainError):
    code = "invalid_data"


class ConflictError(DomainError):
    code = "conflict"


class VisionUnavailableError(DomainError):
    """La visión artificial no está disponible (falta el extra `vision` o el modelo)."""

    code = "vision_unavailable"


class AuthenticationError(DomainError):
    """Credenciales o token inválidos."""

    code = "unauthorized"


class ForbiddenError(DomainError):
    code = "forbidden"
