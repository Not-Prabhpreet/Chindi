"""Budget API: ownership is checked at every record boundary."""

from datetime import UTC, date, datetime, timedelta
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field
from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError

from app.db import DbSession
from app.errors import AppError
from app.models import (
    Account,
    Category,
    Goal,
    GoalDeposit,
    Review,
    Rule,
    Subscription,
    Transaction,
    WishlistItem,
)
from app.quips.engine import next_quip
from app.quiz.scoring import CARDS, score
from app.routers.decimal_route import DecimalRoute
from app.schemas.budget import (
    AccountIn,
    CategoryIn,
    DepositIn,
    GoalIn,
    ReviewComplete,
    RuleIn,
    SubscriptionIn,
    TransactionIn,
    Verdicts,
    WishlistIn,
)
from app.services import budget as svc
from app.services import calculations as calc
from app.services.auth import CurrentUser

router = APIRouter(route_class=DecimalRoute)


def save(db, record):
    db.add(record)
    db.commit()
    return svc.dump(record)


def patch_data(schema, record, body):
    original = {key: getattr(record, key) for key in schema.model_fields if hasattr(record, key)}
    original.update(body)
    return schema.model_validate(original)


@router.get("/accounts")
def accounts(user: CurrentUser, db: DbSession, include_archived: bool = False):
    return svc.account_data(db, user, include_archived=include_archived)


@router.post("/accounts", status_code=201)
def add_account(body: AccountIn, user: CurrentUser, db: DbSession):
    return save(db, Account(user_id=user.id, **body.model_dump()))


@router.patch("/accounts/{id}")
def edit_account(id: str, body: dict, user: CurrentUser, db: DbSession):
    record = svc.owned(db, Account, id, user)
    data = patch_data(AccountIn, record, body)
    for key, value in data.model_dump().items():
        setattr(record, key, value)
    return save(db, record)


@router.delete("/accounts/{id}")
def archive_account(id: str, user: CurrentUser, db: DbSession):
    record = svc.owned(db, Account, id, user)
    record.archived = True
    return save(db, record)


@router.delete("/accounts/{id}/permanent")
def delete_unused_account(id: str, user: CurrentUser, db: DbSession):
    record = svc.owned(db, Account, id, user)
    if db.scalar(
        select(Transaction.id)
        .where(
            Transaction.user_id == user.id,
            (Transaction.account_id == id) | (Transaction.to_account_id == id),
        )
        .limit(1)
    ):
        raise AppError(
            "account_has_history",
            "This account has transaction history. Archive it to keep your records.",
            409,
        )
    if db.scalar(select(Goal.id).where(Goal.user_id == user.id, Goal.account_id == id).limit(1)):
        raise AppError(
            "account_linked_to_goal",
            "Unlink this account from your goals before deleting it, or archive it.",
            409,
        )
    db.delete(record)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise AppError(
            "account_in_use", "This account is now in use. Archive it to keep your records.", 409
        ) from exc
    return {"ok": True}


def check_category(db, user, data, id=None):
    if data.parent_id:
        parent = svc.owned(db, Category, data.parent_id, user)
        if parent.parent_id or parent.id == id or parent.archived:
            raise AppError("invalid_parent", "Categories can have only two levels.")
        if parent.kind != data.kind:
            raise AppError("invalid_kind", "A subcategory must have its parent's budget type.")
        if id and any(c.parent_id == id for c in svc.rows(db, Category, user)):
            raise AppError("invalid_parent", "A parent with children cannot become a subcategory.")
    if data.limit_amount is not None and data.max_count:
        raise AppError("invalid_limit", "Choose an amount or a count limit.")


@router.get("/categories")
def categories(
    user: CurrentUser, db: DbSession, with_usage: str | None = None, include_archived: bool = False
):
    return svc.categories_usage(db, user, include_archived=include_archived)


@router.post("/categories", status_code=201)
def add_category(body: CategoryIn, user: CurrentUser, db: DbSession):
    check_category(db, user, body)
    return save(db, Category(user_id=user.id, **body.model_dump()))


@router.patch("/categories/{id}")
def edit_category(id: str, body: dict, user: CurrentUser, db: DbSession):
    record = svc.owned(db, Category, id, user)
    data = patch_data(CategoryIn, record, body)
    check_category(db, user, data, id)
    for key, value in data.model_dump().items():
        setattr(record, key, value)
    for child in svc.rows(db, Category, user):
        if child.parent_id == id:
            child.kind = record.kind
            if record.archived:
                child.archived = True
    return save(db, record)


