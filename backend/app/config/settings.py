from functools import lru_cache

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_INGEST_KEY = "dev-ingest-key"
DEFAULT_JWT_SECRET = "dev-jwt-secret-solo-para-desarrollo-local"  # ≥ 32 bytes (HS256)
DEV_ENVIRONMENTS = frozenset({"dev", "development", "local", "test"})


class Settings(BaseSettings):
    """Configuración leída de variables de entorno o de backend/.env (plantilla en ../.env.example)."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Río Monitor API"
    environment: str = "development"
    log_level: str = "INFO"
    log_json: bool = True

    database_url: str = "postgresql+asyncpg://hackatec:hackatec@localhost:5432/hackatec"
    db_echo: bool = False
    # Vacío = broker en memoria (un solo worker, útil sin Redis).
    redis_url: str = "redis://localhost:6379/0"

    cors_origins: str = "http://localhost:4200"
    ingest_api_key: SecretStr = SecretStr(DEFAULT_INGEST_KEY)
    # Llave opcional de los nodos IoT (header X-Device-Key de POST /telemetry/iot).
    device_key: SecretStr | None = None
    # Sesiones del personal (login): JWT HS256.
    jwt_secret: SecretStr = SecretStr(DEFAULT_JWT_SECRET)
    jwt_expires_min: int = Field(default=720, ge=1)
    login_rate_limit: int = Field(default=10, ge=1)  # intentos por IP y por correo
    login_rate_window_min: int = Field(default=10, ge=1)
    max_body_kb: int = Field(default=2048, ge=64)  # tope del cuerpo de cualquier petición

    # Reportes ciudadanos y fotos (valores de prototipo).
    media_dir: str = "media"
    max_photo_kb: int = Field(default=300, ge=10)
    report_rate_limit: int = Field(default=5, ge=1)
    report_rate_window_min: int = Field(default=10, ge=1)
    report_station_radius_km: float = Field(default=8, gt=0)

    # Salud de sensores (valores de prototipo, ver README).
    sensor_offline_after_min: int = Field(default=10, ge=1)
    sensor_degraded_quality: float = Field(default=0.6, ge=0, le=1)
    sensor_stuck_window: int = Field(default=10, ge=3)
    health_sweep_interval_s: float = Field(default=60, gt=0)

    # Una alerta activa que se vuelve a disparar se re-emite por WS tras estos minutos.
    alert_renotify_after_min: float = Field(default=15, gt=0)

    ws_ping_interval_s: float = Field(default=20, gt=0)

    # Telemetría de las boyas por MQTT. Vacío = puente apagado (sigue la ingesta HTTP).
    mqtt_url: SecretStr = SecretStr("")  # mqtt://[user:pass@]host[:1883] o mqtts://…
    mqtt_topic: str = "riomonitor/+/telemetria"  # el `+` es el código de la boya
    # Suscripción compartida ($share/<grupo>/…): con varios workers cada mensaje se ingiere una vez.
    # Vacío (default) = suscripción normal, para un solo worker. En un broker público no uses un grupo
    # que otro backend del equipo también use: el broker repartiría los mensajes entre los dos.
    mqtt_shared_group: str = ""

    # Visión artificial de los reportes ciudadanos (requiere `uv sync --extra vision`).
    vision_enabled: bool = True
    vision_model: str = "yolov8s-worldv2.pt"
    vision_models_dir: str = "models"
    vision_conf: float = Field(default=0.15, gt=0, le=1)  # umbral del detector; el dominio filtra de nuevo
    vision_imgsz: int = Field(default=640, ge=160, le=1280)
    # Tope de la foto. La petición completa también pasa por MAX_BODY_KB: súbelo si subes este.
    vision_max_image_mb: int = Field(default=2, ge=1, le=50)
    vision_scene_enabled: bool = True  # clasificador de escena CLIP (complementa al detector)
    vision_preload: bool = False  # cargar el modelo al arrancar en vez de en la primera foto

    simulation_enabled: bool = False
    simulation_interval_s: float = Field(default=5, gt=0)
    simulation_seed: int | None = None

    max_readings_per_request: int = Field(default=1000, ge=1)
    max_range_days: int = Field(default=90, ge=1)
    max_buckets: int = Field(default=5000, ge=10)

    @property
    def is_dev(self) -> bool:
        return self.environment.lower() in DEV_ENVIRONMENTS

    @model_validator(mode="after")
    def _no_default_key_outside_dev(self) -> "Settings":
        if not self.is_dev:
            for name, value, default in (
                ("INGEST_API_KEY", self.ingest_api_key, DEFAULT_INGEST_KEY),
                ("JWT_SECRET", self.jwt_secret, DEFAULT_JWT_SECRET),
            ):
                if value.get_secret_value() == default:
                    raise ValueError(
                        f"{name} sigue con el valor por defecto y ENVIRONMENT={self.environment}: "
                        "define uno propio (o usa ENVIRONMENT=dev)"
                    )
            if len(self.jwt_secret.get_secret_value().encode()) < 32:
                raise ValueError("JWT_SECRET debe tener al menos 32 bytes (HS256)")
        return self

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
