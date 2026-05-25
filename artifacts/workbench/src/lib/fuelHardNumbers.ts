// Fuel Watch "Hard Numbers" cards.
//
// Hard Numbers is a fuel-market block, not a renamed Fast Facts panel.
// The required render order is:
//
//   1. Price cards         (Brent / WTI / pump / surcharge)
//   2. Jet fuel card       (latest value, change, source)
//   3. Supply cards        (refinery outages, shortages, rationing)
//   4. Policy cards        (subsidy / levy / duty changes)
//   5. Route cards         (Hormuz / Red Sea / Malacca pressure)
//
// Sources, in priority order:
//   a. Anything supplied in the report's `hardNumbers` jsonb. This is the
//      authoritative source — we never override a manually-entered price.
//   b. Incident-derived counters for supply / policy / route tiers. These
//      back-fill from the in-window incident set so the section is not
//      empty when manual data is missing. They are never used to fake
//      price data.
//
// We never invent values. Cards with zero signal are omitted. If no
// price data is supplied at all, the renderer surfaces a single honest
// note instead of a wall of incident counts.

import { filterTopicReportIncidents, type TopicFastFactsIncident } from "./topicFastFacts";
import {
  parseFuelHardNumbers,
  latestJetFuelPoint,
  jetFuelMovement,
  jetFuelBenchmarkLabel,
  type FuelDataCard,
} from "./jetFuelTrajectory";

export interface FuelHardNumberCard {
  label: string;
  value: string;
  /** Short note: change, source or context line. */
  note?: string;
  /** Severity key, only used for the (rare) severity-tinted accent. */
  severity?: string;
  /** Optional as-of date, rendered as a small caption. */
  asOf?: string;
  /** Optional source attribution, rendered as a small caption. */
  source?: string;
}

export const FUEL_NO_PRICE_NOTE =
  "Fuel price indicators are not available for this reporting cycle.";

function matchAny(text: string, patterns: RegExp[]): boolean {
  for (const re of patterns) if (re.test(text)) return true;
  return false;
}

function haystack(i: TopicFastFactsIncident): string {
  return [i.title ?? "", i.summary ?? ""].join(" ").toLowerCase();
}

const REFINERY_RE = [
  /\b(refinery|refineries) (disruption|outage|shutdown|fire|attack|maintenance|closure|halt)/,
  /\brefinery .{0,20}(unplanned|forced|emergency)/,
];
const SHORTAGE_RE = [
  /\b(fuel|petrol|diesel|lpg|cng|kerosene|jet fuel) (shortage|stockout|rationing|queues?)/,
  /\b(fuel|petrol|diesel) .{0,20}(runs? out|ran out)/,
];
const SUBSIDY_RE = [
  /\b(subsidy|subsidies|levy|levies|duty|excise|tax) .{0,30}(fuel|petrol|diesel|gas|lpg|kerosene)/,
  /\b(fuel|petrol|diesel|gas|lpg) (subsidy|levy|duty|excise|tax) (cut|hike|raise|increase|removed|removal|reform)/,
];
const TANKER_RE = [
  /\btanker (driver|drivers|strike|shortage|attack|blockade|convoy)/,
  /\b(forecourt|pump|petrol station) (closure|shut|queue|disruption)/,
];
const CHOKEPOINT_RE = [
  /\b(strait of hormuz|hormuz|bab[- ]el[- ]mandeb|suez|malacca|singapore strait)/,
  /\bchokepoint\b/,
];

function formatValue(value: number | string, unit?: string): string {
  if (typeof value === "string") return unit ? `${value} ${unit}` : value;
  const formatted = Number.isInteger(value)
    ? value.toString()
    : value.toFixed(value >= 100 ? 1 : Math.abs(value) >= 10 ? 2 : 3);
  return unit ? `${formatted} ${unit}` : formatted;
}

function dataCardToHardNumber(c: FuelDataCard): FuelHardNumberCard {
  const out: FuelHardNumberCard = {
    label: c.label,
    value: formatValue(c.value, c.unit),
  };
  // Note line carries the change first (most useful signal), then the
  // free-form note. Source/asOf are surfaced separately as captions.
  const noteParts: string[] = [];
  if (c.change) noteParts.push(c.change);
  if (c.note) noteParts.push(c.note);
  if (noteParts.length > 0) out.note = noteParts.join(" · ");
  if (c.asOf) out.asOf = c.asOf;
  if (c.source) out.source = c.source;
  return out;
}

export interface ComputeFuelHardNumbersOpts {
  issueDate: string;
  incidents: TopicFastFactsIncident[];
  /** Raw report.hardNumbers payload (object or legacy array). */
  hardNumbersRaw?: unknown;
}

/**
 * Compute the Fuel Watch Hard Numbers cards in the required order.
 * Returns an empty array when the report carries no price, supply,
 * policy, route or jet-fuel data — the caller is expected to render
 * the FUEL_NO_PRICE_NOTE when that happens.
 */
