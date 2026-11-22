"""Import every model module here so Alembic autogenerate can see all tables."""

from app.db import Base
from app.models.entities import (  # noqa: F401
    Account,
    Category,
    Goal,
    GoalDeposit,
    PointEvent,
    PushSubscription,
    QuipLog,
    RefreshToken,
    Review,
    Rule,
    Subscription,
    Transaction,
    User,
    WishlistItem,
    Wrapped,
)
from app.models.security import AuthChallenge, Passkey, RecoverySecret  # noqa: F401

__all__ = ["Base"]
