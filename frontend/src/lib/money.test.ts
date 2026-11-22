import { describe, it, expect } from "vitest";
import { cents, fromCents, subtract, padAmount } from "./money";
describe("money entry and arithmetic", () => {
  it("keeps decimals exact", () => {
    expect(fromCents(cents("0.10") + cents("0.20"))).toBe("0.30");
    expect(subtract("100", "24.60")).toBe("75.40");
    expect(subtract("0", "1.01")).toBe("-1.01");
  });
  it("rejects fractions of a cent", () => {
    expect(() => cents("1.001")).toThrow();
    expect(() => cents("NaN")).toThrow();
  });
  it("bounds the amount pad and handles delete", () => {
    expect(padAmount("0", "1")).toBe("1");
    expect(padAmount("1.25", "3")).toBe("1.25");
    expect(padAmount("1.", ".")).toBe("1.");
    expect(padAmount("1", "delete")).toBe("0");
  });
});
