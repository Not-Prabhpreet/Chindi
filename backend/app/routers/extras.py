import csv
import io
import json
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal
from uuid import uuid4

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field
from sqlalchemy import Boolean, DateTime, Integer, Numeric, String, inspect
from sqlalchemy.exc import SQLAlchemyError
from starlette.responses import Response

from app.config import get_settings
from app.db import DbSession
from app.errors import AppError
from app.models import (
    Account,
    Category,
    Goal,
    GoalDeposit,
    PointEvent,
    PushSubscription,
    QuipLog,
    Review,
    Rule,
    Subscription,
    Transaction,
    WishlistItem,
    Wrapped,
)
from app.quiz.scoring import score
from app.routers.decimal_route import DecimalRoute
from app.schemas.budget import AccountIn, CategoryIn, GoalIn, Profile
from app.services import budget as svc
from app.services import calculations as calc
from app.services.auth import CurrentUser
from app.services.insights import insights

router = APIRouter(route_class=DecimalRoute)
TABLES = [
    Account,
    Category,
    Goal,
    Transaction,
    WishlistItem,
    Rule,
    GoalDeposit,
    Review,
    Subscription,
    QuipLog,
    Wrapped,
    PointEvent,
]


@router.get("/insights")
def get_insights(user: CurrentUser, db: DbSession, period: str = "month"):
    return insights(db, user)


def make_wrapped(db, user, month):
    try:
        first = date.fromisoformat(month + "-01")
    except ValueError as exc:
        raise AppError("invalid_month", "Use YYYY-MM.") from exc
    if first >= svc.today(user).replace(day=1):
        raise AppError("not_ready", "Wrapped arrives after the month ends.", 409)
    categories = svc.rows(db, Category, user)
    items = svc.in_month(
        calc.flexible_transactions(svc.rows(db, Transaction, user), categories), user, month
    )
    spent = sum((t.amount for t in items), calc.ZERO)
    budget = sum(
        (
            c.limit_amount or calc.ZERO
            for c in categories
            if c.kind == "flexible" and not c.parent_id and not c.archived
        ),
        calc.ZERO,
    )
    wishes = [
        w
        for w in svc.rows(db, WishlistItem, user)
        if w.status == "let_go"
        and w.decided_at
        and calc.local_day(w.decided_at, user.timezone).strftime("%Y-%m") == month
    ]
    if not items and not wishes:
        return None
    old = next((w for w in svc.rows(db, Wrapped, user) if w.month == month), None)
    if old:
        return svc.dump(old)
    has_budget = any(
        c.kind == "flexible" and not c.parent_id and not c.archived and c.limit_amount is not None
        for c in categories
    )
    regrets = [t for t in items if t.verdict == "regret"]
    biggest = max(regrets, key=lambda t: t.amount, default=None)
    best = max(wishes, key=lambda w: w.price, default=None)
    tags = [tag for t in regrets for tag in t.trigger_tags]
    top = max(sorted(set(tags)), key=tags.count) if tags else "No recurring trigger yet"
    days = [calc.local_day(t.occurred_at, user.timezone).strftime("%A") for t in regrets]
    regret_day = max(sorted(set(days)), key=days.count) if days else "No regret day yet"
    points = sum(p.points for p in svc.rows(db, PointEvent, user))
    slides = [
        {
            "title": "Your month, kept." if has_budget else "Your month in spending.",
            "text": (
                f"{first:%B %Y} · {'under' if budget >= spent else 'over'} your flexible budget"
            )
            if has_budget
            else f"{first:%B %Y} · Your logged flexible spending",
            "amount": str(abs(budget - spent) if has_budget else spent),
            "percent": str(calc.money(abs(budget - spent) * 100 / budget)) if budget else None,
        },
        {
            "title": "A lesson with a receipt.",
            "text": biggest.merchant or "Your biggest regret"
            if biggest
            else "No regrets reviewed this month.",
            "amount": str(biggest.amount) if biggest else None,
        },
        {
            "title": "Best decision? The pause.",
            "text": best.name if best else "Your next pause can be a win.",
            "amount": str(best.price) if best else None,
        },
        {"title": "Know your patterns.", "text": f"{top} · {regret_day}", "amount": None},
        {
            "title": "Money not wasted.",
            "text": f"{sum(w.from_pause for w in wishes)} pauses that worked.",
            "amount": str(sum((w.price for w in wishes), calc.ZERO)),
        },
        {
            "title": calc.level(points),
            "text": f"Started as {user.personality}. {points} points and counting.",
            "amount": None,
        },
    ]
    wrapped = Wrapped(user_id=user.id, month=month, slides=slides)
    db.add(wrapped)
    db.flush()
    return svc.dump(wrapped)


