// Canonical Fuel Watch report data.
//
// This is the ONLY place Fuel Watch assembles its report payload.
// Preview, PDF exporter and the editor debug panel all consume the
// FuelWatchReportData object returned by buildFuelWatchReportData.
//
// Design rules:
//   * Fast Facts is built from marketData ONLY — no incident-count
//     fallbacks (no "shortages-only" or "chokepoint-only" Fast Facts).
//   * Brent / WTI / jet fuel are required market indicators. The
//     validation block names exactly what is missing so the editor
//     can fail closed instead of exporting a polished but empty report.
//   * Jet fuel headline can resolve from prices[], jetFuel snapshot,
//     or the latest trajectory point (in that priority order).

import {
  parseFuelHardNumbers,
  jetFuelBenchmarkLabel as resolveBenchmark,
  type FuelDataCard,
  type JetFuelPricePoint,
} from "./jetFuelTrajectory";
import {
  filterTopicReportIncidents,
  type TopicFastFactsIncident,
} from "./topicFastFacts";
import {
  buildFuelRegionalHighlights,
  buildFuelProducerBuyerActions,
  buildFuelOperationalRead,
  buildFuelGulfChokepointWatch,
  topUpFuelBullets,
  FUEL_DEFAULT_WATCH_NEXT,
  FUEL_DEFAULT_IMPLICATIONS,
  type ProducerBuyerActionRow,
  type FuelGulfChokepointWatch,
} from "./fuelNarratives";
import { clampIssueDateToLatestRecord } from "./reportWindow";
import { format, parseISO } from "date-fns";

export type { FuelDataCard, JetFuelPricePoint, ProducerBuyerActionRow };

/** Format a bare/leading ISO date as e.g. "26 May 2026" for prose notes. */
function formatFuelNoteDate(iso: string): string {
  const m = iso.match(/^\d{4}-\d{2}-\d{2}/);
  if (!m) return iso;
  const d = parseISO(m[0]);
  if (Number.isNaN(d.getTime())) return iso;
  return format(d, "d MMM yyyy");
}

export const FUEL_MISSING_REQUIRED_NOTE =
  "Fuel Watch is missing required market data. Add Brent, WTI and jet fuel data before export.";
export const FUEL_JET_MISSING_NOTE =
  "Jet fuel data has not been loaded for this report.";

// Detection patterns for the headline crude/jet rows. Kept narrow on
// purpose so a card titled "Brent" wins over a generic "Crude oil" card.
const BRENT_RE = /brent/i;
const WTI_RE = /\bwti\b|west\s*texas/i;
const JET_RE = /\bjet\b|kerosene/i;

function cardHaystack(c: FuelDataCard): string {
  return `${c.label} ${c.note ?? ""}`;
}

function findCard(cards: FuelDataCard[], re: RegExp): FuelDataCard | null {
  for (const c of cards) if (re.test(cardHaystack(c))) return c;
  return null;
}

export interface FuelReportInput {
  id?: number;
  title?: string;
  issueDate: string;
  author?: string | null;
  executiveSummary?: string | null;
  situation?: string | null;
  whatHappened?: string | null;
  whatMatters?: string | null;
  implications?: string | null;
  polestarView?: string | null;
  watchNext?: string | null;
  hardNumbers?: unknown;
}

export interface FuelReportMeta {
  id?: number;
  title: string;
  topic: "fuel";
  issueDate: string;
  author?: string | null;
}

export interface FuelMarketData {
  prices: FuelDataCard[];
  brent: FuelDataCard | null;
  wti: FuelDataCard | null;
  /** Headline jet fuel card — resolved from prices[], jetFuel snapshot,
   *  or the latest trajectory point. Null if none of those are present. */
  jetFuel: FuelDataCard | null;
  jetFuelBenchmarkLabel: string;
  /** Trajectory series. Empty array when fewer than 2 valid points. */
  jetFuelTrajectory: JetFuelPricePoint[];
  supplyIndicators: FuelDataCard[];
  policyIndicators: FuelDataCard[];
  routeIndicators: FuelDataCard[];
  /** The ordered Fast Facts grid. Built from marketData only — never
   *  back-filled from incident counts. */
  fastFactsCards: FuelDataCard[];
  /** Auto-derived 2-paragraph Market Read prose. Null when no market
   *  data is available (caller renders nothing). */
  marketRead: string | null;
  /** Set when the jet-fuel series stops BEFORE the reporting-period end
   *  (which is anchored to the freshest market close — usually Brent/WTI).
   *  The jet figure is the REAL EIA Gulf Coast series, which publishes
   *  weekly, so its latest point normally lands a few days inside the period
   *  and this note fires to explain the in-period date gap — so the jet
   *  chart's earlier "Latest" date never reads as a contradiction. */
  jetDataNote: string | null;
}

