export function localDateTime(instant: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const part = (name: string) => parts.find((p) => p.type === name)!.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

function wallClockMilliseconds(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("Choose a valid transaction date and time.");
  const [, year, month, day, hour, minute] = match.map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, 0, 0);
  if (year < 1 || date.toISOString().slice(0, 16) !== value)
    throw new Error("Choose a valid transaction date and time.");
  return date.getTime();
}

export function transactionInstant(
  value: string,
  timezone: string,
  original: string,
): string {
  if (value === localDateTime(original, timezone)) return original;
  const wanted = wallClockMilliseconds(value);
  let candidate = wanted;
  for (let attempt = 0; attempt < 4; attempt++) {
    const actual = localDateTime(new Date(candidate).toISOString(), timezone);
    if (actual === value) return new Date(candidate).toISOString();
    candidate += wanted - wallClockMilliseconds(actual);
  }
  throw new Error(
    "That time doesn’t exist on this date because the clocks change. Choose another time.",
  );
}
