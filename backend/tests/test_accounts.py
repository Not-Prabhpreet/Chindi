from decimal import Decimal

import pytest

from app.config import get_settings
from tests.test_budget import PREFIX, get, post


@pytest.mark.parametrize("archived", [False, True])
def test_delete_unused_account_permanently_removes_only_that_account(client, headers, archived):
    existing = get(client, "/accounts", headers)[0]
    account = post(
        client,
        "/accounts",
        headers,
        {
            "name": "Unused savings",
            "kind": "savings",
            "opening_balance": "600",
            "archived": archived,
        },
    ).json()
    info = next(
        a
        for a in get(client, "/accounts?include_archived=true", headers)
        if a["id"] == account["id"]
    )
    assert info["can_delete"] is True
    assert Decimal(info["balance"]) == Decimal("600")
    result = client.delete(PREFIX + "/accounts/" + account["id"] + "/permanent", headers=headers)
    assert result.status_code == 200, result.text
    assert [a["id"] for a in get(client, "/accounts?include_archived=true", headers)] == [
        existing["id"]
    ]
    assert all(
        a["id"] != account["id"] for a in get(client, "/export", headers)["tables"]["accounts"]
    )


def test_delete_blocks_source_and_destination_history_and_restore_preserves_balances(
    client, headers
):
    source = get(client, "/accounts", headers)[0]
    target = post(
        client,
        "/accounts",
        headers,
        {"name": "Savings", "kind": "savings", "opening_balance": "600"},
    ).json()
    for body in [
        {"client_id": "expense", "kind": "expense", "amount": "24.60"},
        {
            "client_id": "transfer",
            "kind": "transfer",
            "amount": "50",
            "to_account_id": target["id"],
        },
    ]:
        result = post(client, "/transactions", headers, {"account_id": source["id"], **body})
        assert result.status_code == 201, result.text
    before = get(client, "/accounts", headers)
    spent = get(client, "/home", headers)["spent"]
    transactions = get(client, "/transactions", headers)
    for account in before:
        assert account["has_transactions"] is True
        assert account["can_delete"] is False
        result = client.delete(
            PREFIX + "/accounts/" + account["id"] + "/permanent", headers=headers
        )
        assert result.status_code == 409, result.text
        assert result.json()["error"]["code"] == "account_has_history"
        assert (
            client.delete(PREFIX + "/accounts/" + account["id"], headers=headers).status_code == 200
        )
    assert get(client, "/accounts", headers) == []
    for account in get(client, "/accounts?include_archived=true", headers):
        assert account["archived"] is True
        result = client.patch(
            PREFIX + "/accounts/" + account["id"], headers=headers, json={"archived": False}
        )
        assert result.status_code == 200, result.text
    assert get(client, "/accounts", headers) == before
    assert get(client, "/home", headers)["spent"] == spent
    assert get(client, "/transactions", headers) == transactions


def test_delete_blocks_linked_goals_until_explicitly_unlinked(client, headers):
    account = get(client, "/accounts", headers)[0]
    goal = post(
        client, "/goals", headers, {"name": "My goal", "target": "100", "account_id": account["id"]}
    ).json()
    info = get(client, "/accounts", headers)[0]
    assert info["has_transactions"] is False
    assert info["has_linked_goals"] is True
    assert info["can_delete"] is False
    result = client.delete(PREFIX + "/accounts/" + account["id"] + "/permanent", headers=headers)
    assert result.status_code == 409
    assert result.json()["error"]["code"] == "account_linked_to_goal"
    unlinked = client.patch(
        PREFIX + "/goals/" + goal["id"], headers=headers, json={"account_id": None}
    )
    assert unlinked.status_code == 200, unlinked.text
    assert (
        client.delete(
            PREFIX + "/accounts/" + account["id"] + "/permanent", headers=headers
        ).status_code
        == 200
    )
    assert get(client, "/goals", headers)[0]["name"] == "My goal"


def test_deletion_rechecks_activity_after_the_account_list_was_loaded(client, headers):
    account = get(client, "/accounts", headers)[0]
    assert account["can_delete"] is True
    result = post(
        client,
        "/transactions",
        headers,
        {"client_id": "new-income", "kind": "income", "account_id": account["id"], "amount": "7"},
    )
    assert result.status_code == 201
    assert (
        client.delete(
            PREFIX + "/accounts/" + account["id"] + "/permanent", headers=headers
        ).status_code
        == 409
    )
    assert Decimal(get(client, "/accounts", headers)[0]["balance"]) == Decimal("7")


def test_permanent_delete_is_owner_scoped(client, headers, monkeypatch):
    account = get(client, "/accounts", headers)[0]
    monkeypatch.setattr(get_settings(), "allow_signups", True)
    result = client.post(
        PREFIX + "/auth/register",
        json={"email": "other@example.com", "password": "correct-horse-battery"},
    )
    other = {"Authorization": "Bearer " + result.json()["access_token"]}
    assert (
        client.delete(
            PREFIX + "/accounts/" + account["id"] + "/permanent", headers=other
        ).status_code
        == 404
    )
    assert get(client, "/accounts", headers)[0]["id"] == account["id"]


def test_archived_accounts_cannot_receive_or_send_new_goal_transfers(client, headers):
    source = get(client, "/accounts", headers)[0]
    target = post(client, "/accounts", headers, {"name": "Savings", "kind": "savings"}).json()
    goal = post(
        client, "/goals", headers, {"name": "Trip", "target": "100", "account_id": target["id"]}
    ).json()
    assert client.delete(PREFIX + "/accounts/" + target["id"], headers=headers).status_code == 200
    body = {"amount": "10", "from_account_id": source["id"]}
    result = post(client, "/goals/" + goal["id"] + "/deposit", headers, body)
    assert result.status_code == 400, result.text
    assert result.json()["error"]["code"] == "account_archived"
    client.patch(PREFIX + "/accounts/" + target["id"], headers=headers, json={"archived": False})
    client.delete(PREFIX + "/accounts/" + source["id"], headers=headers)
    assert post(client, "/goals/" + goal["id"] + "/deposit", headers, body).status_code == 400
    assert Decimal(get(client, "/goals", headers)[0]["saved"]) == 0
    assert get(client, "/transactions", headers) == []
