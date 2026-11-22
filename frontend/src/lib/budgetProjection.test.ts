import { expect, it } from "vitest";
import { localDate, optimisticHome } from "./budgetProjection";

const user = { timezone: "America/St_Johns" };
function home() {
  return {
    as_of: "2026-11-01",
    has_budget: true,
    budget: "400.00",
    spent: "350.25",
    kept: "-336.92",
    daily_average: "350.25",
    has_previous_month: true,
    streak: { current: 4, best: 7 },
    accounts: [{ id: "a", kind: "chequing", balance: "1000.00" }],
    categories: [
      {
        id: "food",
        kind: "flexible",
        parent_id: null,
        limit_amount: "400.00",
        max_count: null,
        spent: "350.25",
        left: "49.75",
        count_used: 2,
      },
      {
        id: "rent",
        kind: "fixed",
        parent_id: null,
        limit_amount: "1500.00",
        max_count: null,
        spent: "0.00",
        left: "1500.00",
        count_used: 0,
      },
      {
        id: "other",
        kind: "flexible",
        parent_id: null,
        limit_amount: null,
        max_count: null,
        spent: "0.00",
        left: null,
        count_used: 0,
      },
    ],
    monthly_buckets: {
      has_limits: true,
      month: "2026-11",
      next_reset: "2026-12-01",
      assigned: "1900.00",
      spent: "350.25",
      remaining: "1549.75",
      unbudgeted_spent: "0.00",
      category_ids: ["food", "rent"],
    },
  };
}
function entry(amount: string, category_id: string | null, extra = {}) {
  return {
    payload: {
      kind: "expense",
      amount,
      account_id: "a",
      category_id,
      occurred_at: "2026-11-02T12:00:00Z",
      ...extra,
    },
  };
}

it("includes queued expenses exactly once in their matching monthly buckets", () => {
  const original = home();
  const value = optimisticHome(
    original,
    [
      entry("100.10", "rent"),
      entry("50.05", "food"),
      entry("3.15", "other"),
      entry("2.00", null),
      entry("7.00", null, { kind: "transfer" }),
      entry("100.00", null, { kind: "income" }),
      entry("20.25", "food", { occurred_at: "2026-11-01T02:29:59Z" }),
      { ...entry("999.00", "food"), error: "Needs attention" },
    ],
    user,
    new Date("2026-11-02T15:00:00Z"),
  );
  expect(value.monthly_buckets).toMatchObject({
    assigned: "1900.00",
    spent: "500.40",
    remaining: "1399.60",
    unbudgeted_spent: "5.15",
  });
  expect(value.spent).toBe("405.45");
  expect(value.daily_average).toBe("202.73");
  expect(value.accounts[0].balance).toBe("917.45");
  expect(original.monthly_buckets.remaining).toBe("1549.75");
});

it("renews a cached budget at local midnight and leaves old queued receipts in their month", () => {
  const snapshot = home();
  const entries = [
    entry("10.25", "food", { occurred_at: "2026-12-01T03:29:59Z" }),
    entry("20.10", "food", { occurred_at: "2026-12-01T03:30:00Z" }),
  ];
  const before = optimisticHome(
    snapshot,
    entries,
    user,
    new Date("2026-12-01T03:29:59Z"),
  );
  expect(before.monthly_buckets.month).toBe("2026-11");
  expect(before.monthly_buckets.remaining).toBe("1539.50");
  const after = optimisticHome(
    snapshot,
    entries,
    user,
    new Date("2026-12-01T03:30:00Z"),
  );
  expect(after.monthly_buckets).toMatchObject({
    month: "2026-12",
    next_reset: "2027-01-01",
    assigned: "1900.00",
    spent: "20.10",
    remaining: "1879.90",
    unbudgeted_spent: "0.00",
  });
  expect(after.categories[0].left).toBe("379.90");
  expect(after.categories[0].count_used).toBe(1);
  expect(after.categories[1].left).toBe("1500.00");
  expect(after.spent).toBe("20.10");
  expect(after.daily_average).toBe("20.10");
  expect(after.streak).toEqual(snapshot.streak);
  expect(after.accounts[0].balance).toBe("969.65");
  expect(after.as_of).toBe("2026-12-01");
  expect(
    optimisticHome(snapshot, [], user, new Date("2027-01-01T12:00:00Z"))
      .monthly_buckets,
  ).toMatchObject({
    month: "2027-01",
    next_reset: "2027-02-01",
    remaining: "1900.00",
  });
  expect(
    optimisticHome(snapshot, [], user, new Date("2027-01-01T12:00:00Z"))
      .daily_average,
  ).toBe("0.00");
});

it("shows negative remaining when over budget and handles a zero amount limit", () => {
  const snapshot = home();
  snapshot.categories[0].limit_amount = "0.00";
  const value = optimisticHome(
    snapshot,
    [entry("1600.01", "food")],
    user,
    new Date("2026-11-02T12:00:00Z"),
  );
  expect(value.monthly_buckets.remaining).toBe("-50.26");
  expect(value.categories[0].state).toBe("over");
  expect(value.categories[0].left).toBe("-1950.26");
  expect(localDate(user.timezone, new Date("2026-11-01T02:29:59Z"))).toBe(
    "2026-10-31",
  );
});
