import { cents, fromCents } from "./money";

export function localDate(timezone: string, now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function nextMonthStart(day: string) {
  const [year, month] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
}

const divideRounded = (value: bigint, divisor: bigint) =>
  (value + divisor / 2n) / divisor;

export function optimisticHome(
  home: any,
  pending: any[],
  user: any,
  now = new Date(),
) {
  const today = localDate(user.timezone, now);
  const month = today.slice(0, 7);
  const newDay = home.as_of && home.as_of !== today;
  if (!pending.length && !newDay) return home;
  const value = structuredClone(home);
  // Limits recur; only usage resets. Keep account balances and receipts intact.
  if (value.monthly_buckets && value.monthly_buckets.month !== month) {
    Object.assign(value.monthly_buckets, {
      month,
      next_reset: nextMonthStart(today),
      spent: "0.00",
      remaining: value.monthly_buckets.assigned,
      unbudgeted_spent: "0.00",
    });
    for (const c of value.categories) {
      Object.assign(c, {
        spent: "0.00",
        count_used: 0,
        left: c.max_count || c.limit_amount,
        percent: 0,
        state: "normal",
      });
    }
    value.spent = "0.00";
    value.has_previous_month = false; // An offline snapshot isn't a closed-month report.
  }
  const day = BigInt(Number(today.slice(-2)));
  const [year, monthNumber] = today.split("-").map(Number);
  const daysInMonth = BigInt(
    new Date(Date.UTC(year, monthNumber, 0)).getUTCDate(),
  );
  if (newDay) {
    value.as_of = today;
    if (value.has_budget)
      value.kept = fromCents(
        divideRounded(cents(String(value.budget)) * day, daysInMonth) -
          cents(String(value.spent)),
      );
  }
  for (const p of pending) {
    const t = p.payload;
    if (p.error) continue;
    const amount = cents(t.amount);
    const a = value.accounts.find((a: any) => a.id === t.account_id);
    const dest = value.accounts.find((a: any) => a.id === t.to_account_id);
    if (a) {
      a.balance = fromCents(
        cents(String(a.balance)) +
          (t.kind === "income" || t.kind === "adjustment" ? amount : -amount),
      );
      if (a.kind === "credit_card")
        a.owed = fromCents(cents(a.balance) < 0n ? -cents(a.balance) : 0n);
    }
    if (dest && t.kind === "transfer")
      dest.balance = fromCents(cents(String(dest.balance)) + amount);
    const transactionMonth = localDate(
      user.timezone,
      new Date(t.occurred_at),
    ).slice(0, 7);
    if (t.kind !== "expense" || transactionMonth !== month) continue;
    const cat = value.categories.find((c: any) => c.id === t.category_id);
    if (cat) {
      for (const c of value.categories.filter(
        (c: any) => c.id === cat.id || c.id === cat.parent_id,
      )) {
        c.spent = fromCents(cents(String(c.spent)) + amount);
        c.count_used++;
        if (c.max_count) c.left = c.max_count - c.count_used;
        else if (c.limit_amount !== null)
          c.left = fromCents(cents(String(c.limit_amount)) - cents(c.spent));
        const ratio = c.max_count
          ? c.count_used / c.max_count
          : c.limit_amount !== null
            ? Number(c.limit_amount) === 0
              ? Number(c.spent) > 0
                ? 2
                : 0
              : Number(c.spent) / Number(c.limit_amount)
            : 0;
        c.percent = Math.min(100, ratio * 100);
        c.state = ratio > 1 ? "over" : ratio >= 0.85 ? "near" : "normal";
      }
    }
    const buckets = value.monthly_buckets;
    if (buckets?.category_ids.includes(t.category_id)) {
      buckets.spent = fromCents(cents(buckets.spent) + amount);
      buckets.remaining = fromCents(cents(buckets.remaining) - amount);
    } else if (buckets) {
      buckets.unbudgeted_spent = fromCents(
        cents(buckets.unbudgeted_spent) + amount,
      );
    }
    if ((!cat || cat.kind === "flexible") && !t.goal_id) {
      value.spent = fromCents(cents(String(value.spent)) + amount);
      if (value.kept !== null)
        value.kept = fromCents(cents(String(value.kept)) - amount);
    }
  }
  value.daily_average = fromCents(
    divideRounded(cents(String(value.spent)), day),
  );
  return value;
}
