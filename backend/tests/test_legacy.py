from datetime import UTC, datetime, timedelta
from decimal import Decimal

from app.models import Account, Category, Transaction, User
from app.services import budget as svc
from app.services.legacy import STARTER, retire_starter_budget


def legacy_user(db):
    user = User(email="old@example.com", password_hash="unused", created_at=datetime.now(UTC))
    db.add(user)
    db.flush()
    created = {}
    for position, (name, amount, count, icon, color, parent, kind) in enumerate(STARTER):
        c = Category(
            user_id=user.id,
            name=name,
            limit_amount=Decimal(amount) if amount else None,
            max_count=count,
            icon=icon,
            color=color,
            parent_id=created[parent].id if parent else None,
            kind=kind,
            position=position,
            created_at=user.created_at + timedelta(milliseconds=10),
        )
        db.add(c)
        db.flush()
        created[name] = c
    return user, created


def test_retire_presets_preserves_real_expenses_and_account_balances(db_session):
    db = db_session
    user, cats = legacy_user(db)
    account = Account(user_id=user.id, name="My account", opening_balance=Decimal("200"))
    db.add(account)
    db.flush()
    transaction = Transaction(
        user_id=user.id,
        client_id="real",
        account_id=account.id,
        category_id=cats["Coffee"].id,
        amount=Decimal("20"),
    )
    db.add(transaction)
    db.flush()
    before = svc.home(db, user)
    assert before["has_budget"] is True
    assert retire_starter_budget(db, user) is True
    after = svc.home(db, user)
    assert after["spent"] == before["spent"] == Decimal("20")
    assert after["accounts"][0]["balance"] == before["accounts"][0]["balance"]
    assert after["has_budget"] is False
    assert after["kept"] is None
    assert {c["name"] for c in after["categories"]} == {"Food out", "Coffee"}
    assert transaction.category_id == cats["Coffee"].id
    assert retire_starter_budget(db, user) is False


def test_customized_presets_and_independent_user_categories_are_preserved(db_session):
    user, cats = legacy_user(db_session)
    cats["Groceries"].limit_amount = Decimal("475")
    db_session.flush()
    assert retire_starter_budget(db_session, user) is False
    assert cats["Groceries"].limit_amount == Decimal("475")
    assert all(not c.archived for c in cats.values())


def test_custom_children_keep_their_parent_when_presets_are_retired(db_session):
    user, cats = legacy_user(db_session)
    db_session.add(
        Category(
            user_id=user.id,
            name="My supplies",
            parent_id=cats["Shopping"].id,
            created_at=user.created_at + timedelta(days=1),
        )
    )
    db_session.flush()
    assert retire_starter_budget(db_session, user) is True
    assert cats["Shopping"].archived is False
    assert cats["Shopping"].limit_amount is None
