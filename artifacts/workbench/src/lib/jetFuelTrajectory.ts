// Jet Fuel Price Trajectory — single source of truth for parsing the
// report.hardNumbers jsonb column. Both the Fuel Watch preview and the
// PDF exporter call into this so they cannot read different series.
//
// The parser is intentionally tolerant: it accepts the modern
// FuelHardNumbers object shape ({ cards?, jetFuelTrajectory?, … }) as
// well as the legacy KpiCard[] shape (treated as cards only, no
// trajectory). Anything else returns null so the chart falls back to
// the honest empty state.

export interface JetFuelPricePoint {
  date: string;
  value: number;
  unit?: string;
  label?: string;
  annotation?: string;
}

export interface ParsedFuelHardNumbers {
  cards: Array<{ label: string; value: string; accent?: string; context?: string }>;
  jetFuelTrajectory: JetFuelPricePoint[];
  jetFuelBenchmarkLabel?: string;
}

const EMPTY: ParsedFuelHardNumbers = { cards: [], jetFuelTrajectory: [] };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseCard(v: unknown) {
  if (!isRecord(v)) return null;
  const label = typeof v.label === "string" ? v.label : null;
  const value = typeof v.value === "string" ? v.value : null;
  if (!label || !value) return null;
  const out: { label: string; value: string; accent?: string; context?: string } = { label, value };
  if (typeof v.accent === "string") out.accent = v.accent;
  if (typeof v.context === "string") out.context = v.context;
  return out;
}

function parsePoint(v: unknown): JetFuelPricePoint | null {
  if (!isRecord(v)) return null;
  const date = typeof v.date === "string" ? v.date.trim() : "";
  const value = typeof v.value === "number" && Number.isFinite(v.value) ? v.value : null;
  if (!date || value === null) return null;
  // Reject obviously malformed dates so the chart never plots garbage.
  const parsed = new Date(date);
  if (isNaN(parsed.getTime())) return null;
  const out: JetFuelPricePoint = { date, value };
  if (typeof v.unit === "string" && v.unit.trim()) out.unit = v.unit.trim();
  if (typeof v.label === "string" && v.label.trim()) out.label = v.label.trim();
  if (typeof v.annotation === "string" && v.annotation.trim()) out.annotation = v.annotation.trim();
  return out;
}

/**
 * Parse the raw jsonb payload from report.hardNumbers into a normalised
 * shape. Returns an empty container (no cards, no series) when the
 * payload is null, malformed, or carries no recognised data.
 */
export function parseFuelHardNumbers(raw: unknown): ParsedFuelHardNumbers {
  if (raw == null) return EMPTY;
  // Legacy: array of KpiCard. No trajectory, just cards.
  if (Array.isArray(raw)) {
    const cards = raw.map(parseCard).filter((c): c is NonNullable<typeof c> => c !== null);
    return { cards, jetFuelTrajectory: [] };
  }
  if (!isRecord(raw)) return EMPTY;
  const cardsArr = Array.isArray(raw.cards) ? raw.cards : [];
  const trajArr = Array.isArray(raw.jetFuelTrajectory) ? raw.jetFuelTrajectory : [];
  const points = trajArr
    .map(parsePoint)
    .filter((p): p is JetFuelPricePoint => p !== null)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const benchmark = typeof raw.jetFuelBenchmarkLabel === "string" && raw.jetFuelBenchmarkLabel.trim()
    ? raw.jetFuelBenchmarkLabel.trim()
    : undefined;
  const out: ParsedFuelHardNumbers = {
    cards: cardsArr.map(parseCard).filter((c): c is NonNullable<ReturnType<typeof parseCard>> => c !== null),
    jetFuelTrajectory: points,
  };
  if (benchmark) out.jetFuelBenchmarkLabel = benchmark;
  return out;
}

/**
 * Return the jet fuel series only when it has at least 2 valid points,
 * matching the chart's minimum-data contract. Returns null otherwise so
 * the caller renders the honest empty-state card.
 */
export function getFuelJetFuelTrajectory(raw: unknown): JetFuelPricePoint[] | null {
  const { jetFuelTrajectory } = parseFuelHardNumbers(raw);
  return jetFuelTrajectory.length >= 2 ? jetFuelTrajectory : null;
}

/** Latest (most recent) point in the series, or null if none. */
export function latestJetFuelPoint(raw: unknown): JetFuelPricePoint | null {
  const series = getFuelJetFuelTrajectory(raw);
  return series ? series[series.length - 1] : null;
}

/**
 * Movement direction between the first and last point in the series.
 * Returns null when the series is too short or values are equal.
 */
export function jetFuelMovement(raw: unknown): { direction: "up" | "down"; delta: number; pct: number } | null {
  const series = getFuelJetFuelTrajectory(raw);
  if (!series || series.length < 2) return null;
  const first = series[0].value;
  const last = series[series.length - 1].value;
  if (first === last) return null;
  const delta = last - first;
  const pct = first !== 0 ? (delta / first) * 100 : 0;
  return { direction: delta > 0 ? "up" : "down", delta, pct };
}

export function jetFuelBenchmarkLabel(raw: unknown): string {
  const parsed = parseFuelHardNumbers(raw);
  if (parsed.jetFuelBenchmarkLabel) return parsed.jetFuelBenchmarkLabel;
  // Fall back to the first point's label if the container did not set one.
  const first = parsed.jetFuelTrajectory[0];
  if (first?.label) return first.label;
  return "Singapore jet fuel benchmark";
}
