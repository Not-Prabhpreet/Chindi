from app.config import get_settings
from tests.test_budget import PREFIX, draft, get, post


def test_empty_history_has_no_filter_options_even_with_unused_archived_categories(client, headers):
    for category in get(client, "/categories", headers):
        client.delete(PREFIX + "/categories/" + category["id"], headers=headers)
    filters = get(client, "/transactions/filters", headers)
    assert filters == {
        "has_transactions": False,
        "has_uncategorized": False,
        "categories": [],
        "accounts": [],
    }


def test_filters_follow_real_history_keep_used_archived_labels_and_clear_after_recategorizing(
    client, headers
):
    used = get(client, "/categories", headers)[0]
    account = get(client, "/accounts", headers)[0]
    unused = post(client, "/categories", headers, {"name": "Never used"}).json()
    unused_account = post(client, "/accounts", headers, {"name": "Never used account"}).json()
    record = post(
        client, "/transactions", headers, draft(client, headers, category_id=used["id"])
    ).json()
    client.delete(PREFIX + "/categories/" + used["id"], headers=headers)
    client.delete(PREFIX + "/accounts/" + account["id"], headers=headers)
    filters = get(client, "/transactions/filters", headers)
    assert filters["has_transactions"] is True
    assert filters["has_uncategorized"] is False
    assert [c["id"] for c in filters["categories"]] == [used["id"]]
    assert filters["categories"][0]["archived"] is True
    assert [a["id"] for a in filters["accounts"]] == [account["id"]]
    assert filters["accounts"][0]["archived"] is True
    updated = client.patch(
        PREFIX + "/transactions/" + record["id"],
        headers=headers,
        json={"category_id": unused["id"]},
    )
    assert updated.status_code == 200, updated.text
    assert [c["id"] for c in get(client, "/transactions/filters", headers)["categories"]] == [
        unused["id"]
    ]
    updated = client.patch(
        PREFIX + "/transactions/" + record["id"], headers=headers, json={"category_id": None}
    )
    assert updated.status_code == 200, updated.text
    filters = get(client, "/transactions/filters", headers)
    assert filters["categories"] == []
    assert filters["has_uncategorized"] is True
    assert unused_account["id"] not in [a["id"] for a in filters["accounts"]]
    assert (
        client.delete(PREFIX + "/transactions/" + record["id"], headers=headers).status_code == 200
    )
    assert get(client, "/transactions/filters", headers)["has_transactions"] is False


def test_filter_accounts_include_both_transfer_sides_and_are_owner_scoped(
    client, headers, monkeypatch
):
    source = get(client, "/accounts", headers)[0]
    target = post(client, "/accounts", headers, {"name": "Savings", "kind": "savings"}).json()
    result = post(
        client,
        "/transactions",
        headers,
        {
            "client_id": "transfer",
            "kind": "transfer",
            "amount": "20",
            "account_id": source["id"],
            "to_account_id": target["id"],
        },
    )
    assert result.status_code == 201, result.text
    filters = get(client, "/transactions/filters", headers)
    assert {a["id"] for a in filters["accounts"]} == {source["id"], target["id"]}
    assert filters["categories"] == []
    assert filters["has_uncategorized"] is False
    monkeypatch.setattr(get_settings(), "allow_signups", True)
    registration = client.post(
        PREFIX + "/auth/register",
        json={"email": "other@example.com", "password": "correct-horse-battery"},
    )
    other = {"Authorization": "Bearer " + registration.json()["access_token"]}
    assert get(client, "/transactions/filters", other) == {
        "has_transactions": False,
        "has_uncategorized": False,
        "categories": [],
        "accounts": [],
    }
    assert client.get(PREFIX + "/transactions/filters").status_code == 401
