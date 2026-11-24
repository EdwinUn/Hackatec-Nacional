import asyncio
import contextlib
import json
import secrets
from uuid import UUID

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from app.application.events import EventType
from app.domain.entities import utcnow

router = APIRouter()


def _server_msg(type_: str, **data) -> dict:
    return {"type": type_, "station_id": None, "ts": utcnow().isoformat(), "data": data}


@router.websocket("/ws/live")
async def live(
    ws: WebSocket,
    station_id: UUID | None = Query(default=None),
    api_key: str | None = Query(default=None),
) -> None:
    """Eventos en tiempo real. Ver API.md → «WebSocket /ws/live»."""
    container = ws.app.state.container
    settings = container.settings
    if not settings.is_dev:
        expected = settings.ingest_api_key.get_secret_value()
        if not api_key or not secrets.compare_digest(api_key, expected):
            await ws.close(code=1008, reason="api_key inválida")
            return

    manager = container.ws_manager
    await ws.accept()
    await ws.send_json(
        _server_msg(
            "hello",
            station_id=str(station_id) if station_id else None,
            ping_interval_s=settings.ws_ping_interval_s,
            events=[e.value for e in EventType],
        )
    )
    manager.register(ws, station_id)

    async def pinger() -> None:
        while True:
            await asyncio.sleep(settings.ws_ping_interval_s)
            await ws.send_json(_server_msg("ping"))

    ping_task = asyncio.create_task(pinger())
    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                msg = {"type": raw.strip()}
            kind = msg.get("type") if isinstance(msg, dict) else None
            if kind == "ping":
                await ws.send_json(_server_msg("pong"))
            elif kind == "subscribe":
                try:
                    new = UUID(msg["station_id"]) if msg.get("station_id") else None
                except (ValueError, TypeError):
                    await ws.send_json(_server_msg("error", message="station_id inválido"))
                    continue
                manager.register(ws, new)
                await ws.send_json(_server_msg("subscribed", station_id=str(new) if new else None))
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        ping_task.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await ping_task
        manager.unregister(ws)
