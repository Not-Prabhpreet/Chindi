"""Deterministic rules, cooldowns and non-repeating variants; no runtime AI."""

from datetime import UTC, datetime, timedelta

from app.models import QuipLog
from app.services.budget import rows
from app.services.calculations import utc

# Every rule has four variants per tone and an explicit event, priority and cooldown.
TEXT = {
    "over_limit": (
        [
            "{category} went {over} over. Tomorrow's a fresh start.",
            "A little reset for {category}?",
            "Your {category} limit needs a breather.",
            "Let's give {category} a quiet day.",
        ],
        [
            "{category} is {over} over. Money doesn't grow on trees, bestie.",
            "{category} called. It wants a day off.",
            "Your {category} budget has left the chat.",
            "A moment of silence for {category}.",
        ],
        "judging",
        100,
        6,
    ),
    "near_limit": (
        [
            "Heads up: only {left} left in {category}.",
            "{category} is close to its limit.",
            "A pause could help {category}.",
            "Almost at your {category} limit. You've got this.",
        ],
        [
            "{left} left in {category}. Choose wisely.",
            "{category} is hanging by a thread.",
            "Your {category} budget is sweating.",
            "{category}: proceed with side-eye.",
        ],
        "judging",
        80,
        2,
    ),
    "count_limit_last": (
        [
            "Last {category} of the month. Make it count.",
            "One more {category} fits your plan.",
            "Save that last {category} for something good.",
            "Your last {category} deserves a little thought.",
        ],
        [
            "One {category} left. ONE.",
            "{category}: final boss.",
            "Last {category}. No pressure. All pressure.",
            "One more {category} before I start judging.",
        ],
        "judging",
        85,
        1,
    ),
    "late_night_repeat": (
        [
            "Late-night {category} again. Sleep might be cheaper.",
            "Maybe sleep on this one?",
            "Your wallet could use an early night.",
            "A rested you might choose differently.",
        ],
        [
            "Your {count} late-night {category} this month. Just saying.",
            "The cart has a bedtime too.",
            "Go to sleep. Your wallet asked me.",
            "Midnight you is expensive.",
        ],
        "shocked",
        75,
        4,
    ),
    "same_merchant": (
        [
            "{merchant} must really like you.",
            "A familiar receipt from {merchant}.",
            "You've been supporting {merchant} this week.",
            "{merchant} is becoming a habit.",
        ],
        [
            "{merchant} again? Are you an investor?",
            "Do you live at {merchant}?",
            "{merchant} should put you on payroll.",
            "Another episode of you and {merchant}.",
        ],
        "smug",
        70,
        24,
    ),
    "streak": (
        [
            "{days} days with no extra spending. Proud of you.",
            "{days} quiet wallet days. Nice.",
            "Your {days}-day streak is growing.",
            "Look at you keeping that streak.",
        ],
        [
            "{days} days, zero extra spending. Certified chindi.",
            "{days} days. Who are you and where is your cart?",
            "Your wallet is on vacation. {days} days.",
            "{days} days without receipts. Character development.",
        ],
        "happy",
        60,
        12,
    ),
    "let_go": (
        [
            "{amount} kept. That's growth.",
            "Future you says thank you.",
            "You gave yourself room to breathe.",
            "A pause that paid off.",
        ],
        [
            "{amount} kept. Look at you go.",
            "The cart lost. You won.",
            "You survived not buying it.",
            "Personal growth, with fewer parcels.",
        ],
        "happy",
        95,
        0,
    ),
    "bought_anyway": (
        [
            "Enjoy it. You waited, that counts.",
            "A considered choice. Enjoy.",
            "You gave it some thought.",
            "Log it honestly. That's progress.",
        ],
        [
            "Fine. I'll remember this.",
            "The receipt has entered the chat.",
            "At least you thought about it.",
            "Enjoy it. I'm taking notes.",
        ],
        "smug",
        90,
        0,
    ),
    "review_done": (
        [
            "All caught up. Nice work this week.",
            "You showed up for your money.",
            "Another week understood.",
            "A little reflection goes a long way.",
        ],
        [
            "Books balanced. Go touch grass.",
            "Receipts judged. Court dismissed.",
            "Your spending has been perceived.",
            "Review complete. You're free to go.",
        ],
        "happy",
        95,
        0,
    ),
    "empty_day": (
        [
            "Nothing spent today? Love that.",
            "A quiet day for your wallet.",
            "Still no receipts. Nice.",
            "No extra spending today. A little win.",
        ],
        [
            "Nothing spent today? Who even are you?",
            "Wallet closed. Suspiciously responsible.",
            "No receipts? I'll allow it.",
            "Zero spending. Main character growth.",
        ],
        "smug",
        30,
        12,
    ),
    "payday": (
        [
            "Payday! Let's give it a plan.",
            "A little plan for your new income?",
            "Pay yourself first today.",
            "New income. New chance to plan.",
        ],
        [
            "Payday. Don't get ideas.",
            "Your cart can smell payday.",
            "Income arrived. Hide it from your impulses.",
            "Give it a job before the cart does.",
        ],
        "happy",
        90,
        1,
    ),
    "goal_close": (
        [
            "{goal} is {percent}% there!",
            "Your {goal} is getting close.",
            "Keep going. {goal} is almost here.",
            "Future you can almost see {goal}.",
        ],
        [
            "{goal} is {percent}% done. Don't you dare.",
            "{goal} is close. Step away from the cart.",
            "You can almost afford {goal}. Behave.",
            "{goal} is within reach. No plot twists.",
        ],
        "happy",
        65,
        12,
    ),
    "level_up": (
        [
            "Look how far you've come.",
            "Small steps add up.",
            "A new level of awareness.",
            "Your effort is showing.",
        ],
        [
            "New level. Same side-eye.",
            "Character development unlocked.",
            "Look who has a plan now.",
            "Your wallet is impressed. I'm still watching.",
        ],
        "happy",
        99,
        0,
    ),
    "goal_reached": (
        [
            "You did it. Your goal is full!",
            "A bigger plan, made real.",
            "Future you is celebrating.",
            "Every little choice got you here.",
        ],
        [
            "Goal reached. Certified icon.",
            "You actually did it. Respect.",
            "The jar is full. The cart can wait.",
            "A fully funded plot twist.",
        ],
        "happy",
        99,
        0,
    ),
}


