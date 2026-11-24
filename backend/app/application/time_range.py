from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum

from app.domain.entities import ensure_utc
from app.domain.errors import InvalidDataError


class Bucket(StrEnum):
    M1 = "1m"
    M5 = "5m"
    H1 = "1h"
    D1 = "1d"

    @property
    def delta(self) -> timedelta:
        return {
            Bucket.M1: timedelta(minutes=1),
            Bucket.M5: timedelta(minutes=5),
            Bucket.H1: timedelta(hours=1),
            Bucket.D1: timedelta(days=1),
        }[self]


@dataclass(frozen=True, slots=True)
class TimeRange:
    start: datetime
    end: datetime

    @classmethod
    def build(
        cls,
        start: datetime | None,
        end: datetime | None,
        *,
        now: datetime,
        default_span: timedelta = timedelta(hours=24),
        max_span: timedelta = timedelta(days=90),
    ) -> "TimeRange":
        end = ensure_utc(end) if end else now
        start = ensure_utc(start) if start else end - default_span
        if start >= end:
            raise InvalidDataError("'from' debe ser anterior a 'to'")
        if end - start > max_span:
            raise InvalidDataError(f"El rango máximo es de {max_span.days} días")
        return cls(start, end)

    def check_buckets(self, bucket: Bucket, max_buckets: int) -> None:
        count = (self.end - self.start) / bucket.delta
        if count > max_buckets:
            raise InvalidDataError(
                f"El rango produce {int(count)} buckets de {bucket.value} (máximo {max_buckets}); "
                "usa un bucket más grande o un rango más corto"
            )
