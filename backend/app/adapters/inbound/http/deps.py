import secrets
from datetime import datetime, timedelta
from typing import Annotated

from fastapi import Depends, Header, HTTPException, Query, Request

from app.application.time_range import Bucket, TimeRange
from app.config.container import Container
from app.domain.errors import UnauthorizedError
from app.domain.operations import User


def get_container(request: Request) -> Container:
    return request.app.state.container


ContainerDep = Annotated[Container, Depends(get_container)]


def require_api_key(
    container: ContainerDep,
    x_api_key: Annotated[str | None, Header(description="Llave de ingesta (INGEST_API_KEY)")] = None,
) -> None:
    expected = container.settings.ingest_api_key.get_secret_value()
    if not x_api_key or not secrets.compare_digest(x_api_key, expected):
        raise HTTPException(401, "X-API-Key inválida o ausente")


def _bearer(authorization: str | None) -> str | None:
    if authorization and authorization[:7].lower() == "bearer ":
        return authorization[7:].strip() or None
    return None


AuthorizationHeader = Annotated[
    str | None, Header(description="`Bearer <token>` de una sesión del personal (POST /auth/login)")
]


async def current_user(container: ContainerDep, authorization: AuthorizationHeader = None) -> User:
    """Usuario del personal con sesión activa; 401 si falta, venció o fue desactivado."""
    token = _bearer(authorization)
    if token is None:
        raise UnauthorizedError("Inicia sesión para continuar")
    return await container.staff.authenticate(token)


CurrentUser = Annotated[User, Depends(current_user)]


async def require_key_or_staff(
    container: ContainerDep,
    x_api_key: Annotated[str | None, Header(description="Llave de ingesta (INGEST_API_KEY)")] = None,
    authorization: AuthorizationHeader = None,
) -> None:
    """Acepta la `X-API-Key` de ingesta **o** el Bearer de un usuario activo del personal."""
    expected = container.settings.ingest_api_key.get_secret_value()
    if x_api_key and secrets.compare_digest(x_api_key, expected):
        return
    token = _bearer(authorization)
    if token is None:
        raise HTTPException(401, "Se requiere X-API-Key o una sesión del personal")
    await container.staff.authenticate(token)


def time_range(
    container: ContainerDep,
    start: Annotated[
        datetime | None, Query(alias="from", description="ISO-8601 con zona. Default: to − 24 h")
    ] = None,
    end: Annotated[
        datetime | None, Query(alias="to", description="ISO-8601 con zona. Default: ahora")
    ] = None,
) -> TimeRange:
    return TimeRange.build(
        start,
        end,
        now=container.clock(),
        max_span=timedelta(days=container.settings.max_range_days),
    )


TimeRangeDep = Annotated[TimeRange, Depends(time_range)]
BucketQuery = Annotated[Bucket, Query(description="Tamaño de bucket para date_bin")]


class Pagination:
    def __init__(
        self,
        limit: Annotated[int, Query(ge=1, le=500)] = 50,
        offset: Annotated[int, Query(ge=0)] = 0,
    ) -> None:
        self.limit = limit
        self.offset = offset


PaginationDep = Annotated[Pagination, Depends()]
