// Canonical Fuel Watch FACTS object.
//
// This module is the ONE place Fuel Watch computes the quantitative facts a
// report is built on. Every narrative surface (deterministic Market Read, the
// AI prose prompt, the consistency gate) reads THESE values — none of them may
// re-derive counts, rankings, directions or severities on its own.
//
// Documented calculation rules (spec):
//   * Facts are computed AFTER window filtering: the input incident set is
//     exactly filterTopicReportIncidents(incidents, "fuel", issueDate) — the
//     same set that drives Fast Facts and the Related Incidents table.
//   * Market direction is calculated from numbers, once, here:
//       pct >= +NEUTRAL → "rising"; pct <= -NEUTRAL → "falling";
//       |pct| < NEUTRAL and pct != 0 → "broadly stable"; pct == 0 → "unchanged".
//     NEUTRAL = MARKET_DIRECTION_NEUTRAL_PCT (0.75%).
//   * Pressure-point ranking: countries are grouped via the SAME
//     deriveIncidentCountry rule Regional Highlights uses, scored with the
//     shared aggregateIncidentSignificance (severity-weighted, resolved-event
//     discounted). The primary pressure point must beat the runner-up by
//     PRESSURE_LEADER_MARGIN (25%); otherwise pressure is "distributed" and
//     no surface may name a single leading pressure point.
//   * Overall severity is computed ONCE: the highest incident severity after
//     capFuelMarketSeverity (market-commentary demotion) is applied per
//     incident. Five tiers only.
//   * Entity fields are carried verbatim from the stored record — country,
//     location, severity and date are never inferred from one another.

import {
  filterTopicReportIncidents,
  type TopicFastFactsIncident,
} from "./topicFastFacts";
import { parseFuelHardNumbers, type FuelDataCard } from "./jetFuelTrajectory";
import { capFuelMarketSeverity } from "./fuelNarratives";
import { aggregateIncidentSignificance } from "@workspace/country-engine";
import { deriveIncidentCountry } from "./shippingCountry";

export type MarketDirection =
  | "rising"
  | "falling"
  | "broadly stable"
  | "unchanged";

/** Neutral band (in %): moves smaller than this are "broadly stable". */
export const MARKET_DIRECTION_NEUTRAL_PCT = 0.75;

/** A leader must carry at least this multiple of the runner-up's score to be
 *  named the primary pressure point; otherwise pressure is "distributed". */
export const PRESSURE_LEADER_MARGIN = 1.25;

/** The ONE direction rule. Every direction wording decision routes here. */
export function directionForPct(pct: number | null | undefined): MarketDirection | null {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return null;
  if (pct === 0) return "unchanged";
  if (pct >= MARKET_DIRECTION_NEUTRAL_PCT) return "rising";
  if (pct <= -MARKET_DIRECTION_NEUTRAL_PCT) return "falling";
  return "broadly stable";
}

export const SEVERITY_TIERS = [
  "insignificant",
  "low",
  "moderate",
  "high",
  "extreme",
] as const;
export type SeverityTier = (typeof SEVERITY_TIERS)[number];
const SEV_RANK: Record<string, number> = {
  insignificant: 1,
  low: 2,
  moderate: 3,
  high: 4,
  extreme: 5,
};

export interface FuelMarketIndicatorFact {
  key: "brent" | "wti" | "jet";
  label: string;
  /** Latest value as stored. Null when the indicator is absent. */
  current: number | null;
  unit: string | null;
  asOf: string | null;
  /** Previous reference value. For Brent/WTI this is back-computed from the
   *  card's change string (current / (1 + pct/100)); for jet it is the first
   *  trajectory point when a trajectory exists. Null when underivable. */
  previous: number | null;
  absChange: number | null;
  pctChange: number | null;
  direction: MarketDirection | null;
  /** Where previous/pct came from: audit trail for the gate. */
  basis: "change-string" | "trajectory" | "none";
}

export interface FuelPressurePointFact {
  country: string;
  score: number;
  recordCount: number;
  highestSeverity: SeverityTier | null;
}

