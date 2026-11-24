"""Catálogo: estaciones (máquinas/boyas) y sensores."""

from dataclasses import replace
from typing import Any
from uuid import UUID

from app.application.events import sensor_status_event
from app.application.ports import EventPublisher, UnitOfWorkFactory
from app.domain.entities import Sensor, Station
from app.domain.enums import SensorLocation, SensorStatus, SensorType, StationStatus
from app.domain.errors import NotFoundError


class CatalogService:
    def __init__(self, uow_factory: UnitOfWorkFactory, publisher: EventPublisher) -> None:
        self._uow_factory = uow_factory
        self._publisher = publisher

    # ── Estaciones ──────────────────────────────
    async def create_station(self, data: dict[str, Any]) -> Station:
        station = Station(**data)
        async with self._uow_factory() as uow:
            await uow.stations.add(station)
            await uow.commit()
        return station

    async def get_station(self, station_id: UUID) -> Station:
        async with self._uow_factory() as uow:
            station = await uow.stations.get(station_id)
        if station is None:
            raise NotFoundError("Estación no encontrada")
        return station

    async def list_stations(
        self, *, status: StationStatus | None, river: str | None, limit: int, offset: int
    ) -> tuple[list[Station], int]:
        async with self._uow_factory() as uow:
            return await uow.stations.list(status=status, river=river, limit=limit, offset=offset)

    async def update_station(self, station_id: UUID, changes: dict[str, Any]) -> Station:
        async with self._uow_factory() as uow:
            current = await uow.stations.get(station_id)
            if current is None:
                raise NotFoundError("Estación no encontrada")
            station = replace(current, **changes)  # re-ejecuta las validaciones del dominio
            station.touch()
            await uow.stations.save(station)
            await uow.commit()
        return station

    # ── Sensores ────────────────────────────────
    async def create_sensor(self, data: dict[str, Any]) -> Sensor:
        sensor = Sensor(**data)
        async with self._uow_factory() as uow:
            if await uow.stations.get(sensor.station_id) is None:
                raise NotFoundError("Estación no encontrada")
            await uow.sensors.add(sensor)
            await uow.commit()
        return sensor

    async def get_sensor(self, sensor_id: UUID) -> Sensor:
        async with self._uow_factory() as uow:
            sensor = await uow.sensors.get(sensor_id)
        if sensor is None:
            raise NotFoundError("Sensor no encontrado")
        return sensor

    async def list_sensors(
        self,
        *,
        station_id: UUID | None,
        type: SensorType | None,
        location: SensorLocation | None,
        status: SensorStatus | None,
        limit: int,
        offset: int,
    ) -> tuple[list[Sensor], int]:
        async with self._uow_factory() as uow:
            return await uow.sensors.list(
                station_id=station_id, type=type, location=location, status=status, limit=limit, offset=offset
            )

    async def update_sensor(self, sensor_id: UUID, changes: dict[str, Any]) -> Sensor:
        async with self._uow_factory() as uow:
            current = await uow.sensors.get(sensor_id)
            if current is None:
                raise NotFoundError("Sensor no encontrado")
            sensor = replace(current, **changes)
            sensor.touch()
            await uow.sensors.save(sensor)
            await uow.commit()
        if sensor.status is not current.status:
            await self._publisher.publish([sensor_status_event(sensor, current.status.value)])
        return sensor
