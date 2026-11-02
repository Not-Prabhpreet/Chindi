"""Settings read from environment variables (and backend/.env for local dev)."""

from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEV_JWT_SECRET = "dev-only-not-a-secret"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # SQLite is fine for local dev; Docker Compose sets a Postgres URL.
    database_url: str = "sqlite:///./chindi.db"
    jwt_secret: str = DEV_JWT_SECRET
    allow_signups: bool = False
    default_currency: str = "CAD"

    vapid_public_key: str = ""
    vapid_private_key: str = ""
    vapid_subject: str = ""

    app_url: str = "http://localhost:5173"
    cors_origins: list[str] = ["http://localhost:5173"]

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")

    @model_validator(mode="after")
    def _require_real_secret_outside_dev(self) -> "Settings":
        if not self.is_sqlite and self.jwt_secret == DEV_JWT_SECRET:
            raise ValueError("JWT_SECRET must be set when using a real database.")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
