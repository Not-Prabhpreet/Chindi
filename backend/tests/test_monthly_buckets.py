from datetime import date, datetime, timedelta
from decimal import Decimal as D

import pytest

from app.services import budget as svc
from app.services import calculations as calc
from tests.test_budget import PREFIX, get, post


@pytest.mark.parametrize(
    "old_day,new_day,boundary,next_reset",
    [
        (date(2026, 11, 30), date(2026, 12, 1), "2026-12-01T03:30:00Z", "2027-01-01"),
        (date(2026, 12, 31), date(2027, 1, 1), "2027-01-01T03:30:00Z", "2027-02-01"),
        (date(2028, 2, 29), date(2028, 3, 1), "2028-03-01T03:30:00Z", "2028-04-01"),
    ],
)
def test_limits_renew_on_local_first_without_erasing_history(
    client, monkeypatch, old_day, new_day, boundary, next_reset
):
    registered = client.post(
        PREFIX + "/auth/register",
        json={"email": "monthly@example.com", "password": "correct-horse-battery"},
    ).json()
    auth = {"Authorization": "Bearer " + registered["access_token"]}
    account = get(client, "/accounts", auth)[0]["id"]
    buckets = [
        post(client, "/categories", auth, {"name": name, "limit_amount": limit}).json()
        for name, limit in [("Food", "400"), ("Travel", "1500")]
    ]
    # In St John's, UTC's first few hours still belong to the previous month.
    before = datetime.fromisoformat(boundary.replace("Z", "+00:00"))
    assert calc.local_day(before, "America/St_Johns") == new_day
    before -= timedelta(seconds=1)
    for client_id, amount, occurred_at in [
        ("last-month", "350.25", before.isoformat()),
        ("new-month", "20.10", boundary),
    ]:
        result = post(
            client,
            "/transactions",
            auth,
            {
                "client_id": client_id,
                "account_id": account,
                "category_id": buckets[0]["id"],
                "amount": amount,
                "occurred_at": occurred_at,
            },
        )
        assert result.status_code == 201, result.text
    monkeypatch.setattr(svc, "today", lambda _: old_day)
    old = get(client, "/home", auth)
    assert old["monthly_buckets"]["assigned"] == "1900.00"
    assert old["monthly_buckets"]["remaining"] == "1549.75"
    assert old["monthly_buckets"]["next_reset"] == new_day.isoformat()
    assert D(old["daily_average"]) == calc.daily_average(D("350.25"), old_day.day)

    monkeypatch.setattr(svc, "today", lambda _: new_day)
    fresh = get(client, "/home", auth)
    assert fresh["as_of"] == new_day.isoformat()
    assert fresh["monthly_buckets"]["month"] == new_day.strftime("%Y-%m")
    assert fresh["monthly_buckets"]["assigned"] == "1900.00"
    assert fresh["monthly_buckets"]["spent"] == "20.10"
    assert fresh["monthly_buckets"]["remaining"] == "1879.90"
    assert fresh["monthly_buckets"]["next_reset"] == next_reset
    assert fresh["daily_average"] == "20.10"
    assert fresh["categories"][0]["left"] == "379.90"
    assert len(get(client, "/transactions", auth)) == 2
    assert get(client, "/accounts", auth)[0]["balance"] == "-370.35"

    # Missing a month never requires a job or creates duplicate income/transfers.
    monkeypatch.setattr(svc, "today", lambda _: date(2029, 1, 1))
    idle_home = get(client, "/home", auth)
    idle = idle_home["monthly_buckets"]
    assert idle["remaining"] == "1900.00"
    assert idle["spent"] == "0.00"
    assert idle_home["daily_average"] == "0.00"
    assert len(get(client, "/transactions", auth)) == 2


def test_monthly_totals_recompute_after_limit_and_expense_changes(client, headers):
    account = get(client, "/accounts", headers)[0]["id"]
    category = get(client, "/categories", headers)[0]
    starting = get(client, "/home", headers)["monthly_buckets"]
    created = post(
        client,
        "/transactions",
        headers,
        {
            "client_id": "monthly",
            "amount": "90.15",
            "account_id": account,
            "category_id": category["id"],
        },
    ).json()
    spent = get(client, "/home", headers)["monthly_buckets"]
    assert D(spent["remaining"]) == D(starting["assigned"]) - D("90.15")
    changed = client.patch(
        PREFIX + "/categories/" + category["id"], headers=headers, json={"limit_amount": "500"}
    )
    assert changed.status_code == 200
    revised = get(client, "/home", headers)["monthly_buckets"]
    assert D(revised["assigned"]) == D(starting["assigned"]) + D(100)
    assert (
        client.patch(
            PREFIX + "/transactions/" + created["id"], headers=headers, json={"amount": "510.25"}
        ).status_code
        == 200
    )
    assert get(client, "/home", headers)["monthly_buckets"]["spent"] == "510.25"
    assert (
        client.delete(PREFIX + "/transactions/" + created["id"], headers=headers).status_code == 200
    )
    reset = get(client, "/home", headers)["monthly_buckets"]
    assert reset["spent"] == "0.00"
    assert reset["remaining"] == reset["assigned"]


def test_monthly_bucket_projection_is_owner_scoped(client, headers, monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "allow_signups", True)
    registered = client.post(
        PREFIX + "/auth/register",
        json={
            "email": "empty@example.com",
            "password": "correct-horse-battery",
        },
    ).json()
    other = {"Authorization": "Bearer " + registered["access_token"]}
    summary = get(client, "/home", other)["monthly_buckets"]
    assert summary["has_limits"] is False
    assert summary["assigned"] == "0.00"
    assert summary["category_ids"] == []
