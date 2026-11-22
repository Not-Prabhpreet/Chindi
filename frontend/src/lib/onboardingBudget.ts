import { cents, fromCents } from "./money";

export type BudgetCategory = {
  name: string;
  amount: string;
  kind: "flexible" | "fixed";
  enabled: boolean;
  icon: string;
  color: string;
};

export const DEFAULT_BUDGET_CATEGORIES: BudgetCategory[] = [];

function amountInCents(category: BudgetCategory): bigint {
  if (category.amount === "") return 0n;
  const value = cents(category.amount);
  if (value < 0n || value >= 1000000000000n)
    throw new Error(
      `${category.name}: enter a nonnegative amount below 10 billion, with at most two decimal places.`,
    );
  return value;
}

export function budgetTotals(categories: BudgetCategory[]) {
  let flexible = 0n;
  let fixed = 0n;
  for (const category of categories) {
    if (!category.enabled) continue;
    const amount = amountInCents(category);
    if (category.kind === "flexible") flexible += amount;
    else fixed += amount;
  }
  return { flexible: fromCents(flexible), fixed: fromCents(fixed) };
}

export function budgetPayload(categories: BudgetCategory[]) {
  budgetTotals(categories); // Validate before creating the account.
  const names = new Set<string>();
  for (const category of categories) {
    const name = category.name.trim();
    if (!name)
      throw new Error("Give each category a name, or remove the empty row.");
    if (names.has(name.toLowerCase()))
      throw new Error("Each category needs a different name.");
    names.add(name.toLowerCase());
  }
  return categories.map((category, position) => ({
    name: category.name.trim(),
    kind: category.kind,
    archived: !category.enabled,
    limit_amount:
      category.amount === "" ? null : fromCents(amountInCents(category)),
    max_count: null,
    icon: category.icon,
    color: category.color,
    position,
  }));
}
