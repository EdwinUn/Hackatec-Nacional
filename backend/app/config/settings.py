from functools import lru_cache

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_INGEST_KEY = "dev-ingest-key"
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

    # Sesión del personal (JWT HS256). En producción define JWT_SECRET propio.
    jwt_secret: SecretStr = SecretStr("dev-jwt-secret-change-me")
    jwt_expire_min: int = Field(default=720, ge=1)
    # Crea las cuentas demo (operador@atlmonitor.mx, …) al arrancar. Solo en dev por defecto.
    demo_users_enabled: bool | None = None

    # Salud de sensores (valores de prototipo, ver README).
    sensor_offline_after_min: int = Field(default=10, ge=1)
    sensor_degraded_quality: float = Field(default=0.6, ge=0, le=1)
    sensor_stuck_window: int = Field(default=10, ge=3)
    health_sweep_interval_s: float = Field(default=60, gt=0)

    # Una alerta activa que se vuelve a disparar se re-emite por WS tras estos minutos.
    alert_renotify_after_min: float = Field(default=15, gt=0)

    ws_ping_interval_s: float = Field(default=20, gt=0)

    simulation_enabled: bool = False
    simulation_interval_s: float = Field(default=5, gt=0)
    simulation_seed: int | None = None

    # Visión artificial de los reportes ciudadanos (requiere `uv sync --extra vision`).
    vision_enabled: bool = True
    vision_model: str = "yolov8s-worldv2.pt"
    vision_models_dir: str = "models"
    vision_conf: float = Field(default=0.15, gt=0, le=1)  # umbral del detector; el dominio filtra de nuevo
    vision_imgsz: int = Field(default=640, ge=160, le=1280)
    vision_max_image_mb: int = Field(default=8, ge=1, le=50)
    vision_scene_enabled: bool = True  # clasificador de escena CLIP (complementa al detector)
    vision_preload: bool = False  # cargar el modelo al arrancar en vez de en la primera foto

    max_readings_per_request: int = Field(default=1000, ge=1)
    max_range_days: int = Field(default=90, ge=1)
    max_buckets: int = Field(default=5000, ge=10)

    @property
    def is_dev(self) -> bool:
        return self.environment.lower() in DEV_ENVIRONMENTS

    @property
    def seed_demo_users(self) -> bool:
        return self.is_dev if self.demo_users_enabled is None else self.demo_users_enabled

    @model_validator(mode="after")
    def _no_default_key_outside_dev(self) -> "Settings":
        if not self.is_dev and self.ingest_api_key.get_secret_value() == DEFAULT_INGEST_KEY:
            raise ValueError(
                f"INGEST_API_KEY sigue con el valor por defecto y ENVIRONMENT={self.environment}: "
                "define una llave propia (o usa ENVIRONMENT=dev)"
            )
        return self

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
