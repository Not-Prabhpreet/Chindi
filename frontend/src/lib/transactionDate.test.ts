import { expect, it } from "vitest";
import { localDateTime, transactionInstant } from "./transactionDate";

const zone = "America/St_Johns";
const original = "2026-11-02T20:30:47.123Z";

it("formats the transaction in the budget timezone rather than the device timezone", () => {
  expect(localDateTime("2026-11-02T02:30:47.123Z", zone)).toBe(
    "2026-11-01T23:00",
  );
  expect(localDateTime("2026-11-01T01:30:00Z", zone)).toBe("2026-10-31T23:00");
  expect(localDateTime("2026-11-02T00:00:00Z", "Asia/Kolkata")).toBe(
    "2026-11-02T05:30",
  );
});

it("converts chosen dates through half-hour offsets, DST changes and leap dates", () => {
  expect(transactionInstant("2026-10-31T23:59", zone, original)).toBe(
    "2026-11-01T02:29:00.000Z",
  );
  expect(transactionInstant("2026-11-01T23:59", zone, original)).toBe(
    "2026-11-02T03:29:00.000Z",
  );
  expect(transactionInstant("2026-03-08T03:30", zone, original)).toBe(
    "2026-03-08T06:00:00.000Z",
  );
  expect(transactionInstant("2028-02-29T14:30", zone, original)).toBe(
    "2028-02-29T18:00:00.000Z",
  );
});

it("keeps the original instant and its seconds when an edit leaves the date and time unchanged", () => {
  for (const instant of [
    original,
    "2026-11-01T03:45:12.345Z",
    "2026-11-01T04:45:59.987Z",
  ]) {
    expect(
      transactionInstant(localDateTime(instant, zone), zone, instant),
    ).toBe(instant);
  }
});

it("rejects missing dates, invalid calendar days and nonexistent clock-change times", () => {
  expect(() => transactionInstant("", zone, original)).toThrow(
    "Choose a valid transaction date",
  );
  expect(() => transactionInstant("2026-02-30T12:00", zone, original)).toThrow(
    "Choose a valid transaction date",
  );
  expect(() => transactionInstant("2026-03-08T02:30", zone, original)).toThrow(
    "clocks change",
  );
});
