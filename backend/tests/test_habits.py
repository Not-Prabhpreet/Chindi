from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import select

from app.models import User
from app.quips.engine import TEXT, next_quip
from app.services import budget as svc
from tests.test_budget import PREFIX, draft, get, post


def test_fresh_account_has_no_categories_and_can_log_uncategorized(client):
    response = client.post(
        PREFIX + "/auth/register",
        json={
            "email": "fresh@example.com",
            "password": "correct-horse-battery",
        },
    )
    auth = {"Authorization": "Bearer " + response.json()["access_token"]}
    assert get(client, "/categories", auth) == []
    dashboard = get(client, "/home", auth)
    assert dashboard["has_budget"] is False
    assert dashboard["kept"] is None
    account = dashboard["accounts"][0]["id"]
    body = {"client_id": "uncategorized", "account_id": account, "amount": "24.60"}
    result = post(client, "/transactions", auth, body)
    assert result.status_code == 201, result.text
    assert result.json()["category_id"] is None
    assert post(client, "/transactions", auth, body).json()["id"] == result.json()["id"]
    dashboard = get(client, "/home", auth)
    assert dashboard["spent"] == "24.60"
    assert dashboard["uncategorized_count"] == 1
    assert dashboard["streak"]["current"] == 0
    assert Decimal(get(client, "/accounts", auth)[0]["balance"]) == Decimal("-24.60")
    category = post(client, "/categories", auth, {"name": "My hobby"}).json()
    assert category["limit_amount"] is None
    updated = client.patch(
        PREFIX + "/transactions/" + result.json()["id"],
        headers=auth,
        json={"category_id": category["id"]},
    )
    assert updated.status_code == 200, updated.text
    assert get(client, "/home", auth)["uncategorized_count"] == 0
    assert get(client, "/home", auth)["spent"] == "24.60"


def test_onboarding_uses_entered_category_limits_and_excludes_fixed_bills(client, headers):
    result = post(
        client,
        "/onboarding/complete",
        headers,
        {
            "categories": [
                {"name": "Groceries", "limit_amount": "123.45"},
                {"name": "Food out", "limit_amount": "67.89", "kind": "fixed"},
                {"name": "Shopping", "limit_amount": "150", "archived": True},
                {"name": "Fun", "limit_amount": None},
                {"name": "Transport", "limit_amount": "0"},
                {"name": "Bills", "limit_amount": "900.25", "kind": "fixed"},
            ],
        },
    )
    assert result.status_code == 200, result.text
    dashboard = get(client, "/home", headers)
    assert Decimal(dashboard["budget"]) == Decimal("123.45")
    categories = {c["name"]: c for c in dashboard["categories"]}
    assert categories["Groceries"]["limit_amount"] == "123.45"
    assert categories["Bills"]["limit_amount"] == "900.25"
    assert categories["Food out"]["kind"] == "fixed"
    assert categories["Coffee"]["kind"] == "fixed"
    assert "Shopping" not in categories


def test_review_verdict_balance_adjustment_and_idempotent_completion(client, headers):
    data = draft(client, headers, occurred_at=(datetime.now(UTC) - timedelta(days=8)).isoformat())
    result = post(client, "/transactions", headers, data)
    assert result.status_code == 201
    id = result.json()["id"]
    review = get(client, "/reviews/current", headers)
    assert len(review["transactions"]) == 1
    assert post(client, "/reviews/current/complete", headers, {}).status_code == 400
    verdict = post(
        client,
        "/reviews/current/verdicts",
        headers,
        {
            "verdicts": [
                {
                    "id": id,
                    "verdict": "worth_it",
                    "classification": "want",
                    "trigger_tags": ["social"],
                }
            ]
        },
    )
    assert verdict.status_code == 200, verdict.text
    balances = [{"account_id": a["id"], "balance": "-30.00"} for a in review["accounts"]]
    done = post(client, "/reviews/current/complete", headers, {"balances": balances})
    assert done.status_code == 200, done.text
    assert Decimal(done.json()["worth_it_rate"]) == 100
    repeated = post(client, "/reviews/current/complete", headers, {"balances": balances})
    assert repeated.status_code == 200
    assert len([t for t in get(client, "/transactions", headers) if t["kind"] == "adjustment"]) == 1
    assert Decimal(get(client, "/accounts", headers)[0]["balance"]) == -30


def test_sinking_fund_payment_and_delete_restore_fund(client, headers):
    goal = post(
        client, "/goals", headers, {"name": "Gifts", "target": "300", "kind": "sinking_fund"}
    ).json()
    assert (
        post(client, f"/goals/{goal['id']}/deposit", headers, {"amount": "100"}).status_code == 200
    )
    kept = get(client, "/home", headers)["kept"]
    result = post(client, "/transactions", headers, draft(client, headers, goal_id=goal["id"]))
    assert result.status_code == 201, result.text
    assert get(client, "/home", headers)["kept"] == kept
    assert Decimal(get(client, "/goals", headers)[0]["saved"]) == Decimal("75.40")
    assert (
        client.delete(PREFIX + "/transactions/" + result.json()["id"], headers=headers).status_code
        == 200
    )
    assert Decimal(get(client, "/goals", headers)[0]["saved"]) == 100