@router.get("/wrapped/{month}")
def wrapped(month: str, user: CurrentUser, db: DbSession):
    result = make_wrapped(db, user, month)
    db.commit()
    return result or {"available": False, "month": month, "slides": []}


class Onboarding(BaseModel):
    answers: list[bool] | None = Field(default=None, min_length=6, max_length=6)
    tone: Literal["sweet", "savage"] = "sweet"
    accounts: list[AccountIn] = Field(default_factory=list, max_length=20)
    categories: list[CategoryIn] = Field(default_factory=list, max_length=50)
    goal: GoalIn | None = None
    timezone: str = "America/St_Johns"


@router.post("/onboarding/complete")
def onboarding(body: Onboarding, user: CurrentUser, db: DbSession):
    if user.preferences.get("onboarded"):
        return {"ok": True}
    Profile(timezone=body.timezone, tone=body.tone)
    user.timezone = body.timezone
    user.tone = body.tone
    if body.answers:
        user.personality = score(body.answers)["personality"]
    if body.accounts:
        default = svc.rows(db, Account, user)
        if svc.rows(db, Transaction, user):
            raise AppError("already_started", "Manage existing accounts in Settings.")
        for account in default:
            db.delete(account)
        db.flush()
        for account in body.accounts:
            db.add(Account(user_id=user.id, **account.model_dump()))
    if body.categories:
        # Resume setup without duplicating categories the user already created.
        from app.routers.budget import check_category

        for item in body.categories:
            existing = next((c for c in svc.rows(db, Category, user) if c.name == item.name), None)
            check_category(db, user, item, existing.id if existing else None)
            if existing:
                for key, value in item.model_dump(exclude_unset=True).items():
                    setattr(existing, key, value)
                for child in svc.rows(db, Category, user):
                    if child.parent_id == existing.id:
                        child.kind = existing.kind
                        if existing.archived:
                            child.archived = True
            else:
                db.add(Category(user_id=user.id, **item.model_dump()))
    if body.goal:
        if body.goal.account_id:
            svc.owned(db, Account, body.goal.account_id, user)
        db.add(Goal(user_id=user.id, **body.goal.model_dump()))
    user.preferences = {
        **user.preferences,
        "onboarded": True,
        "subscriptions": user.personality == "Subscription Hoarder",
        "cost_per_use": False,
        "rules": True,
        "levels": True,
    }
    db.commit()
    return {"ok": True, "personality": user.personality}


@router.get("/push/key")
def push_key(user: CurrentUser):
    return {"public_key": get_settings().vapid_public_key}


class PushIn(BaseModel):
    endpoint: str = Field(max_length=2048)
    keys: dict[str, str]


@router.post("/push/subscribe")
def subscribe(body: PushIn, user: CurrentUser, db: DbSession):
    from urllib.parse import urlparse

    host = urlparse(body.endpoint)
    allowed = (
        "fcm.googleapis.com",
        "updates.push.services.mozilla.com",
        "web.push.apple.com",
        "notify.windows.com",
    )
    if (
        host.scheme != "https"
        or not host.hostname
        or not any(host.hostname == h or host.hostname.endswith("." + h) for h in allowed)
        or host.port not in (None, 443)
    ):
        raise AppError("invalid_endpoint", "Use a supported browser push service.")
    if not {"auth", "p256dh"} <= body.keys.keys():
        raise AppError("invalid_keys", "Push keys are missing.")
    existing = next(
        (
            p
            for p in svc.rows(db, PushSubscription, user)
            if p.payload.get("endpoint") == body.endpoint
        ),
        None,
    )
    if not existing:
        db.add(PushSubscription(user_id=user.id, payload=body.model_dump()))
    db.commit()
    return {"ok": True}


