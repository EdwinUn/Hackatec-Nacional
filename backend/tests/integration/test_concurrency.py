"""Ingestas concurrentes sobre los mismos sensores no deben bloquearse entre sí (deadlock)."""

import asyncio
from datetime import UTC, datetime, timedelta
from uuid import UUID

from app.application.commands import ReadingInput


async def test_concurrent_batches_in_opposite_order_do_not_deadlock(client, container, station):
    sensor_ids = []
    for location in ("inlet", "outlet", "river"):
        r = await client.post(
            "/api/v1/sensors", json={"station_id": station["id"], "type": "ph", "location": location}
        )
        sensor_ids.append(UUID(r.json()["id"]))

    base = datetime.now(UTC)
    for round_ in range(60):
        ts = base - timedelta(seconds=2 * round_)
        # Valores fuera de rango → ambos lotes tocan las mismas alertas y los mismos sensores.
        forward = [ReadingInput(sid, ts, 4.0) for sid in sensor_ids]
        backward = [ReadingInput(sid, ts - timedelta(seconds=1), 10.0) for sid in reversed(sensor_ids)]
        results = await asyncio.gather(
            container.ingestion.ingest_readings(forward),
            container.ingestion.ingest_readings(backward),
            return_exceptions=True,
        )
        errors = [r for r in results if isinstance(r, Exception)]
        assert not errors, f"ronda {round_}: {errors[0]!r}"
        assert [r.accepted for r in results] == [3, 3]
