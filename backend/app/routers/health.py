from fastapi import APIRouter
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.db import DbSession
from app.errors import AppError

router = APIRouter(tags=["health"])


@router.get("/health")
def health(db: DbSession) -> dict[str, str]:
    """Liveness plus a database round trip."""
    try:
        db.execute(text("SELECT 1"))
    except SQLAlchemyError as exc:
        raise AppError("database_unavailable", "The database is not reachable.", 503) from exc
    return {"status": "ok", "database": "ok"}
