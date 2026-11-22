import { test, expect } from "@playwright/test";

test("onboarding starts empty and saves only the categories the user creates", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("button", { name: "Let's go", exact: true }).click();
  await page.getByRole("button", { name: "Skip quiz", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your categories." }),
  ).toBeVisible();
  await expect(page.getByLabel("Category 1 name", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.locator('output[aria-label="Monthly flexible total"]'),
  ).toHaveText("$0");
  await page.getByRole("button", { name: "Add category", exact: true }).click();
  await page
    .getByLabel("Category 1 name", { exact: true })
    .fill("Weekend hobbies");
  await page
    .getByLabel("Weekend hobbies monthly limit", { exact: true })
    .fill("123.45");
  await page.getByRole("button", { name: "Add category", exact: true }).click();
  await page.getByLabel("Category 2 name", { exact: true }).fill("Studio rent");
  await page
    .getByLabel("Studio rent monthly limit", { exact: true })
    .fill("900.25");
  await page.getByLabel("Studio rent is a fixed bill", { exact: true }).check();
  await expect(
    page.locator('output[aria-label="Monthly flexible total"]'),
  ).toHaveText("$123.45");
  await expect(
    page.locator('output[aria-label="Fixed bills total"]'),
  ).toHaveText("$900.25");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Skip for now", exact: true }).click();
  await page
    .getByLabel("Email", { exact: true })
    .fill(`custom-${Date.now()}@example.com`);
  await page.locator('input[name="password"]').fill("correct-horse-battery");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Put me on your home screen." }),
  ).toBeVisible();
  const token = (await (await page.request.post("/api/v1/auth/refresh")).json())
    .access_token;
  const home = await (
    await page.request.get("/api/v1/home", {
      headers: { Authorization: "Bearer " + token },
    })
  ).json();
  expect(home.budget).toBe("123.45");
  expect(home.categories.map((c: { name: string }) => c.name)).toEqual([
    "Weekend hobbies",
    "Studio rent",
  ]);
  expect(home.categories[1].kind).toBe("fixed");
});

test("first install, expense, edits, wishlist, settings, and offline replay", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("button", { name: "Skip setup", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Browser test");
  await page
    .getByLabel("Email", { exact: true })
    .fill(`browser-${Date.now()}@example.com`);
  await page.locator('input[name="password"]').fill("correct-horse-battery");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Put me on your home screen." }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Nothing spent? Who even are you?" })
    .click();
  await expect(
    page.getByText("Spent this month", { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/home.png", fullPage: true });
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Amount", exact: true })
    .fill("24.60");
  await page.getByLabel("Where", { exact: true }).fill("Corner Market");
  await expect(
    page.getByRole("combobox", { name: "Category", exact: true }),
  ).toHaveValue("");
  await expect(page.getByRole("option", { name: /Groceries/ })).toHaveCount(0);
  await page
    .getByRole("button", { name: "+ New category", exact: true })
    .click();
  await page.getByLabel("Category name", { exact: true }).fill("Weekend fun");
  await page
    .getByRole("button", { name: "Create category", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Amount", exact: true }),
  ).toHaveValue("24.60");
  await expect(page.getByLabel("Where", { exact: true })).toHaveValue(
    "Corner Market",
  );
  await page.getByRole("button", { name: "Add $24.60", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("link", { name: "History", exact: true }).click();
  await expect(page.getByText("Corner Market", { exact: true })).toBeVisible();
  await expect(page.getByText("$24.60", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByLabel("Where", { exact: true })).toHaveValue(
    "Corner Market",
  );
  await page
    .getByRole("textbox", { name: "Amount", exact: true })
    .fill("12.10");
  await page.getByRole("button", { name: "Save $12.10", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("$12.10", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  await expect(page.getByLabel("Where", { exact: true })).toHaveValue("");
  await page
    .getByRole("button", { name: "Corner Market", exact: true })
    .click();
  await expect(page.getByLabel("Where", { exact: true })).toHaveValue(
    "Corner Market",
  );
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("link", { name: "About to buy something?" }).click();
  await page.getByLabel("What is it?").fill("Headphones");
  await page.getByLabel("Price", { exact: true }).fill("129");
  await page.getByRole("button", { name: "Check this purchase" }).click();
  await page.getByRole("button", { name: "Wait 7 days" }).click();
  await expect(page.getByRole("heading", { name: "Headphones" })).toBeVisible();
  await page.getByRole("link", { name: "Goals", exact: true }).click();
  await page.getByRole("button", { name: "Add goal", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Japan trip");
  await page.getByLabel("Target (CAD)").fill("3000");
  await page.getByRole("button", { name: "Save goal", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Japan trip", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add money", exact: true }).click();
  await page.getByLabel("Amount", { exact: true }).fill("100");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Add money", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("$100", { exact: true })).toBeVisible();
  for (const tab of ["Rules", "Insights", "Wishlist", "Home"]) {
    await page.getByRole("link", { name: tab, exact: true }).click();
    await expect(page.locator("main")).toBeVisible();
  }
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByText("Spent this month", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("You're offline. New expenses stay on this device."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  await page.getByRole("textbox", { name: "Amount", exact: true }).fill("7.25");
  await page.getByLabel("Where", { exact: true }).fill("Offline Coffee");
  await page
    .getByRole("combobox", { name: "Category", exact: true })
    .selectOption("");
  await page.getByRole("button", { name: "Add $7.25", exact: true }).click();
  await expect(page.getByText("1 entry waiting to sync")).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText("1 entry waiting to sync")).toHaveCount(0, {
    timeout: 15000,
  });
  await page.getByRole("link", { name: "History", exact: true }).click();
  await expect(page.getByText("Offline Coffee", { exact: true })).toHaveCount(
    1,
  );
  await page.reload();
  await expect(page.getByText("Offline Coffee", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Tone", exact: true })
    .selectOption("savage");
  await expect(
    page.getByRole("combobox", { name: "Tone", exact: true }),
  ).toHaveValue("savage");
  await page.screenshot({ path: "test-results/settings.png", fullPage: true });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
