"""Persistent, owner-scoped budget records. Money never passes through a float."""

from datetime import UTC, datetime
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


def uid() -> str:
    return str(uuid4())


def now() -> datetime:
    return datetime.now(UTC)


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    email: Mapped[str] = mapped_column(String(254), unique=True)
    password_hash: Mapped[str] = mapped_column(String(512))
    name: Mapped[str] = mapped_column(String(80), default="You")
    currency: Mapped[str] = mapped_column(String(3), default="CAD")
    timezone: Mapped[str] = mapped_column(String(80), default="America/St_Johns")
    tone: Mapped[str] = mapped_column(String(10), default="sweet")
    personality: Mapped[str] = mapped_column(String(80), default="Secret Chindi")
    preferences: Mapped[dict] = mapped_column(JSON, default=dict)
    auth_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Owned:
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class RefreshToken(Owned, Base):
    __tablename__ = "refresh_tokens"
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    auth_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0")


class Account(Owned, Base):
    __tablename__ = "accounts"
    name: Mapped[str] = mapped_column(String(80))
    kind: Mapped[str] = mapped_column(String(20), default="chequing")
    opening_balance: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal(0))
    archived: Mapped[bool] = mapped_column(Boolean, default=False)


class Category(Owned, Base):
    __tablename__ = "categories"
    name: Mapped[str] = mapped_column(String(80))
    parent_id: Mapped[str | None] = mapped_column(ForeignKey("categories.id"))
    kind: Mapped[str] = mapped_column(String(12), default="flexible")
    limit_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    max_count: Mapped[int | None] = mapped_column(Integer)
    icon: Mapped[str] = mapped_column(String(20), default="bag")
    color: Mapped[str] = mapped_column(String(24), default="sky-soft")
    position: Mapped[int] = mapped_column(Integer, default=0)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)


class Goal(Owned, Base):
    __tablename__ = "goals"
    name: Mapped[str] = mapped_column(String(100))
    target: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    saved: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal(0))
    due_date: Mapped[str | None] = mapped_column(String(10))
    note: Mapped[str] = mapped_column(String(500), default="")
    kind: Mapped[str] = mapped_column(String(20), default="jar")
    account_id: Mapped[str | None] = mapped_column(ForeignKey("accounts.id"))


class Transaction(Owned, Base):
    __tablename__ = "transactions"
    __table_args__ = (UniqueConstraint("user_id", "client_id"),)
    client_id: Mapped[str] = mapped_column(String(80))
    kind: Mapped[str] = mapped_column(String(20), default="expense")
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"))
    to_account_id: Mapped[str | None] = mapped_column(ForeignKey("accounts.id"))
    category_id: Mapped[str | None] = mapped_column(ForeignKey("categories.id"))
    goal_id: Mapped[str | None] = mapped_column(ForeignKey("goals.id"))
    merchant: Mapped[str] = mapped_column(String(120), default="")
    note: Mapped[str] = mapped_column(String(1000), default="")
    feeling: Mapped[str | None] = mapped_column(String(12))
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    verdict: Mapped[str | None] = mapped_column(String(12))
    classification: Mapped[str | None] = mapped_column(String(12))
    trigger_tags: Mapped[list] = mapped_column(JSON, default=list)
    impulse_override: Mapped[bool] = mapped_column(Boolean, default=False)
    track_uses: Mapped[bool] = mapped_column(Boolean, default=False)
    uses: Mapped[int] = mapped_column(Integer, default=0)


class WishlistItem(Owned, Base):
    __tablename__ = "wishlist"
    name: Mapped[str] = mapped_column(String(160))
    price: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    category_id: Mapped[str | None] = mapped_column(ForeignKey("categories.id"))
    ready_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(16), default="waiting")
    reasons_for: Mapped[str] = mapped_column(String(1000), default="")
    reasons_against: Mapped[str] = mapped_column(String(1000), default="")
    from_pause: Mapped[bool] = mapped_column(Boolean, default=False)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Rule(Owned, Base):
    __tablename__ = "rules"
    name: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(20), default="custom")
    category_id: Mapped[str | None] = mapped_column(ForeignKey("categories.id"))
    max_count: Mapped[int | None] = mapped_column(Integer)
    until: Mapped[str | None] = mapped_column(String(10))
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class GoalDeposit(Owned, Base):
    __tablename__ = "goal_deposits"
    goal_id: Mapped[str] = mapped_column(ForeignKey("goals.id"))
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    source: Mapped[str] = mapped_column(String(24), default="manual")


class Review(Owned, Base):
    __tablename__ = "reviews"
    __table_args__ = (UniqueConstraint("user_id", "week"),)
    week: Mapped[str] = mapped_column(String(10))


class Subscription(Owned, Base):
    __tablename__ = "subscriptions"
    name: Mapped[str] = mapped_column(String(120))
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    cycle: Mapped[str] = mapped_column(String(16), default="monthly")
    next_date: Mapped[str] = mapped_column(String(10))
    unused_months: Mapped[int] = mapped_column(Integer, default=0)
    last_checked_month: Mapped[str | None] = mapped_column(String(7))
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class QuipLog(Owned, Base):
    __tablename__ = "quip_log"
    rule_id: Mapped[str] = mapped_column(String(40))
    variant: Mapped[int] = mapped_column(Integer)
    event_key: Mapped[str | None] = mapped_column(String(80), unique=True)


class PushSubscription(Owned, Base):
    __tablename__ = "push_subscriptions"
    payload: Mapped[dict] = mapped_column(JSON)
    sent: Mapped[dict] = mapped_column(JSON, default=dict)


class Wrapped(Owned, Base):
    __tablename__ = "wrapped"
    __table_args__ = (UniqueConstraint("user_id", "month"),)
    month: Mapped[str] = mapped_column(String(7))
    slides: Mapped[list] = mapped_column(JSON)


class PointEvent(Owned, Base):
    __tablename__ = "point_events"
    __table_args__ = (UniqueConstraint("user_id", "key"),)
    key: Mapped[str] = mapped_column(String(100))
    points: Mapped[int] = mapped_column(Integer)
