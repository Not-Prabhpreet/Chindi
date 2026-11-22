import pytest
from pydantic import ValidationError

from app.config import Settings


def test_sqlite_dev_runs_without_a_secret() -> None:
    settings = Settings(_env_file=None, database_url="sqlite:///./x.db")
    assert settings.is_sqlite
    assert settings.allow_signups is False
    assert settings.default_currency == "CAD"


def test_postgres_requires_a_real_jwt_secret() -> None:
    with pytest.raises(ValidationError, match="JWT_SECRET"):
        Settings(_env_file=None, database_url="postgresql+psycopg://u:p@db/chindi")


def test_postgres_with_secret_is_accepted() -> None:
    settings = Settings(
        _env_file=None, database_url="postgresql+psycopg://u:p@db/chindi", jwt_secret="s3cret"
    )
    assert not settings.is_sqlite


@pytest.mark.parametrize(
    "url", ["postgres://u:p@db/chindi", "postgresql://u:p@db/chindi"]
)
def test_hosted_postgres_urls_use_psycopg(url: str) -> None:
    settings = Settings(_env_file=None, database_url=url, jwt_secret="s3cret")
    assert settings.database_url == "postgresql+psycopg://u:p@db/chindi"
