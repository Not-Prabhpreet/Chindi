import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";

const browserErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
});
test.afterEach(async ({ page }, info) => {
  await page.screenshot({
    path: info.outputPath("screen.png"),
    fullPage: true,
  });
  expect(browserErrors.get(page)).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

// Advance only the timer of this test user's item in the isolated browser DB.
// The decision itself still goes through the real UI and API, without mocking.
async function finishWishlistTimer(page: Page) {
  const session = await (
    await page.request.post("/api/v1/auth/refresh")
  ).json();
  const data = await (
    await page.request.get("/api/v1/wishlist", {
      headers: { Authorization: "Bearer " + session.access_token },
    })
  ).json();
  const wish = data.items.find(
    (item: { status: string }) => item.status === "waiting",
  );
  const backend = path.resolve("../backend");
  const python = path.join(
    backend,
    process.platform === "win32"
      ? ".venv/Scripts/python.exe"
      : ".venv/bin/python",
  );
  execFileSync(python, [
    "-c",
    "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute(\"UPDATE wishlist SET ready_at='2000-01-01 00:00:00' WHERE id=? AND user_id=?\",sys.argv[2:]); c.commit()",
    path.join(backend, "chindi-e2e.db"),
    wish.id,
    wish.user_id,
  ]);
  await page.reload();
}

async function signUp(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("button", { name: "Skip setup", exact: true }).click();
  const email = `flow-${Date.now()}@example.com`;
  await page.getByLabel("Name", { exact: true }).fill("Flow test");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.locator('input[name="password"]').fill("correct-horse-battery");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page
    .getByRole("link", { name: "Nothing spent? Who even are you?" })
    .click();
  return email;
}

test("full setup validates accounts and first log waits for saved accounts", async ({
  page,
}) => {
  await page.route("**/api/v1/home", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("button", { name: "Let's go", exact: true }).click();
  for (let i = 0; i < 6; i++)
    await page.getByRole("button", { name: /Never/ }).click();
  await page
    .getByRole("button", { name: "Meet your personality", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Secret Chindi", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "That's me. What's next?", exact: true })
    .click();
  await page.getByRole("button", { name: /Savage/ }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Give account 1 a name, or remove it.",
  );
  await page.getByLabel("Name", { exact: true }).fill("Everyday");
  await page.getByLabel("Opening balance", { exact: true }).fill("1000");
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).nth(1).fill("Visa");
  await page
    .getByRole("combobox", { name: "Type", exact: true })
    .nth(1)
    .selectOption("credit_card");
  await page.getByLabel("Opening balance", { exact: true }).nth(1).fill("-250");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Add category", exact: true }).click();
  await page.getByLabel("Category 1 name", { exact: true }).fill("My food");
  await page.getByLabel("My food monthly limit", { exact: true }).fill("300");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Skip for now", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Full setup");
  await page
    .getByLabel("Email", { exact: true })
    .fill(`full-${Date.now()}@example.com`);
  await page.locator('input[name="password"]').fill("correct-horse-battery");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page
    .getByRole("link", { name: "Log your first expense", exact: true })
    .click();
  await page.getByLabel("Amount", { exact: true }).fill("10");
  await expect(
    page.getByRole("button", { name: "Everyday Chequing", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add $10", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.locator(".account-line").filter({ hasText: "Everyday" }),
  ).toContainText("$990");
  await expect(
    page.locator(".account-line").filter({ hasText: "Visa" }),
  ).toContainText("$250");
  await expect(
    page.getByText("Left in monthly buckets", { exact: true }),
  ).toBeVisible();
});

test("fresh budgets show honest empty states without invented history", async ({
  page,
}) => {
  await signUp(page);
  await expect(
    page.getByText("Spent this month", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("No previous month to compare yet."),
  ).toBeVisible();
  await page.getByRole("link", { name: "Insights", exact: true }).click();
  await expect(
    page.getByText("Your first Wrapped needs a completed month of spending."),
  ).toBeVisible();
  await expect(page.locator(".wrapped-banner")).toHaveCount(0);
  await page.screenshot({
    path: "test-results/fresh-insights.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await page.getByRole("link", { name: "About to buy something?" }).click();
  await expect(
    page.getByRole("combobox", { name: "Category", exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByRole("option", { name: "Uncategorized", exact: true }),
  ).toHaveCount(1);
});

test("monthly buckets combine assigned and remaining money, including offline expenses", async ({
  page,
  context,
}) => {
  await signUp(page);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Categories & limits", exact: true })
    .click();
  for (const [name, limit, fixed, parent] of [
    ["Food", "400", false, ""],
    ["Travel", "500", false, ""],
    ["Rent", "1000", true, ""],
    ["Coffee", "50", false, "Food"],
    ["Other", "", false, ""],
  ] as const) {
    await page
      .getByRole("button", { name: "Add category", exact: true })
      .click();
    await page.getByLabel("Name", { exact: true }).fill(name);
    await page.getByLabel("Monthly amount limit", { exact: true }).fill(limit);
    if (fixed)
      await page
        .getByRole("combobox", { name: "Budget type", exact: true })
        .selectOption("fixed");
    if (parent)
      await page
        .getByRole("combobox", { name: "Parent category", exact: true })
        .selectOption({ label: parent });
    await page
      .getByRole("button", { name: "Save category", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await page.getByRole("link", { name: "Home", exact: true }).click();
  const total = page.locator(".hero-amount");
  const assigned = page
    .locator(".budget-breakdown div")
    .filter({ hasText: "Assigned this month" });
  const spent = page
    .locator(".budget-breakdown div")
    .filter({ hasText: "Spent from buckets" });
  await expect(total).toHaveText("$1,900");
  await expect(assigned).toContainText("$1,900");
  await expect(page.getByText(/Amount limits renew on/)).toBeVisible();
  const log = async (category: string, amount: string) => {
    await page
      .getByRole("button", { name: "Add expense", exact: true })
      .click();
    await page.getByLabel("Amount", { exact: true }).fill(amount);
    const select = page.getByRole("combobox", {
      name: "Category",
      exact: true,
    });
    const id = await select
      .getByRole("option", { name: new RegExp(category) })
      .getAttribute("value");
    await select.selectOption(id!);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /^Add \$/ })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  };
  await log("Food", "350.25");
  await log("Coffee", "24.75");
  await log("Rent", "1000");
  await expect(total).toHaveText("$525");
  await expect(spent).toContainText("$1,375");
  await log("Other", "20");
  await expect(total).toHaveText("$525");
  await expect(
    page.getByText("$20 spent outside buckets with amount limits.", {
      exact: true,
    }),
  ).toBeVisible();
  await context.setOffline(true);
  await expect(page.getByText(/You're offline/)).toBeVisible();
  await log("Food", "25");
  await expect(total).toHaveText("$500");
  await expect(spent).toContainText("$1,400");
  await context.setOffline(false);
  await expect(page.getByText(/waiting to sync/)).toHaveCount(0);
  await page.reload();
  await expect(total).toHaveText("$500");
  await expect(assigned).toContainText("$1,900");
  for (const width of [320, 390, 430, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(total).toHaveText("$500");
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/monthly-buckets.png",
    fullPage: true,
  });
  await log("Food", "600");
  await expect(total).toHaveText("-$100");
  await expect(
    page.getByText("Over your monthly bucket budget.", { exact: true }),
  ).toBeVisible();
});

test("monthly average and bucket usage renew in an open offline app", async ({
  page,
  context,
}) => {
  await page.clock.install();
  await signUp(page);
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  await page.getByLabel("Amount", { exact: true }).fill("350");
  await page
    .getByRole("button", { name: "+ New category", exact: true })
    .click();
  await page
    .getByLabel("Category name", { exact: true })
    .fill("Monthly bucket");
  await page
    .getByLabel("Monthly limit (optional)", { exact: true })
    .fill("1900");
  await page
    .getByRole("button", { name: "Create category", exact: true })
    .click();
  await page.getByRole("button", { name: "Add $350", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".hero-amount")).toHaveText("$1,550");
  await expect(page.getByText("Kept this month", { exact: true })).toHaveCount(
    0,
  );
  const daily = page
    .locator(".hero-stats > div")
    .filter({ hasText: "Daily average" });
  const streak = page
    .locator(".hero-stats > div")
    .filter({ hasText: "No-spend streak" });
  await expect(daily.locator("strong")).not.toHaveText("$0");
  const previousStreak = await streak.locator("strong").innerText();
  const worker = await page.request.get("/sw.js");
  expect(worker.headers()["content-type"]).toMatch(/javascript/);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator(".hero-amount")).toHaveText("$1,550");
  const localDay = await page.evaluate(() => {
    const user = JSON.parse(localStorage.getItem("chindi:session")!);
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: user.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  });
  const [year, month] = localDay.split("-").map(Number);
  const nextMonth = new Date(Date.UTC(year, month, 1, 12));
  await page.clock.setSystemTime(nextMonth);
  await page.clock.runFor(30_100);
  await expect(page.locator(".hero-amount")).toHaveText("$1,900");
  await expect(daily.locator("strong")).toHaveText("$0");
  await expect(daily.locator("small")).toHaveText(
    "Daily average · " +
      new Intl.DateTimeFormat("en-CA", {
        month: "long",
        timeZone: "UTC",
      }).format(nextMonth),
  );
  await expect(streak.locator("strong")).toHaveText(previousStreak);
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  await page.getByLabel("Amount", { exact: true }).fill("10");
  await page.getByRole("button", { name: "Add $10", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".hero-amount")).toHaveText("$1,890");
  await expect(daily.locator("strong")).toHaveText("$10");
  await expect(page.locator(".account-line")).toContainText("-$360");
});

test.describe("backdated transactions", () => {
  test.use({ timezoneId: "UTC" });
  test("visible dates use the budget timezone and update only the selected month's average", async ({
    page,
    context,
  }) => {
    await signUp(page);
    const today = await page.evaluate(() => {
      const profile = JSON.parse(localStorage.getItem("chindi:session")!);
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: profile.timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
    });
    const [year, month, day] = today.split("-").map(Number);
    const firstDay = today.slice(0, 8) + "01";
    const previousDate = new Date(Date.UTC(year, month - 1, 0, 12))
      .toISOString()
      .slice(0, 10);
    const money = (value: number) =>
      new Intl.NumberFormat("en-CA", {
        style: "currency",
        currency: "CAD",
        minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
        maximumFractionDigits: 2,
      }).format(value);
    const daily = page
      .locator(".hero-stats > div")
      .filter({ hasText: "Daily average" })
      .locator("strong");
    await page
      .getByRole("button", { name: "Add expense", exact: true })
      .click();
    await expect(
      page.getByLabel("Transaction date", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByLabel("Transaction date", { exact: true }),
    ).toHaveValue(today);
    await page.getByLabel("Amount", { exact: true }).fill("30");
    await page.getByLabel("Where", { exact: true }).fill("Missed this month");
    await page
      .getByRole("button", { name: "+ New category", exact: true })
      .click();
    await page
      .getByLabel("Category name", { exact: true })
      .fill("Everyday spending");
    await page
      .getByLabel("Monthly limit (optional)", { exact: true })
      .fill("1900");
    await page
      .getByRole("button", { name: "Create category", exact: true })
      .click();
    await page.getByLabel("Transaction date", { exact: true }).fill("");
    await page.getByRole("button", { name: "Add $30", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
      "Choose a valid transaction date",
    );
    await page.getByLabel("Transaction date", { exact: true }).fill(firstDay);
    await page.getByText("Note, time & more", { exact: true }).click();
    await page.getByLabel("Time", { exact: true }).fill("00:10");
    await page.setViewportSize({ width: 320, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Add $30", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(daily).toHaveText(money(30 / day));
    await expect(page.locator(".hero-amount")).toHaveText("$1,870");
    await page
      .getByRole("button", { name: "Add expense", exact: true })
      .click();
    await expect(
      page.getByLabel("Transaction date", { exact: true }),
    ).toHaveValue(today);
    await page.getByLabel("Amount", { exact: true }).fill("60");
    await page.getByLabel("Where", { exact: true }).fill("Missed last month");
    await page
      .getByLabel("Transaction date", { exact: true })
      .fill(previousDate);
    await expect(page.locator(".amount-hint")).toHaveCount(0);
    await expect(
      page
        .getByRole("combobox", { name: "Category", exact: true })
        .getByRole("option", { selected: true }),
    ).toHaveText("Everyday spending");
    await page.screenshot({
      path: "test-results/transaction-date.png",
      fullPage: true,
    });
    await page.getByText("Note, time & more", { exact: true }).click();
    await page.getByLabel("Time", { exact: true }).fill("23:50");
    await page.getByRole("button", { name: "Add $60", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(daily).toHaveText(money(30 / day));
    await expect(page.locator(".hero-amount")).toHaveText("$1,870");
    await expect(page.locator(".account-line")).toContainText("-$90");
    await page.getByRole("link", { name: "History", exact: true }).click();
    const previousHeading = new Intl.DateTimeFormat("en-CA", {
      weekday: "long",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(new Date(previousDate + "T12:00:00Z"));
    await expect(
      page.getByRole("heading", { name: previousHeading, exact: true }),
    ).toBeVisible();
    const receipt = page
      .locator(".card")
      .filter({ has: page.getByText("Missed this month", { exact: true }) });
    await receipt.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(
      page.getByLabel("Transaction date", { exact: true }),
    ).toHaveValue(firstDay);
    await expect(page.locator(".amount-hint")).toHaveText(/Leaves \$1,870/);
    await page
      .getByLabel("Transaction date", { exact: true })
      .fill(previousDate);
    await page.getByRole("button", { name: "Save $30", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("link", { name: "Home", exact: true }).click();
    await expect(daily).toHaveText("$0");
    await expect(page.locator(".hero-amount")).toHaveText("$1,900");
    await context.setOffline(true);
    for (const [date, amount] of [
      [previousDate, "10"],
      [firstDay, "40"],
    ]) {
      await page
        .getByRole("button", { name: "Add expense", exact: true })
        .click();
      await page.getByLabel("Amount", { exact: true }).fill(amount);
      await page.getByLabel("Transaction date", { exact: true }).fill(date);
      await page
        .getByRole("button", { name: `Add $${amount}`, exact: true })
        .click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
    await expect(daily).toHaveText(money(40 / day));
    await expect(page.locator(".hero-amount")).toHaveText("$1,860");
    await context.setOffline(false);
    await expect(page.getByText(/waiting to sync/)).toHaveCount(0);
    await page.reload();
    await expect(daily).toHaveText(money(40 / day));
    await expect(page.locator(".account-line")).toContainText("-$140");
  });
});

test("accounts, income, transfers, archived account fallback, and login", async ({
  page,
}) => {
  const email = await signUp(page);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Accounts", exact: true }).click();
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Rainy day");
  await page
    .getByRole("combobox", { name: "Type", exact: true })
    .selectOption("savings");
  await page.getByLabel("Opening balance", { exact: true }).fill("200");
  await page.getByRole("button", { name: "Save account", exact: true }).click();
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await page.getByRole("button", { name: "+ Log income", exact: true }).click();
  await page.getByLabel("Amount", { exact: true }).fill("1000");
  await page.getByRole("button", { name: "Add $1,000", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  await page.getByLabel("Amount", { exact: true }).fill("100");
  await page.getByText("Note, time & more", { exact: true }).click();
  await page
    .getByRole("combobox", { name: "Entry type", exact: true })
    .selectOption("transfer");
  await page
    .getByRole("combobox", { name: "To account", exact: true })
    .selectOption({ label: "Rainy day · Savings" });
  await page.getByRole("button", { name: "Add $100", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.locator(".account-line").filter({ hasText: "Chequing" }),
  ).toContainText("$900");
  await expect(
    page.locator(".account-line").filter({ hasText: "Rainy day" }),
  ).toContainText("$300");
  await expect(page.locator(".hero-amount")).toHaveText("$0");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Accounts", exact: true }).click();
  await page
    .locator(".card")
    .filter({
      has: page.getByRole("heading", { name: "Chequing", exact: true }),
    })
    .getByRole("button", { name: "Archive", exact: true })
    .click();
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  await page.getByLabel("Amount", { exact: true }).fill("12.50");
  await page.getByLabel("Where", { exact: true }).fill("Actual purchase");
  await page.getByRole("button", { name: "Add $12.50", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText(/waiting to sync/)).toHaveCount(0);
  await expect(
    page.locator(".account-line").filter({ hasText: "Rainy day" }),
  ).toContainText("$287.50");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("correct-horse-battery");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.locator(".hero-amount")).toHaveText("$12.50");
});

test("payment account choices distinguish matching names and save to the selected type", async ({
  page,
}) => {
  await signUp(page);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Accounts", exact: true }).click();
  for (const [kind, balance] of [
    ["chequing", "500"],
    ["credit_card", "-200"],
  ]) {
    await page
      .getByRole("button", { name: "Add account", exact: true })
      .click();
    await page.getByLabel("Name", { exact: true }).fill("Scotiabank");
    await page
      .getByRole("combobox", { name: "Type", exact: true })
      .selectOption(kind);
    await page.getByLabel("Opening balance", { exact: true }).fill(balance);
    await page
      .getByRole("button", { name: "Save account", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  await page.getByLabel("Amount", { exact: true }).fill("25");
  await page
    .getByLabel("Where", { exact: true })
    .fill("Typed account purchase");
  const paidWith = page.getByRole("group", { name: "Paid with", exact: true });
  const credit = paidWith.getByRole("button", {
    name: "Scotiabank Credit card",
    exact: true,
  });
  const chequing = paidWith.getByRole("button", {
    name: "Scotiabank Chequing",
    exact: true,
  });
  await credit.click();
  await expect(credit).toHaveAttribute("aria-pressed", "true");
  await expect(chequing).toHaveAttribute("aria-pressed", "false");
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(
      credit.getByText("Credit card", { exact: true }),
    ).toBeVisible();
    await expect(chequing.getByText("Chequing", { exact: true })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.screenshot({
    path: "test-results/payment-account-types.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Add $25", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const creditLine = page
    .locator(".account-line")
    .filter({ hasText: "Scotiabank" })
    .filter({ hasText: "Credit card" });
  const chequingLine = page
    .locator(".account-line")
    .filter({ hasText: "Scotiabank" })
    .filter({ hasText: "Chequing" });
  await expect(creditLine).toContainText("$225");
  await expect(chequingLine).toContainText("$500");
  await page.getByRole("button", { name: "+ Log income", exact: true }).click();
  await page.getByLabel("Amount", { exact: true }).fill("100");
  await page
    .getByRole("group", { name: "Paid into", exact: true })
    .getByRole("button", { name: "Scotiabank Chequing", exact: true })
    .click();
  await page.getByRole("button", { name: "Add $100", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(chequingLine).toContainText("$600");
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  await page.getByLabel("Amount", { exact: true }).fill("50");
  await page.getByText("Note, time & more", { exact: true }).click();
  await page
    .getByRole("combobox", { name: "Entry type", exact: true })
    .selectOption("transfer");
  await page
    .getByRole("combobox", { name: "To account", exact: true })
    .selectOption({ label: "Scotiabank · Credit card" });
  await page.getByRole("button", { name: "Add $50", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(creditLine).toContainText("$175");
  await expect(chequingLine).toContainText("$550");
  await page.getByRole("link", { name: "History", exact: true }).click();
  const receipt = page
    .locator(".card")
    .filter({ has: page.getByText("Typed account purchase", { exact: true }) });
  await expect(receipt.locator(".transaction-accounts")).toHaveText(
    "Scotiabank · Credit card · expense",
  );
  const income = page
    .locator(".card")
    .filter({ has: page.getByText("income", { exact: true }) });
  await expect(income.locator(".transaction-accounts")).toHaveText(
    "Scotiabank · Chequing · income",
  );
  const transfer = page
    .locator(".card")
    .filter({ has: page.getByText("transfer", { exact: true }) });
  await expect(transfer.locator(".transaction-accounts")).toContainText(
    "From Scotiabank · Chequing",
  );
  await expect(transfer.locator(".transaction-accounts")).toContainText(
    "To Scotiabank · Credit card",
  );
  const filter = page.getByRole("combobox", { name: "Account", exact: true });
  await filter.selectOption({ label: "Scotiabank · Chequing" });
  await expect(receipt).toHaveCount(0);
  await expect(income).toBeVisible();
  await expect(transfer).toBeVisible();
  await filter.selectOption({ label: "Scotiabank · Credit card" });
  await expect(receipt).toBeVisible();
  await expect(income).toHaveCount(0);
  await expect(transfer).toBeVisible();
  await filter.selectOption("");
  await page.setViewportSize({ width: 320, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/history-account-types.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Accounts", exact: true }).click();
  const bank = page
    .locator(".card")
    .filter({
      has: page.getByRole("heading", { name: "Scotiabank", exact: true }),
    })
    .filter({ hasText: "Credit card" });
  await bank.getByRole("button", { name: "Archive", exact: true }).click();
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await page.getByRole("link", { name: "History", exact: true }).click();
  await expect(receipt.locator(".transaction-accounts")).toHaveText(
    "Scotiabank · Credit card (archived) · expense",
  );
  await receipt.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(
    paidWith.getByRole("button", {
      name: "Scotiabank Credit card · Archived",
      exact: true,
    }),
  ).toContainText("Credit card");
  await expect(
    paidWith.getByRole("button", {
      name: "Scotiabank Credit card · Archived",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Save $25", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("account types, confirmed deletion, and reversible archiving", async ({
  page,
}) => {
  await signUp(page);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Accounts", exact: true }).click();
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Scotiabank");
  await page
    .getByRole("combobox", { name: "Type", exact: true })
    .selectOption("savings");
  await page.getByLabel("Opening balance", { exact: true }).fill("600");
  await page.getByRole("button", { name: "Save account", exact: true }).click();
  const bank = page.locator(".card").filter({
    has: page.getByRole("heading", { name: "Scotiabank", exact: true }),
  });
  await expect(bank.getByText("Savings", { exact: true })).toBeVisible();
  await expect(bank.getByText("$600", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "test-results/account-types.png",
    fullPage: true,
  });
  await bank.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Keep account", exact: true }).click();
  await expect(bank).toBeVisible();
  await bank.getByRole("button", { name: "Delete", exact: true }).click();
  await page
    .getByRole("button", { name: "Delete account", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(bank).toHaveCount(0);
  await page.reload();
  await expect(bank).toHaveCount(0);
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Scotiabank");
  await page
    .getByRole("combobox", { name: "Type", exact: true })
    .selectOption("credit_card");
  await page.getByLabel("Opening balance", { exact: true }).fill("-200");
  await page.getByRole("button", { name: "Save account", exact: true }).click();
  await expect(bank.getByText("Credit card", { exact: true })).toBeVisible();
  await expect(bank.getByText("Amount owed", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(
    page.locator(".account-line").filter({ hasText: "Scotiabank" }),
  ).toContainText("Credit card");
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  await page.getByLabel("Amount", { exact: true }).fill("25");
  await page.getByLabel("Where", { exact: true }).fill("Keep this receipt");
  await page
    .getByRole("button", { name: "Scotiabank Credit card", exact: true })
    .click();
  await page.getByRole("button", { name: "Add $25", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Accounts", exact: true }).click();
  await expect(bank.getByText("$225", { exact: true })).toBeVisible();
  await expect(
    bank.getByRole("button", { name: "Delete", exact: true }),
  ).toBeDisabled();
  await bank.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(bank).not.toBeVisible();
  await page.getByText("Archived accounts (1)", { exact: true }).click();
  await expect(bank.getByText("Credit card", { exact: true })).toBeVisible();
  await bank.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(
    bank.getByRole("button", { name: "Edit", exact: true }),
  ).toBeVisible();
  await expect(bank.getByText("$225", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await page.getByRole("link", { name: "History", exact: true }).click();
  await expect(
    page.getByText("Keep this receipt", { exact: true }),
  ).toBeVisible();
});

test("pending account entries cannot be archived or deleted before sync", async ({
  page,
  context,
}) => {
  await signUp(page);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Accounts", exact: true }).click();
  const account = page.locator(".card").filter({
    has: page.getByRole("heading", { name: "Chequing", exact: true }),
  });
  await expect(
    account.getByRole("button", { name: "Delete", exact: true }),
  ).toBeEnabled();
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await context.setOffline(true);
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  await page.getByLabel("Amount", { exact: true }).fill("7.25");
  await page.getByRole("button", { name: "Add $7.25", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Accounts", exact: true }).click();
  await expect(
    account.getByRole("button", { name: "Delete", exact: true }),
  ).toBeDisabled();
  await expect(
    account.getByRole("button", { name: "Archive", exact: true }),
  ).toBeDisabled();
  await expect(
    account.getByText(/pending entries before archiving or deleting/),
  ).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText(/waiting to sync/)).toHaveCount(0, {
    timeout: 15000,
  });
  await expect(
    account.getByRole("button", { name: "Delete", exact: true }),
  ).toBeDisabled();
  await expect(
    account.getByRole("button", { name: "Archive", exact: true }),
  ).toBeEnabled();
});

test("history categories come from receipts and custom categories can be added directly", async ({
  page,
}) => {
  await signUp(page);
  await page.getByRole("link", { name: "History", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "No receipts. Yet.", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Category", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "Account", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Add category", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "New category", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill("My hobbies");
  await page
    .getByRole("button", { name: "Save category", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Add category", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Shopping");
  await page
    .getByRole("button", { name: "Save category", exact: true })
    .click();
  await page
    .locator(".card")
    .filter({
      has: page.getByRole("heading", { name: "Shopping", exact: true }),
    })
    .getByRole("button", { name: "Archive", exact: true })
    .click();
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  await page.getByLabel("Amount", { exact: true }).fill("12");
  await page.getByLabel("Where", { exact: true }).fill("Actual receipt");
  await page
    .getByRole("combobox", { name: "Category", exact: true })
    .selectOption({ label: "My hobbies" });
  await page.getByRole("button", { name: "Add $12", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("link", { name: "History", exact: true }).click();
  await expect(
    page.getByRole("option", { name: "My hobbies", exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("option", { name: "Shopping", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("option", { name: "Groceries", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("link", { name: "Manage categories", exact: true })
    .click();
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await page.getByRole("link", { name: "History", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Category", exact: true })
    .selectOption({ label: "My hobbies (archived)" });
  await expect(page.getByText("Actual receipt", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByRole("button", { name: "+ New category", exact: true })
    .click();
  await page.getByLabel("Category name", { exact: true }).fill("New plans");
  await page
    .getByRole("button", { name: "Create category", exact: true })
    .click();
  await page.getByRole("button", { name: "Save $12", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "Category", exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByRole("option", { name: "My hobbies (archived)", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("option", { name: "New plans", exact: true }),
  ).toHaveCount(1);
  await page
    .getByRole("searchbox", { name: "Search", exact: true })
    .fill("No such merchant");
  await expect(
    page.getByRole("heading", { name: "No matching entries.", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await expect(page.getByText("Actual receipt", { exact: true })).toBeVisible();
});

test("history shows purchase ratings and supports adding, changing and clearing them", async ({
  page,
  context,
}) => {
  await signUp(page);
  for (const feeling of ["Love", "Good", "Meh", "Regret", "Not rated"]) {
    await page
      .getByRole("button", { name: "Add expense", exact: true })
      .click();
    await page.getByLabel("Amount", { exact: true }).fill("10");
    await page.getByLabel("Where", { exact: true }).fill(feeling + " purchase");
    if (feeling !== "Not rated") {
      await page.getByRole("button", { name: feeling, exact: true }).click();
      await expect(
        page.getByRole("button", { name: feeling, exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
    }
    await page.getByRole("button", { name: "Add $10", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await page.getByRole("link", { name: "History", exact: true }).click();
  const card = (merchant: string) =>
    page
      .locator(".card")
      .filter({ has: page.getByText(merchant, { exact: true }) });
  for (const feeling of ["Love", "Good", "Meh", "Regret"]) {
    await expect(
      card(feeling + " purchase").locator(".rating-badge"),
    ).toHaveText("Rating: " + feeling);
  }
  const unrated = card("Not rated purchase");
  await expect(
    unrated.getByRole("button", {
      name: "Add rating for Not rated purchase",
      exact: true,
    }),
  ).toContainText("Not rated");
  await unrated
    .getByRole("button", {
      name: "Add rating for Not rated purchase",
      exact: true,
    })
    .click();
  const sheet = page.getByRole("dialog", {
    name: "Rate this expense",
    exact: true,
  });
  await sheet.getByRole("button", { name: "Good", exact: true }).click();
  await sheet.getByRole("button", { name: "Close", exact: true }).click();
  await expect(unrated.locator(".rating-badge")).toContainText("Not rated");
  await unrated
    .getByRole("button", {
      name: "Add rating for Not rated purchase",
      exact: true,
    })
    .click();
  await sheet.getByRole("button", { name: "Good", exact: true }).click();
  await sheet.getByRole("button", { name: "Save rating", exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(unrated.locator(".rating-badge")).toHaveText("Rating: Good");
  await page.reload();
  await expect(unrated.locator(".rating-badge")).toHaveText("Rating: Good");
  await unrated
    .getByRole("button", {
      name: "Change rating for Not rated purchase",
      exact: true,
    })
    .click();
  await expect(
    sheet.getByRole("button", { name: "Good", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await sheet.getByRole("button", { name: "Regret", exact: true }).click();
  await sheet.getByRole("button", { name: "Save rating", exact: true }).click();
  await expect(unrated.locator(".rating-badge")).toHaveText("Rating: Regret");
  await unrated
    .getByRole("button", {
      name: "Change rating for Not rated purchase",
      exact: true,
    })
    .click();
  await sheet
    .getByRole("button", { name: "Clear rating", exact: true })
    .click();
  await sheet.getByRole("button", { name: "Save rating", exact: true }).click();
  await expect(unrated.locator(".rating-badge")).toContainText("Not rated");
  await page.setViewportSize({ width: 320, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/transaction-ratings.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await context.setOffline(true);
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  await page.getByLabel("Amount", { exact: true }).fill("5");
  await page.getByLabel("Where", { exact: true }).fill("Offline purchase");
  await page.getByRole("button", { name: "Love", exact: true }).click();
  await page.getByRole("button", { name: "Add $5", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("link", { name: "History", exact: true }).click();
  await expect(card("Waiting to sync").locator(".rating-badge")).toHaveText(
    "Rating: Love",
  );
  await expect(
    card("Waiting to sync").locator(".transaction-accounts"),
  ).toHaveText("Chequing · Chequing · expense");
  await context.setOffline(false);
  await expect(page.getByText(/waiting to sync/)).toHaveCount(0);
  await expect(card("Offline purchase").locator(".rating-badge")).toHaveText(
    "Rating: Love",
  );
});

test("archiving all categories leaves a useful empty state", async ({
  page,
}) => {
  await signUp(page);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Categories & limits", exact: true })
    .click();
  await page.getByRole("button", { name: "Add category", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("My category");
  await page.getByLabel("Monthly amount limit", { exact: true }).fill("80");
  await page
    .getByRole("button", { name: "Save category", exact: true })
    .click();
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your first category starts here." }),
  ).toBeVisible();
});

test("wishlist decisions, jar allocation, and a purchase use real totals", async ({
  page,
}) => {
  await signUp(page);
  await page.getByRole("link", { name: "About to buy something?" }).click();
  await page.getByLabel("What is it?", { exact: true }).fill("Keyboard");
  await page.getByLabel("Price", { exact: true }).fill("129");
  await page
    .getByRole("button", { name: "Check this purchase", exact: true })
    .click();
  await page.getByRole("button", { name: "Wait 7 days", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Keyboard", exact: true }),
  ).toBeVisible();
  await finishWishlistTimer(page);
  await page.getByRole("button", { name: "Let it go", exact: true }).click();
  await expect(page.locator(".big-number")).toHaveText("$129");
  await page.getByRole("link", { name: "Move to a jar", exact: true }).click();
  await page.getByRole("button", { name: "Add goal", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("My future");
  await page.getByLabel("Target (CAD)", { exact: true }).fill("500");
  await page.getByRole("button", { name: "Save goal", exact: true }).click();
  await page.getByRole("button", { name: "Add money", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Source", exact: true }),
  ).toHaveValue("wishlist");
  await page.getByLabel("Amount", { exact: true }).fill("50");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Add money", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.locator(".card").filter({
      has: page.getByRole("heading", { name: "My future", exact: true }),
    }),
  ).toContainText("$50");
  await page.getByRole("link", { name: "Wishlist", exact: true }).click();
  await expect(
    page.getByText("$79 available to move", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Add wishlist item", exact: true })
    .click();
  await page.getByLabel("What is it?", { exact: true }).fill("Book");
  await page.getByLabel("Price", { exact: true }).fill("30");
  await page
    .getByRole("button", { name: "Wait 72 hours", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Book", exact: true }),
  ).toBeVisible();
  await finishWishlistTimer(page);
  await page
    .getByRole("button", { name: "Still want it", exact: true })
    .click();
  await expect(page.getByLabel("Where", { exact: true })).toHaveValue("Book");
  await page.getByRole("button", { name: "Add $30", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.locator(".hero-amount")).toHaveText("$30");
});

test("wishlist items can be deleted in one tap before or after their timer", async ({
  page,
}) => {
  await signUp(page);
  await page.getByRole("link", { name: "Wishlist", exact: true }).click();
  await page
    .getByRole("button", { name: "Add wishlist item", exact: true })
    .click();
  await page.getByLabel("What is it?", { exact: true }).fill("TV");
  await page.getByLabel("Price", { exact: true }).fill("100");
  await page.getByRole("button", { name: "Wait 7 days", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "TV", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/wishlist-delete.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Delete TV", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "TV", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".big-number")).toHaveText("$0");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "TV", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Add wishlist item", exact: true })
    .click();
  await page.getByLabel("What is it?", { exact: true }).fill("Lamp");
  await page.getByLabel("Price", { exact: true }).fill("30");
  await page
    .getByRole("button", { name: "Wait 72 hours", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Lamp", exact: true }),
  ).toBeVisible();
  await finishWishlistTimer(page);
  await expect(
    page.getByRole("button", { name: "Still want it", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Delete Lamp", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Lamp", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".big-number")).toHaveText("$0");
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.locator(".hero-amount")).toHaveText("$0");
  await expect(page.locator(".account-line")).toContainText("$0");
});

test("server rejection can be corrected without losing or duplicating an expense", async ({
  page,
}) => {
  await signUp(page);
  await page.getByRole("link", { name: "Goals", exact: true }).click();
  await page.getByRole("button", { name: "Add goal", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Repairs");
  await page.getByLabel("Target (CAD)", { exact: true }).fill("200");
  await page
    .getByRole("combobox", { name: "Kind", exact: true })
    .selectOption("sinking_fund");
  await page.getByRole("button", { name: "Save goal", exact: true }).click();
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  await page.getByLabel("Amount", { exact: true }).fill("5");
  await page.getByLabel("Where", { exact: true }).fill("Repair shop");
  await page.getByText("Note, time & more", { exact: true }).click();
  await page
    .getByRole("combobox", { name: "Pay from a sinking fund", exact: true })
    .selectOption({ label: "Repairs" });
  await page.getByRole("button", { name: "Add $5", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toHaveText(
    "This fund doesn't have enough saved.",
  );
  await page
    .getByRole("combobox", { name: "Pay from a sinking fund", exact: true })
    .selectOption("");
  await page.getByRole("button", { name: "Add $5", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText(/waiting to sync/)).toHaveCount(0);
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.locator(".hero-amount")).toHaveText("$5");
  await page.getByRole("link", { name: "History", exact: true }).click();
  await expect(page.getByText("Repair shop", { exact: true })).toHaveCount(1);
});

test("cost per use, subscriptions, JSON export and restore", async ({
  page,
}, info) => {
  await signUp(page);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByLabel("Cost per use", { exact: true }).check();
  await page
    .getByRole("button", { name: "Subscriptions", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add subscription", exact: true })
    .click();
  await page.getByLabel("Name", { exact: true }).fill("My streaming");
  await page.getByLabel("Amount", { exact: true }).fill("15");
  await page.getByLabel("Next date", { exact: true }).fill("2027-01-01");
  await page
    .getByRole("button", { name: "Save subscription", exact: true })
    .click();
  await page.getByRole("button", { name: "No", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "No", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Stop tracking", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your first subscription starts here." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  await page.getByLabel("Amount", { exact: true }).fill("40");
  await page.getByLabel("Where", { exact: true }).fill("Equipment");
  await page.getByText("Note, time & more", { exact: true }).click();
  await page.getByLabel("Track cost per use", { exact: true }).check();
  await page.getByRole("button", { name: "Add $40", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("link", { name: "History", exact: true }).click();
  await page.getByRole("button", { name: /No uses yet/ }).click();
  await expect(page.getByRole("button", { name: /\$40\/use/ })).toBeVisible();
  await page.getByRole("button", { name: /\$40\/use/ }).click();
  await expect(page.getByRole("button", { name: /\$20\/use/ })).toBeVisible();
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  const downloadReady = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  const download = await downloadReady;
  const backup = info.outputPath("budget.json");
  await download.saveAs(backup);
  await page
    .getByRole("button", { name: "Transaction history", exact: true })
    .click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Delete entry", exact: true }).click();
  await expect(page.getByText("Equipment", { exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.locator(".hero-amount")).toHaveText("$0");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles(backup);
  await page
    .getByRole("button", { name: "Replace data with this backup", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Transaction history", exact: true })
    .click();
  await expect(page.getByText("Equipment", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /\$20\/use/ })).toBeVisible();
});

test("rules, weekly review, historical Wrapped, and desktop layout", async ({
  page,
}) => {
  await signUp(page);
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  await page.getByLabel("Amount", { exact: true }).fill("20");
  await page.getByLabel("Where", { exact: true }).fill("Last week's meal");
  await page
    .getByRole("button", { name: "+ New category", exact: true })
    .click();
  await page.getByLabel("Category name", { exact: true }).fill("My meals");
  await page
    .getByRole("button", { name: "Create category", exact: true })
    .click();
  const lastWeek = new Date();
  lastWeek.setDate(lastWeek.getDate() - ((lastWeek.getDay() + 6) % 7) - 7);
  const date = `${lastWeek.getFullYear()}-${String(lastWeek.getMonth() + 1).padStart(2, "0")}-${String(lastWeek.getDate()).padStart(2, "0")}T12:00`;
  await page.getByRole("button", { name: "Love", exact: true }).click();
  await page.getByText("Note, time & more", { exact: true }).click();
  await page
    .getByLabel("Transaction date", { exact: true })
    .fill(date.slice(0, 10));
  await page.getByLabel("Time", { exact: true }).fill("12:00");
  await page.getByRole("button", { name: "Add $20", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  await page.getByLabel("Amount", { exact: true }).fill("10");
  await page.getByLabel("Where", { exact: true }).fill("Today's meal");
  await page.getByRole("button", { name: "Add $10", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("link", { name: "Rules", exact: true }).click();
  await page.getByRole("button", { name: "Add rule", exact: true }).click();
  await page.getByLabel("Your rule", { exact: true }).fill("One meal out");
  await page
    .getByRole("combobox", { name: "Type", exact: true })
    .selectOption("count");
  await page.getByLabel("Purchases per month", { exact: true }).fill("1");
  await page.getByRole("button", { name: "Save rule", exact: true }).click();
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await page.getByRole("link", { name: "About to buy something?" }).click();
  await page.getByLabel("What is it?", { exact: true }).fill("Another meal");
  await page.getByLabel("Price", { exact: true }).fill("12");
  await page
    .getByRole("button", { name: "Check this purchase", exact: true })
    .click();
  await expect(
    page.getByText("Breaks your rule: One meal out", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await page.getByRole("button", { name: /Swipe Sunday is ready/ }).click();
  await expect(
    page.getByRole("heading", { name: "Last week's meal", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Worth it", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "One last balance check.", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Chequing", { exact: true }).fill("100");
  await page
    .getByRole("button", { name: "Confirm balances & finish", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "100% worth it.", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back home", exact: true }).click();
  await expect(page.locator(".account-line")).toContainText("$100");
  await page.getByRole("link", { name: "History", exact: true }).click();
  const reviewed = page
    .locator(".card")
    .filter({ has: page.getByText("Last week's meal", { exact: true }) });
  await expect(reviewed.locator(".rating-badge")).toHaveText([
    "Rating: Love",
    "Review: Worth it",
  ]);
  await reviewed
    .getByRole("button", {
      name: "Change rating for Last week's meal",
      exact: true,
    })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Meh", exact: true })
    .click();
  await page.getByRole("button", { name: "Save rating", exact: true }).click();
  await expect(reviewed.locator(".rating-badge")).toHaveText([
    "Rating: Meh",
    "Review: Worth it",
  ]);
  await page.getByRole("link", { name: "Insights", exact: true }).click();
  if (lastWeek.getMonth() !== new Date().getMonth()) {
    await page.locator(".wrapped-banner").click();
    await expect(
      page.getByRole("heading", {
        name: "Your month in spending.",
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Next slide", exact: true }).click();
    await expect(
      page.getByRole("heading", {
        name: "A lesson with a receipt.",
        exact: true,
      }),
    ).toBeVisible();
    await page.getByLabel("Hide my numbers", { exact: true }).check();
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.locator(".account-line")).toContainText("$100");
});
