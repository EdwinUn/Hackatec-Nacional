"""Orquesta el generador contra un sink: histórico (backfill) o en vivo (tick periódico)."""

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from uuid import UUID

from app.adapters.outbound.simulation.generator import (
    CYCLE_EVERY,
    CYCLE_LENGTH,
    WASTE_EVERY,
    CyclePlan,
    ReadingSample,
    RiverSimulator,
)
from app.adapters.outbound.simulation.sinks import SimStation, SimulationSink

log = logging.getLogger(__name__)


def _slots(start: datetime, end: datetime, every: timedelta):
    t = RiverSimulator.slot_start(start, every)
    if t < start:
        t += every
    while t < end:
        yield t
        t += every


async def backfill(
    sim: RiverSimulator,
    sink: SimulationSink,
    start: datetime,
    end: datetime,
    step: timedelta = timedelta(minutes=1),
    batch_size: int = 1000,
) -> dict[str, int]:
    stations = await sink.topology()
    stats = {"readings": 0, "cycles": 0, "batches": 0, "waste": 0}
    buffer: list[tuple[UUID, ReadingSample]] = []
    t = start
    while t < end:
        for st in stations:
            for sensor in st.sensors:
                sample = sim.value(st.name, sensor.type, sensor.location, t)
                if sample:
                    buffer.append((sensor.id, sample))
        if len(buffer) >= batch_size:
            await sink.ingest(buffer)
            stats["readings"] += len(buffer)
            buffer = []
        t += step
    if buffer:
        await sink.ingest(buffer)
        stats["readings"] += len(buffer)

    for st in stations:
        for slot in _slots(start, end - CYCLE_LENGTH, CYCLE_EVERY):
            plan = sim.cycle(st.name, slot)
            cycle_id = await sink.start_cycle(st.id, plan.started_at, plan.rpm_avg)
            await sink.close_cycle(cycle_id, plan)
            stats["cycles"] += 1
            if not plan.failed:
                await sink.batch(st.id, cycle_id, plan)
                stats["batches"] += 1
        for slot in _slots(start, end, WASTE_EVERY):
            await sink.waste(st.id, sim.waste(st.name, slot))
            stats["waste"] += 1
    return stats


@dataclass
class _StationState:
    cycle_id: UUID | None = None
    plan: CyclePlan | None = None
    done_slots: set[datetime] = field(default_factory=set)
    last_waste_slot: datetime | None = None


class LiveRunner:
    """Cada `tick(now)` emite una lectura por sensor y avanza la máquina de estados de cada estación."""

    def __init__(self, sim: RiverSimulator, sink: SimulationSink) -> None:
        self.sim = sim
        self.sink = sink
        self.stations: list[SimStation] = []
        self.state: dict[UUID, _StationState] = {}

    async def refresh_topology(self) -> None:
        self.stations = await self.sink.topology()
        for st in self.stations:
            self.state.setdefault(st.id, _StationState())

    async def tick(self, now: datetime) -> None:
        if not self.stations:
            await self.refresh_topology()
        readings = [
            (sensor.id, sample)
            for st in self.stations
            for sensor in st.sensors
            if (sample := self.sim.value(st.name, sensor.type, sensor.location, now))
        ]
        if readings:
            await self.sink.ingest(readings)
        for st in self.stations:
            await self._machine(st, now)

    async def _machine(self, st: SimStation, now: datetime) -> None:
        state = self.state[st.id]
        slot = RiverSimulator.slot_start(now, CYCLE_EVERY)
        if state.cycle_id is None and slot not in state.done_slots and now < slot + CYCLE_LENGTH:
            # El ciclo en vivo arranca "ahora" para que el dashboard lo vea completo.
            plan = self.sim.cycle(st.name, slot)
            length = plan.ended_at - plan.started_at
            state.plan = CyclePlan(**{**plan.__dict__, "started_at": now, "ended_at": now + length})
            state.cycle_id = await self.sink.start_cycle(st.id, now, plan.rpm_avg)
            state.done_slots.add(slot)
        elif state.cycle_id and state.plan:
            if now >= state.plan.ended_at:
                await self.sink.close_cycle(state.cycle_id, state.plan)
                if not state.plan.failed:
                    await self.sink.batch(st.id, state.cycle_id, state.plan)
                state.cycle_id, state.plan = None, None
            else:
                rng = self.sim._rng("live", st.id, int(now.timestamp()))
                await self.sink.update_cycle(
                    state.cycle_id,
                    {
                        "rpm_avg": round(state.plan.rpm_avg + rng.gauss(0, 25), 1),
                        "vibration_mm_s": round(max(state.plan.vibration_mm_s + rng.gauss(0, 0.2), 0), 2),
                        "power_w": round(state.plan.power_w + rng.gauss(0, 15), 1),
                    },
                )
        waste_slot = RiverSimulator.slot_start(now, WASTE_EVERY)
        if state.last_waste_slot is None:
            state.last_waste_slot = waste_slot  # no duplicar al arrancar a mitad de slot
        elif waste_slot != state.last_waste_slot:
            state.last_waste_slot = waste_slot
            await self.sink.waste(st.id, self.sim.waste(st.name, now))