@router.delete("/categories/{id}")
def archive_category(id: str, user: CurrentUser, db: DbSession):
    return edit_category(id, {"archived": True}, user, db)


def validate_transaction(db, user, body, previous=None):
    account = svc.owned(db, Account, body.account_id, user)
    if account.archived and (previous is None or previous.account_id != account.id):
        raise AppError("account_archived", "Choose an active account.")
    if body.kind != "adjustment" and body.amount <= 0:
        raise AppError("invalid_amount", "Amount must be greater than zero.")
    if body.category_id:
        category = svc.owned(db, Category, body.category_id, user)
        if category.archived and (previous is None or previous.category_id != category.id):
            raise AppError("category_archived", "Choose an active category.")
    if body.kind == "transfer":
        if not body.to_account_id or body.to_account_id == body.account_id:
            raise AppError("invalid_transfer", "Choose a different destination account.")
        target = svc.owned(db, Account, body.to_account_id, user)
        if target.archived and (previous is None or previous.to_account_id != target.id):
            raise AppError("account_archived", "Choose an active destination account.")
    elif body.to_account_id:
        raise AppError("invalid_transfer", "Only transfers have a destination account.")
    if body.goal_id:
        goal = svc.owned(db, Goal, body.goal_id, user)
        if body.kind != "expense" or goal.kind != "sinking_fund":
            raise AppError("invalid_fund", "Only expenses can be paid from a sinking fund.")


def transaction_values(body):
    data = body.model_dump()
    data["occurred_at"] = calc.utc(body.occurred_at) if body.occurred_at else datetime.now(UTC)
    return data


@router.get("/transactions/filters")
def transaction_filters(user: CurrentUser, db: DbSession):
    items = svc.rows(db, Transaction, user)
    category_ids = {t.category_id for t in items if t.category_id}
    account_ids = {t.account_id for t in items} | {
        t.to_account_id for t in items if t.to_account_id
    }
    return {
        "has_transactions": bool(items),
        "has_uncategorized": any(t.kind == "expense" and t.category_id is None for t in items),
        "categories": [
            svc.dump(c)
            for c in sorted(svc.rows(db, Category, user), key=lambda c: (c.position, c.name))
            if c.id in category_ids
        ],
        "accounts": [
            svc.dump(a)
            for a in sorted(svc.rows(db, Account, user), key=lambda a: a.name)
            if a.id in account_ids
        ],
    }


@router.get("/transactions")
def transactions(
    user: CurrentUser,
    db: DbSession,
    q: str = "",
    category_id: str | None = None,
    account_id: str | None = None,
    limit: int = Query(500, ge=1, le=5000),
    offset: int = Query(0, ge=0),
):
    items = svc.rows(db, Transaction, user)
    if category_id == "__uncategorized":
        items = [t for t in items if t.kind == "expense" and t.category_id is None]
    elif category_id:
        items = [t for t in items if t.category_id == category_id]
    if account_id:
        items = [t for t in items if t.account_id == account_id or t.to_account_id == account_id]
    if q:
        items = [t for t in items if q.casefold() in (t.merchant + " " + t.note).casefold()]
    return [
        svc.dump(t)
        for t in sorted(items, key=lambda t: t.occurred_at, reverse=True)[offset : offset + limit]
    ]