export interface FuelIncidentData {
  fuelIncidents: TopicFastFactsIncident[];
  regionalHighlights: string | null;
  producerBuyerActions: ProducerBuyerActionRow[];
  /** Auto-derived 1-2 paragraph operational read of the incident set.
   *  Never repeats the Related Incidents table. Null when the window
   *  carries no usable fuel-relevant records. */
  operationalRead: string | null;
  /** Standing Gulf/Hormuz chokepoint view (wider lookback than the 7-day
   *  market window). Null when no chokepoint reporting falls in the lookback,
   *  so the section is omitted rather than padded. */
  gulfChokepointWatch: FuelGulfChokepointWatch | null;
}

export interface FuelNarrativeData {
  executiveSummary?: string | null;
  situation?: string | null;
  whatHappened?: string | null;
  whatMatters?: string | null;
  implications?: string | null;
  polestarView?: string | null;
  watchNext?: string | null;
}

export interface FuelValidation {
  hasPrices: boolean;
  hasBrent: boolean;
  hasWti: boolean;
  hasBrentOrWti: boolean;
  hasJetFuel: boolean;
  hasJetFuelTrajectory: boolean;
  hasSupplyOrPolicy: boolean;
  hasRelatedIncidents: boolean;
  hasRequiredFuelWatchData: boolean;
  /** Human-readable list of missing required indicators. */
  missingRequired: string[];
  errors: string[];
  warnings: string[];
}

export interface FuelWatchReportData {
  reportMeta: FuelReportMeta;
  marketData: FuelMarketData;
  incidentData: FuelIncidentData;
  narrativeData: FuelNarrativeData;
  validation: FuelValidation;
}

/**
 * The latest market-close date a Fuel Watch report carries — the max ISO
 * date across its price cards' `asOf` values, the jet-fuel snapshot `asOf`,
 * and the jet-fuel trajectory points. Fuel Watch is a MARKET product, so
 * this date is its reporting-period end: the cover, period label, Fast
 * Facts "as of" dates and the jet chart's latest point all resolve to it,
 * which is why they can never disagree. Returns null when the report
 * carries no dated market data yet (e.g. a brand-new draft before ingest).
 */
export function fuelMarketLatestDate(hardNumbers: unknown): string | null {
  const parsed = parseFuelHardNumbers(hardNumbers);
  let max: string | null = null;
  const consider = (raw: string | undefined | null) => {
    if (!raw) return;
    const m = raw.match(/^\d{4}-\d{2}-\d{2}/);
    if (!m) return;
    if (max === null || m[0] > max) max = m[0];
  };
  for (const c of parsed.prices) consider(c.asOf);
  consider(parsed.jetFuel?.asOf);
  for (const p of parsed.jetFuelTrajectory.points) consider(p.date);
  return max;
}

/**
 * The Fuel Watch reporting-period END date. Fuel Watch is anchored to the
 * MARKET close, not to the latest incident: the period ends on the newest
 * market-close date the report carries (`fuelMarketLatestDate`). Incident
 * records — which may stop earlier — are reported separately in the
 * data-status strip, never as the overall reporting period. Falls back to
 * the incident-clamped issue date only when the report has no dated market
 * data yet (a fresh draft before the FRED ingest has run).
 */
export function resolveFuelPeriodEnd(
  renderIssueDate: string,
  hardNumbers: unknown,
  incidents: { occurredAt: string; topic?: string }[],
): string {
  const market = fuelMarketLatestDate(hardNumbers);
  if (market) return market;
  return clampIssueDateToLatestRecord(renderIssueDate, incidents, "fuel");
}

/**
 * The one place Fuel Watch data is assembled. Preview, PDF and the
 * editor debug panel must all call this — no renderer is allowed to
 * parse hardNumbers or derive jet fuel on its own.
 */
