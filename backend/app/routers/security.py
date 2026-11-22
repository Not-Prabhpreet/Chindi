"""Verified passkeys and single-use account recovery. No secrets enter exports."""

import json
import logging
import secrets
import smtplib
import ssl
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage
from typing import Literal
from urllib.parse import urlparse

from fastapi import APIRouter, BackgroundTasks, Request, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from webauthn import (
    generate_authentication_options,
    generate_registration_options,
    options_to_json,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url
from webauthn.helpers.exceptions import WebAuthnException
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from app.config import get_settings
from app.db import DbSession
from app.errors import AppError
from app.models import AuthChallenge, Passkey, RecoverySecret, RefreshToken, User
from app.schemas.budget import Credentials
from app.services import auth
from app.services.auth import CurrentUser
from app.services.calculations import utc

router = APIRouter()
CHALLENGE_COOKIE = "chindi_passkey_challenge"
CHALLENGE_PATH = "/api/v1/auth/passkeys"
log = logging.getLogger(__name__)


class PasswordCheck(BaseModel):
    password: str = Field(min_length=10, max_length=128)


class RegistrationStart(PasswordCheck):
    name: str = Field(default="My passkey", min_length=1, max_length=80)


class CredentialIn(BaseModel):
    credential: dict

    @field_validator("credential")
    @classmethod
    def valid_structure(cls, value):
        if (
            not isinstance(value.get("id"), str)
            or len(value["id"]) > 2048
            or not isinstance(value.get("response"), dict)
        ):
            raise ValueError("Invalid passkey response")
        return value


class RecoveryRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)


class PasswordReset(BaseModel):
    email: str = Field(default="", max_length=254)
    secret: str = Field(min_length=20, max_length=200)
    method: Literal["code", "email"] = "code"
    password: str = Field(min_length=10, max_length=128)
    confirm_password: str = Field(min_length=10, max_length=128)


def check_password(user, password):
    if not auth.verify_password(password, user.password_hash):
        raise AppError("invalid_password", "Your current password is incorrect.", 401)


def origin_for(request):
    settings = get_settings()
    origin = request.headers.get("origin", settings.app_url).rstrip("/")
    allowed = {settings.app_url.rstrip("/"), *(s.rstrip("/") for s in settings.cors_origins)}
    parsed = urlparse(origin)
    if origin not in allowed or not parsed.hostname:
        raise AppError("invalid_origin", "Open Chindi using its configured address.", 403)
    if parsed.scheme != "https" and not (
        parsed.scheme == "http" and parsed.hostname in ("localhost", "127.0.0.1", "::1")
    ):
        raise AppError("https_required", "Passkeys need a secure HTTPS connection.", 400)
    return origin, parsed.hostname


def begin_challenge(db, request, response, purpose, challenge, user_id=None, name=None):
    origin, rp_id = origin_for(request)
    instant = datetime.now(UTC)
    db.execute(delete(AuthChallenge).where(AuthChallenge.expires_at < instant))
    secret = secrets.token_urlsafe(32)
    db.add(
        AuthChallenge(
            id=auth.digest(secret),
            user_id=user_id,
            purpose=purpose,
            challenge=bytes_to_base64url(challenge),
            origin=origin,
            rp_id=rp_id,
            expires_at=instant + timedelta(minutes=5),
            name=name,
        )
    )
    db.commit()
    response.set_cookie(
        CHALLENGE_COOKIE,
        secret,
        max_age=300,
        httponly=True,
        secure=get_settings().app_url.startswith("https://"),
        samesite="strict",
        path=CHALLENGE_PATH,
    )


def consume_challenge(db, request, response, purpose, user_id=None):
    origin, _ = origin_for(request)
    query = (
        delete(AuthChallenge)
        .where(
            AuthChallenge.id == auth.digest(request.cookies.get(CHALLENGE_COOKIE, "")),
            AuthChallenge.purpose == purpose,
            AuthChallenge.user_id == user_id,
        )
        .returning(AuthChallenge)
    )
    record = db.scalars(query).first()
    # Commit consumption before verifying: concurrent requests cannot reuse a challenge.
    db.commit()
    response.delete_cookie(CHALLENGE_COOKIE, path=CHALLENGE_PATH)
    if not record or utc(record.expires_at) <= datetime.now(UTC) or record.origin != origin:
        raise AppError("expired_challenge", "That sign-in attempt expired. Please try again.", 400)
    return record


