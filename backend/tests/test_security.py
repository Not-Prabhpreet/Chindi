import base64
import hashlib
import json
import secrets
from datetime import UTC, datetime, timedelta

import cbor2
import pytest
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from sqlalchemy import select

from app.config import get_settings
from app.models import AuthChallenge, RecoverySecret, User
from app.services import auth
from tests.test_budget import PREFIX, get, post

ORIGIN = "http://localhost:5173"
PASSWORD = "correct-horse-battery"
NEW_PASSWORD = "a-new-correct-password"


def b64(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def register_key(client, headers):
    options = post(
        client,
        "/auth/passkeys/register/options",
        headers,
        {"password": PASSWORD, "name": "Test phone"},
    )
    assert options.status_code == 200, options.text
    options = options.json()
    private_key = ec.generate_private_key(ec.SECP256R1())
    numbers = private_key.public_key().public_numbers()
    cose = cbor2.dumps(
        {1: 2, 3: -7, -1: 1, -2: numbers.x.to_bytes(32, "big"), -3: numbers.y.to_bytes(32, "big")}
    )
    credential_id = secrets.token_bytes(32)
    data = (
        hashlib.sha256(b"localhost").digest()
        + bytes([0x45])
        + bytes(4)
        + bytes(16)
        + len(credential_id).to_bytes(2, "big")
        + credential_id
        + cose
    )
    client_data = json.dumps(
        {"type": "webauthn.create", "challenge": options["challenge"], "origin": ORIGIN}
    ).encode()
    credential = {
        "id": b64(credential_id),
        "rawId": b64(credential_id),
        "type": "public-key",
        "response": {
            "clientDataJSON": b64(client_data),
            "attestationObject": b64(cbor2.dumps({"fmt": "none", "attStmt": {}, "authData": data})),
            "transports": ["internal"],
        },
    }
    result = post(client, "/auth/passkeys/register/verify", headers, {"credential": credential})
    assert result.status_code == 201, result.text
    return private_key, credential_id, result.json()["id"]


def assertion(
    client, private_key, credential_id, count=1, origin=ORIGIN, verified=True, challenge=None
):
    result = client.post(PREFIX + "/auth/passkeys/authenticate/options")
    assert result.status_code == 200, result.text
    client_data = json.dumps(
        {
            "type": "webauthn.get",
            "challenge": challenge or result.json()["challenge"],
            "origin": origin,
        }
    ).encode()
    data = (
        hashlib.sha256(b"localhost").digest()
        + bytes([5 if verified else 1])
        + count.to_bytes(4, "big")
    )
    signature = private_key.sign(
        data + hashlib.sha256(client_data).digest(), ec.ECDSA(hashes.SHA256())
    )
    return {
        "id": b64(credential_id),
        "rawId": b64(credential_id),
        "type": "public-key",
        "response": {
            "clientDataJSON": b64(client_data),
            "authenticatorData": b64(data),
            "signature": b64(signature),
            "userHandle": None,
        },
    }


def test_passkey_real_signatures_user_verification_replay_and_remove(client, headers):
    private, id, key_id = register_key(client, headers)
    assert get(client, "/auth/security", headers)["passkeys"][0]["name"] == "Test phone"
    credential = assertion(client, private, id)
    accepted = client.post(
        PREFIX + "/auth/passkeys/authenticate/verify", json={"credential": credential}
    )
    assert accepted.status_code == 200, accepted.text
    signed_in = {"Authorization": "Bearer " + accepted.json()["access_token"]}
    assert get(client, "/me", signed_in)["email"] == "you@example.com"
    assert (
        client.post(
            PREFIX + "/auth/passkeys/authenticate/verify", json={"credential": credential}
        ).status_code
        == 400
    )
    same_counter = assertion(client, private, id)
    assert (
        client.post(
            PREFIX + "/auth/passkeys/authenticate/verify", json={"credential": same_counter}
        ).status_code
        == 401
    )
    assert (
        client.request(
            "DELETE",
            PREFIX + "/auth/passkeys/" + key_id,
            headers=headers,
            json={"password": PASSWORD},
        ).status_code
        == 200
    )
    removed = assertion(client, private, id, count=2)
    assert (
        client.post(
            PREFIX + "/auth/passkeys/authenticate/verify", json={"credential": removed}
        ).status_code
        == 401
    )


@pytest.mark.parametrize("change", ["origin", "challenge", "verification", "signature"])
def test_passkey_rejects_signed_wrong_origin_challenge_missing_uv_and_forgery(
    client, headers, change
):
    private, id, _ = register_key(client, headers)
    values = (
        {"origin": "https://evil.example"}
        if change == "origin"
        else {"challenge": b64(bytes(32))}
        if change == "challenge"
        else {"verified": False}
        if change == "verification"
        else {}
    )
    credential = assertion(client, private, id, **values)
    if change == "signature":
        credential["response"]["signature"] = b64(bytes(64))
    result = client.post(
        PREFIX + "/auth/passkeys/authenticate/verify", json={"credential": credential}
    )
    assert result.status_code == 401, result.text


def test_passkey_requires_reauthentication_and_scopes_management(client, headers, monkeypatch):
    result = post(
        client, "/auth/passkeys/register/options", headers, {"password": "wrong-password"}
    )
    assert result.status_code == 401
    _, _, key_id = register_key(client, headers)
    monkeypatch.setattr(get_settings(), "allow_signups", True)
    second = client.post(
        PREFIX + "/auth/register", json={"email": "second@example.com", "password": PASSWORD}
    )
    other = {"Authorization": "Bearer " + second.json()["access_token"]}
    assert get(client, "/auth/security", other)["passkeys"] == []
    assert (
        client.request(
            "DELETE",
            PREFIX + "/auth/passkeys/" + key_id,
            headers=other,
            json={"password": PASSWORD},
        ).status_code
        == 404
    )
    assert (
        client.post(
            PREFIX + "/auth/passkeys/authenticate/options",
            headers={"Origin": "https://evil.example"},
        ).status_code
        == 403
    )


def test_expired_challenge_and_malformed_credentials(client, headers, db_session):
    private, id, _ = register_key(client, headers)
    credential = assertion(client, private, id)
    challenge = db_session.scalar(select(AuthChallenge))
    challenge.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    db_session.commit()
    assert (
        client.post(
            PREFIX + "/auth/passkeys/authenticate/verify", json={"credential": credential}
        ).status_code
        == 400
    )
    assert (
        client.post(
            PREFIX + "/auth/passkeys/authenticate/verify",
            json={"credential": {"id": {}, "response": "bad"}},
        ).status_code
        == 422
    )


def test_recovery_code_is_hashed_single_use_and_revokes_existing_sessions(
    client, headers, db_session
):
    bad = post(client, "/auth/recovery-code", headers, {"password": "wrong-password"})
    assert bad.status_code == 401
    result = post(client, "/auth/recovery-code", headers, {"password": PASSWORD})
    code = result.json()["code"]
    stored = db_session.scalar(select(RecoverySecret))
    assert stored.secret_hash == auth.digest(code.replace("-", ""))
    export = get(client, "/export", headers)
    assert "recovery_secrets" not in export["tables"]
    assert "auth_version" not in get(client, "/me", headers)
    body = {
        "email": "you@example.com",
        "secret": code,
        "password": NEW_PASSWORD,
        "confirm_password": NEW_PASSWORD,
    }
    wrong_email = client.post(
        PREFIX + "/auth/password/reset", json={**body, "email": "other@example.com"}
    )
    assert wrong_email.status_code == 400
    assert client.post(PREFIX + "/auth/password/reset", json=body).status_code == 200
    assert client.get(PREFIX + "/home", headers=headers).status_code == 401
    assert client.post(PREFIX + "/auth/refresh").status_code == 401
    assert client.post(PREFIX + "/auth/password/reset", json=body).status_code == 400
    assert (
        client.post(
            PREFIX + "/auth/login", json={"email": "you@example.com", "password": PASSWORD}
        ).status_code
        == 401
    )
    assert (
        client.post(
            PREFIX + "/auth/login", json={"email": "you@example.com", "password": NEW_PASSWORD}
        ).status_code
        == 200
    )


def test_replacing_recovery_code_and_mismatched_passwords(client, headers):
    first = post(client, "/auth/recovery-code", headers, {"password": PASSWORD}).json()["code"]
    second = post(client, "/auth/recovery-code", headers, {"password": PASSWORD}).json()["code"]
    body = {"email": "you@example.com", "password": NEW_PASSWORD, "confirm_password": NEW_PASSWORD}
    assert (
        client.post(PREFIX + "/auth/password/reset", json={**body, "secret": first}).status_code
        == 400
    )
    assert (
        client.post(
            PREFIX + "/auth/password/reset",
            json={**body, "secret": second, "confirm_password": "mismatched-password"},
        ).status_code
        == 400
    )
    assert (
        client.post(PREFIX + "/auth/password/reset", json={**body, "secret": second}).status_code
        == 200
    )


def test_stale_refresh_token_cannot_resume_after_password_version_changes(
    client, headers, db_session
):
    user = db_session.scalar(select(User))
    user.auth_version += 1
    db_session.commit()
    assert client.post(PREFIX + "/auth/refresh").status_code == 401


def test_email_recovery_uses_single_use_expiring_tokens_without_enumeration(
    client, headers, db_session, monkeypatch
):
    from app.routers import security

    settings = get_settings()
    monkeypatch.setattr(settings, "smtp_host", "smtp.example.com")
    monkeypatch.setattr(settings, "smtp_from", "chindi@example.com")
    sent = []
    monkeypatch.setattr(
        security, "send_reset_email", lambda email, token: sent.append((email, token))
    )
    known = client.post(PREFIX + "/auth/password/forgot", json={"email": "you@example.com"})
    unknown = client.post(PREFIX + "/auth/password/forgot", json={"email": "unknown@example.com"})
    assert known.json() == unknown.json()
    assert len(sent) == 1
    secret = sent[0][1]
    assert secret not in known.text
    stored = db_session.scalar(select(RecoverySecret))
    assert stored.secret_hash == auth.digest(secret)
    body = {
        "secret": secret,
        "method": "email",
        "password": NEW_PASSWORD,
        "confirm_password": NEW_PASSWORD,
    }
    assert client.post(PREFIX + "/auth/password/reset", json=body).status_code == 200
    assert client.post(PREFIX + "/auth/password/reset", json=body).status_code == 400
    # Generate a second token and prove expiration prevents a reset.
    client.post(PREFIX + "/auth/password/forgot", json={"email": "you@example.com"})
    expired = db_session.scalar(select(RecoverySecret))
    expired.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    db_session.commit()
    assert (
        client.post(
            PREFIX + "/auth/password/reset", json={**body, "secret": sent[-1][1]}
        ).status_code
        == 400
    )


def test_missing_email_configuration_is_honest_and_auth_endpoints_are_rate_limited(
    client, monkeypatch
):
    assert client.get(PREFIX + "/auth/status").json()["password_email_available"] is False
    assert (
        client.post(PREFIX + "/auth/password/forgot", json={"email": "any@example.com"}).status_code
        == 503
    )
    monkeypatch.setattr(get_settings(), "auth_rate_limit", 2)
    assert client.post(PREFIX + "/auth/passkeys/authenticate/options").status_code == 200
    assert client.post(PREFIX + "/auth/passkeys/authenticate/options").status_code == 200
    result = client.post(PREFIX + "/auth/passkeys/authenticate/options")
    assert result.status_code == 429
    assert result.headers["Retry-After"] == "60"