export function buildFuelWatchReportData(
  report: FuelReportInput,
  incidents: TopicFastFactsIncident[],
): FuelWatchReportData {
  const parsed = parseFuelHardNumbers(report.hardNumbers);
  const prices = parsed.prices;
  const brent = findCard(prices, BRENT_RE);
  const wti = findCard(prices, WTI_RE);

  // Jet fuel headline card resolution, in priority order:
  //   1. an explicit price card whose label/benchmark mentions jet
  //   2. the jetFuel snapshot's latestValue
  //   3. the latest trajectory point
  // The card label is always the bare "Jet fuel" string so the Fast
  // Facts grid reads "JET FUEL" uppercased; the benchmark moves into
  // the `note` subline ("U.S. Gulf Coast kerosene-type jet fuel").
  let jetFuel: FuelDataCard | null = findCard(prices, JET_RE);
  if (jetFuel) jetFuel = normaliseJetCard(jetFuel);
  if (!jetFuel && parsed.jetFuel?.latestValue !== undefined) {
    const s = parsed.jetFuel;
    const latest = s.latestValue as number;
    const built: FuelDataCard = { label: "Jet fuel", value: latest };
    if (s.unit) built.unit = s.unit;
    if (s.change) built.change = s.change;
    if (s.asOf) built.asOf = s.asOf;
    if (s.source) built.source = s.source;
    const note = stripBenchmarkSuffix(s.benchmark);
    if (note) built.note = note;
    jetFuel = built;
  }
  if (!jetFuel && parsed.jetFuelTrajectory.points.length >= 1) {
    const last = parsed.jetFuelTrajectory.points[parsed.jetFuelTrajectory.points.length - 1];
    const built: FuelDataCard = {
      label: "Jet fuel",
      value: last.value,
      asOf: last.date,
    };
    const unit = last.unit ?? parsed.jetFuelTrajectory.unit;
    if (unit) built.unit = unit;
    if (parsed.jetFuelTrajectory.source) built.source = parsed.jetFuelTrajectory.source;
    const note = stripBenchmarkSuffix(parsed.jetFuelTrajectory.benchmark);
    if (note) built.note = note;
    jetFuel = built;
  }

  // The trajectory chart minimum-data contract is unchanged: at least
  // two dated points. Fewer than that and the series is empty.
  // Project the container's unit onto each point that is missing one
  // so the chart's "Latest …" label always shows the unit (e.g.
  // "Latest 15 May: 4.15 USD/gal") rather than dropping it.
  const containerUnit = parsed.jetFuelTrajectory.unit;
  const trajectoryPoints =
    parsed.jetFuelTrajectory.points.length >= 2
      ? parsed.jetFuelTrajectory.points.map((p) =>
          p.unit || !containerUnit ? p : { ...p, unit: containerUnit },
        )
      : [];
  const jetFuelBenchmarkLabel = resolveBenchmark(report.hardNumbers);

  // Fast Facts order: Brent, WTI, jet fuel, any other price cards
  // (e.g. pump, diesel), then supply / policy / routes. Never any
  // incident-derived fallbacks.
  const fastFactsCards: FuelDataCard[] = [];
  if (brent) fastFactsCards.push(brent);
  if (wti) fastFactsCards.push(wti);
  if (jetFuel) fastFactsCards.push(jetFuel);
  for (const p of prices) {
    if (p === brent || p === wti || p === jetFuel) continue;
    // Skip a duplicate jet card if jetFuel was derived from prices[] above.
    if (jetFuel && p === jetFuel) continue;
    if (JET_RE.test(cardHaystack(p))) continue;
    fastFactsCards.push(p);
  }
  for (const c of parsed.supply) fastFactsCards.push(c);
  for (const c of parsed.policy) fastFactsCards.push(c);
  for (const c of parsed.routes) fastFactsCards.push(c);

  // Related-incident filtering uses the topic window + topic-relevance
  // filter so a hiking story that happens to say "fuel" is dropped.
  const fuelIncidents = filterTopicReportIncidents(incidents, "fuel", report.issueDate);
  const regionalHighlights = buildFuelRegionalHighlights({
    issueDate: report.issueDate,
    incidents,
  });
  const producerBuyerActions = buildFuelProducerBuyerActions({
    issueDate: report.issueDate,
    incidents,
  });
  const operationalRead = buildFuelOperationalRead({
    issueDate: report.issueDate,
    incidents,
  });
  // Gulf/Hormuz chokepoint watch is anchored on the report ISSUE DATE (the same
  // window as the rest of the report), splitting current-period activity from
  // older standing context. fuelMarketLatestDate is passed only to extend the
  // current end when the market close lands a day or two after the issue date.
  const gulfChokepointWatch = buildFuelGulfChokepointWatch({
    issueDate: report.issueDate,
    periodEnd: fuelMarketLatestDate(report.hardNumbers) ?? undefined,
    incidents,
  });

  // Validation. The fail-closed export gate is keyed on market data
  // only: Brent, WTI and jet fuel are the required indicators. Other
  // signals (supply/policy/routes/related incidents) are reported as
  // completeness warnings, not as export blockers — a missing incident
  // window is normal and must not stop publication of valid market data.
  const hasPrices = prices.length > 0;
  const hasBrent = brent !== null;
  const hasWti = wti !== null;
  const hasBrentOrWti = hasBrent || hasWti;
  const hasJetFuel = jetFuel !== null;
  const hasJetFuelTrajectory = trajectoryPoints.length >= 2;
  const hasSupplyOrPolicy =
    parsed.supply.length > 0 || parsed.policy.length > 0 || parsed.routes.length > 0;
  const hasRelatedIncidents = fuelIncidents.length > 0;

  const missingRequired: string[] = [];
  if (!hasBrent) missingRequired.push("Brent crude price");
  if (!hasWti) missingRequired.push("WTI crude price");
  if (!hasJetFuel) missingRequired.push("Jet fuel indicator");
  const hasRequiredFuelWatchData = missingRequired.length === 0;

  const errors: string[] = [];
  const warnings: string[] = [];
  if (!hasJetFuel) errors.push(FUEL_JET_MISSING_NOTE);
  if (hasJetFuel && !hasJetFuelTrajectory) {
    warnings.push("Jet fuel trajectory needs at least two dated points to render the chart.");
  }
  // Only flag missing supply/policy/route indicators when the incident
  // layer is ALSO empty. When related fuel incidents are present the
  // narrative (Market Read / operational read) already covers supply,
  // policy and route pressure, so a bare "none supplied" note read as a
  // contradiction of the body. Reworded to point at the Fast Facts grid
  // and incident layer specifically rather than asserting an absence.
  if (!hasSupplyOrPolicy && !hasRelatedIncidents) {
    warnings.push(
      "No supply, policy or route indicators in the Fast Facts grid or the incident layer right now.",
    );
  }
  if (!hasRelatedIncidents) {
    warnings.push("No related fuel incidents were reported recently.");
  }

  // Jet-fuel lag note. The reporting period ends on the freshest market
  // close the report carries (fuelMarketLatestDate — usually Brent/WTI from
  // the daily futures feed). The jet figure is the REAL EIA Gulf Coast
  // jet-fuel series, which publishes weekly, so its latest point usually
  // lands a few days inside the period. When it does, surface an in-period
  // note so the jet chart's earlier "Latest" date is explained, not
  // perceived as a mismatch.
  const periodEnd = fuelMarketLatestDate(report.hardNumbers);
  const jetDates: string[] = [];
  const pushJet = (raw: string | undefined | null) => {
    if (!raw) return;
    const m = raw.match(/^\d{4}-\d{2}-\d{2}/);
    if (m) jetDates.push(m[0]);
  };
  pushJet(jetFuel?.asOf);
  for (const p of trajectoryPoints) pushJet(p.date);
  const jetLatest = jetDates.length
    ? jetDates.reduce((a, b) => (b > a ? b : a))
    : null;
  let jetDataNote: string | null = null;
  if (periodEnd && jetLatest && jetLatest < periodEnd) {
    jetDataNote =
      `Jet fuel latest available ${formatFuelNoteDate(jetLatest)} ` +
      `(weekly EIA U.S. Gulf Coast series); ` +
      `Brent and WTI run to ${formatFuelNoteDate(periodEnd)} (the period end).`;
  }

  return {
    reportMeta: {
      ...(report.id !== undefined ? { id: report.id } : {}),
      title: report.title ?? "",
      topic: "fuel",
      issueDate: report.issueDate,
      ...(report.author !== undefined ? { author: report.author } : {}),
    },
    marketData: {
      prices,
      brent,
      wti,
      jetFuel,
      jetFuelBenchmarkLabel,
      jetFuelTrajectory: trajectoryPoints,
      supplyIndicators: parsed.supply,
      policyIndicators: parsed.policy,
      routeIndicators: parsed.routes,
      fastFactsCards,
      marketRead: buildFuelMarketRead({
        brent,
        wti,
        jetFuel,
        trajectory: trajectoryPoints,
      }),
      jetDataNote,
    },
    incidentData: {
      fuelIncidents,
      regionalHighlights,
      producerBuyerActions,
      operationalRead,
      gulfChokepointWatch,
    },
    narrativeData: {
      executiveSummary: report.executiveSummary,
      situation: report.situation,
      whatHappened: report.whatHappened,
      whatMatters: report.whatMatters,
      // Top up the bullet sections to a useful minimum so a thinly saved
      // report does not render a one-line Watch Next / two-line Implications.
      // Stored content always leads; defaults only fill the gap.
      implications: topUpFuelBullets(report.implications, FUEL_DEFAULT_IMPLICATIONS, 4, 6),
      polestarView: report.polestarView,
      watchNext: topUpFuelBullets(report.watchNext, FUEL_DEFAULT_WATCH_NEXT, 5, 5),
    },
    validation: {
      hasPrices,
      hasBrent,
      hasWti,
      hasBrentOrWti,
      hasJetFuel,
      hasJetFuelTrajectory,
      hasSupplyOrPolicy,
      hasRelatedIncidents,
      hasRequiredFuelWatchData,
      missingRequired,
      errors,
      warnings,
    },
  };
}

