"""Destinos del simulador.

- ServiceSink: llama a los casos de uso en el mismo proceso (histórico rápido / SIMULATION_ENABLED).
- HttpSink: hace peticiones HTTP reales con X-API-Key (modo --live): ejercita validación, reglas
  de alerta, Redis y WebSocket de punta a punta, igual que lo haría un dispositivo IoT.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol
from uuid import UUID

import httpx

from app.adapters.outbound.simulation.generator import CyclePlan, ReadingSample, WastePlan
from app.application.commands import ReadingInput
from app.application.services.catalog import CatalogService
from app.application.services.ingestion import IngestionService
from app.application.services.operations import CyclePatch, OperationsService
from app.domain.enums import CycleStatus, SensorLocation, SensorType


@dataclass(frozen=True)
class SimSensor:
    id: UUID
    type: SensorType
    location: SensorLocation


@dataclass(frozen=True)
class SimStation:
    id: UUID
    name: str
    sensors: tuple[SimSensor, ...]


def _close_payload(plan: CyclePlan) -> dict[str, Any]:
    return {
        "status": (CycleStatus.FAILED if plan.failed else CycleStatus.COMPLETED).value,
        "ended_at": plan.ended_at,
        "failure_reason": "Vibración excesiva: posible desbalance del rotor" if plan.failed else None,
        "rpm_avg": plan.rpm_avg,
        "rpm_max": plan.rpm_max,
        "vibration_mm_s": plan.vibration_mm_s,
        "power_w": plan.power_w,
        "water_in_l": plan.water_in_l,
        "water_out_clean_l": plan.water_out_clean_l,
        "sludge_kg": plan.sludge_kg,
    }


def _batch_payload(station_id: UUID, cycle_id: UUID, plan: CyclePlan) -> dict[str, Any]:
    return {
        "station_id": station_id,
        "cycle_id": cycle_id,
        "ts": plan.ended_at,
        "volume_in_l": plan.water_in_l,
        "volume_clean_l": plan.water_out_clean_l,
        "sludge_kg": plan.sludge_kg,
        "ph_in": plan.ph_in,
        "ph_out": plan.ph_out,
        "turbidity_in_ntu": plan.turbidity_in,
        "turbidity_out_ntu": plan.turbidity_out,
    }


class SimulationSink(Protocol):
    async def topology(self) -> list[SimStation]: ...
    async def ingest(self, readings: Sequence[tuple[UUID, ReadingSample]]) -> None: ...
    async def start_cycle(self, station_id: UUID, started_at: datetime, rpm_avg: float) -> UUID: ...
    async def update_cycle(self, cycle_id: UUID, measures: dict[str, float]) -> None: ...
    async def close_cycle(self, cycle_id: UUID, plan: CyclePlan) -> None: ...
    async def batch(self, station_id: UUID, cycle_id: UUID, plan: CyclePlan) -> None: ...
    async def waste(self, station_id: UUID, plan: WastePlan) -> None: ...


class ServiceSink:
    def __init__(
        self, catalog: CatalogService, ingestion: IngestionService, operations: OperationsService
    ) -> None:
        self.catalog, self.ingestion, self.operations = catalog, ingestion, operations

    async def topology(self) -> list[SimStation]:
        stations, _ = await self.catalog.list_stations(status=None, river=None, limit=500, offset=0)
        result = []
        for st in stations:
            if st.code:  # la alimenta un dispositivo (boya real o Wokwi): no se simula
                continue
            sensors, _ = await self.catalog.list_sensors(
                station_id=st.id, type=None, location=None, status=None, limit=500, offset=0
            )
            result.append(
                SimStation(st.id, st.name, tuple(SimSensor(s.id, s.type, s.location) for s in sensors))
            )
        return result

    async def ingest(self, readings: Sequence[tuple[UUID, ReadingSample]]) -> None:
        await self.ingestion.ingest_readings(
            [ReadingInput(sid, r.ts, r.value, r.quality) for sid, r in readings]
        )

    async def start_cycle(self, station_id: UUID, started_at: datetime, rpm_avg: float) -> UUID:
        cycle = await self.operations.start_cycle(station_id, started_at, {"rpm_avg": rpm_avg})
        return cycle.id

    async def update_cycle(self, cycle_id: UUID, measures: dict[str, float]) -> None:
        await self.operations.update_cycle(cycle_id, CyclePatch(measures=measures))

    async def close_cycle(self, cycle_id: UUID, plan: CyclePlan) -> None:
        data = _close_payload(plan)
        await self.operations.update_cycle(
            cycle_id,
            CyclePatch(
                status=CycleStatus(data.pop("status")),
                ended_at=data.pop("ended_at"),
                failure_reason=data.pop("failure_reason"),
                measures=data,
            ),
        )

    async def batch(self, station_id: UUID, cycle_id: UUID, plan: CyclePlan) -> None:
        await self.operations.record_batch(_batch_payload(station_id, cycle_id, plan))

    async def waste(self, station_id: UUID, plan: WastePlan) -> None:
        await self.operations.record_waste(
            {
                "station_id": station_id,
                "ts": plan.ts,
                "weight_kg": plan.weight_kg,
                "items_count": plan.items_count,
                "waste_type": plan.waste_type,
                "collector_id": "banda-recolectora-1",
            }
        )


def _json(data: dict[str, Any]) -> dict[str, Any]:
    return {
        k: (v.isoformat() if isinstance(v, datetime) else str(v) if isinstance(v, UUID) else v)
        for k, v in data.items()
        if v is not None
    }


class HttpSink:
    def __init__(self, base_url: str, api_key: str, timeout: float = 10) -> None:
        self.client = httpx.AsyncClient(
            base_url=base_url.rstrip("/") + "/api/v1", headers={"X-API-Key": api_key}, timeout=timeout
        )

    async def _send(self, method: str, url: str, **kwargs: Any) -> dict[str, Any]:
        response = await self.client.request(method, url, **kwargs)
        if response.is_error:
            raise RuntimeError(f"{method} {url} → {response.status_code}: {response.text}")
        return response.json()

    async def topology(self) -> list[SimStation]:
        stations = (await self._send("GET", "/stations", params={"limit": 500}))["items"]
        sensors = (await self._send("GET", "/sensors", params={"limit": 500}))["items"]
        return [
            SimStation(
                UUID(st["id"]),
                st["name"],
                tuple(
                    SimSensor(UUID(s["id"]), SensorType(s["type"]), SensorLocation(s["location"]))
                    for s in sensors
                    if s["station_id"] == st["id"]
                ),
            )
            for st in stations
            if not st.get("code")  # la alimenta un dispositivo (boya real o Wokwi): no se simula
        ]

    async def ingest(self, readings: Sequence[tuple[UUID, ReadingSample]]) -> None:
        body = {
            "readings": [
                {"sensor_id": str(sid), "ts": r.ts.isoformat(), "value": r.value, "quality": r.quality}
                for sid, r in readings
            ]
        }
        await self._send("POST", "/readings", json=body)

    async def start_cycle(self, station_id: UUID, started_at: datetime, rpm_avg: float) -> UUID:
        body = _json({"station_id": station_id, "started_at": started_at, "rpm_avg": rpm_avg})
        return UUID((await self._send("POST", "/centrifuge-cycles", json=body))["id"])

    async def update_cycle(self, cycle_id: UUID, measures: dict[str, float]) -> None:
        await self._send("PATCH", f"/centrifuge-cycles/{cycle_id}", json=measures)

    async def close_cycle(self, cycle_id: UUID, plan: CyclePlan) -> None:
        await self._send("PATCH", f"/centrifuge-cycles/{cycle_id}", json=_json(_close_payload(plan)))

    async def batch(self, station_id: UUID, cycle_id: UUID, plan: CyclePlan) -> None:
        await self._send("POST", "/treatment-batches", json=_json(_batch_payload(station_id, cycle_id, plan)))

    async def waste(self, station_id: UUID, plan: WastePlan) -> None:
        await self._send(
            "POST",
            "/waste-collections",
            json=_json(
                {
                    "station_id": station_id,
                    "ts": plan.ts,
                    "weight_kg": plan.weight_kg,
                    "items_count": plan.items_count,
                    "waste_type": plan.waste_type.value,
                    "collector_id": "banda-recolectora-1",
                }
            ),
        )

    async def aclose(self) -> None:
        await self.client.aclose()
