"""The build spec's financial definitions, independent of HTTP and persistence."""

from calendar import monthrange
from datetime import UTC, date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from zoneinfo import ZoneInfo

ZERO = Decimal("0.00")


def money(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def local_day(value: datetime, timezone: str) -> date:
    return utc(value).astimezone(ZoneInfo(timezone)).date()


def kept(limit: Decimal, spent: Decimal, today: date) -> Decimal:
    return money(
        limit * Decimal(today.day) / Decimal(monthrange(today.year, today.month)[1]) - spent
    )


def daily_average(spent: Decimal, days: int) -> Decimal:
    return money(spent / Decimal(max(1, days)))


def category_usage(category, transactions, categories):
    ids = {category.id} | {c.id for c in categories if c.parent_id == category.id}
    items = [t for t in transactions if t.kind == "expense" and t.category_id in ids]
    spent = sum((t.amount for t in items), ZERO)
    if category.max_count:
        ratio = Decimal(len(items)) / Decimal(category.max_count)
        left = category.max_count - len(items)
    elif category.limit_amount is not None:
        ratio = spent / category.limit_amount if category.limit_amount else Decimal(bool(spent)) * 2
        left = category.limit_amount - spent
    else:
        ratio, left = ZERO, None
    return {
        "spent": spent,
        "left": left,
        "count_used": len(items),
        "percent": min(Decimal(100), ratio * 100),
        "state": "over" if ratio > 1 else "near" if ratio >= Decimal(".85") else "normal",
    }


def monthly_buckets(categories, transactions):
    """Combine recurring amount limits and this month's usage without double counting.

    A child's amount limit is part of its parent's amount limit. Under an
    unlimited/count-only parent, monetary child limits are independent buckets.
    Transactions must already be filtered to the user's local calendar month.
    """
    limited = {c.id: c for c in categories if not c.archived and c.limit_amount is not None}
    buckets = [c for c in limited.values() if c.parent_id not in limited]
    bucket_ids = {c.id for c in buckets}
    covered_ids = bucket_ids | {c.id for c in categories if c.parent_id in bucket_ids}
    assigned = sum((c.limit_amount for c in buckets), ZERO)
    expenses = [t for t in transactions if t.kind == "expense"]
    spent = sum((t.amount for t in expenses if t.category_id in covered_ids), ZERO)
    outside = sum((t.amount for t in expenses if t.category_id not in covered_ids), ZERO)
    return {
        "has_limits": bool(buckets),
        "assigned": money(assigned),
        "spent": money(spent),
        "remaining": money(assigned - spent),
        "unbudgeted_spent": money(outside),
        "category_ids": sorted(covered_ids),
    }


def flexible_transactions(transactions, categories):
    flex = {c.id for c in categories if c.kind == "flexible"}
    return [
        t
        for t in transactions
        if t.kind == "expense"
        and (t.category_id is None or t.category_id in flex)
        and not t.goal_id
    ]


def account_balance(account, transactions) -> Decimal:
    total = account.opening_balance
    for t in transactions:
        if t.account_id == account.id:
            total += t.amount if t.kind in ("income", "adjustment") else -t.amount
        if t.kind == "transfer" and t.to_account_id == account.id:
            total += t.amount
    return money(total)


def streaks(spend_days: set[date], created: date, today: date):
    current = best = run = 0
    day = created
    while day <= today:
        run = 0 if day in spend_days else run + 1
        best = max(best, run)
        day += timedelta(days=1)
    current = run
    return {"current": current, "best": best}


def regret_rate(transactions):
    reviewed = [t for t in transactions if t.verdict]
    if len(reviewed) < 3:
        return None
    return money(Decimal(sum(t.verdict == "regret" for t in reviewed)) * 100 / len(reviewed))


def goal_impact(price: Decimal, target: Decimal, saved: Decimal):
    return money(price * 100 / (target - saved)) if target > saved else None


def wishlist_hours(price: Decimal) -> int:
    return 72 if price < 100 else 168 if price <= 300 else 720


def worth_rate(transactions) -> Decimal:
    reviewed = [t for t in transactions if t.verdict]
    return (
        money(Decimal(sum(t.verdict == "worth_it" for t in reviewed)) * 100 / len(reviewed))
        if reviewed
        else ZERO
    )


def yearly_habit(spend: Decimal) -> Decimal:
    return money(spend * Decimal(365) / Decimal(90))


def level(points: int) -> str:
    return (
        "Ultra Chindi"
        if points >= 2000
        else "Chindi"
        if points >= 900
        else "Recovering"
        if points >= 300
        else "Shopaholic"
    )


def monthly_fund(target: Decimal, saved: Decimal, due: date, today: date) -> Decimal:
    months = max(1, (due.year - today.year) * 12 + due.month - today.month)
    return money(max(ZERO, target - saved) / months)


def late_night(value: datetime, timezone: str) -> bool:
    hour = utc(value).astimezone(ZoneInfo(timezone)).hour
    return hour >= 22 or hour < 4
