const ACCOUNT_TYPES: Record<string, string> = {
  chequing: "Chequing",
  savings: "Savings",
  credit_card: "Credit card",
  cash: "Cash",
  other: "Other",
};

export function accountTypeName(kind: string): string {
  return ACCOUNT_TYPES[kind] || "Other";
}

export function accountLabel(account?: {
  name: string;
  kind: string;
  archived?: boolean;
}): string {
  if (!account) return "Account unavailable";
  return `${account.name} · ${accountTypeName(account.kind)}${account.archived ? " (archived)" : ""}`;
}
