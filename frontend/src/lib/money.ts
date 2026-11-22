// Integer cents for client-side arithmetic. Strings go unchanged to the Decimal API.
export function cents(value: string): bigint {
  if (!/^-?\d+(\.\d{0,2})?$/.test(value))
    throw new Error("Use an amount with at most two decimal places.");
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace("-", "").split(".");
  return (
    (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))) *
    (negative ? -1n : 1n)
  );
}
export function fromCents(value: bigint): string {
  const abs = value < 0n ? -value : value;
  return (
    (value < 0n ? "-" : "") +
    abs / 100n +
    "." +
    String(abs % 100n).padStart(2, "0")
  );
}
export function subtract(a: string, b: string): string {
  return fromCents(cents(a) - cents(b));
}
export function formatMoney(
  value: string | number | undefined,
  currency = "CAD",
): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    minimumFractionDigits: Number.isInteger(Number(value || 0)) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}
export function padAmount(value: string, key: string): string {
  if (key === "delete") return value.slice(0, -1) || "0";
  if (key === ".") return value.includes(".") ? value : value + ".";
  if (value.includes(".") && value.split(".")[1].length >= 2) return value;
  if (value.replace(".", "").length >= 10) return value;
  return value === "0" ? key : value + key;
}
