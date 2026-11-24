"""Puente MQTT → caso de uso de telemetría.

Se suscribe a `MQTT_TOPIC` (default `riomonitor/+/telemetria`); el `+` es el código de la boya.
Con varios workers usa una suscripción compartida (`$share/<grupo>/...`): el broker entrega cada
mensaje a un solo worker, así no se ingiere dos veces.
"""

import asyncio
import logging
import ssl
import uuid
from dataclasses import dataclass
from urllib.parse import unquote, urlsplit

import aiomqtt
from pydantic import ValidationError

from app.adapters.inbound.telemetry_payload import TelemetryIn
from app.application.services.telemetry import TelemetryService
from app.domain.errors import DomainError

log = logging.getLogger(__name__)

MAX_BACKOFF_S = 30


@dataclass(frozen=True, slots=True)
class BrokerConfig:
    host: str
    port: int
    username: str | None
    password: str | None
    tls: bool

    @classmethod
    def from_url(cls, url: str) -> "BrokerConfig":
        """`mqtt://[user:pass@]host[:1883]` o `mqtts://…` (TLS, puerto 8883 por defecto)."""
        parts = urlsplit(url)
        if parts.scheme not in ("mqtt", "mqtts") or not parts.hostname:
            raise ValueError("MQTT_URL debe ser mqtt://host[:puerto] o mqtts://host[:puerto]")
        tls = parts.scheme == "mqtts"
        return cls(
            host=parts.hostname,
            port=parts.port or (8883 if tls else 1883),
            username=unquote(parts.username) if parts.username else None,
            password=unquote(parts.password) if parts.password else None,
            tls=tls,
        )


def code_from_topic(pattern: str, topic: str) -> str | None:
    """Segmento del tópico que corresponde al primer `+` del patrón."""
    wanted = pattern.split("/")
    if "+" not in wanted:
        return None
    segments = topic.split("/")
    index = wanted.index("+")
    return segments[index] if index < len(segments) else None


class MqttTelemetryBridge:
    def __init__(
        self, service: TelemetryService, url: str, topic: str, shared_group: str | None = None
    ) -> None:
        self._service = service
        self._broker = BrokerConfig.from_url(url)
        self._topic = topic
        self._subscription = f"$share/{shared_group}/{topic}" if shared_group else topic

    async def handle(self, topic: str, payload: bytes) -> None:
        """Procesa un mensaje. Un mensaje inválido se registra y se descarta (no tumba el puente)."""
        try:
            message = TelemetryIn.model_validate_json(payload)
            code = code_from_topic(self._topic, topic) or message.boya
            if not code:
                raise DomainError("No se sabe qué boya envía: el tópico no tiene `+` ni viene `boya`")
            message.check_code(code)
            result = await self._service.ingest(code, message.to_input())
        except ValidationError as exc:
            log.warning("mqtt telemetry invalid", extra={"topic": topic, "errors": exc.error_count()})
        except DomainError as exc:
            log.warning("mqtt telemetry rejected", extra={"topic": topic, "detail": str(exc)})
        except Exception:
            # BD caída u otro fallo: se pierde este mensaje, pero el puente sigue escuchando.
            log.exception("mqtt telemetry failed", extra={"topic": topic})
        else:
            log.debug(
                "mqtt telemetry ingested",
                extra={"topic": topic, "accepted": result.readings.accepted, "unmapped": result.unmapped},
            )

    async def run(self) -> None:
        """Conecta, se suscribe y procesa mensajes; si el broker se cae, reintenta con backoff."""
        b = self._broker
        backoff = 1
        while True:
            try:
                async with aiomqtt.Client(
                    b.host,
                    b.port,
                    username=b.username,
                    password=b.password,
                    identifier=f"rio-api-{uuid.uuid4().hex[:8]}",
                    tls_context=ssl.create_default_context() if b.tls else None,
                ) as client:
                    await client.subscribe(self._subscription, qos=1)
                    log.info("mqtt subscribed", extra={"host": b.host, "topic": self._subscription})
                    backoff = 1
                    async for message in client.messages:
                        await self.handle(message.topic.value, message.payload)  # type: ignore[arg-type]
            except aiomqtt.MqttError as exc:
                log.warning(
                    "mqtt disconnected", extra={"host": b.host, "error": str(exc), "retry_s": backoff}
                )
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, MAX_BACKOFF_S)
