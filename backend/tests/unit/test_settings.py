import pytest
from pydantic import ValidationError

from app.config.settings import Settings


def test_default_key_is_fine_in_dev():
    assert Settings(_env_file=None, environment="dev").is_dev


def test_default_key_is_refused_outside_dev():
    with pytest.raises(ValidationError, match="INGEST_API_KEY"):
        Settings(_env_file=None, environment="production")


def test_custom_key_outside_dev():
    settings = Settings(_env_file=None, environment="production", ingest_api_key="s3cret")
    assert not settings.is_dev