/**
 * Build the 2-paragraph "Market Read" prose from the parsed market
 * data. Lives here (next to the rest of the canonical builder) so
 * preview and PDF can never drift.
 *
 * Para 1: where Brent / WTI sit and what the jet trajectory shows.
 * Para 2: what the combined picture means for fuel-linked costs.
 */
function levelWord(v: number): string {
  if (v >= 100) return "elevated";
  if (v >= 80) return "firm";
  if (v >= 60) return "steady";
  return "softer";
}
function numVal(c: FuelDataCard | null): number | null {
  if (!c) return null;
  return typeof c.value === "number" ? c.value : Number(c.value);
}
export function buildFuelMarketRead(opts: {
  brent: FuelDataCard | null;
  wti: FuelDataCard | null;
  jetFuel: FuelDataCard | null;
  trajectory: JetFuelPricePoint[];
}): string | null {
  const { brent, wti, jetFuel, trajectory } = opts;
  if (!brent && !wti && !jetFuel) return null;
  const b = numVal(brent);
  const w = numVal(wti);
  const parts: string[] = [];
  if (b !== null && !Number.isNaN(b) && w !== null && !Number.isNaN(w)) {
    parts.push(
      `Brent is sitting around ${b.toFixed(2)} ${brent?.unit ?? "USD/bbl"} and WTI around ${w.toFixed(2)} ${wti?.unit ?? "USD/bbl"}, which puts the crude complex in ${levelWord((b + w) / 2)} territory rather than a transient spike.`,
    );
  } else if (b !== null && !Number.isNaN(b)) {
    parts.push(`Brent is sitting around ${b.toFixed(2)} ${brent?.unit ?? "USD/bbl"}, placing crude in ${levelWord(b)} territory.`);
  } else if (w !== null && !Number.isNaN(w)) {
    parts.push(`WTI is sitting around ${w.toFixed(2)} ${wti?.unit ?? "USD/bbl"}, placing crude in ${levelWord(w)} territory.`);
  }

  if (jetFuel && trajectory.length >= 2) {
    const first = trajectory[0].value;
    const last = trajectory[trajectory.length - 1].value;
    const pct = first !== 0 ? ((last - first) / first) * 100 : 0;
    let dir: string;
    if (pct >= 3) dir = "rising over the period";
    else if (pct <= -3) dir = "easing over the period";
    else dir = "holding above the start of the period";
    const jetUnit = jetFuel.unit ?? trajectory[trajectory.length - 1].unit ?? "USD/gal";
    parts.push(
      `The jet fuel series is ${dir}, with the latest figure at ${last.toFixed(3)} ${jetUnit} versus ${first.toFixed(3)} at the start (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%).`,
    );
  } else if (jetFuel) {
    const jv = numVal(jetFuel);
    if (jv !== null && !Number.isNaN(jv)) {
      parts.push(`Jet fuel is running at ${jv.toFixed(3)} ${jetFuel.unit ?? "USD/gal"}, anchoring the aviation-linked cost line.`);
    }
  }

  const para1 = parts.join(" ");
  const para2 =
    "Taken together, this points to sustained cost pressure rather than a one-off move. Fuel-linked costs rarely stay isolated; they feed into freight rates, generator running costs, staff movement and supplier pricing — so treat these market indicators as the cost floor for the decisions that follow.";
  return para1 ? `${para1}\n\n${para2}` : para2;
}