export interface FuelReportFactsIncident {
  id: number | string | null;
  title: string;
  country: string | null;
  location: string | null;
  severity: string;
  /** Severity after the market-commentary cap — the value overall severity
   *  is computed from. */
  effectiveSeverity: string;
  occurredAt: string;
}

export interface FuelReportFacts {
  issueDate: string;
  incidentCount: number;
  /** Distinct occurredAt calendar dates (ISO YYYY-MM-DD), sorted ascending. */
  distinctDates: string[];
  /** Attributed countries with record counts, sorted by count desc. */
  countries: { name: string; count: number }[];
  severityDistribution: Record<SeverityTier, number>;
  highestSeverity: SeverityTier | null;
  /** Overall severity — computed once, five tiers only. Null when no records. */
  overallSeverity: SeverityTier | null;
  highestPriorityIncident: FuelReportFactsIncident | null;
  pressure: {
    distributed: boolean;
    primary: FuelPressurePointFact | null;
    secondary: FuelPressurePointFact[];
  };
  market: {
    indicators: FuelMarketIndicatorFact[];
    /** Mean of Brent/WTI pct changes (the crude complex direction basis). */
    avgCrudePctChange: number | null;
    crudeDirection: MarketDirection | null;
  };
  evidenceConfidence: "low" | "moderate" | "high";
  /** Condition classes OBSERVED in this window's records (e.g. "shortage",
   *  "chokepoint"). Current-condition claims outside this list are
   *  unsupported; anything else belongs in Watch Next as potential. */
  currentConditionSignals: string[];
  /** The qualifying records themselves — the traceability anchor. */
  incidents: FuelReportFactsIncident[];
}

const BRENT_RE = /brent/i;
const WTI_RE = /\bwti\b|west\s*texas/i;
const JET_RE = /\bjet\b|kerosene/i;

function parseChangePct(change?: string | null): number | null {
  if (!change) return null;
  const m = change.match(/(-?\d+(?:\.\d+)?)\s*%/);
  return m ? parseFloat(m[1]) : null;
}

function numOf(v: number | string | undefined | null): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function tierOf(s: string | null | undefined): SeverityTier | null {
  const k = (s ?? "").toLowerCase();
  return (SEVERITY_TIERS as readonly string[]).includes(k)
    ? (k as SeverityTier)
    : null;
}

function findCard(cards: FuelDataCard[], re: RegExp): FuelDataCard | null {
  for (const c of cards) if (re.test(`${c.label} ${c.note ?? ""}`)) return c;
  return null;
}

function indicatorFromCard(
  key: "brent" | "wti" | "jet",
  label: string,
  card: FuelDataCard | null,
  trajectory?: { date: string; value: number }[],
): FuelMarketIndicatorFact {
  const current = numOf(card?.value);
  let previous: number | null = null;
  let basis: FuelMarketIndicatorFact["basis"] = "none";
  let pct: number | null = null;

  // Jet prefers the trajectory (real observed previous point) over the
  // change-string back-computation.
  if (key === "jet" && trajectory && trajectory.length >= 2) {
    const first = trajectory[0];
    const last = trajectory[trajectory.length - 1];
    const cur = current ?? last.value;
    previous = first.value;
    pct = first.value !== 0 ? ((cur - first.value) / first.value) * 100 : 0;
    basis = "trajectory";
    return {
      key,
      label,
      current: cur,
      unit: card?.unit ?? null,
      asOf: card?.asOf ?? last.date ?? null,
      previous,
      absChange: previous !== null ? cur - previous : null,
      pctChange: pct,
      direction: directionForPct(pct),
      basis,
    };
  }

  const changePct = parseChangePct(card?.change);
  if (current !== null && changePct !== null) {
    previous = current / (1 + changePct / 100);
    pct = changePct;
    basis = "change-string";
  }
  return {
    key,
    label,
    current,
    unit: card?.unit ?? null,
    asOf: card?.asOf ?? null,
    previous,
    absChange: previous !== null && current !== null ? current - previous : null,
    pctChange: pct,
    direction: directionForPct(pct),
    basis,
  };
}

