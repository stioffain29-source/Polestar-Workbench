// Fuel Watch hard-numbers / jet-fuel data parser.
//
// Single source of truth for parsing the report.hardNumbers jsonb column.
// Both the preview and the PDF exporter call into this so they cannot
// read different series or different headline numbers.
//
// The parser is intentionally tolerant. It accepts:
//
//   1. The flexible FuelHardNumbers v2 object:
//        {
//          prices?:  PriceCard[],
//          supply?:  SupplyCard[],
//          policy?:  PolicyCard[],
//          routes?:  RouteCard[],
//          jetFuel?: JetFuelSnapshot,
//          jetFuelTrajectory?: { benchmark?, source?, unit?, period?, points: Point[] }
//                              | Point[]   // legacy array shape
//        }
//
//   2. The original v1 object: { cards?: KpiCard[], jetFuelTrajectory?: Point[],
//        jetFuelBenchmarkLabel?: string }
//
//   3. The legacy KpiCard[] array.
//
// Anything else returns an empty container so callers render the honest
// empty-state, not a dash-filled placeholder grid.

export interface JetFuelPricePoint {
  date: string;
  value: number;
  unit?: string;
  label?: string;
  annotation?: string;
}

export interface FuelDataCard {
  label: string;
  /** Numeric or string value. Numbers are formatted at render time. */
  value: number | string;
  unit?: string;
  change?: string;
  asOf?: string;
  source?: string;
  note?: string;
}

export interface JetFuelSnapshot {
  benchmark?: string;
  source?: string;
  unit?: string;
  latestValue?: number;
  asOf?: string;
  change?: string;
}

export interface JetFuelTrajectoryContainer {
  benchmark?: string;
  source?: string;
  unit?: string;
  period?: string;
  points: JetFuelPricePoint[];
}

export interface ParsedFuelHardNumbers {
  /** Legacy free-form cards (v1 shape). Preserved verbatim. */
  legacyCards: Array<{ label: string; value: string; accent?: string; context?: string }>;
  prices: FuelDataCard[];
  supply: FuelDataCard[];
  policy: FuelDataCard[];
  routes: FuelDataCard[];
  jetFuel?: JetFuelSnapshot;
  jetFuelTrajectory: JetFuelTrajectoryContainer;
}

