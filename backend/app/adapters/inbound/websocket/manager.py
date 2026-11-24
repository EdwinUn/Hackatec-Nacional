"""Gestor de conexiones WebSocket de este worker.

Flujo: caso de uso → broker (Redis) → `forward_events` (una tarea por worker, en el lifespan)
→ `broadcast` a los clientes locales que coinciden con el filtro de estación.
"""

import asyncio
import contextlib
import logging
from typing import Any
from uuid import UUID

from fastapi import WebSocket

from app.application.ports import EventSubscriber

log = logging.getLogger(__name__)

SEND_TIMEOUT_S = 5


class ConnectionManager:
    def __init__(self) -> None:
        self._clients: dict[WebSocket, UUID | None] = {}
        self._closing: set[asyncio.Task] = set()

    @property
    def count(self) -> int:
        return len(self._clients)

    def register(self, ws: WebSocket, station_id: UUID | None) -> None:
        self._clients[ws] = station_id

    def unregister(self, ws: WebSocket) -> None:
        self._clients.pop(ws, None)

    async def broadcast(self, event: dict[str, Any]) -> None:
        station = event.get("station_id")
        targets = [
            ws
            for ws, wanted in list(self._clients.items())
            if wanted is None or station is None or str(wanted) == station
        ]
        if not targets:
            return
        results = await asyncio.gather(
            *(asyncio.wait_for(ws.send_json(event), SEND_TIMEOUT_S) for ws in targets),
            return_exceptions=True,
        )
        for ws, result in zip(targets, results, strict=True):
            if isinstance(result, Exception):
                # Cliente lento o roto: cerrar (no solo olvidarlo) para que su lógica de
                # reconexión se active; si no, seguiría recibiendo pings pero ningún evento.
                self.unregister(ws)
                task = asyncio.create_task(self._close(ws, 1011))
                self._closing.add(task)
                task.add_done_callback(self._closing.discard)

    @staticmethod
    async def _close(ws: WebSocket, code: int) -> None:
        with contextlib.suppress(Exception):
            await ws.close(code=code)

    async def close_all(self) -> None:
        for ws in list(self._clients):
            with contextlib.suppress(Exception):
                await ws.close(code=1001)
        self._clients.clear()


async def forward_events(subscriber: EventSubscriber, manager: ConnectionManager) -> None:
    """Corre en el lifespan; se cancela al apagar el servidor."""
    async for event in subscriber.listen():
        try:
            await manager.broadcast(event)
        except Exception:
            log.exception("broadcast failed")
