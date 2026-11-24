import secrets
from datetime import datetime, timedelta
from typing import Annotated

from fastapi import Depends, Header, HTTPException, Query, Request

from app.application.time_range import Bucket, TimeRange
from app.config.container import Container


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
