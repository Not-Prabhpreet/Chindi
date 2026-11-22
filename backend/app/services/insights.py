from datetime import timedelta
from decimal import Decimal

from app.models import Category, Subscription, Transaction, WishlistItem
from app.services import budget as svc
from app.services import calculations as calc


def insights(db, user):
    transactions = calc.flexible_transactions(
        svc.rows(db, Transaction, user), svc.rows(db, Category, user)
    )
    if len(transactions) < 10:
        return []
    current = svc.today(user)
    last = current.replace(day=1) - timedelta(days=1)
    this_month = svc.in_month(transactions, user)
    previous = svc.in_month(transactions, user, last.strftime("%Y-%m"))
    result = []
    currency = user.currency

    def add(id, text, amount=calc.ZERO):
        result.append({"id": id, "text": text, "amount": str(amount)})

    if calc.local_day(user.created_at, user.timezone) <= last.replace(day=1):
        now_avg = calc.daily_average(sum((t.amount for t in this_month), calc.ZERO), current.day)
        old_avg = calc.daily_average(sum((t.amount for t in previous), calc.ZERO), last.day)
        add(
            "daily",
            (
                f"Your daily average is {currency} {abs(now_avg - old_avg):,.2f} "
                f"{'less' if now_avg <= old_avg else 'more'} than {last:%B}."
            ),
            abs(now_avg - old_avg) * current.day,
        )
    regrets = [t for t in transactions if t.verdict == "regret"]
    if len(regrets) >= 5:
        weekdays = {
            n: sum(
                (
                    t.amount
                    for t in regrets
                    if calc.local_day(t.occurred_at, user.timezone).weekday() == n
                ),
                calc.ZERO,
            )
            for n in range(7)
        }
        day = max(weekdays, key=weekdays.get)
        name = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][day]
        add(
            "weekday",
            (
                f"{name} purchases account for {currency} {weekdays[day]:,.2f} "
                "of your regretted spending."
            ),
            weekdays[day],
        )
    tags = {tag for t in transactions for tag in t.trigger_tags}
    best_tag = None
    for tag in tags:
        tagged = [t for t in transactions if tag in t.trigger_tags and t.verdict]
        if len(tagged) >= 5:
            rate = calc.regret_rate(tagged)
            if best_tag is None or rate > best_tag[1]:
                best_tag = (
                    tag,
                    rate,
                    sum((t.amount for t in tagged if t.verdict == "regret"), calc.ZERO),
                )
    if best_tag:
        add(
            "trigger",
            f"You regret {best_tag[1]:.0f}% of purchases tagged {best_tag[0]}.",
            best_tag[2],
        )
    merchants = {t.merchant for t in transactions if t.merchant}
    for merchant in merchants:
        yearly = sum(
            (
                t.amount
                for t in transactions
                if t.merchant == merchant
                and calc.local_day(t.occurred_at, user.timezone).year == current.year
            ),
            calc.ZERO,
        )
        recent = [
            t
            for t in transactions
            if t.merchant == merchant
            and current - timedelta(days=89)
            <= calc.local_day(t.occurred_at, user.timezone)
            <= current
        ]
        if yearly >= 100:
            projection = calc.yearly_habit(sum((t.amount for t in recent), calc.ZERO))
            sentence = f"You've spent {currency} {yearly:,.2f} at {merchant} this year"
            if len([t for t in this_month if t.merchant == merchant]) >= 3:
                sentence += f", a {currency} {projection:,.2f} yearly habit at your recent pace"
            add("merchant:" + merchant, sentence + ".", yearly)
    if (
        sum(bool(t.verdict) for t in this_month) >= 3
        and sum(bool(t.verdict) for t in previous) >= 3
    ):
        add(
            "worth",
            (
                f"{calc.worth_rate(this_month):.0f}% of this month's reviewed purchases "
                f"were worth it, compared with {calc.worth_rate(previous):.0f}% last month."
            ),
        )
    let_go = [
        w
        for w in svc.rows(db, WishlistItem, user)
        if w.status == "let_go"
        and w.decided_at
        and calc.local_day(w.decided_at, user.timezone).strftime("%Y-%m")
        == current.strftime("%Y-%m")
    ]
    total = sum((w.price for w in let_go), calc.ZERO)
    if let_go:
        add(
            "pauses",
            (
                f"You kept {currency} {total:,.2f} by letting go, "
                f"including {sum(w.from_pause for w in let_go)} pauses that worked."
            ),
            total,
        )
    for sub in svc.rows(db, Subscription, user):
        if sub.active and sub.unused_months >= 2:
            add(
                "subscription:" + sub.id,
                (
                    f"You haven't used {sub.name} for {sub.unused_months} months; "
                    f"it costs {currency} {sub.amount:,.2f} per "
                    f"{dict(weekly='week', monthly='month', yearly='year')[sub.cycle]}."
                ),
                sub.amount,
            )
    return sorted(result, key=lambda i: Decimal(i["amount"]), reverse=True)[:6]
