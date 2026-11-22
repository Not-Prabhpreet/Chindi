from datetime import UTC, date, datetime
from decimal import Decimal as D

from sqlalchemy import select

from app.models import User
from app.services import budget as svc
from tests.test_budget import PREFIX, draft, get, post


def test_backdated_create_and_date_edit_recalculate_averages_months_balances_and_streak(
    client, headers, db_session, monkeypatch
):
    monkeypatch.setattr(svc, "today", lambda _: date(2026, 11, 10))
    user = db_session.scalar(select(User))
    user.created_at = datetime(2026, 11, 1, 12, tzinfo=UTC)
    db_session.commit()
    assigned = D(get(client, "/home", headers)["monthly_buckets"]["assigned"])
    current = post(
        client,
        "/transactions",
        headers,
        draft(
            client,
            headers,
            client_id="missed-this-month",
            amount="90.00",
            occurred_at="2026-11-06T03:29:00Z",  # Nov 5 in the budget timezone.
        ),
    ).json()
    same_month = get(client, "/home", headers)
    assert same_month["daily_average"] == "9.00"
    assert D(same_month["monthly_buckets"]["remaining"]) == assigned - D(90)
    assert same_month["streak"]["current"] == 5

    past = post(
        client,
        "/transactions",
        headers,
        draft(
            client,
            headers,
            client_id="missed-last-month",
            amount="310.00",
            occurred_at="2026-11-01T02:29:00Z",  # Oct 31 before the DST change.
        ),
    ).json()
    home = get(client, "/home", headers)
    assert home["daily_average"] == "9.00"
    assert home["last_month_average"] == "10.00"
    assert home["monthly_buckets"] == same_month["monthly_buckets"]
    assert home["accounts"][0]["balance"] == "-400.00"

    moved = client.patch(
        PREFIX + "/transactions/" + current["id"],
        headers=headers,
        json={"occurred_at": "2026-10-30T14:30:00Z"},
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["created_at"] == current["created_at"]
    home = get(client, "/home", headers)
    assert home["daily_average"] == "0.00"
    assert home["last_month_average"] == "12.90"
    assert D(home["monthly_buckets"]["remaining"]) == assigned
    assert home["accounts"][0]["balance"] == "-400.00"

    moved = client.patch(
        PREFIX + "/transactions/" + past["id"],
        headers=headers,
        json={"occurred_at": "2026-11-09T19:30:00Z"},
    )
    assert moved.status_code == 200, moved.text
    home = get(client, "/home", headers)
    assert home["daily_average"] == "31.00"
    assert home["last_month_average"] == "2.90"
    assert home["streak"]["current"] == 1
    assert client.delete(PREFIX + "/transactions/" + past["id"], headers=headers).status_code == 200
    assert get(client, "/home", headers)["daily_average"] == "0.00"
