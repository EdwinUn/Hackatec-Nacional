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


class InvalidTransitionError(ConflictError):
    code = "invalid_transition"


class UnauthorizedError(DomainError):
    """Falta la credencial, está vencida o no es válida."""

    code = "unauthorized"


class InvalidCredentialsError(UnauthorizedError):
    code = "invalid_credentials"


class ForbiddenError(DomainError):
    """La credencial es válida pero el rol no permite la acción."""

    code = "forbidden"


class InactiveAccountError(ForbiddenError):
    code = "inactive"


class RateLimitedError(DomainError):
    code = "rate_limited"


class VisionUnavailableError(DomainError):
    """La visión artificial no está disponible (falta el extra `vision` o el modelo)."""

    code = "vision_unavailable"
