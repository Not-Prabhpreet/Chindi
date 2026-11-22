"""Owner-scoped queries and projections shared by API endpoints and jobs."""

from calendar import monthrange
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import inspect, select

from app.errors import AppError
from app.models import Account, Category, Goal, PointEvent, Review, Rule, Transaction, WishlistItem
from app.services import calculations as calc


def rows(db, model, user):
    return list(db.scalars(select(model).where(model.user_id == user.id)))


def owned(db, model, id, user):
    item = db.scalar(select(model).where(model.id == id, model.user_id == user.id))
    if item is None:
        raise AppError("not_found", "That record doesn't exist.", 404)
    return item


def dump(item):
    result = {}
    for col in inspect(type(item)).columns:
        value = getattr(item, col.key)
        if isinstance(value, Decimal):
            value = str(value)
        elif isinstance(value, datetime):
            value = calc.utc(value).isoformat()
        result[col.key] = value
    return result


def today(user):
    return datetime.now(ZoneInfo(user.timezone)).date()


def in_month(items, user, month=None):
    key = month or today(user).strftime("%Y-%m")
    return [
        t for t in items if calc.local_day(t.occurred_at, user.timezone).strftime("%Y-%m") == key
    ]


def seed(db, user):
    # Categories and limits belong to the user; registration never invents them.
    db.add(Account(user_id=user.id, name="Chequing", kind="chequing", opening_balance=Decimal(0)))


def categories_usage(db, user, month=None, include_archived=False):
    categories = rows(db, Category, user)
    transactions = in_month(rows(db, Transaction, user), user, month)
    return [
        {**dump(c), **calc.category_usage(c, transactions, categories)}
        for c in sorted(categories, key=lambda c: (c.position, c.name))
        if include_archived or not c.archived
    ]


def account_data(db, user, include_archived=False):
    transactions = rows(db, Transaction, user)
    linked_accounts = {g.account_id for g in rows(db, Goal, user) if g.account_id}
    used_accounts = {t.account_id for t in transactions} | {
        t.to_account_id for t in transactions if t.to_account_id
    }
    return [
        {
            **dump(a),
            "balance": calc.account_balance(a, transactions),
            "has_transactions": a.id in used_accounts,
            "has_linked_goals": a.id in linked_accounts,
            "can_delete": a.id not in used_accounts and a.id not in linked_accounts,
            "owed": max(calc.ZERO, -calc.account_balance(a, transactions))
            if a.kind == "credit_card"
            else None,
        }
        for a in rows(db, Account, user)
        if include_archived or not a.archived
    ]


def point(db, user, key, amount):
    if not db.scalar(
        select(PointEvent).where(PointEvent.user_id == user.id, PointEvent.key == key)
    ):
        db.add(PointEvent(user_id=user.id, key=key, points=amount))
        db.flush()


def streak_data(db, user, month=None):
    categories = rows(db, Category, user)
    transactions = calc.flexible_transactions(rows(db, Transaction, user), categories)
    days = {calc.local_day(t.occurred_at, user.timezone) for t in transactions}
    current = today(user)
    created = calc.local_day(user.created_at, user.timezone)
    stats = calc.streaks(days, created, current)
    start = date.fromisoformat((month or current.strftime("%Y-%m")) + "-01")
    grid = []
    for n in range(1, monthrange(start.year, start.month)[1] + 1):
        day = start.replace(day=n)
        grid.append(
            {"date": str(day), "no_spend": day not in days if created <= day <= current else None}
        )
    # Only closed days earn points; logging later cannot take awarded points away.
    day = created
    while day < current:
        if day not in days:
            point(db, user, f"no-spend:{day}", 10)
        day += timedelta(days=1)
    return {**stats, "days": grid}


def week_bounds(user, db=None):
    day = today(user)
    monday = day - timedelta(days=day.weekday())
    start = monday if day.weekday() == 6 else monday - timedelta(days=7)
    if db is not None:
        completed = {r.week for r in rows(db, Review, user)}
        candidates = []
        for item in calc.flexible_transactions(
            rows(db, Transaction, user), rows(db, Category, user)
        ):
            logged = calc.local_day(item.occurred_at, user.timezone)
            week = logged - timedelta(days=logged.weekday())
            if week <= start and str(week) not in completed:
                candidates.append(week)
        if candidates:
            start = min(candidates)
    return start, start + timedelta(days=7)


def review_data(db, user):
    start, end = week_bounds(user, db)
    items = calc.flexible_transactions(rows(db, Transaction, user), rows(db, Category, user))
    items = [t for t in items if start <= calc.local_day(t.occurred_at, user.timezone) < end]
    complete = any(r.week == str(start) for r in rows(db, Review, user))
    wishes = [
        w
        for w in rows(db, WishlistItem, user)
        if w.status == "waiting" and calc.utc(w.ready_at) <= datetime.now(UTC)
    ]
    return {
        "week": str(start),
        "complete": complete,
        "transactions": [
            dump(t) for t in sorted(items, key=lambda t: t.occurred_at) if not t.verdict
        ],
        "wishlist": [dump(w) for w in wishes],
        "accounts": account_data(db, user),
        "worth_it_rate": calc.worth_rate(items),
    }