@router.get("/auth/security")
def security_status(user: CurrentUser, db: DbSession):
    return {
        "passkeys": [
            {
                "id": p.id,
                "name": p.name,
                "created_at": utc(p.created_at).isoformat(),
                "last_used_at": utc(p.last_used_at).isoformat() if p.last_used_at else None,
            }
            for p in db.scalars(select(Passkey).where(Passkey.user_id == user.id))
        ],
        "has_recovery_code": bool(
            db.scalar(
                select(RecoverySecret.id).where(
                    RecoverySecret.user_id == user.id, RecoverySecret.purpose == "code"
                )
            )
        ),
    }


@router.post("/auth/passkeys/register/options")
def registration_options(
    body: RegistrationStart, user: CurrentUser, db: DbSession, request: Request, response: Response
):
    check_password(user, body.password)
    _, rp_id = origin_for(request)
    keys = list(db.scalars(select(Passkey).where(Passkey.user_id == user.id)))
    if len(keys) >= 10:
        raise AppError("too_many_passkeys", "Remove an old passkey before adding another.")
    options = generate_registration_options(
        rp_id=rp_id,
        rp_name="Chindi",
        user_name=user.email,
        user_display_name=user.name,
        user_id=user.id.encode(),
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.REQUIRED,
            user_verification=UserVerificationRequirement.REQUIRED,
        ),
        exclude_credentials=[
            PublicKeyCredentialDescriptor(id=base64url_to_bytes(p.credential_id))
            for p in keys
            if p.rp_id == rp_id
        ],
    )
    begin_challenge(
        db,
        request,
        response,
        "register",
        options.challenge,
        user.id,
        body.name.strip() or "My passkey",
    )
    return json.loads(options_to_json(options))


@router.post("/auth/passkeys/register/verify", status_code=201)
def register_passkey(
    body: CredentialIn, user: CurrentUser, db: DbSession, request: Request, response: Response
):
    challenge = consume_challenge(db, request, response, "register", user.id)
    try:
        verified = verify_registration_response(
            credential=body.credential,
            expected_challenge=base64url_to_bytes(challenge.challenge),
            expected_rp_id=challenge.rp_id,
            expected_origin=challenge.origin,
            require_user_verification=True,
        )
    except (WebAuthnException, ValueError, TypeError, KeyError) as exc:
        raise AppError(
            "invalid_passkey", "The passkey could not be verified. Please try again."
        ) from exc
    key = Passkey(
        user_id=user.id,
        credential_id=bytes_to_base64url(verified.credential_id),
        public_key=bytes_to_base64url(verified.credential_public_key),
        sign_count=verified.sign_count,
        rp_id=challenge.rp_id,
        name=challenge.name or "My passkey",
        transports=body.credential.get("response", {}).get("transports", []),
    )
    db.add(key)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise AppError("passkey_exists", "That passkey has already been added.", 409) from exc
    return {"ok": True, "id": key.id}


@router.post("/auth/passkeys/authenticate/options")
def authentication_options(db: DbSession, request: Request, response: Response):
    _, rp_id = origin_for(request)
    options = generate_authentication_options(
        rp_id=rp_id, user_verification=UserVerificationRequirement.REQUIRED
    )
    begin_challenge(db, request, response, "authenticate", options.challenge)
    return json.loads(options_to_json(options))


@router.post("/auth/passkeys/authenticate/verify")
def authenticate_passkey(body: CredentialIn, db: DbSession, request: Request, response: Response):
    challenge = consume_challenge(db, request, response, "authenticate")
    key = db.scalar(select(Passkey).where(Passkey.credential_id == body.credential.get("id", "")))
    if key is None or key.rp_id != challenge.rp_id:
        raise AppError("invalid_passkey", "This passkey is not registered for Chindi.", 401)
    user = db.get(User, key.user_id)
    if user is None:
        raise AppError("invalid_passkey", "This account no longer exists.", 401)
    try:
        handle = body.credential.get("response", {}).get("userHandle")
        if handle is not None and base64url_to_bytes(handle) != user.id.encode():
            raise ValueError("Wrong user handle")
        verified = verify_authentication_response(
            credential=body.credential,
            expected_challenge=base64url_to_bytes(challenge.challenge),
            expected_rp_id=challenge.rp_id,
            expected_origin=challenge.origin,
            credential_public_key=base64url_to_bytes(key.public_key),
            credential_current_sign_count=key.sign_count,
            require_user_verification=True,
        )
    except (WebAuthnException, ValueError, TypeError, KeyError) as exc:
        raise AppError(
            "invalid_passkey", "The passkey could not be verified. Please try again.", 401
        ) from exc
    key.sign_count = verified.new_sign_count
    key.last_used_at = datetime.now(UTC)
    return auth.issue(db, user, response)


