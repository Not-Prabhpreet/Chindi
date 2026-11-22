import { expect, it } from "vitest";
import {
  budgetPayload,
  budgetTotals,
  DEFAULT_BUDGET_CATEGORIES,
  type BudgetCategory,
} from "./onboardingBudget";

const category = (
  name: string,
  amount: string,
  kind: "flexible" | "fixed" = "flexible",
  enabled = true,
): BudgetCategory => ({
  name,
  amount,
  kind,
  enabled,
  icon: "bag",
  color: "sky-soft",
});

it("starts with no predefined categories or budget", () => {
  expect(DEFAULT_BUDGET_CATEGORIES).toEqual([]);
  expect(budgetPayload([])).toEqual([]);
  expect(budgetTotals([])).toEqual({ flexible: "0.00", fixed: "0.00" });
});

it("sums entered category limits exactly and excludes fixed and disabled categories", () => {
  const categories = [
    category("Food", "123.45"),
    category("Hobbies", "67.89"),
    category("Optional", "150.00", "flexible", false),
    category("Phone", "50.10", "fixed"),
    category("Other", ""),
    category("Rent", "900.25", "fixed"),
  ];
  expect(budgetTotals(categories)).toEqual({
    flexible: "191.34",
    fixed: "950.35",
  });
  const payload = budgetPayload(categories);
  expect(payload[0].limit_amount).toBe("123.45");
  expect(payload[2]).toMatchObject({ archived: true, limit_amount: "150.00" });
  expect(payload[3]).toMatchObject({ kind: "fixed", limit_amount: "50.10" });
  expect(payload[4].limit_amount).toBeNull();
});

it("rejects negative amounts and fractions of a cent before registration", () => {
  expect(() => budgetPayload([category("Food", "-1")])).toThrow();
  expect(() => budgetPayload([category("Food", "1.001")])).toThrow();
  expect(() => budgetPayload([category("", "1")])).toThrow();
  expect(() =>
    budgetPayload([category("Food", "1"), category(" food ", "2")]),
  ).toThrow();
});
