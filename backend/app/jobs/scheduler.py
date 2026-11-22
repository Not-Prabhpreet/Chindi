"""Single-process scheduled maintenance and opt-in, deduplicated web push."""

import json
import logging
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from pywebpush import WebPushException, webpush
from sqlalchemy import select

from app.config import get_settings
from app.db import SessionLocal
from app.models import PushSubscription, Transaction, User, WishlistItem
from app.services import budget as svc
from app.services.calculations import local_day, utc

log = logging.getLogger(__name__)


def notifications(db, user, local):
    day = local.date()
    items = []
    if local.strftime("%H:%M") == user.preferences.get("nudge_time", "20:00") and not any(
        local_day(t.occurred_at, user.timezone) == day for t in svc.rows(db, Transaction, user)
    ):
        items.append((f"nudge:{day}", "Spent anything today? Log it before you forget.", "/?add=1"))
    if local.weekday() == 6 and local.hour == 11 and local.minute == 0:
        items.append(
            (f"review:{day}", "Swipe Sunday is ready. Time to judge your week.", "/review")
        )
    if day.day == 1 and local.hour == 10 and local.minute == 0:
        month = (day - timedelta(days=1)).strftime("%Y-%m")
        items.append(
            (
                f"wrapped:{month}",
                "Your Wrapped is out. A little reflection, a little roast.",
                "/wrapped/" + month,
            )
        )
    for wish in svc.rows(db, WishlistItem, user):
        if wish.status == "waiting" and utc(wish.ready_at) <= datetime.now(UTC):
            items.append(("wish:" + wish.id, f"Still want {wish.name}? Decide now.", "/wishlist"))
    return items


def tick():
    settings = get_settings()
    with SessionLocal() as db:
        for user in db.scalars(select(User)):
            try:
                local = datetime.now(ZoneInfo(user.timezone))
                svc.streak_data(db, user)
                if local.day == 1:
                    from app.routers.extras import make_wrapped

                    make_wrapped(db, user, (local.date() - timedelta(days=1)).strftime("%Y-%m"))
                if user.preferences.get("notifications") and settings.vapid_private_key:
                    for subscription in svc.rows(db, PushSubscription, user):
                        sent = dict(subscription.sent)
                        for key, body, url in notifications(db, user, local):
                            if key in sent:
                                continue
                            try:
                                webpush(
                                    subscription_info=subscription.payload,
                                    data=json.dumps({"title": "Chindi", "body": body, "url": url}),
                                    vapid_private_key=settings.vapid_private_key,
                                    vapid_claims={"sub": settings.vapid_subject},
                                    timeout=10,
                                )
                                sent[key] = local.isoformat()
                            except WebPushException as exc:
                                if exc.response is not None and exc.response.status_code in (
                                    404,
                                    410,
                                ):
                                    db.delete(subscription)
                                    break
                                log.warning("Push delivery failed: %s", type(exc).__name__)
                        subscription.sent = sent
                db.commit()
            except Exception:
                db.rollback()
                log.exception("Scheduled maintenance failed for a user")
