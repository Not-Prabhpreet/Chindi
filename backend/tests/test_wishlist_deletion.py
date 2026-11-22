from datetime import UTC, datetime, timedelta

import pytest

from app.config import get_settings
from app.models import WishlistItem
from tests.test_budget import PREFIX, draft, get, post


def make_ready(db, item):
    db.get(WishlistItem, item["id"]).ready_at = datetime.now(UTC) - timedelta(seconds=1)
    db.commit()


@pytest.mark.parametrize("ready", [False, True])
def test_delete_waiting_or_ready_wish_preserves_budget_and_does_not_count_as_saving(
    client, headers, db_session, ready
):
    transaction = post(
        client, "/transactions", headers, draft(client, headers, merchant="Existing receipt")
    ).json()
    goal = post(client, "/goals", headers, {"name": "Trip", "target": "1000"}).json()
    post(client, "/goals/" + goal["id"] + "/deposit", headers, {"amount": "50"})
    decided = post(
        client, "/wishlist", headers, {"name": "Previous decision", "price": "20"}
    ).json()
    make_ready(db_session, decided)
    assert (
        post(
            client, "/wishlist/" + decided["id"] + "/decide", headers, {"decision": "let_go"}
        ).status_code
        == 200
    )
    item = post(
        client, "/wishlist", headers, {"name": "TV", "price": "100", "from_pause": True}
    ).json()
    if ready:
        make_ready(db_session, item)
    before = get(client, "/home", headers)
    saved = get(client, "/wishlist", headers)
    result = client.delete(PREFIX + "/wishlist/" + item["id"], headers=headers)
    assert result.status_code == 200, result.text
    assert db_session.get(WishlistItem, item["id"]) is None
    after = get(client, "/home", headers)
    for key in ("spent", "kept", "accounts", "goals", "points", "level"):
        assert after[key] == before[key], key
    remaining = get(client, "/wishlist", headers)
    assert [w["id"] for w in remaining["items"]] == [decided["id"]]
    for key in ("money_not_wasted", "available_to_allocate", "this_year"):
        assert remaining[key] == saved[key], key
    assert get(client, "/transactions", headers)[0]["id"] == transaction["id"]
    assert (
        post(
            client, "/wishlist/" + item["id"] + "/decide", headers, {"decision": "let_go"}
        ).status_code
        == 404
    )
    assert all(w["id"] != item["id"] for w in get(client, "/export", headers)["tables"]["wishlist"])
    if ready:
        # The deleted wish must leave the weekly review. Don't assert on review_ready itself:
        # on Sundays the review covers the current week, so the transaction above makes it true.
        review = get(client, "/reviews/current", headers)
        assert all(w["id"] != item["id"] for w in review["wishlist"])
        assert after["review_ready"] is bool(review["transactions"])


@pytest.mark.parametrize("decision", ["buy", "let_go"])
def test_delete_cannot_erase_a_completed_decision_or_its_allocated_savings(
    client, headers, db_session, decision
):
    item = post(client, "/wishlist", headers, {"name": "TV", "price": "100"}).json()
    make_ready(db_session, item)
    assert (
        post(
            client, "/wishlist/" + item["id"] + "/decide", headers, {"decision": decision}
        ).status_code
        == 200
    )
    if decision == "let_go":
        goal = post(client, "/goals", headers, {"name": "Trip", "target": "1000"}).json()
        assert (
            post(
                client,
                "/goals/" + goal["id"] + "/deposit",
                headers,
                {"amount": "50", "source": "wishlist"},
            ).status_code
            == 200
        )
    before = get(client, "/wishlist", headers)
    goals = get(client, "/goals", headers)
    result = client.delete(PREFIX + "/wishlist/" + item["id"], headers=headers)
    assert result.status_code == 409, result.text
    assert get(client, "/wishlist", headers) == before
    assert get(client, "/goals", headers) == goals


def test_wishlist_deletion_is_authenticated_and_owner_scoped(client, headers, monkeypatch):
    item = post(client, "/wishlist", headers, {"name": "TV", "price": "100"}).json()
    assert client.delete(PREFIX + "/wishlist/" + item["id"]).status_code == 401
    monkeypatch.setattr(get_settings(), "allow_signups", True)
    registered = client.post(
        PREFIX + "/auth/register",
        json={"email": "other@example.com", "password": "correct-horse-battery"},
    )
    other = {"Authorization": "Bearer " + registered.json()["access_token"]}
    assert client.delete(PREFIX + "/wishlist/" + item["id"], headers=other).status_code == 404
    assert get(client, "/wishlist", headers)["items"][0]["id"] == item["id"]