def test_quips_rotate_and_cool_down(client, headers, db_session):
    user = db_session.scalar(select(User))
    lines = [
        next_quip(db_session, user, "wishlist_let_go", {"amount": "CAD 20"})["text"]
        for _ in range(4)
    ]
    assert len(set(lines)) == 4
    ctx = {"days": 4}
    assert next_quip(db_session, user, "app_open", ctx)["rule_id"] == "streak"
    assert next_quip(db_session, user, "app_open", ctx)["rule_id"] == "neutral"
    for _, (sweet, savage, *_) in TEXT.items():
        assert len(sweet) >= 3 and len(savage) >= 3


def test_rules_preview_and_toggle(client, headers):
    data = draft(client, headers)
    category = data["category_id"]
    rule = post(
        client,
        "/rules",
        headers,
        {"name": "One is enough", "kind": "count", "category_id": category, "max_count": 1},
    )
    assert rule.status_code == 201
    post(client, "/transactions", headers, data)
    preview = post(
        client,
        "/about-to-buy/preview",
        headers,
        {"name": "Another", "price": "10", "category_id": category},
    )
    assert len(preview.json()["broken_rules"]) == 1
    client.patch(PREFIX + "/me", headers=headers, json={"preferences": {"rules": False}})
    assert (
        post(
            client,
            "/about-to-buy/preview",
            headers,
            {"name": "Another", "price": "10", "category_id": category},
        ).json()["broken_rules"]
        == []
    )


def test_cost_per_use_and_subscription_check_dedup(client, headers):
    item = post(client, "/transactions", headers, draft(client, headers, track_uses=True)).json()
    for _ in range(2):
        result = post(client, f"/transactions/{item['id']}/uses", headers, {})
        assert result.status_code == 200
    assert Decimal(result.json()["cost_per_use"]) == Decimal("12.30")
    sub = post(
        client,
        "/subscriptions",
        headers,
        {"name": "Streaming", "amount": "12", "next_date": "2027-01-01"},
    ).json()
    for _ in range(2):
        checked = post(client, f"/subscriptions/{sub['id']}/check", headers, {"used": False})
    assert checked.json()["unused_months"] == 1


def test_malformed_import_rolls_back_and_invalid_dates_are_422(client, headers):
    post(client, "/transactions", headers, draft(client, headers))
    exported = get(client, "/export", headers)
    exported["tables"]["transactions"][0]["category_id"] = "not-an-owned-category"
    result = post(client, "/import", headers, exported)
    assert result.status_code == 400
    assert len(get(client, "/transactions", headers)) == 1
    assert (
        post(
            client,
            "/goals",
            headers,
            {"name": "Bad date", "target": "100", "due_date": "2027-99-99"},
        ).status_code
        == 422
    )


def test_wrapped_snapshot_and_future_month_guard(client, headers):
    month = (
        svc.today(type("User", (), {"timezone": "UTC"})()).replace(day=1) - timedelta(days=1)
    ).strftime("%Y-%m")
    assert get(client, "/wrapped/" + month, headers)["available"] is False
    result = post(
        client,
        "/transactions",
        headers,
        draft(
            client,
            headers,
            occurred_at=month + "-15T12:00:00Z",
        ),
    )
    assert result.status_code == 201, result.text
    first = get(client, "/wrapped/" + month, headers)
    second = get(client, "/wrapped/" + month, headers)
    assert first["id"] == second["id"]
    assert len(first["slides"]) == 6
    assert client.get(PREFIX + "/wrapped/2099-01", headers=headers).status_code == 409


def test_wrapped_without_limits_shows_spending_not_a_budget_claim(client, headers):
    month = (
        svc.today(type("User", (), {"timezone": "UTC"})()).replace(day=1) - timedelta(days=1)
    ).strftime("%Y-%m")
    for category in get(client, "/categories", headers):
        client.patch(
            PREFIX + "/categories/" + category["id"],
            headers=headers,
            json={"limit_amount": None, "max_count": None},
        )
    result = post(
        client,
        "/transactions",
        headers,
        draft(client, headers, occurred_at=month + "-15T12:00:00Z"),
    )
    assert result.status_code == 201, result.text
    slide = get(client, "/wrapped/" + month, headers)["slides"][0]
    assert slide["title"] == "Your month in spending."
    assert Decimal(slide["amount"]) == Decimal("24.60")
    assert "budget" not in slide["text"]
