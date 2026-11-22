from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest

from app.config import get_settings
from app.models import WishlistItem

PREFIX = "/api/v1"


def get(client, path, headers):
    result = client.get(PREFIX + path, headers=headers)
    assert result.status_code == 200, result.text
    return result.json()


def post(client, path, headers, body):
    return client.post(PREFIX + path, headers=headers, json=body)


def draft(client, headers, **values):
    return {
        "client_id": "one",
        "amount": "24.60",
        "account_id": get(client, "/accounts", headers)[0]["id"],
        "category_id": get(client, "/categories", headers)[0]["id"],
        **values,
    }


def test_auth_bootstrap_refresh_rotation_and_logout(client, headers):
    assert (
        client.post(
            PREFIX + "/auth/register",
            json={"email": "other@example.com", "password": "correct-horse-battery"},
        ).status_code
        == 403
    )
    old_cookie = client.cookies.get("chindi_refresh")
    refreshed = client.post(PREFIX + "/auth/refresh")
    assert refreshed.status_code == 200
    assert old_cookie != client.cookies.get("chindi_refresh")
    assert client.post(PREFIX + "/auth/logout").status_code == 200
    assert client.post(PREFIX + "/auth/refresh").status_code == 401
    assert (
        client.post(
            PREFIX + "/auth/login", json={"email": "you@example.com", "password": "wrong-password"}
        ).status_code
        == 401
    )
    assert (
        client.post(
            PREFIX + "/auth/login",
            json={"email": "you@example.com", "password": "correct-horse-battery"},
        ).status_code
        == 200
    )


def test_expense_dedupe_edit_delete_updates_totals(client, headers):
    body = draft(client, headers)
    result = post(client, "/transactions", headers, body)
    assert result.status_code == 201, result.text
    id = result.json()["id"]
    assert post(client, "/transactions", headers, body).json()["id"] == id
    assert len(get(client, "/transactions", headers)) == 1
    assert Decimal(get(client, "/home", headers)["spent"]) == Decimal("24.60")
    changed = client.patch(
        PREFIX + f"/transactions/{id}", headers=headers, json={"amount": "12.10"}
    )
    assert changed.status_code == 200, changed.text
    assert Decimal(get(client, "/home", headers)["spent"]) == Decimal("12.10")
    assert client.delete(PREFIX + f"/transactions/{id}", headers=headers).status_code == 200
    assert Decimal(get(client, "/home", headers)["spent"]) == 0