/**
 * Render-time formatting helper used by both preview and PDF so a
 * FuelDataCard renders identically in both. Numbers pick decimals
 * based on magnitude; pre-formatted strings pass through.
 */
/** Trim a redundant trailing " jet fuel" off a benchmark string so it
 *  reads cleanly as a subline (e.g. "US Gulf Coast kerosene-type jet
 *  fuel" → "US Gulf Coast kerosene-type"). */
function stripBenchmarkSuffix(b: string | undefined | null): string {
  if (!b) return "";
  return b.replace(/\s*jet\s*fuel\s*$/i, "").trim();
}

/** Apply the same label/note normalisation to a price-list card that
 *  already mentions jet fuel, so explicit cards stay consistent with
 *  the snapshot- and trajectory-derived branches. */
function normaliseJetCard(c: FuelDataCard): FuelDataCard {
  const out: FuelDataCard = { ...c, label: "Jet fuel" };
  if (!out.note) {
    // Prefer an explicit benchmark stripped of "jet fuel"; fall back to
    // anything that came after "Jet fuel — " in the original label.
    const fromBenchmark = stripBenchmarkSuffix(
      (c as FuelDataCard & { benchmark?: string }).benchmark,
    );
    if (fromBenchmark) {
      out.note = fromBenchmark;
    } else {
      const m = c.label.match(/^jet fuel\s*[—–-]\s*(.+)$/i);
      if (m) out.note = stripBenchmarkSuffix(m[1]);
    }
  }
  return out;
}

