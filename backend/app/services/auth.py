import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from typing import Annotated

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerificationError
from fastapi import Depends, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select

from app.config import get_settings
from app.db import DbSession
from app.errors import AppError
from app.models import RefreshToken, User

hasher = PasswordHasher()
bearer = HTTPBearer(auto_error=False)
COOKIE = "chindi_refresh"
COOKIE_PATH = "/api/v1/auth"


def digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


def issue(db, user, response: Response):
    now = datetime.now(UTC)
    token = jwt.encode(
        {
            "sub": user.id,
            "iat": now,
            "exp": now + timedelta(minutes=15),
            "type": "access",
            "version": user.auth_version,
        },
        get_settings().jwt_secret,
        algorithm="HS256",
    )
    refresh = secrets.token_urlsafe(48)
    db.add(
        RefreshToken(
            user_id=user.id,
            token_hash=digest(refresh),
            expires_at=now + timedelta(days=60),
            auth_version=user.auth_version,
        )
    )
    db.commit()
    response.set_cookie(
        COOKIE,
        refresh,
        max_age=60 * 86400,
        httponly=True,
        secure=get_settings().app_url.startswith("https://"),
        samesite="strict",
        path=COOKIE_PATH,
    )
    return {"access_token": token, "token_type": "bearer"}


def verify_password(password, hashed):
    try:
        return hasher.verify(hashed, password)
    except VerificationError:
        return False


def current_user(
    db: DbSession, credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]
):
    try:
        if not credentials:
            raise ValueError()
        data = jwt.decode(
            credentials.credentials,
            get_settings().jwt_secret,
            algorithms=["HS256"],
            options={"require": ["sub", "exp", "iat"]},
        )
        user = db.get(User, data["sub"])
        if not user or data.get("type") != "access" or data.get("version", 0) != user.auth_version:
            raise ValueError()
        return user
    except (jwt.InvalidTokenError, ValueError) as exc:
        raise AppError("unauthorized", "Please log in again.", 401) from exc


CurrentUser = Annotated[User, Depends(current_user)]


def refresh_record(request: Request, db):
    origin = request.headers.get("origin")
    allowed = {get_settings().app_url.rstrip("/"), *get_settings().cors_origins}
    if origin and origin not in allowed:
        raise AppError("forbidden", "Unrecognized origin.", 403)
    return db.scalar(
        select(RefreshToken).where(
            RefreshToken.token_hash == digest(request.cookies.get(COOKIE, ""))
        )
    )
