"""Validated request contracts, including strict precision for money."""

from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator

Money = Annotated[Decimal, Field(max_digits=12, decimal_places=2)]
PositiveMoney = Annotated[Decimal, Field(gt=0, max_digits=12, decimal_places=2)]
NonnegativeMoney = Annotated[Decimal, Field(ge=0, max_digits=12, decimal_places=2)]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid")

    @field_validator("due_date", "until", "next_date", check_fields=False)
    @classmethod
    def valid_date(cls, value):
        if value:
            date.fromisoformat(value)
        return value


class Credentials(Contract):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=10, max_length=128)
    name: str = Field(default="You", max_length=80)

    @field_validator("email")
    @classmethod
    def email_valid(cls, value):
        value = value.strip().lower()
        if (
            value.count("@") != 1
            or any(c.isspace() for c in value)
            or "." not in value.split("@")[-1]
        ):
            raise ValueError("Enter a valid email address")
        return value


class Profile(Contract):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    currency: str | None = Field(default=None, pattern=r"^[A-Z]{3}$")
    timezone: str | None = None
    tone: Literal["sweet", "savage"] | None = None
    preferences: dict | None = None

    @field_validator("timezone")
    @classmethod
    def timezone_valid(cls, value):
        if value:
            try:
                ZoneInfo(value)
            except ZoneInfoNotFoundError as exc:
                raise ValueError("Unknown timezone") from exc
        return value


class AccountIn(Contract):
    name: str = Field(min_length=1, max_length=80)
    kind: Literal["chequing", "savings", "credit_card", "cash", "other"] = "chequing"
    opening_balance: Money = Decimal(0)
    archived: bool = False


class CategoryIn(Contract):
    name: str = Field(min_length=1, max_length=80)
    parent_id: str | None = None
    kind: Literal["fixed", "flexible"] = "flexible"
    limit_amount: NonnegativeMoney | None = None
    max_count: int | None = Field(default=None, ge=1, le=10000)
    icon: str = Field(default="bag", max_length=20)
    color: Literal["sky-soft", "mango-soft", "bubblegum-soft", "mint-soft", "tomato-soft"] = (
        "sky-soft"
    )
    position: int = 0
    archived: bool = False


class TransactionIn(Contract):
    client_id: str = Field(min_length=1, max_length=80)
    kind: Literal["expense", "income", "transfer", "adjustment"] = "expense"
    amount: Money
    account_id: str
    to_account_id: str | None = None
    category_id: str | None = None
    goal_id: str | None = None
    merchant: str = Field(default="", max_length=120)
    note: str = Field(default="", max_length=1000)
    feeling: Literal["love", "good", "meh", "regret"] | None = None
    occurred_at: datetime | None = None
    impulse_override: bool = False
    track_uses: bool = False

    @field_validator("occurred_at")
    @classmethod
    def aware(cls, value):
        if value and value.tzinfo is None:
            raise ValueError("Include the timezone offset")
        return value


class WishlistIn(Contract):
    name: str = Field(min_length=1, max_length=160)
    price: PositiveMoney
    category_id: str | None = None
    wait_hours: int | None = Field(default=None, ge=1, le=8760)
    reasons_for: str = Field(default="", max_length=1000)
    reasons_against: str = Field(default="", max_length=1000)
    from_pause: bool = False


class GoalIn(Contract):
    name: str = Field(min_length=1, max_length=100)
    target: PositiveMoney
    due_date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    note: str = Field(default="", max_length=500)
    kind: Literal["jar", "sinking_fund"] = "jar"
    account_id: str | None = None


class DepositIn(Contract):
    amount: PositiveMoney
    source: Literal["manual", "wishlist", "month_leftover", "payday"] = "manual"
    from_account_id: str | None = None


class RuleIn(Contract):
    name: str = Field(min_length=1, max_length=200)
    kind: Literal["custom", "count", "no_buy"] = "custom"
    category_id: str | None = None
    max_count: int | None = Field(default=None, ge=1)
    until: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    active: bool = True


class SubscriptionIn(Contract):
    name: str = Field(min_length=1, max_length=120)
    amount: PositiveMoney
    cycle: Literal["weekly", "monthly", "yearly"] = "monthly"
    next_date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    active: bool = True


class Verdict(Contract):
    id: str
    verdict: Literal["worth_it", "regret"]
    classification: Literal["need", "want", "waste"] | None = None
    trigger_tags: list[str] = Field(default_factory=list, max_length=10)


class Verdicts(Contract):
    verdicts: list[Verdict]


class BalanceCheck(Contract):
    account_id: str
    balance: Money


class ReviewComplete(Contract):
    balances: list[BalanceCheck] = Field(default_factory=list)