@router.delete("/auth/passkeys/{id}")
def remove_passkey(id: str, body: PasswordCheck, user: CurrentUser, db: DbSession):
    check_password(user, body.password)
    key = db.scalar(select(Passkey).where(Passkey.id == id, Passkey.user_id == user.id))
    if not key:
        raise AppError("not_found", "That passkey doesn't exist.", 404)
    db.delete(key)
    db.commit()
    return {"ok": True}


@router.post("/auth/recovery-code")
def recovery_code(body: PasswordCheck, user: CurrentUser, db: DbSession):
    check_password(user, body.password)
    code = secrets.token_hex(24).upper()
    db.execute(
        delete(RecoverySecret).where(
            RecoverySecret.user_id == user.id, RecoverySecret.purpose == "code"
        )
    )
    db.add(RecoverySecret(user_id=user.id, purpose="code", secret_hash=auth.digest(code)))
    db.commit()
    return {"code": "-".join(code[i : i + 8] for i in range(0, len(code), 8))}


def send_reset_email(email, token):
    settings = get_settings()
    message = EmailMessage()
    message["From"], message["To"] = settings.smtp_from, email
    message["Subject"] = "Reset your Chindi password"
    message.set_content(
        "Use this link within 15 minutes to reset your Chindi password:\n\n"
        + settings.app_url.rstrip("/")
        + "/reset-password#token="
        + token
        + "\n\nIf you didn't request this, you can ignore this email."
    )
    try:
        connection = smtplib.SMTP_SSL if settings.smtp_ssl else smtplib.SMTP
        with connection(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
            if settings.smtp_starttls and not settings.smtp_ssl:
                smtp.starttls(context=ssl.create_default_context())
            if settings.smtp_username:
                smtp.login(settings.smtp_username, settings.smtp_password)
            smtp.send_message(message)
    except (OSError, smtplib.SMTPException, ValueError):
        # Never log reset tokens, email contents, credentials or SMTP responses.
        log.warning("Password reset email delivery failed; check the configured mail service.")


@router.post("/auth/password/forgot")
def forgot_password(body: RecoveryRequest, db: DbSession, background: BackgroundTasks):
    if not get_settings().password_email_available:
        raise AppError(
            "email_unavailable",
            "Email recovery isn't set up here. Use a saved recovery code or a passkey.",
            503,
        )
    email = Credentials(email=body.email, password="validation-only").email
    user = db.scalar(select(User).where(User.email == email))
    token = secrets.token_urlsafe(32)
    if user:
        # Keep earlier unexpired links valid: an unsolicited request must not revoke
        # a legitimate reset already in progress. All are consumed after a reset.
        db.execute(delete(RecoverySecret).where(RecoverySecret.expires_at < datetime.now(UTC)))
        db.add(
            RecoverySecret(
                user_id=user.id,
                purpose="email",
                secret_hash=auth.digest(token),
                expires_at=datetime.now(UTC) + timedelta(minutes=15),
            )
        )
        db.commit()
        background.add_task(send_reset_email, email, token)
    return {
        "message": (
            "If an account matches that email, a reset link will be sent. "
            "Check your inbox and spam folder."
        )
    }


@router.post("/auth/password/reset")
def reset_password(body: PasswordReset, db: DbSession, response: Response):
    if body.password != body.confirm_password:
        raise AppError("password_mismatch", "Your passwords don't match.")
    secret = (
        "".join(body.secret.upper().replace("-", "").split())
        if body.method == "code"
        else body.secret
    )
    query = delete(RecoverySecret).where(
        RecoverySecret.secret_hash == auth.digest(secret), RecoverySecret.purpose == body.method
    )
    if body.method == "code":
        query = query.where(
            RecoverySecret.user_id.in_(
                select(User.id).where(User.email == body.email.strip().lower())
            )
        )
    record = db.scalars(query.returning(RecoverySecret)).first()
    if not record or record.expires_at and utc(record.expires_at) <= datetime.now(UTC):
        db.rollback()
        raise AppError("invalid_recovery", "That recovery code or link is invalid or expired.", 400)
    user = db.get(User, record.user_id)
    if user is None:
        db.rollback()
        raise AppError("invalid_recovery", "That recovery code or link is invalid or expired.", 400)
    user.password_hash = auth.hasher.hash(body.password)
    user.auth_version += 1
    for model in (RefreshToken, RecoverySecret, AuthChallenge):
        db.execute(delete(model).where(model.user_id == user.id))
    db.commit()
    response.delete_cookie(auth.COOKIE, path=auth.COOKIE_PATH)
    response.delete_cookie(CHALLENGE_COOKIE, path=CHALLENGE_PATH)
    return {
        "message": (
            "Password updated. Sign in with your new password. "
            "Your previous sessions have been signed out."
        )
    }
