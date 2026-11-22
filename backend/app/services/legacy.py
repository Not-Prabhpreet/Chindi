"""Retire the identifiable budget invented by the first version of registration."""

from decimal import Decimal

from app.models import Category, Rule, Transaction, User, WishlistItem
from app.services import budget as svc
from app.services.calculations import utc

STARTER = [
    ("Groceries", "400", None, "cart", "sky-soft", None, "flexible"),
    ("Food out", "140", None, "food", "mango-soft", None, "flexible"),
    ("Shopping", "150", None, "bag", "bubblegum-soft", None, "flexible"),
    ("Fun", "100", None, "ticket", "tomato-soft", None, "flexible"),
    ("Transport", "100", None, "bus", "mint-soft", None, "flexible"),
    ("Coffee", "40", None, "bag", "sky-soft", "Food out", "flexible"),
    ("Takeout", None, 3, "bag", "sky-soft", "Food out", "flexible"),
    ("Bills", None, None, "home", "sky-soft", None, "fixed"),
]


def retire_starter_budget(db, user: User) -> bool:
    categories = svc.rows(db, Category, user)
    # The old seed inserted all eight records at registration. A name alone is
    # never evidence that a user's own category or limit is a preset.
    initial = [
        c for c in categories if 0 <= (utc(c.created_at) - utc(user.created_at)).total_seconds() < 2
    ]
    by_name = {c.name: c for c in initial}
    if len(initial) != len(STARTER) or len(by_name) != len(STARTER):
        return False
    for position, (name, amount, count, icon, color, parent, kind) in enumerate(STARTER):
        c = by_name.get(name)
        if c is None or (
            c.limit_amount,
            c.max_count,
            c.icon,
            c.color,
            c.parent_id,
            c.kind,
            c.position,
            c.archived,
        ) != (
            Decimal(amount) if amount is not None else None,
            count,
            icon,
            color,
            by_name[parent].id if parent else None,
            kind,
            position,
            False,
        ):
            return False
    used = {
        item.category_id
        for model in (Transaction, Rule, WishlistItem)
        for item in svc.rows(db, model, user)
    }
    used.update(c.parent_id for c in categories if c.id in used or c not in initial)
    for c in initial:
        c.limit_amount = None
        c.max_count = None
        c.archived = c.id not in used
    user.preferences = {**user.preferences, "starter_budget_retired": True}
    db.flush()
    return True
