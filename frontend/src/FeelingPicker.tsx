export const FEELINGS = ["love", "good", "meh", "regret"] as const;

export function feelingLabel(value: string | null) {
  return value && FEELINGS.some((feeling) => feeling === value)
    ? value[0].toUpperCase() + value.slice(1)
    : "Not rated";
}

export default function FeelingPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="feeling-grid" role="group" aria-label="Purchase rating">
      {FEELINGS.map((feeling) => (
        <button
          type="button"
          key={feeling}
          className={"chip " + (value === feeling ? "active" : "")}
          aria-pressed={value === feeling}
          disabled={disabled}
          onClick={() => onChange(value === feeling ? "" : feeling)}
        >
          <i className={"dot " + feeling} aria-hidden="true" />
          {feelingLabel(feeling)}
        </button>
      ))}
    </div>
  );
}
