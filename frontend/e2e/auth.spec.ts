import { test, expect, type Page } from "@playwright/test";

test.use({ baseURL: "http://localhost:5174" });

const password = "correct-horse-battery";
async function createUser(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page.getByRole("button", { name: "Skip setup", exact: true }).click();
  const email = `security-${Date.now()}@example.com`;
  await page.getByLabel("Name", { exact: true }).fill("Security test");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page
    .getByRole("link", { name: "Nothing spent? Who even are you?" })
    .click();
  return email;
}

test("login offers account creation, password recovery, and a clear fallback", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Create account", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Create account", exact: true }),
  ).toBeInViewport();
  await expect(
    page.getByRole("button", { name: "Sign in with a passkey", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/sign-in.png", fullPage: true });
  await page
    .getByRole("button", { name: "Forgot password?", exact: true })
    .click();
  await expect(page.getByText(/Email recovery isn't set up/)).toBeVisible();
  await expect(page.getByLabel("Recovery code", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Back to log in", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Hi, I'm Chindi.", exact: true }),
  ).toBeVisible();
});

test("real WebAuthn enrollment, persistent session, passkey sign-in, and removal", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  const email = await createUser(page);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Add a passkey", exact: true })
    .click();
  await page.getByLabel("Passkey name", { exact: true }).fill("My phone");
  await page.getByLabel("Current password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Save passkey", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 15000 });
  await expect(
    page.getByRole("button", { name: "Remove My phone", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Your settings.", exact: true }),
  ).toBeVisible();
  // A new browser context has no in-memory access token and must resume from the cookie.
  const resumed = await context
    .browser()!
    .newContext({ storageState: await context.storageState() });
  try {
    const otherPage = await resumed.newPage();
    await otherPage.goto("http://localhost:5174/");
    await expect(
      otherPage.getByText("Spent this month", { exact: true }),
    ).toBeVisible();
  } finally {
    await resumed.close();
  }
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue("");
  await page
    .getByRole("button", { name: "Sign in with a passkey", exact: true })
    .click();
  await expect(page.getByText("Spent this month", { exact: true })).toBeVisible(
    { timeout: 15000 },
  );
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Remove My phone", exact: true })
    .click();
  await page.getByLabel("Current password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Remove passkey", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Remove My phone", exact: true }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("recovery code resets the password once and preserves the budget", async ({
  page,
}) => {
  const email = await createUser(page);
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  await page.getByLabel("Amount", { exact: true }).fill("24.60");
  await page.getByLabel("Where", { exact: true }).fill("Before recovery");
  await page.getByRole("button", { name: "Add $24.60", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Generate recovery code", exact: true })
    .click();
  await page.getByLabel("Current password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Generate code", exact: true })
    .click();
  await expect(page.getByLabel("Recovery code", { exact: true })).toHaveValue(
    /^[A-F0-9-]{53}$/,
  );
  const code = await page
    .getByLabel("Recovery code", { exact: true })
    .inputValue();
  await page
    .getByRole("button", { name: "I've saved it", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await page
    .getByRole("button", { name: "Forgot password?", exact: true })
    .click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Recovery code", { exact: true }).fill(code);
  await page
    .getByLabel("New password", { exact: true })
    .fill("my-new-secure-password");
  await page
    .getByLabel("Confirm new password", { exact: true })
    .fill("my-new-secure-password");
  await page
    .getByRole("button", { name: "Reset password", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Password updated.");
  await page
    .getByRole("button", { name: "Back to log in", exact: true })
    .click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Email or password is incorrect.",
  );
  await page.locator('input[name="password"]').fill("my-new-secure-password");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.locator(".hero-amount")).toHaveText("$24.60");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Generate recovery code", exact: true }),
  ).toBeVisible();
});