@router.post("/transactions", status_code=201)
def add_transaction(body: TransactionIn, user: CurrentUser, db: DbSession):
    old = db.scalar(
        select(Transaction).where(
            Transaction.user_id == user.id, Transaction.client_id == body.client_id
        )
    )
    if old:
        return svc.dump(old)
    validate_transaction(db, user, body)
    if body.goal_id:
        fund = svc.owned(db, Goal, body.goal_id, user)
        if fund.saved < body.amount:
            raise AppError("insufficient_fund", "This fund doesn't have enough saved.")
        fund.saved -= body.amount
    record = Transaction(user_id=user.id, **transaction_values(body))
    db.add(record)
    try:
        db.flush()
        if body.kind == "expense":
            svc.point(db, user, "expense:" + record.id, 2)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        old = db.scalar(
            select(Transaction).where(
                Transaction.user_id == user.id, Transaction.client_id == body.client_id
            )
        )
        if old:
            return svc.dump(old)
        raise AppError("conflict", "This entry conflicts with an existing record.", 409) from exc
    usage = svc.categories_usage(db, user)
    category = next((c for c in usage if c["id"] == body.category_id), None)
    items = svc.rows(db, Transaction, user)
    week_start = svc.today(user) - timedelta(days=svc.today(user).weekday())
    ctx = {
        "categories": usage,
        "kind": body.kind,
        "amount": body.amount,
        "category": category["name"] if category else "spending",
        "merchant": body.merchant,
        "left": f"{user.currency} {category['left']}" if category else "",
        "near": bool(category and category["state"] == "near"),
        "count_left": category["left"] if category and category["max_count"] else None,
        "late_count": sum(
            t.category_id == body.category_id and calc.late_night(t.occurred_at, user.timezone)
            for t in svc.in_month(items, user)
        )
        if calc.late_night(record.occurred_at, user.timezone)
        else 0,
        "merchant_count": sum(
            t.merchant == body.merchant
            and calc.local_day(t.occurred_at, user.timezone) >= week_start
            for t in items
        )
        if body.merchant
        else 0,
    }
    quip = next_quip(db, user, "transaction_created", ctx)
    db.commit()
    return {**svc.dump(record), "quip": quip}


@router.patch("/transactions/{id}")
def edit_transaction(id: str, body: dict, user: CurrentUser, db: DbSession):
    record = svc.owned(db, Transaction, id, user)
    if "client_id" in body and body["client_id"] != record.client_id:
        raise AppError("immutable_id", "The client ID cannot change.")
    # SQLite returns naive UTC timestamps; normalize before validating an edit.
    original = svc.dump(record)
    original = {key: original[key] for key in TransactionIn.model_fields}
    original.update(body)
    data = TransactionIn.model_validate(original)
    validate_transaction(db, user, data, previous=record)
    if record.goal_id:
        svc.owned(db, Goal, record.goal_id, user).saved += record.amount
    if data.goal_id:
        fund = svc.owned(db, Goal, data.goal_id, user)
        if fund.saved < data.amount:
            raise AppError("insufficient_fund", "This fund doesn't have enough saved.")
        fund.saved -= data.amount
    for key, value in transaction_values(data).items():
        setattr(record, key, value)
    return save(db, record)


@router.delete("/transactions/{id}")
def delete_transaction(id: str, user: CurrentUser, db: DbSession):
    record = svc.owned(db, Transaction, id, user)
    if record.goal_id:
        svc.owned(db, Goal, record.goal_id, user).saved += record.amount
    db.delete(record)
    db.commit()
    return {"ok": True}


@router.get("/merchants/recent")
def merchants(user: CurrentUser, db: DbSession, category_id: str | None = None):
    items = transactions(user, db, category_id=category_id, limit=5000, offset=0)
    return list(dict.fromkeys(t["merchant"] for t in items if t["merchant"]))[:5]


@router.get("/home")
def home(user: CurrentUser, db: DbSession):
    result = svc.home(db, user)
    db.commit()
    return result


@router.get("/goals")
def goals(user: CurrentUser, db: DbSession):
    return svc.goal_data(db, user)


@router.post("/goals", status_code=201)
def add_goal(body: GoalIn, user: CurrentUser, db: DbSession):
    if body.account_id:
        svc.owned(db, Account, body.account_id, user)
    if body.due_date:
        date.fromisoformat(body.due_date)
    return save(db, Goal(user_id=user.id, **body.model_dump()))


@router.patch("/goals/{id}")
def edit_goal(id: str, body: dict, user: CurrentUser, db: DbSession):
    record = svc.owned(db, Goal, id, user)
    data = patch_data(GoalIn, record, body)
    if data.account_id:
        svc.owned(db, Account, data.account_id, user)
    if data.due_date:
        date.fromisoformat(data.due_date)
    for key, value in data.model_dump().items():
        setattr(record, key, value)
    return save(db, record)


