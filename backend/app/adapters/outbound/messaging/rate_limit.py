"""Límite de peticiones por clave (p. ej. reportes ciudadanos por IP)."""

import time
from collections import defaultdict, deque

from redis.asyncio import Redis


class RedisRateLimiter:
    """Ventana fija compartida por todos los workers (INCR + EXPIRE)."""

    def __init__(self, redis: Redis) -> None:
        self._redis = redis

    async def allow(self, key: str, limit: int, window_s: int) -> bool:
        redis_key = f"rio:rate:{key}"
        try:
            # INCR y EXPIRE en una sola transacción: la ventana siempre caduca.
            async with self._redis.pipeline(transaction=True) as pipe:
                pipe.incr(redis_key)
                pipe.expire(redis_key, window_s, nx=True)
                count, _ = await pipe.execute()
        except Exception:
            return True  # sin Redis no se bloquea a la ciudadanía
        return count <= limit

    async def blocked(self, key: str, limit: int, window_s: int) -> bool:
        try:
            count = await self._redis.get(f"rio:rate:{key}")
        except Exception:
            return False
        return int(count or 0) >= limit

    async def record(self, key: str, window_s: int) -> None:
        redis_key = f"rio:rate:{key}"
        try:
            async with self._redis.pipeline(transaction=True) as pipe:
                pipe.incr(redis_key)
                pipe.expire(redis_key, window_s, nx=True)
                await pipe.execute()
        except Exception:
            pass


class MemoryRateLimiter:
    """Ventana deslizante en memoria (un solo worker; tests y modo sin Redis)."""

    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    async def allow(self, key: str, limit: int, window_s: int) -> bool:
        now = time.monotonic()
        hits = self._hits[key]
        while hits and now - hits[0] > window_s:
            hits.popleft()
        if len(hits) >= limit:
            return False
        hits.append(now)
        return True

    def _recent(self, key: str, window_s: int) -> deque[float]:
        now = time.monotonic()
        hits = self._hits[key]
        while hits and now - hits[0] > window_s:
            hits.popleft()
        return hits

    async def blocked(self, key: str, limit: int, window_s: int) -> bool:
        return len(self._recent(key, window_s)) >= limit

    async def record(self, key: str, window_s: int) -> None:
        self._recent(key, window_s).append(time.monotonic())

    def reset(self) -> None:
        self._hits.clear()