/** Format an ISO-style date ("YYYY-MM-DD") as "15 May 2026". Returns
 *  the input unchanged when it isn't a recognisable ISO date. */
export function formatAsOfDate(raw: string): string {
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return raw;
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return raw;
  return `${d} ${months[mo - 1]} ${y}`;
}

export function formatFuelCardValue(value: number | string, unit?: string): string {
  if (typeof value === "string") return unit ? `${value} ${unit}` : value;
  const formatted = Number.isInteger(value)
    ? value.toString()
    : value.toFixed(value >= 100 ? 1 : Math.abs(value) >= 10 ? 2 : 3);
  return unit ? `${formatted} ${unit}` : formatted;
}

/** Build the renderer-friendly card shape (label/value/note/asOf/source). */
export interface RenderableFuelCard {
  label: string;
  value: string;
  note?: string;
  asOf?: string;
  source?: string;
}
export function toRenderableCard(c: FuelDataCard): RenderableFuelCard {
  const out: RenderableFuelCard = { label: c.label, value: formatFuelCardValue(c.value, c.unit) };
  // Card layout (top to bottom): label, value, change line, benchmark
  // + source line, "As of <date>" line. Keeping the benchmark with the
  // source on its own line gives the jet card room to breathe rather
  // than collapsing "+2.5% 7d · US Gulf Coast kerosene-type" into a
  // single cramped subline above the asOf/source caption.
  if (c.change) out.note = c.change;
  const tail: string[] = [];
  if (c.note) tail.push(c.note);
  if (c.source) tail.push(c.source);
  if (tail.length) out.source = tail.join(" · ");
  if (c.asOf) out.asOf = formatAsOfDate(c.asOf);
  return out;
}

/** Canonical sample payload, surfaced by the editor's "Load sample" button. */
export const FUEL_MARKET_DATA_SAMPLE = {
  fastFacts: {
    prices: [
      { label: "Brent crude", value: 109.26, unit: "USD/bbl", change: "+7.9% 7d", asOf: "2026-05-15", source: "Manual" },
      { label: "WTI crude", value: 101.02, unit: "USD/bbl", change: "+10.5% 7d", asOf: "2026-05-15", source: "Manual" },
      { label: "Jet fuel", benchmark: "U.S. Gulf Coast kerosene-type jet fuel", value: 2.41, unit: "USD/gal", change: "+2.5% 7d", asOf: "2026-05-15", source: "EIA / FRED (DJFUELUSGULF)" },
    ],
    supply: [
      { label: "Fuel shortages / rationing", value: 5, unit: "events", note: "this week" },
    ],
    policy: [
      { label: "Subsidy / levy moves", value: 1, unit: "policy event", note: "this week" },
    ],
    routes: [
      { label: "Fuel-relevant chokepoint pressure", value: 15, unit: "records", note: "Hormuz / route disruption" },
    ],
  },
  jetFuelTrajectory: {
    benchmark: "U.S. Gulf Coast kerosene-type jet fuel",
    source: "EIA / FRED (DJFUELUSGULF)",
    unit: "USD/gal",
    period: "recent weeks",
    points: [
      { date: "2026-04-17", value: 2.18 },
      { date: "2026-04-24", value: 2.27 },
      { date: "2026-05-01", value: 2.39 },
      { date: "2026-05-08", value: 2.34 },
      { date: "2026-05-15", value: 2.41 },
    ],
  },
} as const;