def goal_data(db, user):
    result = []
    for goal in rows(db, Goal, user):
        result.append(
            {
                **dump(goal),
                "percent": min(Decimal(100), goal.saved * 100 / goal.target),
                "monthly_suggestion": calc.monthly_fund(
                    goal.target, goal.saved, date.fromisoformat(goal.due_date), today(user)
                )
                if goal.due_date
                else None,
            }
        )
    return result


def broken_rules(db, user, category_id):
    if user.preferences.get("rules") is False:
        return []
    if not category_id:
        return []
    category = owned(db, Category, category_id, user)
    ids = {category.id, category.parent_id}
    items = in_month(rows(db, Transaction, user), user)
    result = []
    for rule in rows(db, Rule, user):
        if not rule.active or rule.category_id not in ids:
            continue
        count = sum(
            t.kind == "expense"
            and t.category_id
            in {
                c.id
                for c in rows(db, Category, user)
                if c.id == rule.category_id or c.parent_id == rule.category_id
            }
            for t in items
        )
        if rule.kind == "no_buy" and rule.until and today(user) <= date.fromisoformat(rule.until):
            result.append(dump(rule))
        if rule.kind == "count" and rule.max_count and count >= rule.max_count:
            result.append(dump(rule))
    return result


def home(db, user):
    current = today(user)
    month = current.strftime("%Y-%m")
    categories = rows(db, Category, user)
    all_transactions = rows(db, Transaction, user)
    flex = calc.flexible_transactions(all_transactions, categories)
    this_month = in_month(flex, user, month)
    spent = sum((t.amount for t in this_month), calc.ZERO)
    budget = sum(
        (
            c.limit_amount or calc.ZERO
            for c in categories
            if not c.archived and c.kind == "flexible" and not c.parent_id
        ),
        calc.ZERO,
    )
    has_budget = any(
        not c.archived and c.kind == "flexible" and not c.parent_id and c.limit_amount is not None
        for c in categories
    )
    previous = current.replace(day=1) - timedelta(days=1)
    past = in_month(flex, user, previous.strftime("%Y-%m"))
    past_spent = sum((t.amount for t in past), calc.ZERO)
    streak = streak_data(db, user)
    points = sum(p.points for p in rows(db, PointEvent, user))
    from app.quips.engine import next_quip

    usage = categories_usage(db, user, month)
    buckets = calc.monthly_buckets(categories, in_month(all_transactions, user, month))
    next_reset = (current.replace(day=28) + timedelta(days=4)).replace(day=1)
    quip = next_quip(
        db,
        user,
        "app_open",
        {
            "categories": usage,
            "days": streak["current"],
            "goals": goal_data(db, user),
            "empty_day": not any(
                calc.local_day(t.occurred_at, user.timezone) == current for t in all_transactions
            ),
            "hour": datetime.now(ZoneInfo(user.timezone)).hour,
        },
    )
    review = review_data(db, user)
    return {
        "as_of": current.isoformat(),
        "monthly_buckets": {
            **buckets,
            "month": month,
            "next_reset": next_reset.isoformat(),
        },
        "kept": calc.kept(budget, spent, current) if has_budget else None,
        "has_budget": has_budget,
        "uncategorized_count": sum(
            t.kind == "expense" and t.category_id is None for t in all_transactions
        ),
        "spent": spent,
        "budget": budget,
        "daily_average": calc.daily_average(spent, current.day),
        "last_month_average": calc.daily_average(past_spent, previous.day),
        "has_previous_month": bool(past),
        "wrapped_month": previous.strftime("%Y-%m")
        if past
        or any(
            w.status == "let_go"
            and w.decided_at
            and calc.local_day(w.decided_at, user.timezone).strftime("%Y-%m")
            == previous.strftime("%Y-%m")
            for w in rows(db, WishlistItem, user)
        )
        else None,
        "last_month_name": previous.strftime("%b"),
        "streak": streak,
        "categories": usage,
        "accounts": account_data(db, user),
        "goals": goal_data(db, user),
        "quip": quip,
        "points": points,
        "level": calc.level(points),
        "review_ready": not review["complete"]
        and bool(review["transactions"] or review["wishlist"]),
        "review_count": len(review["transactions"]),
        "fresh_start": current.day == 1
        or user.preferences.get("birthday") == current.strftime("%m-%d"),
        "month_end": current.day == monthrange(current.year, current.month)[1],
    }
