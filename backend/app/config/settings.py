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

    max_readings_per_request: int = Field(default=1000, ge=1)
    max_range_days: int = Field(default=90, ge=1)
    max_buckets: int = Field(default=5000, ge=10)

    @property
    def is_dev(self) -> bool:
        return self.environment.lower() in DEV_ENVIRONMENTS

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