// Condition-class detectors — classes of CURRENT operating condition a
// narrative may assert only when at least one window record carries it.
const CONDITION_SIGNALS: { key: string; re: RegExp }[] = [
  { key: "shortage", re: /\b(shortage|rationing|run dry|out of fuel|stockout|scarcity)\b/i },
  { key: "chokepoint", re: /\b(hormuz|bab[- ]el[- ]mandeb|red sea|persian gulf|arabian gulf|suez|chokepoint|strait)\b/i },
  { key: "refinery-disruption", re: /\brefiner(y|ies)\b.*\b(fire|blast|explosion|outage|shutdown|shut down|halt|attack|strike|damage)\b|\b(fire|blast|explosion|outage|shutdown|attack)\b.*\brefiner(y|ies)\b/i },
  { key: "policy", re: /\b(subsid(y|ies)|levy|excise|price cap|export (ban|duty|control)|quota)\b/i },
  { key: "unrest", re: /\b(protest|riot|blockade|demonstrat|unrest|strike|walkout)\b/i },
  { key: "supply-disruption", re: /\b(pipeline|depot|terminal|tanker|import|supply)\b.*\b(halt|blocked|suspend|disrupt|attack|seiz|sabotage|damage)\w*\b/i },
];

/**
 * Build the canonical Fuel Watch facts object. `incidents` is the FULL
 * unfiltered list — the fuel window + relevance filter is applied here so all
 * consumers are guaranteed to be counting the same records.
 */
