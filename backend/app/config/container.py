"""Composition root: el único lugar donde se conectan adaptadores con casos de uso."""

import asyncio
import contextlib
import logging
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import timedelta

from app.adapters.inbound.mqtt.bridge import MqttTelemetryBridge
from app.adapters.inbound.websocket.manager import ConnectionManager, forward_events
from app.adapters.outbound.media.storage import LocalMediaStorage
from app.adapters.outbound.messaging.brokers import InMemoryBroker, RedisBroker
from app.adapters.outbound.messaging.rate_limit import MemoryRateLimiter, RedisRateLimiter
from app.adapters.outbound.persistence.analytics import SqlAnalyticsReader
from app.adapters.outbound.persistence.database import make_engine, make_session_factory, ping
from app.adapters.outbound.persistence.uow import SqlUnitOfWork
from app.adapters.outbound.security.passwords import Argon2PasswordHasher
from app.adapters.outbound.security.tokens import JwtTokenService
from app.adapters.outbound.simulation.generator import RiverSimulator
from app.adapters.outbound.simulation.runner import LiveRunner
from app.adapters.outbound.simulation.sinks import ServiceSink
from app.adapters.outbound.vision.clip_scene import ClipSceneClassifier
from app.adapters.outbound.vision.engine import OpenCvYoloEngine
from app.adapters.outbound.vision.yolo_world import YoloWorldDetector
from app.application.ports import Clock
from app.application.services.alerts import AlertService
from app.application.services.analytics import AnalyticsService
from app.application.services.catalog import CatalogService
from app.application.services.citizen_reports import CitizenReportService, ReportPolicy
from app.application.services.field_ops import FieldOpsService
from app.application.services.ingestion import IngestionService
from app.application.services.monitoring import MonitoringService
from app.application.services.operations import OperationsService
from app.application.services.staff import LoginPolicy, StaffService
from app.application.services.telemetry import TelemetryService
from app.application.services.vision import VisionService
from app.application.services.work_orders import WorkOrderService
from app.config.settings import Settings
from app.domain.entities import utcnow
from app.domain.sensor_health import SensorHealthPolicy
from app.domain.vision import DEFAULT_POLICY

log = logging.getLogger(__name__)

VERSION = "0.1.0"