export function computeFuelHardNumbers(
  opts: ComputeFuelHardNumbersOpts,
): FuelHardNumberCard[] {
  const window = filterTopicReportIncidents(opts.incidents, "fuel", opts.issueDate);
  const parsed = parseFuelHardNumbers(opts.hardNumbersRaw);

  const cards: FuelHardNumberCard[] = [];

  // 0. Legacy KpiCard[] payloads. Older reports stored hardNumbers as a
  //    free-form `[{label,value,...}]` array (or as `{cards:[...]}` on the
  //    v1 object). We render those verbatim at the top of Hard Numbers so
  //    pre-migration reports keep their manually-authored cards instead of
  //    silently disappearing when the v2 fields are absent.
  const hasV2Data =
    parsed.prices.length > 0 ||
    parsed.supply.length > 0 ||
    parsed.policy.length > 0 ||
    parsed.routes.length > 0 ||
    parsed.jetFuel !== undefined ||
    parsed.jetFuelTrajectory.points.length > 0;
  if (!hasV2Data && parsed.legacyCards.length > 0) {
    for (const c of parsed.legacyCards) {
      const card: FuelHardNumberCard = { label: c.label, value: c.value };
      if (c.context) card.note = c.context;
      if (c.accent) card.severity = c.accent;
      cards.push(card);
    }
  }

  // 1. Price cards (manual jsonb only — we never fabricate prices).
  for (const p of parsed.prices) cards.push(dataCardToHardNumber(p));

  // 2. Jet fuel card. Prefer the explicit snapshot; otherwise derive
  //    from the trajectory when one is supplied. The label is taken
  //    from whichever benchmark the data names — never hard-coded.
  const jfCard = buildJetFuelCard(opts.hardNumbersRaw, parsed.jetFuel);
  if (jfCard) cards.push(jfCard);

  // 3. Supply cards. Manual data wins; otherwise derive from incidents.
  if (parsed.supply.length > 0) {
    for (const s of parsed.supply) cards.push(dataCardToHardNumber(s));
  } else {
    let refinery = 0, shortage = 0, tanker = 0;
    for (const i of window) {
      const t = haystack(i);
      if (matchAny(t, REFINERY_RE)) refinery++;
      if (matchAny(t, SHORTAGE_RE)) shortage++;
      if (matchAny(t, TANKER_RE)) tanker++;
    }
    if (refinery > 0) {
      cards.push({
        label: "Refinery disruption",
        value: String(refinery),
        note: refinery === 1 ? "1 event in window" : `${refinery} events in window`,
      });
    }
    if (shortage > 0) {
      cards.push({
        label: "Shortages / rationing",
        value: String(shortage),
        note: shortage === 1 ? "1 event in window" : `${shortage} events in window`,
      });
    }
    if (tanker > 0) {
      cards.push({
        label: "Tanker / forecourt disruption",
        value: String(tanker),
        note: tanker === 1 ? "1 event in window" : `${tanker} events in window`,
      });
    }
  }

  // 4. Policy cards.
  if (parsed.policy.length > 0) {
    for (const p of parsed.policy) cards.push(dataCardToHardNumber(p));
  } else {
    let subsidy = 0;
    for (const i of window) if (matchAny(haystack(i), SUBSIDY_RE)) subsidy++;
    if (subsidy > 0) {
      cards.push({
        label: "Subsidy / levy moves",
        value: String(subsidy),
        note: subsidy === 1 ? "1 policy event" : `${subsidy} policy events`,
      });
    }
  }

  // 5. Route / chokepoint pressure cards.
  if (parsed.routes.length > 0) {
    for (const r of parsed.routes) cards.push(dataCardToHardNumber(r));
  } else {
    let chokepoint = 0;
    for (const i of window) if (matchAny(haystack(i), CHOKEPOINT_RE)) chokepoint++;
    if (chokepoint > 0) {
      cards.push({
        label: "Fuel-relevant chokepoint pressure",
        value: String(chokepoint),
        note: chokepoint === 1 ? "1 fuel-relevant flag" : `${chokepoint} fuel-relevant flags`,
      });
    }
  }

  return cards;
}

function buildJetFuelCard(
  raw: unknown,
  snapshot: ReturnType<typeof parseFuelHardNumbers>["jetFuel"],
): FuelHardNumberCard | null {
  const benchmark = jetFuelBenchmarkLabel(raw);
  // Prefer the explicit jetFuel snapshot's latestValue.
  if (snapshot?.latestValue !== undefined) {
    const value = formatValue(snapshot.latestValue, snapshot.unit);
    const note = snapshot.change || undefined;
    const out: FuelHardNumberCard = {
      label: benchmark,
      value,
    };
    if (note) out.note = note;
    if (snapshot.asOf) out.asOf = snapshot.asOf;
    if (snapshot.source) out.source = snapshot.source;
    return out;
  }
  // Otherwise derive from the trajectory series.
  const latest = latestJetFuelPoint(raw);
  if (!latest) return null;
  const value = formatValue(latest.value, latest.unit);
  const move = jetFuelMovement(raw);
  let note: string | undefined;
  if (move) {
    const arrow = move.direction === "up" ? "↑" : "↓";
    const unit = latest.unit ? ` ${latest.unit}` : "";
    note = `${arrow} ${Math.abs(move.delta).toFixed(2)}${unit} (${move.pct >= 0 ? "+" : ""}${move.pct.toFixed(1)}%) vs start`;
  }
  const out: FuelHardNumberCard = { label: benchmark, value };
  if (note) out.note = note;
  return out;
}

/**
 * True when the report carries no manually-supplied price indicators
 * (Brent/WTI/jet/pump/etc.). The caller should surface FUEL_NO_PRICE_NOTE
 * when this is true, instead of padding with incident counts.
 */
export function fuelHasNoPriceIndicators(raw: unknown): boolean {
  const parsed = parseFuelHardNumbers(raw);
  if (parsed.prices.length > 0) return false;
  if (parsed.jetFuel?.latestValue !== undefined) return false;
  if (parsed.jetFuelTrajectory.points.length >= 2) return false;
  // Legacy v1 cards may carry a manually-authored Brent/WTI/jet card.
  // Treat any legacy payload as price indicators present so the
  // "no price data" note is not surfaced on top of real cards.
  if (parsed.legacyCards.length > 0) return false;
  return true;
}