export function buildFuelReportFacts(opts: {
  issueDate: string;
  hardNumbers: unknown;
  incidents: TopicFastFactsIncident[];
}): FuelReportFacts {
  const windowIncidents = filterTopicReportIncidents(
    opts.incidents,
    "fuel",
    opts.issueDate,
  );

  const records: FuelReportFactsIncident[] = windowIncidents.map((i) => ({
    id: i.id ?? null,
    title: i.title,
    country: deriveIncidentCountry(i),
    location: i.location ?? null,
    severity: (i.severity ?? "").toLowerCase(),
    effectiveSeverity: (
      capFuelMarketSeverity(i.severity, i.title, i.summary ?? "") || ""
    ).toLowerCase(),
    occurredAt: i.occurredAt,
  }));

  // Distinct calendar dates.
  const dateSet = new Set<string>();
  for (const r of records) {
    const m = (r.occurredAt ?? "").match(/^\d{4}-\d{2}-\d{2}/);
    if (m) dateSet.add(m[0]);
  }
  const distinctDates = Array.from(dateSet).sort();

  // Country counts (attributed only — Unknown/null never counted).
  const countryCount = new Map<string, number>();
  const byCountry = new Map<string, TopicFastFactsIncident[]>();
  windowIncidents.forEach((i, idx) => {
    const c = records[idx].country;
    if (!c) return;
    countryCount.set(c, (countryCount.get(c) ?? 0) + 1);
    const arr = byCountry.get(c) ?? [];
    arr.push(i);
    byCountry.set(c, arr);
  });
  const countries = Array.from(countryCount.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  // Severity distribution + highest (raw stored tiers) and overall severity
  // (capped tiers — market commentary can never make the report High/Extreme).
  const severityDistribution: Record<SeverityTier, number> = {
    insignificant: 0,
    low: 0,
    moderate: 0,
    high: 0,
    extreme: 0,
  };
  let highestSeverity: SeverityTier | null = null;
  let overallSeverity: SeverityTier | null = null;
  for (const r of records) {
    const raw = tierOf(r.severity);
    if (raw) {
      severityDistribution[raw] += 1;
      if (!highestSeverity || SEV_RANK[raw] > SEV_RANK[highestSeverity]) {
        highestSeverity = raw;
      }
    }
    const eff = tierOf(r.effectiveSeverity);
    if (eff && (!overallSeverity || SEV_RANK[eff] > SEV_RANK[overallSeverity])) {
      overallSeverity = eff;
    }
  }

  // Highest-priority incident: highest EFFECTIVE severity, ties broken by
  // recency, then stable by title. Documented, single rule.
  let highestPriorityIncident: FuelReportFactsIncident | null = null;
  for (const r of records) {
    if (!highestPriorityIncident) {
      highestPriorityIncident = r;
      continue;
    }
    const a = SEV_RANK[r.effectiveSeverity] ?? 0;
    const b = SEV_RANK[highestPriorityIncident.effectiveSeverity] ?? 0;
    if (
      a > b ||
      (a === b && r.occurredAt > highestPriorityIncident.occurredAt) ||
      (a === b &&
        r.occurredAt === highestPriorityIncident.occurredAt &&
        r.title < highestPriorityIncident.title)
    ) {
      highestPriorityIncident = r;
    }
  }

  // Pressure-point ranking — same grouping + scorer as Regional Highlights.
  const scored: FuelPressurePointFact[] = Array.from(byCountry.entries())
    .map(([country, items]) => {
      let hs: SeverityTier | null = null;
      for (const i of items) {
        const t = tierOf(i.severity);
        if (t && (!hs || SEV_RANK[t] > SEV_RANK[hs])) hs = t;
      }
      return {
        country,
        score: aggregateIncidentSignificance(items),
        recordCount: items.length,
        highestSeverity: hs,
      };
    })
    .sort((a, b) => b.score - a.score || a.country.localeCompare(b.country));

  let distributed = false;
  let primary: FuelPressurePointFact | null = null;
  if (scored.length === 1) {
    primary = scored[0];
  } else if (scored.length > 1) {
    const [lead, runner] = scored;
    if (runner.score <= 0 || lead.score >= runner.score * PRESSURE_LEADER_MARGIN) {
      primary = lead;
    } else {
      distributed = true;
    }
  }
  const secondary = scored
    .filter((s) => s !== primary)
    .slice(0, primary ? 2 : 3);

  // Market indicators.
  const parsed = parseFuelHardNumbers(opts.hardNumbers);
  const brentCard = findCard(parsed.prices, BRENT_RE);
  const wtiCard = findCard(parsed.prices, WTI_RE);
  let jetCard = findCard(parsed.prices, JET_RE);
  if (!jetCard && parsed.jetFuel?.latestValue !== undefined) {
    jetCard = {
      label: "Jet fuel",
      value: parsed.jetFuel.latestValue as number,
      ...(parsed.jetFuel.unit ? { unit: parsed.jetFuel.unit } : {}),
      ...(parsed.jetFuel.change ? { change: parsed.jetFuel.change } : {}),
      ...(parsed.jetFuel.asOf ? { asOf: parsed.jetFuel.asOf } : {}),
    };
  }
  const trajPoints = parsed.jetFuelTrajectory.points.map((p) => ({
    date: p.date,
    value: p.value,
  }));
  const brent = indicatorFromCard("brent", "Brent crude", brentCard);
  const wti = indicatorFromCard("wti", "WTI crude", wtiCard);
  const jet = indicatorFromCard(
    "jet",
    "Jet fuel",
    jetCard,
    trajPoints.length >= 2 ? trajPoints : undefined,
  );
  const crudePcts = [brent.pctChange, wti.pctChange].filter(
    (v): v is number => v !== null,
  );
  const avgCrudePctChange = crudePcts.length
    ? crudePcts.reduce((s, v) => s + v, 0) / crudePcts.length
    : null;

  // Evidence confidence — documented rule: volume + attribution coverage.
  const attributed = records.filter((r) => r.country).length;
  const attributionShare = records.length ? attributed / records.length : 0;
  let evidenceConfidence: FuelReportFacts["evidenceConfidence"] = "low";
  if (records.length >= 8 && attributionShare >= 0.6) evidenceConfidence = "high";
  else if (records.length >= 3) evidenceConfidence = "moderate";

  // Observed current-condition classes.
  const signalSet = new Set<string>();
  for (const i of windowIncidents) {
    const hay = `${i.title} ${i.summary ?? ""}`;
    for (const s of CONDITION_SIGNALS) if (s.re.test(hay)) signalSet.add(s.key);
  }

  // Confidence hedge on the OVERALL call (demote-only, never up-rates):
  // a High/Extreme overall read is not supportable when the evidence base is
  // low-confidence, the crude complex is falling and no live shortage or
  // unrest condition was observed this window — a single contained event on
  // thin reporting must not headline the report as High. One tier down.
  const crudeDirectionCalc = directionForPct(avgCrudePctChange);
  if (
    overallSeverity &&
    SEV_RANK[overallSeverity] >= SEV_RANK.high &&
    evidenceConfidence === "low" &&
    crudeDirectionCalc === "falling" &&
    !signalSet.has("shortage") &&
    !signalSet.has("unrest")
  ) {
    const order: SeverityTier[] = [
      "insignificant",
      "low",
      "moderate",
      "high",
      "extreme",
    ];
    overallSeverity = order[SEV_RANK[overallSeverity] - 2] ?? "moderate";
  }

  return {
    issueDate: opts.issueDate,
    incidentCount: records.length,
    distinctDates,
    countries,
    severityDistribution,
    highestSeverity,
    overallSeverity,
    highestPriorityIncident,
    pressure: { distributed, primary, secondary },
    market: {
      indicators: [brent, wti, jet],
      avgCrudePctChange,
      crudeDirection: directionForPct(avgCrudePctChange),
    },
    evidenceConfidence,
    currentConditionSignals: Array.from(signalSet).sort(),
    incidents: records,
  };
}

/**
 * Serialise the facts object into the FIXED FACTS block the AI prose prompt
 * receives. The model may explain these values; it must never recalculate or
 * contradict them. Kept compact and deterministic (stable ordering) so the
 * prose fingerprint keyed on it is stable for identical data.
 */
export function serialiseFuelFactsForPrompt(f: FuelReportFacts): string {
  const lines: string[] = [];
  lines.push(`Qualifying fuel records this window: ${f.incidentCount}`);
  lines.push(`Distinct incident dates: ${f.distinctDates.length}`);
  if (f.countries.length) {
    lines.push(
      `Countries (records): ${f.countries.map((c) => `${c.name} ${c.count}`).join("; ")}`,
    );
  }
  if (f.overallSeverity) {
    lines.push(
      `Overall severity (computed once, five-tier scale): ${f.overallSeverity}`,
    );
  }
  if (f.pressure.distributed) {
    lines.push(
      "Pressure picture: DISTRIBUTED — no single leading pressure point; do NOT name any country as the primary/clearest pressure point.",
    );
  } else if (f.pressure.primary) {
    lines.push(
      `Primary pressure point: ${f.pressure.primary.country}` +
        (f.pressure.secondary.length
          ? `; secondary: ${f.pressure.secondary.map((s) => s.country).join(", ")}`
          : ""),
    );
  }
  for (const m of f.market.indicators) {
    if (m.current === null) continue;
    const bits = [`${m.label}: ${m.current}${m.unit ? ` ${m.unit}` : ""}`];
    if (m.pctChange !== null) {
      bits.push(
        `${m.pctChange >= 0 ? "+" : ""}${m.pctChange.toFixed(1)}% vs previous`,
      );
    }
    if (m.direction) bits.push(`direction: ${m.direction}`);
    lines.push(bits.join(", "));
  }
  if (f.market.crudeDirection) {
    lines.push(`Crude complex direction (Brent/WTI mean): ${f.market.crudeDirection}`);
  }
  lines.push(
    `Observed current conditions this window: ${
      f.currentConditionSignals.length
        ? f.currentConditionSignals.join(", ")
        : "none recorded"
    }. Anything not listed here may be discussed ONLY as a forward watch indicator, never as a current condition.`,
  );
  lines.push(`Evidence confidence: ${f.evidenceConfidence}`);
  return lines.join("\n");
}