def next_quip(db, user, event, context=None):
    ctx = dict(context or {})
    candidates = []
    for cat in ctx.get("categories", []):
        if cat["state"] == "over" and cat["kind"] == "flexible":
            ctx.update(category=cat["name"], over=f"{user.currency} {abs(cat['left']):,.2f}")
            candidates.append("over_limit")
            break
    if event == "transaction_created":
        if ctx.get("kind") == "income" and ctx.get("amount", 0) >= 200:
            candidates.append("payday")
        if ctx.get("near"):
            candidates.append("near_limit")
        if ctx.get("count_left") == 1:
            candidates.append("count_limit_last")
        if ctx.get("late_count", 0) >= 2:
            ctx["count"] = ctx["late_count"]
            candidates.append("late_night_repeat")
        if ctx.get("merchant_count", 0) >= 3:
            candidates.append("same_merchant")
    if event == "app_open":
        if ctx.get("days", 0) >= 3:
            candidates.append("streak")
        if ctx.get("empty_day") and ctx.get("hour", 0) >= 18:
            candidates.append("empty_day")
        close = next((g for g in ctx.get("goals", []) if 90 <= g["percent"] < 100), None)
        if close:
            ctx.update(goal=close["name"], percent=round(close["percent"]))
            candidates.append("goal_close")
    mapped = {
        "wishlist_let_go": "let_go",
        "wishlist_bought": "bought_anyway",
        "review_done": "review_done",
        "goal_reached": "goal_reached",
        "level_up": "level_up",
    }
    if event in mapped:
        candidates.append(mapped[event])
    logs = sorted(rows(db, QuipLog, user), key=lambda q: q.created_at, reverse=True)

    def priority(rule):
        boosted = (user.personality == "Midnight Cart Goblin" and rule == "late_night_repeat") or (
            user.personality == "Latte Leak" and rule == "same_merchant"
        )
        return TEXT[rule][3] + (15 if boosted else 0)

    for rule in sorted(set(candidates), key=priority, reverse=True):
        sweet, savage, mood, _, hours = TEXT[rule]
        previous = [q for q in logs if q.rule_id == rule]
        if previous and utc(previous[0].created_at) > datetime.now(UTC) - timedelta(hours=hours):
            continue
        used = {q.variant for q in previous[:3]}
        variant = next((n for n in range(4) if n not in used), 0)
        db.add(QuipLog(user_id=user.id, rule_id=rule, variant=variant))
        db.flush()
        return {
            "rule_id": rule,
            "text": (sweet if user.tone == "sweet" else savage)[variant].format_map(ctx),
            "mood": mood,
        }
    return {
        "rule_id": "neutral",
        "text": "Morning. Wallet still closed? Respect."
        if datetime.now(ZoneInfo(user.timezone)).hour < 12
        else "A little awareness goes a long way.",
        "mood": "smug",
    }


from zoneinfo import ZoneInfo  # noqa: E402
