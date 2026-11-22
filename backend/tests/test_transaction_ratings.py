from datetime import UTC, datetime

from app.models import Transaction
from tests.test_budget import PREFIX, draft, get, post


def test_saved_purchase_ratings_survive_history_and_do_not_replace_review_or_money(
    client, headers, db_session
):
    created = post(client, "/transactions", headers, draft(client, headers, feeling="love")).json()
    record = db_session.get(Transaction, created["id"])
    record.verdict = "worth_it"
    record.reviewed_at = datetime.now(UTC)
    record.classification = "want"
    db_session.commit()
    baseline = get(client, "/transactions", headers)[0]
    balance = get(client, "/accounts", headers)
    totals = get(client, "/home", headers)["monthly_buckets"]
    for feeling in ["good", "meh", "regret", "love", None]:
        result = client.patch(
            PREFIX + "/transactions/" + record.id, headers=headers, json={"feeling": feeling}
        )
        assert result.status_code == 200, result.text
        saved = get(client, "/transactions", headers)[0]
        assert saved["feeling"] == feeling
        assert {k: v for k, v in saved.items() if k != "feeling"} == {
            k: v for k, v in baseline.items() if k != "feeling"
        }
        assert get(client, "/accounts", headers) == balance
        assert get(client, "/home", headers)["monthly_buckets"] == totals
