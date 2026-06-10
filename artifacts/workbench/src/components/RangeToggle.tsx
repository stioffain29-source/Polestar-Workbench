import { RANGE_KEYS, RANGE_LABEL, type RangeKey } from "@/lib/dateRange";

// Shared date-range pill group used by the topic monitors. Mirrors the styling
// of the existing Cargo Watch range pills so all monitors look consistent.
export function RangeToggle({
  range,
  onChange,
  keys = RANGE_KEYS,
}: {
  range: RangeKey;
  onChange: (r: RangeKey) => void;
  keys?: RangeKey[];
}) {
  return (
    <div className="flex items-center gap-px bg-border rounded-sm overflow-hidden border border-border">
      {keys.map((k) => (
        <button
          key={k}
          onClick={() => onChange(k)}
          aria-pressed={range === k}
          className={
            "px-2.5 py-1.5 text-xs font-sans font-medium uppercase tracking-wider transition-colors " +
            (range === k
              ? "bg-primary text-primary-foreground"
              : "bg-card text-muted-foreground hover:bg-muted")
          }
        >
          {RANGE_LABEL[k]}
        </button>
      ))}
    </div>
  );
}