@router.post("/goals/{id}/deposit")
def deposit(id: str, body: DepositIn, user: CurrentUser, db: DbSession):
    goal = svc.owned(db, Goal, id, user)
    if body.source == "wishlist":
        released = sum(
            (w.price for w in svc.rows(db, WishlistItem, user) if w.status == "let_go"), calc.ZERO
        )
        allocated = sum(
            (d.amount for d in svc.rows(db, GoalDeposit, user) if d.source == "wishlist"), calc.ZERO
        )
        if body.amount > released - allocated:
            raise AppError(
                "insufficient_released", "That is more than your unallocated money not wasted."
            )
    if body.source == "month_leftover":
        dashboard = svc.home(db, user)
        allocated = sum(
            (
                d.amount
                for d in svc.rows(db, GoalDeposit, user)
                if d.source == "month_leftover"
                and calc.local_day(d.created_at, user.timezone).strftime("%Y-%m")
                == svc.today(user).strftime("%Y-%m")
            ),
            calc.ZERO,
        )
        if (
            not dashboard["month_end"]
            or dashboard["kept"] is None
            or body.amount > dashboard["kept"] - allocated
        ):
            raise AppError(
                "invalid_leftover", "Month-end leftover isn't available for that amount."
            )
    if body.from_account_id:
        source = svc.owned(db, Account, body.from_account_id, user)
        if source.archived:
            raise AppError("account_archived", "Choose an active source account.")
        if not goal.account_id or goal.account_id == body.from_account_id:
            raise AppError(
                "destination_required", "Link the jar to a different savings account first."
            )
        destination = svc.owned(db, Account, goal.account_id, user)
        if destination.archived:
            raise AppError(
                "account_archived",
                "Restore the destination account or link this goal to an active account first.",
            )
        db.add(
            Transaction(
                user_id=user.id,
                client_id=str(uuid4()),
                kind="transfer",
                amount=body.amount,
                account_id=body.from_account_id,
                to_account_id=goal.account_id,
                note="Goal: " + goal.name,
            )
        )
    elif body.source == "payday":
        raise AppError("source_required", "Choose the account to transfer from.")
    goal.saved += body.amount
    db.add(GoalDeposit(user_id=user.id, goal_id=goal.id, amount=body.amount, source=body.source))
    if goal.saved >= goal.target:
        svc.point(db, user, "goal:" + goal.id, 50)
    return save(db, goal)


@router.get("/wishlist")
def wishlist(user: CurrentUser, db: DbSession):
    items = svc.rows(db, WishlistItem, user)
    released = sum((w.price for w in items if w.status == "let_go"), calc.ZERO)
    allocated = sum(
        (d.amount for d in svc.rows(db, GoalDeposit, user) if d.source == "wishlist"), calc.ZERO
    )
    return {
        "items": [svc.dump(w) for w in sorted(items, key=lambda w: w.ready_at)],
        "money_not_wasted": sum((w.price for w in items if w.status == "let_go"), calc.ZERO),
        "available_to_allocate": max(calc.ZERO, released - allocated),
        "this_year": sum(
            (
                w.price
                for w in items
                if w.status == "let_go"
                and w.decided_at
                and calc.local_day(w.decided_at, user.timezone).year == svc.today(user).year
            ),
            calc.ZERO,
        ),
    }


@router.post("/wishlist", status_code=201)
def add_wish(body: WishlistIn, user: CurrentUser, db: DbSession):
    if body.category_id:
        svc.owned(db, Category, body.category_id, user)
    data = body.model_dump(exclude={"wait_hours"})
    return save(
        db,
        WishlistItem(
            user_id=user.id,
            **data,
            ready_at=datetime.now(UTC)
            + timedelta(hours=body.wait_hours or calc.wishlist_hours(body.price)),
        ),
    )


@router.patch("/wishlist/{id}")
def edit_wish(id: str, body: WishlistIn, user: CurrentUser, db: DbSession):
    item = svc.owned(db, WishlistItem, id, user)
    if item.status != "waiting":
        raise AppError("already_decided", "This item has already been decided.", 409)
    if body.category_id:
        svc.owned(db, Category, body.category_id, user)
    for key, value in body.model_dump(exclude={"wait_hours"}).items():
        setattr(item, key, value)
    if body.wait_hours:
        item.ready_at = datetime.now(UTC) + timedelta(hours=body.wait_hours)
    return save(db, item)