/**
 * Validate a raw hardNumbers JSON string from the editor's advanced
 * view. Returns parsed value or human-readable error messages.
 */
export function validateFuelHardNumbersJson(
  text: string,
): { ok: true; value: unknown } | { ok: false; errors: string[] } {
  const trimmed = text.trim();
  if (!trimmed) return { ok: true, value: null };
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch (e) {
    return { ok: false, errors: [`Invalid JSON: ${(e as Error).message}`] };
  }
  if (value !== null && typeof value !== "object") {
    return { ok: false, errors: ["Top-level value must be an object, array, or null."] };
  }
  const parsed = parseFuelHardNumbers(value);
  const hasAny =
    parsed.prices.length > 0 ||
    parsed.supply.length > 0 ||
    parsed.policy.length > 0 ||
    parsed.routes.length > 0 ||
    parsed.legacyCards.length > 0 ||
    parsed.jetFuel !== undefined ||
    parsed.jetFuelTrajectory.points.length > 0;
  if (!hasAny) {
    return {
      ok: false,
      errors: [
        "Payload parses as JSON but carries no recognised fields. Expected one of: fastFacts, prices, supply, policy, routes, jetFuel, jetFuelTrajectory, cards.",
      ],
    };
  }
  return { ok: true, value };
}

// ----------------------------------------------------------------------
// Editor form helpers — round-trip between the canonical hardNumbers
// jsonb shape and a flat form-state used by the Fuel Market Data panel.
// ----------------------------------------------------------------------

export interface FuelMarketCardForm {
  value: string;
  unit: string;
  change: string;
  asOf: string;
  source: string;
}

export interface FuelMarketJetForm extends FuelMarketCardForm {
  benchmark: string;
}

export interface FuelMarketFormState {
  brent: FuelMarketCardForm;
  wti: FuelMarketCardForm;
  jet: FuelMarketJetForm;
  /** One trajectory point per line, formatted "YYYY-MM-DD, value". */
  trajectoryText: string;
}

export const EMPTY_FUEL_MARKET_FORM: FuelMarketFormState = {
  brent: { value: "", unit: "USD/bbl", change: "", asOf: "", source: "" },
  wti: { value: "", unit: "USD/bbl", change: "", asOf: "", source: "" },
  jet: { benchmark: "", value: "", unit: "USD/gal", change: "", asOf: "", source: "" },
  trajectoryText: "",
};

function cardFormFrom(c: FuelDataCard | null, fallbackUnit: string): FuelMarketCardForm {
  if (!c) return { value: "", unit: fallbackUnit, change: "", asOf: "", source: "" };
  return {
    value: typeof c.value === "number" ? String(c.value) : c.value,
    unit: c.unit ?? fallbackUnit,
    change: c.change ?? "",
    asOf: c.asOf ?? "",
    source: c.source ?? "",
  };
}

/** Seed the form from a parsed FuelWatchReportData. */
export function fuelMarketFormFromData(data: FuelWatchReportData): FuelMarketFormState {
  const { brent, wti, jetFuel, jetFuelBenchmarkLabel, jetFuelTrajectory } = data.marketData;
  const jet = jetFuel
    ? {
        benchmark:
          // Prefer the trajectory/snapshot benchmark over a label-baked one.
          jetFuelBenchmarkLabel && jetFuelBenchmarkLabel !== "Jet fuel benchmark"
            ? jetFuelBenchmarkLabel
            : (jetFuel.label.replace(/^Jet fuel\s+—\s+/, "") !== jetFuel.label
                ? jetFuel.label.replace(/^Jet fuel\s+—\s+/, "")
                : ""),
        value: typeof jetFuel.value === "number" ? String(jetFuel.value) : jetFuel.value,
        unit: jetFuel.unit ?? "USD/gal",
        change: jetFuel.change ?? "",
        asOf: jetFuel.asOf ?? "",
        source: jetFuel.source ?? "",
      }
    : { ...EMPTY_FUEL_MARKET_FORM.jet };
  const trajectoryText = jetFuelTrajectory
    .map((p) => `${p.date}, ${p.value}`)
    .join("\n");
  return {
    brent: cardFormFrom(brent, "USD/bbl"),
    wti: cardFormFrom(wti, "USD/bbl"),
    jet,
    trajectoryText,
  };
}