@router.get("/export")
def export(user: CurrentUser, db: DbSession, format: str = "json"):
    profile = {
        "name": user.name,
        "currency": user.currency,
        "timezone": user.timezone,
        "tone": user.tone,
        "preferences": user.preferences,
        "personality": user.personality,
    }
    payload: dict[str, Any] = {
        "version": 1,
        "profile": profile,
        "tables": {m.__tablename__: [svc.dump(x) for x in svc.rows(db, m, user)] for m in TABLES},
    }
    if format == "json":
        content = json.dumps(payload)
        media = "application/json"
    elif format == "csv":
        output = io.StringIO(newline="")
        writer = csv.writer(output)
        writer.writerow(["table", "record"])
        writer.writerow(["profile", json.dumps(profile)])
        for table, records in payload["tables"].items():
            for record in records:
                writer.writerow([table, json.dumps(record)])
        content, media = output.getvalue(), "text/csv"
    else:
        raise AppError("invalid_format", "Choose json or csv.")
    return Response(
        content,
        media_type=media,
        headers={
            "Content-Disposition": f'attachment; filename="chindi-export.{format}"',
            "Cache-Control": "no-store",
        },
    )


@router.post("/import")
async def import_data(request: Request, user: CurrentUser, db: DbSession):
    raw = await request.body()
    if len(raw) > 20_000_000:
        raise AppError("too_large", "Import must be under 20 MB.", 413)
    try:
        if "text/csv" in request.headers.get("content-type", ""):
            payload: dict[str, Any] = {"version": 1, "profile": {}, "tables": {}}
            for entry in csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))):
                if entry["table"] == "profile":
                    payload["profile"] = json.loads(entry["record"])
                else:
                    payload["tables"].setdefault(entry["table"], []).append(
                        json.loads(entry["record"])
                    )
        else:
            payload = json.loads(raw)
        if payload["version"] != 1 or not isinstance(payload["tables"], dict):
            raise ValueError()
        names = {m.__tablename__ for m in TABLES}
        if set(payload["tables"]) - names:
            raise ValueError()
        profile = dict(payload.get("profile", {}))
        personality = profile.pop("personality", user.personality)
        validated_profile = Profile.model_validate(profile)
        id_map = {}
        for records in payload["tables"].values():
            if not isinstance(records, list):
                raise ValueError()
            for record in records:
                if record["id"] in id_map:
                    raise ValueError()
                id_map[record["id"]] = str(uuid4())
        staged: list[Any] = []
        for model in TABLES:
            cols = {c.key: c for c in inspect(model).columns}
            for record in payload["tables"].get(model.__tablename__, []):
                if set(record) - set(cols):
                    raise ValueError()
                data = {**record, "id": id_map[record["id"]], "user_id": user.id}
                for key, col in cols.items():
                    value = data.get(key)
                    if value is None:
                        if not col.nullable and key not in ("created_at",):
                            raise ValueError()
                        continue
                    if col.foreign_keys and key != "user_id":
                        data[key] = id_map[value]
                    elif isinstance(col.type, Numeric):
                        number = Decimal(str(value))
                        if (
                            not number.is_finite()
                            or abs(number) >= Decimal("10000000000")
                            or number != number.quantize(Decimal("0.01"))
                        ):
                            raise ValueError()
                        data[key] = number
                    elif isinstance(col.type, DateTime):
                        data[key] = calc.utc(datetime.fromisoformat(value))
                    elif (
                        isinstance(col.type, Boolean)
                        and not isinstance(value, bool)
                        or isinstance(col.type, Integer)
                        and (not isinstance(value, int) or isinstance(value, bool))
                        or isinstance(col.type, String)
                        and (
                            not isinstance(value, str)
                            or col.type.length is not None
                            and len(value) > col.type.length
                        )
                    ):
                        raise ValueError()
                staged.append(model(**data))
        # Replace is explicit in the import UI; parsing and validation finish before any mutation.
        for model in reversed(TABLES):
            existing = svc.rows(db, model, user)
            if model is Category:
                existing.sort(key=lambda x: not bool(x.parent_id))
            for item in existing:
                db.delete(item)
                db.flush()
            db.flush()
        for model in TABLES:
            pending = [x for x in staged if isinstance(x, model)]
            if model is Category:
                pending.sort(key=lambda x: bool(getattr(x, "parent_id", None)))
            for item in pending:
                db.add(item)
                db.flush()
        for key, value in validated_profile.model_dump(exclude_none=True).items():
            setattr(user, key, value)
        user.personality = str(personality)[:80]
        db.commit()
    except (ValueError, KeyError, TypeError, ArithmeticError, SQLAlchemyError) as exc:
        db.rollback()
        raise AppError("invalid_import", "That file isn't a valid Chindi export.") from exc
    return {"ok": True, "records": len(staged)}