@dataclass
class Container:
    settings: Settings
    clock: Clock = utcnow
    broker: RedisBroker | InMemoryBroker | None = None
    version: str = VERSION
    ws_manager: ConnectionManager = field(default_factory=ConnectionManager)
    _tasks: list[asyncio.Task] = field(default_factory=list)

    def __post_init__(self) -> None:
        s = self.settings
        self.engine = make_engine(s.database_url, s.db_echo)
        self.session_factory = make_session_factory(self.engine)
        if self.broker is None:
            self.broker = RedisBroker(s.redis_url) if s.redis_url else InMemoryBroker()

        def uow_factory() -> SqlUnitOfWork:
            return SqlUnitOfWork(self.session_factory, timedelta(minutes=s.alert_renotify_after_min))

        policy = SensorHealthPolicy(
            offline_after=timedelta(minutes=s.sensor_offline_after_min),
            min_quality=s.sensor_degraded_quality,
            stuck_window=s.sensor_stuck_window,
        )
        self.uow_factory = uow_factory
        self.ingestion = IngestionService(uow_factory, self.broker, self.clock, policy)
        self.telemetry = TelemetryService(uow_factory, self.ingestion, self.broker, self.clock)
        self.operations = OperationsService(uow_factory, self.broker, self.clock)
        self.catalog = CatalogService(uow_factory, self.broker)
        self.alerts = AlertService(uow_factory, self.broker)
        self.monitoring = MonitoringService(uow_factory, self.broker, self.clock, policy)
        self.analytics = AnalyticsService(SqlAnalyticsReader(self.session_factory))

        # Operaciones: personal, reportes ciudadanos y órdenes de trabajo.
        self.media = LocalMediaStorage(s.media_dir)
        self.rate_limiter = (
            RedisRateLimiter(self.broker.redis)
            if isinstance(self.broker, RedisBroker)
            else MemoryRateLimiter()
        )
        self.staff = StaffService(
            uow_factory,
            Argon2PasswordHasher(),
            JwtTokenService(s.jwt_secret.get_secret_value(), timedelta(minutes=s.jwt_expires_min)),
            self.rate_limiter,
            LoginPolicy(attempts=s.login_rate_limit, window_s=s.login_rate_window_min * 60),
        )
        self.citizen_reports = CitizenReportService(
            uow_factory,
            self.broker,
            self.media,
            self.rate_limiter,
            self.clock,
            ReportPolicy(
                max_photo_kb=s.max_photo_kb,
                rate_limit=s.report_rate_limit,
                rate_window_s=s.report_rate_window_min * 60,
                station_radius_km=s.report_station_radius_km,
            ),
        )
        self.work_orders = WorkOrderService(uow_factory, self.broker, self.media, self.clock, s.max_photo_kb)
        # Bandeja del operador (tareas rápidas) y bitácora de boyas skimmer.
        self.field_ops = FieldOpsService(uow_factory, self.broker, self.clock)

        # Visión artificial: el modelo se carga en la primera foto (o al arrancar con VISION_PRELOAD).
        self.vision: VisionService | None = None
        self._vision_engine: OpenCvYoloEngine | None = None
        if s.vision_enabled:
            detector = YoloWorldDetector(s.vision_model, s.vision_models_dir, s.vision_conf, s.vision_imgsz)
            scene = ClipSceneClassifier() if s.vision_scene_enabled else None
            self._vision_engine = OpenCvYoloEngine(detector, DEFAULT_POLICY.min_confidence, scene)
            self.vision = VisionService(
                self._vision_engine,
                model_name=s.vision_model.removesuffix(".pt"),
                max_bytes=s.vision_max_image_mb * 1024 * 1024,
            )

    # ── Salud ───────────────────────────────────
    async def check_health(self) -> dict[str, str]:
        result = {}
        try:
            await asyncio.wait_for(ping(self.engine), 3)
            result["postgres"] = "ok"
        except Exception as exc:
            result["postgres"] = f"error: {type(exc).__name__}"
        if isinstance(self.broker, InMemoryBroker):
            result["redis"] = "disabled"
        else:
            try:
                await asyncio.wait_for(self.broker.ping(), 3)  # type: ignore[union-attr]
                result["redis"] = "ok"
            except Exception as exc:
                result["redis"] = f"error: {type(exc).__name__}"
        return result

    # ── Tareas de fondo (lifespan) ──────────────
    def _spawn(self, name: str, coro: Awaitable[None]) -> None:
        self._tasks.append(asyncio.create_task(coro, name=name))  # type: ignore[arg-type]

    async def _every(
        self,
        interval_s: float,
        fn: Callable[[], Awaitable[object]],
        name: str,
        leader_key: str | None = None,
        run_if_lock_unavailable: bool = False,
    ) -> None:
        token = uuid.uuid4().hex
        lock_down = False
        while True:
            try:
                leader = True
                if leader_key is not None:
                    try:
                        leader = await self._is_leader(leader_key, token, interval_s)
                        lock_down = False
                    except Exception:
                        # Redis caído: un aviso (no uno por ciclo). Las tareas idempotentes siguen.
                        if not lock_down:
                            log.warning("leader lock unavailable", extra={"task": name})
                        lock_down = True
                        leader = run_if_lock_unavailable
                if leader:
                    await fn()
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("background task failed", extra={"task": name})
            await asyncio.sleep(interval_s)

    async def _is_leader(self, key: str, token: str, interval_s: float) -> bool:
        """Con varios workers solo uno ejecuta la tarea (lock en Redis con TTL)."""
        if not isinstance(self.broker, RedisBroker):
            return True
        ttl = max(int(interval_s * 3), 5)
        return bool(await self.broker.acquire_or_renew(key, token, ttl))

    async def start(self) -> None:
        s = self.settings
        if s.vision_preload and self._vision_engine is not None:
            try:
                await asyncio.to_thread(self._vision_engine.preload)
            except Exception:
                log.exception("vision preload failed; se reintentará con la primera foto")
        self._spawn("ws-forwarder", forward_events(self.broker, self.ws_manager))  # type: ignore[arg-type]
        self._spawn(
            "health-sweep",
            # El barrido es idempotente (anti-spam en la BD): si Redis cae, corre igual.
            self._every(
                s.health_sweep_interval_s,
                self.monitoring.sweep,
                "health-sweep",
                "rio:lock:sweep",
                run_if_lock_unavailable=True,
            ),
        )
        if mqtt_url := s.mqtt_url.get_secret_value():
            bridge = MqttTelemetryBridge(self.telemetry, mqtt_url, s.mqtt_topic, s.mqtt_shared_group or None)
            self._spawn("mqtt-bridge", bridge.run())
        if s.simulation_enabled:
            sim = RiverSimulator(anchor=self.clock(), seed=s.simulation_seed or 42)
            runner = LiveRunner(sim, ServiceSink(self.catalog, self.ingestion, self.operations))
            log.info("simulation enabled", extra={"interval_s": s.simulation_interval_s})
            self._spawn(
                "simulator",
                self._every(
                    s.simulation_interval_s,
                    lambda: runner.tick(self.clock()),
                    "simulator",
                    "rio:lock:simulator",
                ),
            )

    async def stop(self) -> None:
        for task in self._tasks:
            task.cancel()
        for task in self._tasks:
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task
        self._tasks.clear()
        await self.ws_manager.close_all()
        await self.broker.close()  # type: ignore[union-attr]
        await self.engine.dispose()
