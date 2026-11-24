import pytest
from pydantic import ValidationError

from app.config.settings import Settings


def test_default_key_is_fine_in_dev():
    assert Settings(_env_file=None, environment="dev").is_dev


def test_default_key_is_refused_outside_dev():
    with pytest.raises(ValidationError, match="INGEST_API_KEY"):
        Settings(_env_file=None, environment="production", jwt_secret="x" * 32)


def test_custom_key_outside_dev():
    settings = Settings(
        _env_file=None, environment="production", ingest_api_key="s3cret", jwt_secret="x" * 32
    )
    assert not settings.is_dev


def test_jwt_secret_must_be_custom_and_long_outside_dev():
    with pytest.raises(ValidationError, match="JWT_SECRET"):
        Settings(_env_file=None, environment="production", ingest_api_key="s3cret")
    with pytest.raises(ValidationError, match="32 bytes"):
        Settings(_env_file=None, environment="production", ingest_api_key="s3cret", jwt_secret="corta")
    Settings(_env_file=None, environment="production", ingest_api_key="s3cret", jwt_secret="x" * 32)
