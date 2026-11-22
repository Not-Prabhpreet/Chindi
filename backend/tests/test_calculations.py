from datetime import UTC, date, datetime
from decimal import Decimal as D
from types import SimpleNamespace as Item

from app.quiz.scoring import score
from app.services import calculations as c


def test_kept_and_averages_include_leap_year_and_month_end():
    assert c.kept(D(1000), D(100), date(2024, 2, 29)) == D(900)
    assert c.kept(D(900), D(100), date(2026, 11, 10)) == D(200)
    assert c.daily_average(D(100), 3) == D("33.33")
    assert c.kept(D(0), D("24.60"), date(2026, 11, 2)) == D("-24.60")


def test_category_rollup_count_and_bar_boundaries():
    parent = Item(id="p", parent_id=None, limit_amount=D(100), max_count=None)
    child = Item(id="c", parent_id="p", limit_amount=None, max_count=2)
    tx = [Item(kind="expense", category_id="c", amount=D(85))]
    assert c.category_usage(parent, tx, [parent, child])["state"] == "near"
    assert c.category_usage(parent, tx, [parent, child])["left"] == 15
    assert c.category_usage(child, tx, [parent, child])["left"] == 1
    tx[0].amount = D(101)
    assert c.category_usage(parent, tx, [parent, child])["state"] == "over"


def test_combined_monthly_buckets_include_fixed_without_counting_sublimits_twice():
    def category(id, limit=None, parent=None, archived=False, kind="flexible"):
        return Item(
            id=id,
            limit_amount=D(limit) if limit is not None else None,
            parent_id=parent,
            archived=archived,
            kind=kind,
        )

    categories = [
        category("food", "400"),
        category("coffee", "50", "food"),
        category("old-child", "30", "food", archived=True),
        category("rent", "1000", kind="fixed"),
        category("travel", "500"),
        category("no-limit"),
        category("old", "900", archived=True),
    ]
    transactions = [
        Item(kind=kind, category_id=cat, amount=D(amount))
        for kind, cat, amount in [
            ("expense", "food", "200.10"),
            ("expense", "coffee", "20.20"),
            ("expense", "old-child", "10.05"),
            ("expense", "rent", "1000"),
            ("expense", "no-limit", "40"),
            ("expense", None, "5"),
            ("expense", "old", "7"),
            ("income", "food", "900"),
            ("transfer", "travel", "100"),
            ("adjustment", "food", "10"),
        ]
    ]
    totals = c.monthly_buckets(categories, transactions)
    assert totals == {
        "has_limits": True,
        "assigned": D("1900.00"),
        "spent": D("1230.35"),
        "remaining": D("669.65"),
        "unbudgeted_spent": D("52.00"),
        "category_ids": ["coffee", "food", "old-child", "rent", "travel"],
    }


def test_monthly_buckets_support_child_only_limits_zero_limits_and_overspending():
    categories = [
        Item(id="parent", parent_id=None, archived=False, limit_amount=None),
        Item(id="child", parent_id="parent", archived=False, limit_amount=D("25.10")),
        Item(id="zero", parent_id=None, archived=False, limit_amount=D(0)),
    ]
    totals = c.monthly_buckets(
        categories,
        [
            Item(kind="expense", category_id="child", amount=D("30.20")),
            Item(kind="expense", category_id="zero", amount=D("0.10")),
            Item(kind="expense", category_id="parent", amount=D("5")),
        ],
    )
    assert totals["assigned"] == D("25.10")
    assert totals["spent"] == D("30.30")
    assert totals["remaining"] == D("-5.20")
    assert totals["unbudgeted_spent"] == D("5")
    assert c.monthly_buckets(categories[2:], [])["has_limits"] is True
    assert c.monthly_buckets(categories[:1], [])["has_limits"] is False


def test_timezone_dst_and_streak_start_date():
    assert c.local_day(datetime(2026, 11, 2, 2, tzinfo=UTC), "America/St_Johns") == date(
        2026, 11, 1
    )
    assert c.streaks({date(2026, 11, 2)}, date(2026, 11, 1), date(2026, 11, 5)) == {
        "current": 3,
        "best": 3,
    }
    assert c.streaks(set(), date(2026, 11, 5), date(2026, 11, 5))["current"] == 1
    assert c.streaks(set(), date(2026, 11, 28), date(2026, 12, 1))["current"] == 4


def test_balances_do_not_double_count_transfer():
    accounts = [Item(id="a", opening_balance=D(100)), Item(id="b", opening_balance=D(-50))]
    tx = [Item(kind="transfer", amount=D(20), account_id="a", to_account_id="b")]
    assert [c.account_balance(a, tx) for a in accounts] == [D(80), D(-30)]


def test_wishlist_thresholds_rates_impact_habit_levels_and_funds():
    assert [c.wishlist_hours(D(n)) for n in (99, 100, 300, 301)] == [72, 168, 168, 720]
    tx = [Item(verdict="regret"), Item(verdict="worth_it"), Item(verdict="worth_it")]
    assert c.regret_rate(tx[:2]) is None
    assert c.regret_rate(tx) == D("33.33")
    assert c.worth_rate(tx) == D("66.67")
    assert c.goal_impact(D(100), D(1000), D(500)) == 20
    assert c.goal_impact(D(100), D(1000), D(1000)) is None
    assert c.yearly_habit(D(90)) == 365
    assert [c.level(n) for n in (0, 300, 900, 2000)] == [
        "Shopaholic",
        "Recovering",
        "Chindi",
        "Ultra Chindi",
    ]
    assert c.monthly_fund(D(1200), D(0), date(2027, 11, 1), date(2026, 11, 1)) == 100
    assert c.late_night(datetime(2026, 11, 2, 2, tzinfo=UTC), "America/St_Johns")


def test_quiz_ties_follow_table_order():
    assert score([True] * 6)["personality"] == "Midnight Cart Goblin"
    assert score([False] * 6)["personality"] == "Secret Chindi"