function buildCardPayload(
  label: string,
  form: FuelMarketCardForm,
): Record<string, unknown> | null {
  const valTrim = form.value.trim();
  if (!valTrim) return null;
  const num = Number(valTrim);
  const out: Record<string, unknown> = {
    label,
    value: Number.isFinite(num) ? num : valTrim,
  };
  if (form.unit.trim()) out.unit = form.unit.trim();
  if (form.change.trim()) out.change = form.change.trim();
  if (form.asOf.trim()) out.asOf = form.asOf.trim();
  if (form.source.trim()) out.source = form.source.trim();
  return out;
}

export interface ParseTrajectoryResult {
  points: { date: string; value: number }[];
  errors: string[];
}

/** Parse the trajectory textarea into ordered points + line-level errors. */
export function parseTrajectoryText(text: string): ParseTrajectoryResult {
  const points: { date: string; value: number }[] = [];
  const errors: string[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    // Accept "YYYY-MM-DD, value" or "YYYY-MM-DD value" or tab-separated.
    const parts = line.split(/[,\s\t]+/).filter(Boolean);
    if (parts.length < 2) {
      errors.push(`Line ${i + 1}: expected "YYYY-MM-DD, value".`);
      return;
    }
    const [date, valueStr] = parts;
    const d = new Date(date);
    if (isNaN(d.getTime()) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      errors.push(`Line ${i + 1}: invalid date "${date}".`);
      return;
    }
    const value = Number(valueStr);
    if (!Number.isFinite(value)) {
      errors.push(`Line ${i + 1}: invalid number "${valueStr}".`);
      return;
    }
    points.push({ date, value });
  });
  points.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  return { points, errors };
}

export interface BuildHardNumbersResult {
  /** The hardNumbers payload to persist. `null` when nothing was entered. */
  payload: Record<string, unknown> | null;
  errors: string[];
}

/**
 * Assemble the form state into the canonical hardNumbers jsonb shape.
 * Returns null payload if every field is empty (i.e. user wants to
 * clear the payload). Surfaces trajectory line errors verbatim.
 */
export function buildHardNumbersFromForm(form: FuelMarketFormState): BuildHardNumbersResult {
  const errors: string[] = [];
  const prices: Record<string, unknown>[] = [];
  const brent = buildCardPayload("Brent crude", form.brent);
  if (brent) prices.push(brent);
  const wti = buildCardPayload("WTI crude", form.wti);
  if (wti) prices.push(wti);
  // Jet fuel is stored as a price card with an optional benchmark
  // so the parser picks it up via the jet regex and the renderer
  // shows the benchmark name alongside the label.
  if (form.jet.value.trim()) {
    const valTrim = form.jet.value.trim();
    const num = Number(valTrim);
    const jetCard: Record<string, unknown> = {
      label: "Jet fuel",
      value: Number.isFinite(num) ? num : valTrim,
    };
    if (form.jet.benchmark.trim()) jetCard.benchmark = form.jet.benchmark.trim();
    if (form.jet.unit.trim()) jetCard.unit = form.jet.unit.trim();
    if (form.jet.change.trim()) jetCard.change = form.jet.change.trim();
    if (form.jet.asOf.trim()) jetCard.asOf = form.jet.asOf.trim();
    if (form.jet.source.trim()) jetCard.source = form.jet.source.trim();
    prices.push(jetCard);
  }

  const traj = parseTrajectoryText(form.trajectoryText);
  errors.push(...traj.errors);

  const payload: Record<string, unknown> = {};
  if (prices.length > 0) payload.fastFacts = { prices };
  if (traj.points.length > 0) {
    const container: Record<string, unknown> = { points: traj.points };
    if (form.jet.benchmark.trim()) container.benchmark = form.jet.benchmark.trim();
    if (form.jet.unit.trim()) container.unit = form.jet.unit.trim();
    if (form.jet.source.trim()) container.source = form.jet.source.trim();
    payload.jetFuelTrajectory = container;
  }
  if (Object.keys(payload).length === 0) {
    return { payload: null, errors };
  }
  return { payload, errors };
}
