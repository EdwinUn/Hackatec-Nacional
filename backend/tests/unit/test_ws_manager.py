import asyncio
from uuid import uuid4

from app.adapters.inbound.websocket.manager import ConnectionManager


class FakeWebSocket:
    def __init__(self, fail: bool = False) -> None:
        self.fail = fail
        self.sent: list[dict] = []
        self.closed_with: int | None = None

    async def send_json(self, data: dict) -> None:
        if self.fail:
            raise RuntimeError("socket roto")
        self.sent.append(data)

    async def close(self, code: int = 1000) -> None:
        self.closed_with = code


async def test_broadcast_filters_by_station():
    manager = ConnectionManager()
    station = uuid4()
    mine, other, everything = FakeWebSocket(), FakeWebSocket(), FakeWebSocket()
    manager.register(mine, station)
    manager.register(other, uuid4())
    manager.register(everything, None)

    await manager.broadcast({"type": "reading", "station_id": str(station)})

    assert len(mine.sent) == len(everything.sent) == 1
    assert other.sent == []


async def test_failed_client_is_unregistered_and_closed_so_it_reconnects():
    manager = ConnectionManager()
    healthy, broken = FakeWebSocket(), FakeWebSocket(fail=True)
    manager.register(healthy, None)
    manager.register(broken, None)

    await manager.broadcast({"type": "reading", "station_id": None})
    await asyncio.sleep(0)  # deja correr el cierre programado

    assert manager.count == 1
    assert broken.closed_with == 1011
    assert len(healthy.sent) == 1
