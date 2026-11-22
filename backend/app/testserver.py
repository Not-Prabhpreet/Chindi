"""Isolated browser-test server; never points at the ordinary development database."""

import uvicorn
from alembic.config import Config

from alembic import command
from app.config import get_settings

if __name__ == "__main__":
    if not get_settings().database_url.endswith("chindi-e2e.db"):
        raise RuntimeError("Browser tests require the dedicated chindi-e2e.db database")
    command.upgrade(Config("alembic.ini"), "head")
    uvicorn.run("app.main:app", host="127.0.0.1", port=8001)
