"""Brokers de eventos. Implementan EventPublisher + EventSubscriber.

- RedisBroker: pub/sub de Redis; funciona con varios workers de uvicorn (cada worker se
  suscribe y reenvía a sus propios clientes WebSocket).
- InMemoryBroker: un solo proceso. Para tests y para correr sin Redis (REDIS_URL vacío).
"""

import asyncio
import json
import logging
from collections.abc import AsyncIterator, Sequence
from typing import Any

from redis.asyncio import Redis

from app.application.events import Event

log = logging.getLogger(__name__)

CHANNEL = "rio:events"


# Renueva el lock solo si sigue siendo nuestro (comparar y expirar de forma atómica).
_RENEW_LOCK = """
if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('expire', KEYS[1], ARGV[2]) end
return 0
"""


class RedisBroker:
    def __init__(self, url: str, channel: str = CHANNEL) -> None:
        # Publicar va en el camino de la respuesta HTTP: timeouts cortos para no colgarla.
        self.redis = Redis.from_url(url, decode_responses=True, socket_connect_timeout=2, socket_timeout=2)
        # El suscriptor bloquea esperando mensajes: sin socket_timeout, pero con health check
        # para detectar conexiones medio-abiertas.
        self._sub_redis = Redis.from_url(
            url,
            decode_responses=True,
            socket_connect_timeout=2,
            health_check_interval=30,
            socket_keepalive=True,
        )
        self.channel = channel

    async def acquire_or_renew(self, key: str, token: str, ttl_s: int) -> bool:
        if await self.redis.set(key, token, nx=True, ex=ttl_s):
            return True
        return bool(await self.redis.eval(_RENEW_LOCK, 1, key, token, ttl_s))

    async def publish(self, events: Sequence[Event]) -> None:
        if not events:
            return
        try:
            async with self.redis.pipeline(transaction=False) as pipe:
                for event in events:
                    pipe.publish(self.channel, json.dumps(event.to_dict(), default=str))
                await pipe.execute()
        except Exception:
            # El tiempo real es best-effort: un Redis caído no debe tumbar la ingesta.
            log.exception("redis publish failed", extra={"events": len(events)})

    async def listen(self) -> AsyncIterator[dict[str, Any]]:
        backoff = 1.0
        while True:
            pubsub = self._sub_redis.pubsub(ignore_subscribe_messages=True)
            try:
                await pubsub.subscribe(self.channel)
                backoff = 1.0
                async for message in pubsub.listen():
                    if message and message.get("type") == "message":
                        yield json.loads(message["data"])
            except asyncio.CancelledError:
                raise
            except Exception:
                log.warning(
                    "redis subscriber disconnected; retrying", exc_info=True, extra={"retry_in_s": backoff}
                )
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30)
            finally:
                await pubsub.aclose()

    async def ping(self) -> None:
        await self.redis.ping()

    async def close(self) -> None:
        await self.redis.aclose()
        await self._sub_redis.aclose()


class InMemoryBroker:
    def __init__(self) -> None:
        self._queues: set[asyncio.Queue[dict[str, Any]]] = set()
        self.published: list[Event] = []  # útil para tests

    async def publish(self, events: Sequence[Event]) -> None:
        self.published.extend(events)
        for event in events:
            payload = json.loads(json.dumps(event.to_dict(), default=str))
            for queue in self._queues:
                queue.put_nowait(payload)

    async def listen(self) -> AsyncIterator[dict[str, Any]]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._queues.add(queue)
        try:
            while True:
                yield await queue.get()
        finally:
            self._queues.discard(queue)

    async def ping(self) -> None:
        return None

    async def close(self) -> None:
        return None