def test_edit_archived_history_preserves_original_account_and_category(client, headers):
    body = draft(client, headers)
    record = post(client, "/transactions", headers, body).json()
    assert (
        client.delete(PREFIX + "/accounts/" + body["account_id"], headers=headers).status_code
        == 200
    )
    assert (
        client.delete(PREFIX + "/categories/" + body["category_id"], headers=headers).status_code
        == 200
    )
    assert get(client, "/accounts", headers) == []
    assert any(
        a["id"] == body["account_id"]
        for a in get(client, "/accounts?include_archived=true", headers)
    )
    assert any(
        c["id"] == body["category_id"]
        for c in get(client, "/categories?include_archived=true", headers)
    )
    updated = client.patch(
        PREFIX + "/transactions/" + record["id"], headers=headers, json={"amount": "12.10"}
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["account_id"] == body["account_id"]
    assert updated.json()["category_id"] == body["category_id"]
    assert post(client, "/transactions", headers, {**body, "client_id": "new"}).status_code == 400


def test_transfers_income_fixed_bills_not_spending(client, headers):
    source = get(client, "/accounts", headers)[0]["id"]
    dest = post(
        client,
        "/accounts",
        headers,
        {"name": "Visa", "kind": "credit_card", "opening_balance": "-300.00"},
    ).json()["id"]
    baseline = get(client, "/home", headers)["kept"]
    for body in [
        {"kind": "income", "amount": "1000", "client_id": "income"},
        {"kind": "transfer", "amount": "100", "to_account_id": dest, "client_id": "payment"},
    ]:
        result = post(client, "/transactions", headers, {"account_id": source, **body})
        assert result.status_code == 201, result.text
    balances = {a["id"]: Decimal(a["balance"]) for a in get(client, "/accounts", headers)}
    assert balances[source] == 900
    assert balances[dest] == -200
    assert get(client, "/home", headers)["kept"] == baseline
    fixed = next(c for c in get(client, "/categories", headers) if c["kind"] == "fixed")
    assert (
        post(
            client, "/transactions", headers, draft(client, headers, category_id=fixed["id"])
        ).status_code
        == 201
    )
    assert get(client, "/home", headers)["kept"] == baseline


@pytest.mark.parametrize("amount", ["0", "-2", "1.001", "NaN", "10000000000"])
def test_invalid_expense_amounts_rejected(client, headers, amount):
    assert post(
        client, "/transactions", headers, draft(client, headers, amount=amount)
    ).status_code in (400, 422)


def test_user_isolation_on_reads_writes_and_foreign_keys(client, headers, monkeypatch):
    account = get(client, "/accounts", headers)[0]["id"]
    category = get(client, "/categories", headers)[0]["id"]
    monkeypatch.setattr(get_settings(), "allow_signups", True)
    second = client.post(
        PREFIX + "/auth/register",
        json={"email": "two@example.com", "password": "correct-horse-battery"},
    )
    other = {"Authorization": "Bearer " + second.json()["access_token"]}
    assert account not in [a["id"] for a in get(client, "/accounts", other)]
    assert (
        client.patch(
            PREFIX + f"/accounts/{account}", headers=other, json={"name": "Stolen"}
        ).status_code
        == 404
    )
    assert (
        post(
            client,
            "/transactions",
            other,
            {"client_id": "theft", "amount": "1", "account_id": account, "category_id": category},
        ).status_code
        == 404
    )
    assert (
        post(client, "/categories", other, {"name": "Stolen", "parent_id": category}).status_code
        == 404
    )
    assert (
        post(
            client, "/goals", other, {"name": "Stolen", "target": "100", "account_id": account}
        ).status_code
        == 404
    )


def test_wishlist_timer_decision_and_deposit_guard(client, headers, db_session):
    item = post(
        client, "/wishlist", headers, {"name": "Headphones", "price": "129", "from_pause": True}
    ).json()
    id = item["id"]
    assert (
        post(client, f"/wishlist/{id}/decide", headers, {"decision": "let_go"}).status_code == 409
    )
    record = db_session.get(WishlistItem, id)
    record.ready_at = datetime.now(UTC) - timedelta(seconds=1)
    db_session.commit()
    assert (
        post(client, f"/wishlist/{id}/decide", headers, {"decision": "let_go"}).status_code == 200
    )
    assert Decimal(get(client, "/wishlist", headers)["money_not_wasted"]) == 129
    assert (
        post(client, f"/wishlist/{id}/decide", headers, {"decision": "let_go"}).status_code == 409
    )
    goal = post(client, "/goals", headers, {"name": "Trip", "target": "3000"}).json()
    assert (
        post(
            client, f"/goals/{goal['id']}/deposit", headers, {"amount": "100", "source": "wishlist"}
        ).status_code
        == 200
    )
    assert Decimal(get(client, "/wishlist", headers)["available_to_allocate"]) == Decimal("29")
    assert (
        post(
            client, f"/goals/{goal['id']}/deposit", headers, {"amount": "100", "source": "wishlist"}
        ).status_code
        == 400
    )


def test_parent_category_rollup_and_depth_validation(client, headers):
    cats = get(client, "/categories", headers)
    coffee = next(c for c in cats if c["name"] == "Coffee")
    assert (
        post(
            client, "/transactions", headers, draft(client, headers, category_id=coffee["id"])
        ).status_code
        == 201
    )
    parent = next(c for c in get(client, "/categories", headers) if c["id"] == coffee["parent_id"])
    assert Decimal(parent["spent"]) == Decimal("24.60")
    assert (
        post(
            client, "/categories", headers, {"name": "Too deep", "parent_id": coffee["id"]}
        ).status_code
        == 400
    )


def test_json_and_csv_export_restore(client, headers):
    post(client, "/transactions", headers, draft(client, headers))
    for format, media in [("json", "application/json"), ("csv", "text/csv")]:
        export = client.get(PREFIX + "/export?format=" + format, headers=headers)
        assert export.status_code == 200
        imported = client.post(
            PREFIX + "/import", headers={**headers, "Content-Type": media}, content=export.content
        )
        assert imported.status_code == 200, imported.text
        assert len(get(client, "/transactions", headers)) == 1
        assert Decimal(get(client, "/home", headers)["spent"]) == Decimal("24.60")


def test_no_access_without_login(client):
    for path in ("/home", "/accounts", "/transactions", "/export", "/goals", "/wishlist"):
        assert client.get(PREFIX + path).status_code == 401


def test_insights_require_data_and_quiz_is_deterministic(client, headers):
    assert get(client, "/insights", headers) == []
    result = post(client, "/quiz/score", headers, {"answers": [False] * 6})
    assert result.json()["personality"] == "Secret Chindi"
    assert (
        post(client, "/quiz/score", headers, {"answers": [True] * 6}).json()["personality"]
        == "Midnight Cart Goblin"
    )


def test_refresh_rejects_foreign_origin(client, headers):
    assert (
        client.post(
            PREFIX + "/auth/refresh", headers={"Origin": "https://evil.example"}
        ).status_code
        == 403
    )