const EMPTY: ParsedFuelHardNumbers = {
  legacyCards: [],
  prices: [],
  supply: [],
  policy: [],
  routes: [],
  jetFuelTrajectory: { points: [] },
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function parseLegacyCard(v: unknown) {
  if (!isRecord(v)) return null;
  const label = str(v.label);
  const value = typeof v.value === "string" ? v.value : null;
  if (!label || !value) return null;
  const out: { label: string; value: string; accent?: string; context?: string } = { label, value };
  const accent = str(v.accent); if (accent) out.accent = accent;
  const context = str(v.context); if (context) out.context = context;
  return out;
}

function parseDataCard(v: unknown): FuelDataCard | null {
  if (!isRecord(v)) return null;
  const baseLabel = str(v.label);
  if (!baseLabel) return null;
  const rawValue = v.value;
  let value: number | string;
  if (typeof rawValue === "number" && Number.isFinite(rawValue)) value = rawValue;
  else if (typeof rawValue === "string" && rawValue.trim()) value = rawValue.trim();
  else return null;
  // Allow a `benchmark` field on price cards (e.g. for jet fuel entries
  // inside the prices array). It becomes part of the label so the
  // benchmark name renders without a separate column.
  const benchmark = str(v.benchmark);
  const label = benchmark ? `${baseLabel} — ${benchmark}` : baseLabel;
  const out: FuelDataCard = { label, value };
  const unit = str(v.unit); if (unit) out.unit = unit;
  const change = str(v.change); if (change) out.change = change;
  const asOf = str(v.asOf); if (asOf) out.asOf = asOf;
  const source = str(v.source); if (source) out.source = source;
  const note = str(v.note); if (note) out.note = note;
  return out;
}

function parsePoint(v: unknown): JetFuelPricePoint | null {
  if (!isRecord(v)) return null;
  const date = typeof v.date === "string" ? v.date.trim() : "";
  const value = num(v.value);
  if (!date || value === undefined) return null;
  const parsed = new Date(date);
  if (isNaN(parsed.getTime())) return null;
  const out: JetFuelPricePoint = { date, value };
  const unit = str(v.unit); if (unit) out.unit = unit;
  const label = str(v.label); if (label) out.label = label;
  const annotation = str(v.annotation); if (annotation) out.annotation = annotation;
  return out;
}

function parseCardArray(v: unknown): FuelDataCard[] {
  if (!Array.isArray(v)) return [];
  return v
    .map(parseDataCard)
    .filter((c): c is FuelDataCard => c !== null);
}

function parseJetFuelSnapshot(v: unknown): JetFuelSnapshot | undefined {
  if (!isRecord(v)) return undefined;
  const out: JetFuelSnapshot = {};
  const benchmark = str(v.benchmark); if (benchmark) out.benchmark = benchmark;
  const source = str(v.source); if (source) out.source = source;
  const unit = str(v.unit); if (unit) out.unit = unit;
  const latest = num(v.latestValue); if (latest !== undefined) out.latestValue = latest;
  const asOf = str(v.asOf); if (asOf) out.asOf = asOf;
  const change = str(v.change); if (change) out.change = change;
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseTrajectoryContainer(v: unknown): JetFuelTrajectoryContainer {
  if (Array.isArray(v)) {
    const points = v
      .map(parsePoint)
      .filter((p): p is JetFuelPricePoint => p !== null)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    return { points };
  }
  if (!isRecord(v)) return { points: [] };
  const arr = Array.isArray(v.points) ? v.points : [];
  const points = arr
    .map(parsePoint)
    .filter((p): p is JetFuelPricePoint => p !== null)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const out: JetFuelTrajectoryContainer = { points };
  const benchmark = str(v.benchmark); if (benchmark) out.benchmark = benchmark;
  const source = str(v.source); if (source) out.source = source;
  const unit = str(v.unit); if (unit) out.unit = unit;
  const period = str(v.period); if (period) out.period = period;
  return out;
}

/**
 * Parse the raw jsonb payload from report.hardNumbers into a normalised
 * structure. Returns the EMPTY container when the payload is null,
 * malformed, or carries no recognised data.
 */
export function parseFuelHardNumbers(raw: unknown): ParsedFuelHardNumbers {
  if (raw == null) return EMPTY;
  if (Array.isArray(raw)) {
    const legacyCards = raw
      .map(parseLegacyCard)
      .filter((c): c is NonNullable<ReturnType<typeof parseLegacyCard>> => c !== null);
    return { ...EMPTY, legacyCards };
  }
  if (!isRecord(raw)) return EMPTY;

  const legacyCards = Array.isArray(raw.cards)
    ? raw.cards
        .map(parseLegacyCard)
        .filter((c): c is NonNullable<ReturnType<typeof parseLegacyCard>> => c !== null)
    : [];

  // Top-level fields are the canonical home for the v2 shape, but the
  // jsonb may also wrap them in a `fastFacts` container. Merge both so
  // either layout works without authors having to choose.
  const ff = isRecord(raw.fastFacts) ? raw.fastFacts : {};
  const prices = [...parseCardArray(raw.prices), ...parseCardArray(ff.prices)];
  const supply = [...parseCardArray(raw.supply), ...parseCardArray(ff.supply)];
  const policy = [...parseCardArray(raw.policy), ...parseCardArray(ff.policy)];
  const routes = [...parseCardArray(raw.routes), ...parseCardArray(ff.routes)];
  const jetFuel = parseJetFuelSnapshot(raw.jetFuel);
  const trajectory = parseTrajectoryContainer(raw.jetFuelTrajectory);

  // Back-compat: the v1 shape carried jetFuelBenchmarkLabel at the top
  // level. Promote it to the trajectory container when one wasn't set.
  if (!trajectory.benchmark) {
    const legacyBenchmark = str(raw.jetFuelBenchmarkLabel);
    if (legacyBenchmark) trajectory.benchmark = legacyBenchmark;
  }

  return {
    legacyCards,
    prices,
    supply,
    policy,
    routes,
    ...(jetFuel ? { jetFuel } : {}),
    jetFuelTrajectory: trajectory,
  };
}

/**
 * Return the jet fuel series only when it has at least 2 valid points,
 * matching the chart's minimum-data contract. Returns null otherwise so
 * the caller renders the honest empty-state card.
 */
export function getFuelJetFuelTrajectory(raw: unknown): JetFuelPricePoint[] | null {
  const { jetFuelTrajectory } = parseFuelHardNumbers(raw);
  return jetFuelTrajectory.points.length >= 2 ? jetFuelTrajectory.points : null;
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
export function jetFuelMovement(
  raw: unknown,
): { direction: "up" | "down"; delta: number; pct: number } | null {
  const series = getFuelJetFuelTrajectory(raw);
  if (!series || series.length < 2) return null;
  const first = series[0].value;
  const last = series[series.length - 1].value;
  if (first === last) return null;
  const delta = last - first;
  const pct = first !== 0 ? (delta / first) * 100 : 0;
  return { direction: delta > 0 ? "up" : "down", delta, pct };
}

/**
 * Best-effort benchmark label. Prefers the explicit container/snapshot
 * benchmark name; falls back to the first point's `label`. Returns a
 * neutral "Jet fuel benchmark" only when nothing else is supplied — we
 * never assume Singapore.
 */
export function jetFuelBenchmarkLabel(raw: unknown): string {
  const parsed = parseFuelHardNumbers(raw);
  if (parsed.jetFuelTrajectory.benchmark) return parsed.jetFuelTrajectory.benchmark;
  if (parsed.jetFuel?.benchmark) return parsed.jetFuel.benchmark;
  const first = parsed.jetFuelTrajectory.points[0];
  if (first?.label) return first.label;
  return "Jet fuel benchmark";
}