@router.delete("/wishlist/{id}")
def delete_wish(id: str, user: CurrentUser, db: DbSession):
    item = svc.owned(db, WishlistItem, id, user)
    if item.status != "waiting":
        raise AppError(
            "already_decided", "This item has already been decided. Refresh your wishlist.", 409
        )
    removed = db.scalar(
        delete(WishlistItem)
        .where(
            WishlistItem.id == id,
            WishlistItem.user_id == user.id,
            WishlistItem.status == "waiting",
        )
        .returning(WishlistItem.id)
    )
    if removed is None:
        db.rollback()
        raise AppError("already_decided", "This item has changed. Refresh your wishlist.", 409)
    db.commit()
    return {"ok": True}


class Decision(BaseModel):
    decision: Literal["let_go", "buy"]


@router.post("/wishlist/{id}/decide")
def decide(id: str, body: Decision, user: CurrentUser, db: DbSession):
    item = svc.owned(db, WishlistItem, id, user)
    if item.status != "waiting":
        raise AppError("already_decided", "This item has already been decided.", 409)
    if calc.utc(item.ready_at) > datetime.now(UTC):
        raise AppError("timer_running", "Give it a little more time before deciding.", 409)
    status = "let_go" if body.decision == "let_go" else "bought"
    claimed = db.scalar(
        update(WishlistItem)
        .where(
            WishlistItem.id == id,
            WishlistItem.user_id == user.id,
            WishlistItem.status == "waiting",
        )
        .values(status=status, decided_at=datetime.now(UTC))
        .returning(WishlistItem.id)
    )
    if claimed is None:
        db.rollback()
        raise AppError("already_decided", "This item has changed. Refresh your wishlist.", 409)
    if item.status == "let_go":
        svc.point(db, user, "let-go:" + item.id, int(item.price // 10))
    quip = next_quip(
        db,
        user,
        "wishlist_let_go" if item.status == "let_go" else "wishlist_bought",
        {"amount": f"{user.currency} {item.price:,.2f}"},
    )
    db.commit()
    return {
        "item": svc.dump(item),
        "quip": quip,
        "draft": {"amount": str(item.price), "merchant": item.name, "category_id": item.category_id}
        if body.decision == "buy"
        else None,
    }


@router.post("/about-to-buy/preview")
def preview(body: WishlistIn, user: CurrentUser, db: DbSession):
    if body.category_id:
        category = svc.owned(db, Category, body.category_id, user)
        ids = {category.id} | {
            c.id for c in svc.rows(db, Category, user) if c.parent_id == category.id
        }
    else:
        ids = set()
    items = [t for t in svc.rows(db, Transaction, user) if t.category_id in ids]
    jars = svc.rows(db, Goal, user)
    goal = next((g for g in jars if g.kind == "jar" and g.saved < g.target), None)
    return {
        "goal": svc.dump(goal) if goal else None,
        "goal_impact": calc.goal_impact(body.price, goal.target, goal.saved) if goal else None,
        "regret_rate": calc.regret_rate(items),
        "broken_rules": svc.broken_rules(db, user, body.category_id),
        "wait_hours": calc.wishlist_hours(body.price),
    }


@router.get("/rules")
def rules(user: CurrentUser, db: DbSession):
    return [svc.dump(r) for r in svc.rows(db, Rule, user)]


def check_rule(db, user, body):
    if body.category_id:
        svc.owned(db, Category, body.category_id, user)
    if body.kind in ("count", "no_buy") and not body.category_id:
        raise AppError("category_required", "Choose a category for this rule.")
    if body.kind == "count" and not body.max_count:
        raise AppError("limit_required", "Set a count limit.")
    if body.kind == "no_buy" and not body.until:
        raise AppError("date_required", "Set an end date.")
    if body.until:
        date.fromisoformat(body.until)


@router.post("/rules", status_code=201)
def add_rule(body: RuleIn, user: CurrentUser, db: DbSession):
    check_rule(db, user, body)
    return save(db, Rule(user_id=user.id, **body.model_dump()))


@router.patch("/rules/{id}")
def edit_rule(id: str, body: dict, user: CurrentUser, db: DbSession):
    record = svc.owned(db, Rule, id, user)
    data = patch_data(RuleIn, record, body)
    check_rule(db, user, data)
    for key, value in data.model_dump().items():
        setattr(record, key, value)
    return save(db, record)


@router.delete("/rules/{id}")
def delete_rule(id: str, user: CurrentUser, db: DbSession):
    db.delete(svc.owned(db, Rule, id, user))
    db.commit()
    return {"ok": True}


@router.get("/reviews/current")
def current_review(user: CurrentUser, db: DbSession):
    return svc.review_data(db, user)


@router.post("/reviews/current/verdicts")
def verdicts(body: Verdicts, user: CurrentUser, db: DbSession):
    start, end = svc.week_bounds(user, db)
    for verdict in body.verdicts:
        item = svc.owned(db, Transaction, verdict.id, user)
        if not start <= calc.local_day(item.occurred_at, user.timezone) < end:
            raise AppError("invalid_week", "This purchase isn't in the current review.")
        for key, value in verdict.model_dump(exclude={"id"}).items():
            setattr(item, key, value)
    db.commit()
    return svc.review_data(db, user)


@router.post("/reviews/current/complete")
def complete_review(body: ReviewComplete, user: CurrentUser, db: DbSession):
    current = svc.review_data(db, user)
    if current["transactions"] or current["wishlist"]:
        raise AppError("unfinished_review", "Review the remaining cards first.")
    if current["complete"]:
        return current
    active_ids = {a["id"] for a in current["accounts"]}
    if {b.account_id for b in body.balances} != active_ids or len(body.balances) != len(active_ids):
        raise AppError("balances_required", "Confirm each account balance.")
    for check in body.balances:
        account = svc.owned(db, Account, check.account_id, user)
        difference = check.balance - calc.account_balance(account, svc.rows(db, Transaction, user))
        if difference:
            db.add(
                Transaction(
                    user_id=user.id,
                    client_id=str(uuid4()),
                    kind="adjustment",
                    amount=difference,
                    account_id=account.id,
                    note="Weekly balance check",
                )
            )
    db.add(Review(user_id=user.id, week=current["week"]))
    svc.point(db, user, "review:" + current["week"], 25)
    quip = next_quip(db, user, "review_done")
    db.commit()
    return {**current, "complete": True, "quip": quip}


@router.get("/streaks")
def streaks(user: CurrentUser, db: DbSession, month: str | None = None):
    result = svc.streak_data(db, user, month)
    db.commit()
    return result


@router.get("/quiz/cards")
def quiz_cards():
    return CARDS


class Answers(BaseModel):
    answers: list[bool] = Field(min_length=6, max_length=6)


@router.post("/quiz/score")
def quiz_score(body: Answers, user: CurrentUser, db: DbSession):
    result = score(body.answers)
    user.personality = result["personality"]
    db.commit()
    return result


@router.post("/quips/next")
def quip(user: CurrentUser, db: DbSession, event: str = "app_open"):
    result = next_quip(db, user, event)
    db.commit()
    return result


@router.get("/subscriptions")
def subscriptions(user: CurrentUser, db: DbSession):
    return [svc.dump(s) for s in svc.rows(db, Subscription, user)]


@router.post("/subscriptions", status_code=201)
def add_subscription(body: SubscriptionIn, user: CurrentUser, db: DbSession):
    date.fromisoformat(body.next_date)
    return save(db, Subscription(user_id=user.id, **body.model_dump()))


@router.patch("/subscriptions/{id}")
def edit_subscription(id: str, body: dict, user: CurrentUser, db: DbSession):
    record = svc.owned(db, Subscription, id, user)
    data = patch_data(SubscriptionIn, record, body)
    date.fromisoformat(data.next_date)
    for key, value in data.model_dump().items():
        setattr(record, key, value)
    return save(db, record)


class Used(BaseModel):
    used: bool


@router.post("/subscriptions/{id}/check")
def subscription_check(id: str, body: Used, user: CurrentUser, db: DbSession):
    item = svc.owned(db, Subscription, id, user)
    month = svc.today(user).strftime("%Y-%m")
    if item.last_checked_month != month:
        item.unused_months = 0 if body.used else item.unused_months + 1
        item.last_checked_month = month
    return save(db, item)


@router.post("/transactions/{id}/uses")
def log_use(id: str, user: CurrentUser, db: DbSession):
    item = svc.owned(db, Transaction, id, user)
    if not item.track_uses:
        raise AppError("tracking_disabled", "Turn on cost per use for this purchase first.")
    item.uses += 1
    result = save(db, item)
    return {**result, "cost_per_use": calc.money(item.amount / item.uses)}
