from datetime import UTC, datetime

from fastapi import APIRouter, Request, Response
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError

from app.config import get_settings
from app.db import DbSession
from app.errors import AppError
from app.models import User
from app.schemas.budget import Credentials, Profile
from app.services import auth, budget
from app.services.auth import CurrentUser
from app.services.calculations import utc

router = APIRouter()


@router.get("/auth/status")
def status(db: DbSession):
    return {
        "registration_open": get_settings().allow_signups
        or not db.scalar(select(func.count()).select_from(User)),
        "password_email_available": get_settings().password_email_available,
    }


@router.post("/auth/register", status_code=201)
def register(body: Credentials, db: DbSession, response: Response):
    # Serialize bootstrap registration so simultaneous requests cannot bypass first-user-only.
    if db.get_bind().dialect.name == "postgresql":
        db.execute(text("SELECT pg_advisory_xact_lock(9182741)"))
    else:
        db.execute(text("BEGIN IMMEDIATE"))
    if not get_settings().allow_signups and db.scalar(select(func.count()).select_from(User)):
        raise AppError("signups_closed", "This instance isn't accepting sign-ups.", 403)
    user = User(
        email=body.email,
        password_hash=auth.hasher.hash(body.password),
        name=body.name,
        currency=get_settings().default_currency,
    )
    db.add(user)
    try:
        db.flush()
        budget.seed(db, user)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise AppError("email_taken", "An account already uses this email.", 409) from exc
    return auth.issue(db, user, response)


@router.post("/auth/login")
def login(body: Credentials, db: DbSession, response: Response):
    user = db.scalar(select(User).where(User.email == body.email))
    # Run a password hash even for an unknown email, reducing account enumeration by timing.
    hashed = user.password_hash if user else auth.hasher.hash("invalid-placeholder-password")
    if not auth.verify_password(body.password, hashed) or not user:
        raise AppError("invalid_credentials", "Email or password is incorrect.", 401)
    return auth.issue(db, user, response)


@router.post("/auth/refresh")
def refresh(request: Request, response: Response, db: DbSession):
    record = auth.refresh_record(request, db)
    if not record or utc(record.expires_at) <= datetime.now(UTC):
        raise AppError("unauthorized", "Please log in again.", 401)
    user = db.get(User, record.user_id)
    if user is None or record.auth_version != user.auth_version:
        raise AppError("unauthorized", "Please log in again.", 401)
    db.delete(record)
    return auth.issue(db, user, response)


@router.post("/auth/logout")
def logout(request: Request, response: Response, db: DbSession):
    record = auth.refresh_record(request, db)
    if record:
        db.delete(record)
        db.commit()
    response.delete_cookie(auth.COOKIE, path=auth.COOKIE_PATH)
    return {"ok": True}


def public_user(user):
    result = budget.dump(user)
    result.pop("password_hash")
    result.pop("auth_version")
    return result


@router.get("/me")
def me(user: CurrentUser):
    return public_user(user)


@router.patch("/me")
def update_profile(body: Profile, user: CurrentUser, db: DbSession):
    for key, value in body.model_dump(exclude_none=True).items():
        setattr(user, key, value)
    db.commit()
    return public_user(user)
