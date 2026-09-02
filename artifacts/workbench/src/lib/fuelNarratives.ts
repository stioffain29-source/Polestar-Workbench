// Fuel Watch auto-derived narrative blocks.
//
// Regional Highlights, Producer/Buyer Actions and the Operational Read
// are derived from the in-window incident set. Outputs read like
// analyst prose — never raw headline dumps and never weak "Unknown"
// rows. Helpers return null / empty so the caller can omit a section
// instead of padding it.

import { filterTopicReportIncidents, type TopicFastFactsIncident } from "./topicFastFacts";
import { reportWindowDefaultDays } from "./reportWindow";
import { stripWireCruft } from "./incidentTitle";
import {
  aggregateIncidentSignificance,
  compareIncidentSignificance,
  incidentSeverityRank,
} from "@workspace/country-engine";
import { deriveIncidentCountry, deriveFlagState } from "./shippingCountry";
import { joinWithAnd } from "./proseLists";
import { matchesTopicIncident } from "./topicIncidentMatching";
import type {
  CanonicalFuelIncident,
  FuelCanonicalFacts,
  FuelCanonicalSections,
  FuelDirection,
} from "./fuelCanonicalFacts";

function titleCase(s: string): string {
  // Preserve canonical initialisms returned by the shared incident-location
  // resolver. Rendering "UAE" as "Uae" makes a correct location label look
  // like an unreviewed raw-source value.
  if (["UAE", "UK", "US"].includes(s)) return s;
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

function haystack(i: TopicFastFactsIncident): string {
  return [i.title ?? "", i.summary ?? ""].join(" ").toLowerCase();
}

// An incident whose own text says the situation is over — extinguished,
// contained, restored, resumed, reopened, lifted — is reported ONLY as
// historical colour, never as live pressure. Counting a resolved event at
// full weight let a country top the "clearest pressure point" ranking on
// the strength of an incident that was no longer actually happening (e.g. a
// refinery fire logged as "contained" the same week it started), while a
// standing chokepoint disruption elsewhere in the window carried more real
// severity. Down-weighting resolved records (not dropping them outright —
// they still count as reporting volume, just not as unresolved pressure)
// keeps the ranking honest to current state rather than raw headline count.
// Weighted pressure score for one country's incident set: sum of each
// incident's severity rank, discounted when the incident's own text marks
// it as resolved. Replaces a raw incident-count ranking, which let a country
// with many low-severity or already-resolved records outrank a country (or
// the standing Gulf/Hormuz chokepoint watch) carrying fewer but materially
// more severe, still-live incidents.
/** The single incident-country rule used in Fuel Watch. */
function incidentCountry(i: TopicFastFactsIncident): string | null {
  return deriveIncidentCountry(i);
}

// Operational issue families, in priority order. Each family carries:
//   phrase: short label for the signal
//   why:    one-line business reason it matters
//   watch:  one-line "what should business users watch for"
//   key:    stable identifier used by the Operational Read aggregation
interface IssueFamily {
  key:
    | "chokepoint"
    | "refinery"
    | "shortage"
    | "tanker"
    | "policy"
    | "pricing"
    | "crude";
  test: RegExp[];
  phrase: string;
  /** Used in Regional Highlights — the per-country "why it matters" line. */
  why: string;
  /** Used in Operational Read — a different angle on the same family
   *  so the two sections never repeat the same sentence verbatim. */
  opMeaning: string;
  watch: string;
}
const ISSUE_FAMILIES: IssueFamily[] = [
  {
    key: "chokepoint",
    test: [/\b(strait of hormuz|hormuz)\b/, /\bbab[- ]el[- ]mandeb\b/, /\bred sea\b/, /\bmalacca\b/, /\bsuez\b/],
    phrase: "chokepoint pressure and tanker-route disruption",
    why: "Route pressure on Hormuz, Bab-el-Mandeb or the Red Sea feeds straight into bunker cost, transit time and war-risk premium.",
    opMeaning: "Dependent fuel movement is forced onto longer, costlier routes even when the underlying barrels are still available.",
    watch: "Watch for fresh advisories, vessel reroutes and any naval movement that signals escalation.",
  },
  {
    key: "refinery",
    test: [/\b(refinery|refineries) (outage|disruption|fire|attack|halt|maintenance|shutdown|closure)/],
    phrase: "refinery disruption and supply-side outage",
    why: "Refinery outage typically tightens regional crack spreads and pushes downstream pump and bunker prices up within days.",
    opMeaning: "Where output is actually curtailed, affected grades typically go on allocation first — commercial buyers tend to feel it before the published pump price moves.",
    watch: "Watch for restart timelines, force-majeure declarations and follow-on import announcements.",
  },
  {
    key: "shortage",
    test: [/\b(fuel|petrol|diesel|lpg|kerosene|jet fuel) (shortage|stockout|rationing|queue|queues)/, /\bforecourt (closure|shut|queue|disruption)/],
    phrase: "shortages, rationing and forecourt disruption",
    why: "Forecourt shortages put road transport, staff movement and generator runtime under immediate continuity pressure.",
    opMeaning: "When forecourts dry up the constraint stops being price and becomes physical access; informal markets and queueing rules take over.",
    watch: "Watch for rationing rules, allocation cuts to commercial users and convoy or queue management announcements.",
  },
  {
    key: "tanker",
    test: [/\btanker (driver|drivers|strike|shortage|attack|blockade|convoy)/, /\b(fuel|tanker) (convoy|hijack|seizure)/],
    phrase: "tanker and fuel-transport disruption",
    why: "Tanker driver action or convoy disruption usually shows up as delivery delays at depots and forecourts inside a few days.",
    opMeaning: "Inland distribution lags refinery output; depots draw down even when wholesale supply looks fine on paper.",
    watch: "Watch for negotiation outcomes, military or police escort decisions and downstream depot-stock levels.",
  },
  {
    key: "policy",
    test: [
      /\b(subsidy|subsidies|levy|levies|duty|excise|tax) .{0,30}(fuel|petrol|diesel|gas|lpg|kerosene)/,
      /\b(price control|price cap|price freeze|export ban|import ban)/,
    ],
    phrase: "policy and subsidy / levy moves",
    why: "Policy moves on subsidies, levies or price controls reset operating cost assumptions and contract pass-through clauses.",
    opMeaning: "Surcharge clauses and indexation formulas reset on the gazette date; today's contract economics may not hold for long.",
    watch: "Watch for gazette dates, ministerial statements and any contract-renegotiation triggers from suppliers.",
  },
  {
    key: "pricing",
    test: [/\b(pump price|petrol price|diesel price|fuel price) (hike|rise|increase|cut|drop|fall|change)/, /\bfuel surcharge\b/],
    phrase: "pump and surcharge pricing pressure",
    why: "Pump and surcharge moves flow through fleet cost, freight rates and supplier invoices within the next billing cycle.",
    opMeaning: "Visible at the pump now, visible in freight invoices next — the gap between the two is the negotiation window.",
    watch: "Watch for surcharge revisions on freight contracts and any government push-back against price rises.",
  },
  {
    key: "crude",
    test: [/\b(oil|crude) (export ban|export halt|embargo|sanctions|sabotage|attack|spill)/],
    phrase: "crude supply-chain and sanctions pressure",
    why: "Crude-side disruption rolls into bunker, jet and downstream pricing on a 1-2 week lag and is hard to hedge away cleanly.",
    opMeaning: "The cost shock arrives with a lag, which makes it easy to under-budget for the months that absorb it.",
    watch: "Watch for OPEC+ commentary, sanctions enforcement signals and any retaliation in shipping lanes.",
  },
];

function familyFor(items: TopicFastFactsIncident[]): IssueFamily | null {
  for (const fam of ISSUE_FAMILIES) {
    for (const i of items) {
      const t = haystack(i);
      if (fam.test.some((re) => re.test(t))) return fam;
    }
  }
  return null;
}

/**
 * Country-level Fuel Watch highlights as proper analyst paragraphs.
 * Each country answers three questions: what is the signal, why does
 * it matter, what should the reader watch. Records without a usable
 * country attribution are dropped and "Unknown" is never emitted.
 * Returns null when there is nothing usable to say.
 */
export function buildFuelRegionalHighlights(opts: {
  issueDate: string;
  incidents: TopicFastFactsIncident[];
  /** When supplied, used directly instead of re-filtering the incident feed. */
  window?: TopicFastFactsIncident[];
  /** Canonical pressure decision from the report facts. When distributed,
   *  no country may be crowned "the clearest pressure point" — the lead
   *  paragraph uses spread phrasing instead (single-source-of-truth rule). */
  pressure?: { distributed: boolean; primaryCountry: string | null };
}): string | null {
  const window = opts.window ?? filterTopicReportIncidents(opts.incidents, "fuel", opts.issueDate);
  if (window.length === 0) return null;

  const byCountry = new Map<string, TopicFastFactsIncident[]>();
  for (const i of window) {
    const key = incidentCountry(i);
    if (!key) continue;
    const arr = byCountry.get(key) ?? [];
    arr.push(i);
    byCountry.set(key, arr);
  }
  if (byCountry.size === 0) return null;

  // Rank by shared real-world significance rather than raw record volume.
  const ranked = Array.from(byCountry.entries()).sort(
    (a, b) =>
      aggregateIncidentSignificance(b[1]) -
      aggregateIncidentSignificance(a[1]),
  );
  const lead = ranked.slice(0, 3);

  // Country-specific overlays so secondary countries never reuse the
  // chokepoint / Hormuz / war-risk sentence that belongs with Iran.
  // Iran retains the chokepoint family; India and Pakistan get
  // distinct framings emphasising pump-price/forecourt and
  // availability/power-resilience respectively. The overlay applies
  // to the `why` line only; `phrase` and `watch` still come from the
  // matched family so the records-clause stays honest to the data.
  interface CountryOverlay { why: string; watch?: string }
  const COUNTRY_OVERLAY: Record<string, CountryOverlay> = {
    iran: {
      why: "War-risk premium and voyage delay on dependent crude and product routes persist even when barrels are still moving.",
      watch: "Watch for fresh advisories, vessel reroutes and any naval movement that signals escalation.",
    },
    yemen: {
      why: "Red Sea kinetic reporting keeps Bab-el-Mandeb and southern corridor risk elevated for product tankers.",
      watch: "Watch for further missile activity, crew casualties and Suez–Red Sea rerouting decisions.",
    },
    india: {
      why: "Pump-price moves, forecourt disruption and transport cost are where this lands first; local movement and distribution economics absorb the shock before the published headline catches up.",
      watch: "Watch for state-level fuel-tax changes, fresh forecourt or rationing reports and any operator-side surcharge announcements on road and rail.",
    },
    pakistan: {
      why: "Availability, pricing and power resilience are the main pressure points here; fuel for generators, freight and field operations is where it bites first, well before it shows up in the wider economy.",
      watch: "Watch for load-shedding patterns, depot-stock advisories and any government action on fuel pricing or commercial allocation.",
    },
    russia: {
      why: "Domestic rationing and refinery strain are restricting forecourt access and commercial allocation ahead of pump-price moves.",
      watch: "Watch for purchase-limit changes, station closures and any export or allocation cuts to commercial buyers.",
    },
    ukraine: {
      why: "The pressure here is on physical supply and distribution: refinery and depot damage, import dependence and the logistics of keeping fuel moving are what determine availability on the ground.",
      watch: "Watch for damage to refining and storage, import and rail-supply arrangements and any rationing or allocation measures for commercial users.",
    },
  };
  const paragraphs: string[] = [];
  const usedWhy = new Set<string>();
  for (let idx = 0; idx < lead.length; idx++) {
    const [country, items] = lead[idx];
    const fam = familyFor(items);
    const overlay = COUNTRY_OVERLAY[country.toLowerCase()];
    let why = overlay?.why
      ?? fam?.why
      ?? "There is underlying pressure on local fuel availability and cost.";
    if (usedWhy.has(why)) {
      why = overlay?.watch
        ? `${why} The near-term watch is on operational follow-through rather than headline volume.`
        : `${why} The pattern differs from adjacent theatres in how it reaches buyers and transport users.`;
    }
    usedWhy.add(why.split(".")[0] ?? why);
    const watch = overlay?.watch
      ?? fam?.watch
      ?? "Watch the coming weeks to confirm whether the pattern persists or eases.";
    const signal = regionalSignalPhrase(country, items, fam);
    let opener: string;
    if (idx === 0) {
      // Leader phrasing is only allowed when the canonical facts ranked this
      // country the unique primary pressure point. A distributed picture (or
      // a facts leader that disagrees with the local sort) gets spread
      // phrasing so this section can never contradict the facts object.
      const factsLeader = opts.pressure
        ? !opts.pressure.distributed &&
          (opts.pressure.primaryCountry ?? "").toLowerCase() ===
            country.toLowerCase()
        : true;
      opener = factsLeader
        ? `${titleCase(country)} is the clearest pressure point right now.`
        : `${titleCase(country)} is one of several pressure points right now, with activity spread across the region rather than concentrated in one theatre.`;
    } else if (idx === 1) {
      opener = `${titleCase(country)} is a secondary but credible concern.`;
    } else {
      opener = `${titleCase(country)} adds further weight to the picture.`;
    }
    paragraphs.push(`${opener} ${overlay ? `${why} ${watch}` : `${signal} ${why} ${watch}`}`);
  }
  return paragraphs.join("\n\n");
}

function regionalSignalPhrase(
  country: string,
  items: TopicFastFactsIncident[],
  fam: IssueFamily | null,
): string {
  const blob = items.map((i) => haystack(i)).join(" ").toLowerCase();
  const key = country.toLowerCase();
  if (key === "russia" && /\b(ration|rationing|shortage|moscow)\b/.test(blob)) {
    return "Confirmed rationing and domestic shortage pressure remain the operational story there.";
  }
  if (key === "india" && /\b(windfall|duty|tax|levy|subsidy)\b/.test(blob)) {
    return "Policy and export-duty moves are resetting local refiner and buyer economics.";
  }
  if (key === "yemen" && /\b(red sea|houthi)\b/.test(blob)) {
    return "Red Sea kinetic reporting is keeping corridor risk live for product movement.";
  }
  if (key === "iran" || (key !== "yemen" && /\b(hormuz|strait of hormuz)\b/.test(blob))) {
    return "Hormuz transit disruption is lifting war-risk and delay on dependent routes.";
  }
  if (fam?.key === "shortage") {
    return "Forecourt and allocation pressure is the confirmed operational signal there.";
  }
  if (fam?.key === "policy") {
    return "Government fuel-policy moves are resetting local price and pass-through assumptions.";
  }
  return `Material fuel-market pressure is confirmed in ${titleCase(country)}.`;
}

// ---------------------------------------------------------------------------
// Gulf & Hormuz Chokepoint Watch
//
// This section is now a canonical subset view: it receives only Fuel Watch's
// qualifying incident array and selects rows the canonical route classifier
// has already identified as chokepoint-relevant. It cannot add shipping-topic
// or out-of-window rows that are absent from the report-level total.
// ---------------------------------------------------------------------------

// A genuine chokepoint INCIDENT described in the body even when the headline
// itself doesn't name the chokepoint — e.g. a corporate statement titled
// "ADNOC issues statement clarifying attacks on facilities" that is entirely
// about vessels struck while transiting Hormuz, but never says "Hormuz" in
// the title. Title-only matching (below) silently drops these. This pattern
// stays narrow on purpose: it requires the chokepoint name to co-occur
// closely with an actual incident/closure verb, so a domestic pump-price or
// SPR story that merely name-drops "Persian Gulf" grades as market colour
// still does not qualify — preserving the precision-first design the
// title-only rule was built for.
// Reopen / resumed-transit vocabulary. Shared so the theme blob and the
// per-record temporal test below agree on what counts as a "reopening".
const GULF_REOPEN_RE =
  /\b(reopen|re-open|clears|cleared|exit|exits|transit|resume|resumed|passage|sail)/i;

const GULF_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
function gulfDayKey(iso: string | null | undefined): string | null {
  const m = (iso ?? "").match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
}
// Format a bare yyyy-mm-dd key as "9 May 2026" WITHOUT going through Date, so
// a date-only key can never shift a day under the server's timezone.
function gulfFmtDay(key: string): string {
  const m = key.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return key;
  return `${parseInt(m[3], 10)} ${GULF_MONTHS[parseInt(m[2], 10) - 1]} ${m[1]}`;
}

export interface FuelGulfWatchItem {
  title: string;
  /** yyyy-mm-dd */
  date: string;
  severity: string;
  country: string | null;
}

export interface FuelGulfChokepointWatch {
  /** 1-2 deterministic paragraphs of analyst prose, led by the current period. */
  read: string;
  /** Current-period anchor incidents (issue-date report window), capped. */
  currentItems: FuelGulfWatchItem[];
  /** Pre-formatted "9 Jul 2026 — <title> — High" lines for the current block. */
  currentItemLines: string[];
  /** Deprecated: always empty. Older/pre-period material is never surfaced. */
  standingItems: FuelGulfWatchItem[];
  /** Deprecated: always empty. Older/pre-period material is never surfaced. */
  standingItemLines: string[];
  /** Deprecated: always null. Older/pre-period material is never surfaced. */
  standingNote: string | null;
  /** Date span of the current-period activity. */
  rangeLabel: string;
}

/** Shift a yyyy-mm-dd day-key by whole days in UTC (tz-drift-free). */
function shiftDayKey(key: string, deltaDays: number): string {
  return new Date(new Date(`${key}T00:00:00Z`).getTime() + deltaDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/**
 * Build the Gulf & Hormuz Chokepoint Watch from the report's canonical
 * qualifying set. Production callers pass that exact array, making every
 * Chokepoint Watch count a bounded subset of incidentCount. The raw-input
 * compatibility path remains only for direct legacy unit callers.
 */
export function buildFuelGulfChokepointWatch(opts: {
  /** Report issue date (drives the current-period window). */
  issueDate: string;
  /** The market-close date, used only to extend the current end if later. */
  periodEnd?: string;
  incidents: TopicFastFactsIncident[];
  /** The Fuel Watch canonical incident universe. Production callers must use
   * this rather than independently selecting from the raw incident feed. */
  qualifyingIncidents?: CanonicalFuelIncident[];
  maxItems?: number;
}): FuelGulfChokepointWatch | null {
  const maxItems = opts.maxItems ?? 6;
  const issueKey = gulfDayKey(opts.issueDate);
  if (!issueKey) return null;

  // Current period = the SAME issue-date report window the rest of the report
  // uses (weekly fuel = 7 days), extended to the market close if that lands a
  // day or two later. Only this window is ever considered — no older material
  // is retained or referenced.
  const windowDays = reportWindowDefaultDays("fuel");
  const currentStartKey = shiftDayKey(issueKey, -(windowDays - 1));
  const periodEndKey = gulfDayKey(opts.periodEnd ?? null);
  const currentEndKey =
    periodEndKey && periodEndKey > issueKey ? periodEndKey : issueKey;

  // 1. Production selection is deliberately a filter over the canonical
  //    qualifying array, using routeOrChokepoint — the route classification
  //    already calculated in fuelCanonicalFacts. It neither re-windows nor
  //    re-applies a second Gulf matcher, so this count can never exceed the
  //    canonical incidentCount. The raw path is retained strictly for direct
  //    legacy unit callers that do not build report facts first.
  const matched = opts.qualifyingIncidents
    ? opts.qualifyingIncidents
        .filter((i) => i.routeOrChokepoint !== null)
        .map((i) => ({ i: i.raw, key: i.date }))
    : opts.incidents
        .filter(
          (i) =>
            i.topic === "fuel" ||
            (i.topic === "shipping" && FUEL_ACTION_TOPICAL_RE.test(haystack(i))),
        )
        .map((i) => ({ i, key: gulfDayKey(i.occurredAt) }))
        .filter(
          (x): x is { i: TopicFastFactsIncident; key: string } =>
            x.key !== null && x.key >= currentStartKey && x.key <= currentEndKey,
        )
        .filter(
          ({ i }) => matchesTopicIncident("gulf-chokepoint", i),
        );
  if (matched.length === 0) return null;

  const currentMatched = matched;

  // 2. Rank most-severe-then-newest, then dedupe syndication so one event with
  //    many rewrites collapses to a single representative row.
  type Kept = { i: TopicFastFactsIncident; key: string; title: string };
  const rankAndDedupe = (
    arr: { i: TopicFastFactsIncident; key: string }[],
  ): Kept[] => {
    const ranked = arr.slice().sort((a, b) =>
      compareIncidentSignificance(
        { ...a.i, occurredAt: a.key },
        { ...b.i, occurredAt: b.key },
      ),
    );
    const kept: Kept[] = [];
    const keptTokens: Set<string>[] = [];
    for (const { i, key } of ranked) {
      const title = stripWireCruft(i.title ?? "").trim();
      if (!title) continue;
      const tok = sigTokens(title);
      if (keptTokens.some((k) => nearDuplicate(tok, k))) continue;
      kept.push({ i, key, title });
      keptTokens.push(tok);
    }
    return kept;
  };

  const currentKept = rankAndDedupe(currentMatched);
  if (currentKept.length === 0) return null;

  const toItems = (kept: Kept[]): FuelGulfWatchItem[] =>
    kept.slice(0, maxItems).map(({ i, key, title }) => ({
      title,
      date: key,
      severity: (i.severity ?? "").toLowerCase(),
      country: incidentCountry(i),
    }));
  const toLines = (kept: Kept[]): string[] =>
    kept
      .slice(0, maxItems)
      .map(
        ({ i, key, title }) =>
          `${gulfFmtDay(key)} \u2014 ${title} \u2014 ${titleCase(i.severity ?? "")}`,
      );

  const spanLabel = (keys: string[]): string => {
    if (keys.length === 0) return "";
    const sorted = keys.slice().sort();
    const a = sorted[0];
    const b = sorted[sorted.length - 1];
    return a === b ? gulfFmtDay(a) : `${gulfFmtDay(a)} \u2013 ${gulfFmtDay(b)}`;
  };
  // Range label and every stated figure below derive from currentKept — the
  // SAME deduped set the bullets are drawn from — never from the wider
  // pre-dedupe pool, so the prose can never claim activity the list of
  // incidents beneath it does not show.
  const currentKeys = currentKept.map((x) => x.key);
  const rangeLabel = spanLabel(currentKeys);

  // 3. Theme detection over the CURRENT matched set only — the prose leads with
  //    the current period, so the recency claim is derived from current data.
  const currentBlob = currentMatched
    .map(({ i }) => i.title ?? "")
    .join(" ")
    .toLowerCase();
  const hasClosure =
    /\b(closure|closed|shut|blockad|disrupt|cut supply|crisis|choke)/.test(
      currentBlob,
    );
  const hasKinetic =
    /\b(refinery attack|attack|struck|missile|drone|explosion|blast|oil spill|sabotage)\b/.test(
      currentBlob,
    );
  const hasBypass =
    /\b(bypass|pipeline|alternative route|skirt|reroute|diversion)\b/.test(
      currentBlob,
    );
  const distinctCurrentDays = new Set(currentKept.map((x) => x.key)).size;
  const broadCoverage = currentKept.length >= 4 && distinctCurrentDays >= 3;
  // How many of the counted incidents actually render as bullets. When the
  // list is capped, the prose must SAY it lists a subset — "14 incidents"
  // above six bullets otherwise reads as a self-contradiction.
  const shownCount = Math.min(currentKept.length, maxItems);

  // 4. Compose deterministic, no-fabrication prose. Current period leads.
  const p1: string[] = [];
  const p2: string[] = [];
  if (currentKept.length > 0) {
    p1.push(
      broadCoverage
        ? "The Strait of Hormuz and wider Gulf were this reporting period's dominant fuel-route risk, with a marked concentration of chokepoint reporting."
        : "The Strait of Hormuz and wider Gulf featured in this reporting period's fuel-route reporting.",
    );
    // Quantify the concentration with real, already-deduped counts rather than
    // leaving "marked concentration" as an unsupported adjective — this is the
    // same currentKept/distinctCurrentDays data already used to gate
    // broadCoverage above, so no new figure is introduced.
    if (currentKept.length >= 2) {
      const listedNote =
        currentKept.length > shownCount
          ? `; the ${shownCount} most significant are listed below`
          : "";
      p1.push(
        `${currentKept.length} distinct chokepoint incidents were logged across ${distinctCurrentDays} separate day${distinctCurrentDays === 1 ? "" : "s"} in the window${listedNote}.`,
      );
    }
    if (hasClosure) {
      p1.push(
        "Coverage centred on Hormuz closure and shipping disruption, forcing dependent crude and product flows onto longer, costlier routes and lifting the war-risk premium.",
      );
    }
    const anchor = currentKept[0];
    const anchorSevRank = incidentSeverityRank(anchor.i.severity);
    if (hasKinetic && anchorSevRank >= 4) {
      // Ground the anchor sentence in severity and location rather than just
      // re-quoting the headline as if repetition were analysis — the title
      // is still cited (traceability), but as evidence for a stated claim,
      // not as the claim itself.
      const anchorCountry = incidentCountry(anchor.i);
      const anchorSevLabel = titleCase(anchor.i.severity ?? "");
      const locationClause = anchorCountry ? ` near ${anchorCountry}` : "";
      const article = /^[aeiou]/i.test(anchorSevLabel) ? "an" : "a";
      p1.push(
        `Pressure peaked on ${gulfFmtDay(anchor.key)} with ${article} ${anchorSevLabel.toLowerCase()}-severity incident${locationClause}, the period's most serious chokepoint event: ${anchor.title}.`,
      );
    }
    const reopenAfterAnchor = currentMatched.some(
      ({ i, key }) => key > anchor.key && GULF_REOPEN_RE.test(i.title ?? ""),
    );
    if (reopenAfterAnchor) {
      p2.push(
        "The strait subsequently reopened in phases, with tanker transits resuming later in the period.",
      );
    }
    if (hasBypass) {
      p2.push(
        "Bypass pipelines and alternative routing featured as the main mitigation.",
      );
    }
    p2.push(
      "The chokepoint remains a live, standing watch given the fragility of the route.",
    );
  }
  // currentKept.length === 0 is unreachable here (guarded above), so there is
  // no "no fresh reporting" branch and no older/standing material of any kind
  // is ever surfaced — this section is scoped strictly to the current period.
  const read = [p1.join(" "), p2.join(" ")].filter((s) => s.trim()).join("\n\n");

  return {
    read,
    currentItems: toItems(currentKept),
    currentItemLines: toLines(currentKept),
    standingItems: [],
    standingItemLines: [],
    standingNote: null,
    rangeLabel,
  };
}

// Producer/buyer/government/infrastructure/market classification rules.
// Order matters: a record is assigned to the first matching category.
export type FuelActionCategory =
  | "Producer action"
  | "Buyer action"
  | "Government / policy action"
  | "Infrastructure / routing action"
  | "Market / supply signal";

interface CategoryRule {
  category: FuelActionCategory;
  test: RegExp[];
}

// Buyer supplier-pivot patterns ("Russia Turns To India For Gasoline",
// "Russia seeking extra gasoline from one of its top oil buyers"). Both are
// anchored on a named refined product (never bare "oil" — the food-oil
// guard exists for a reason) plus the sourcing preposition. Named as a
// const because the table builder also uses them for story-key dedupe:
// syndicated rewrites of one pivot share too few distinctive tokens for
// the near-duplicate guard, but one buyer pivoting on one product in one
// window is ONE action.
const SUPPLIER_PIVOT_RES: RegExp[] = [
  /\bturn(?:s|ed|ing)? to\b.{0,50}\bfor (?:gasoline|petrol|gasoil|diesel|jet fuel|kerosene|lpg|naphtha|fuel|crude)\b/,
  /\bseek(?:s|ing)?\b.{0,40}\b(?:gasoline|petrol|gasoil|diesel|jet fuel|kerosene|lpg|naphtha|fuel|crude)\b.{0,50}\bfrom\b/,
];
const PIVOT_PRODUCT_RE =
  /\b(gasoline|petrol|gasoil|diesel|jet fuel|kerosene|lpg|naphtha|fuel|crude)\b/;

const CATEGORY_RULES: CategoryRule[] = [
  {
    category: "Government / policy action",
    test: [
      // An institution ALONE is not a policy action — it must pair with a
      // concrete policy lever (subsidy/levy/tax/duty, price control, trade
      // ban/quota, rationing/allocation/curfew, mandate/sanction,
      // nationalisation), in either order. A bare mention — e.g. "Municipality
      // monitors fuel crisis and announces start of supply arrivals" — is
      // operational supply news, not a government policy intervention.
      /\b(government|ministry|parliament|cabinet|regulator|state[- ]owned|caucus|municipality|municipal|council|authority|authorities)\b.{0,80}\b(subsid\w+|levy|levies|duty|duties|excise|tax|tariff|price (control|cap|freeze)|export ban|import ban|\bban\b|quota|ration\w*|allocation|curfew|mandate|sanction\w*|nationali[sz]\w+)\b/,
      /\b(subsid\w+|levy|levies|duty|duties|excise|tariff|price (control|cap|freeze)|export ban|import ban|quota|ration\w*|allocation|curfew|mandate|sanction\w*|nationali[sz]\w+)\b.{0,80}\b(government|ministry|parliament|cabinet|regulator|state[- ]owned|caucus|municipality|municipal|council|authority|authorities)\b/,
      /\b(subsidy|subsidies|levy|levies|duty|excise|tax) .{0,30}(fuel|petrol|diesel|gas|lpg|kerosene)/,
      /\b(fuel|petrol|diesel) .{0,20}(subsidy|levy|duty|excise|tax) (cut|hike|raise|removal|removed|reform|reintroduce)/,
      /\b(price control|price cap|price freeze|export ban|import ban|export quota|import quota)/,
      // Rationing / allocation / curfew are direct shortage-management
      // levers during a fuel crisis — a core government action, not noise.
      /\b(ration|rationing|allocation|curfew) .{0,30}(fuel|petrol|diesel|gas|lpg|kerosene)/,
      /\b(fuel|petrol|diesel|gas|lpg|kerosene) .{0,30}(ration|rationing|allocation|curfew)/,
    ],
  },
  {
    category: "Infrastructure / routing action",
    test: [
      /\b(pipeline|terminal|jetty|loading|berth) .{0,30}(bypass|reroute|open|close|shut|expand|sabotage|attack)/,
      /\b(bypass(?:ing)? hormuz|red sea bypass|alternative route|reroute|rerouting)/,
      /\b(adnoc|ila|aramco) .{0,30}(pipeline|bypass)/,
      /\b(storage|stockpile|reserve) (build|release|expand|tap)/,
    ],
  },
  {
    category: "Buyer action",
    test: [
      /\b(airline|carrier) .{0,30}(surcharge|fuel hedge|hedging|capacity (cut|reduction))/,
      // Aviation demand response: a named carrier (or the generic words
      // airline/carrier/airways) suspending, cancelling, cutting, grounding
      // or trimming flights/routes/capacity is a buyer-side reaction to fuel
      // cost or availability — a core action class during a fuel crisis.
      /\b(airline|carrier|airways|indigo|emirates|easyjet|jet2|lufthansa|qantas|ryanair|wizz air|air india|spicejet|vistara|cathay|singapore airlines|ana|jal|yemenia|akasa|airasia|air asia|garuda|lion air|thai airways|vietnam airlines|philippine airlines|cebu pacific)\b.{0,80}\b(suspend|cancel|cut|cuts|ground|grounded|reduc|axe|axes|halt|halts|slash|slashes|defer|trim|drop|drops)\w*/,
      /\b(suspend|cancel|cut|cuts|ground|grounded|reduc|axe|halt|slash|defer|trim)\w*\b.{0,40}\b(flight|flights|route|routes|service|services|capacity|schedule|schedules)\b/,
      /\b(indian oil|bharat petroleum|hindustan petroleum|sinopec|cnpc) .{0,30}(spot purchase|tender|cargo|import|buy)/,
      /\b(buyer|importer|trading house|trader|refiner) .{0,30}(switch|diversif|cancel|defer|stockpile|spot purchase|tender)/,
      /\b(strategic reserve|spr) (release|draw|tap)/,
      /\b(fuel hedging|jet fuel hedging|bunker hedging)/,
      // Supplier pivot: a country or company turning to a new source for
      // refined product ("Russia Turns To India For Gasoline", "Russia
      // seeking extra gasoline from one of its top oil buyers") is a core
      // buyer-side procurement action during a supply crisis.
      ...SUPPLIER_PIVOT_RES,
      // Aviation operating-cost impact: Fuel Watch is not limited to
      // schedule cuts. A carrier facing fuel-cost pressure belongs here
      // even when the headline does not use suspend/cancel/cut.
      /\b(airline|carrier|airways|indigo|emirates|easyjet|jet2|lufthansa|qantas|ryanair|wizz air|air india|spicejet|vistara|cathay|singapore airlines|ana|jal|yemenia|akasa|airasia|air asia|garuda|lion air|thai airways|vietnam airlines|philippine airlines|cebu pacific)\b.{0,80}\b(fuel (cost|costs|price|prices)|jet fuel|aviation fuel)\b/,
      /\b(fuel (cost|costs)|jet fuel|aviation fuel)\b.{0,80}\b(airline|airways|flight|flights|aviation|air india)\b/,
    ],
  },
  {
    // OPEC/IEA supply-demand forecast disagreement is relevant because it
    // moves the pricing picture, not because OPEC executed a production
    // action. Must sit BEFORE the Producer name-match so a forecast split
    // is not forced into "Producer action".
    category: "Market / supply signal",
    test: [
      /\b(opec\+?|iea)\b.{0,100}\b(forecast|outlook|disagre\w*|demand outlook|demand forecast|demand estimate|supply outlook)\b/,
      /\b(forecast|outlook|demand (forecast|outlook|estimate)|disagre\w*)\b.{0,80}\b(opec\+?|iea)\b/,
    ],
  },
  {
    category: "Producer action",
    test: [
      /\b(opec\+?|saudi aramco|adnoc|qatarenergy|petrobras|rosneft|gazprom|cnooc|pertamina|petronas|reliance industries|reliance jamnagar|jamnagar|ongc)\b/,
      /\b(production|output) (cut|hike|increase|reduce|boost|target|guidance)/,
      /\b(refinery|refiner|refining) .{0,30}(announce|cut|raise|expand|restart|shut|maintenance|outage)/,
      /\b(supply (contract|deal|agreement|swap)|long[- ]term contract)/,
    ],
  },
  {
    category: "Market / supply signal",
    test: [
      /\b(brent|wti|crude|oil) (price|prices) (rise|fall|climb|drop|surge|slide|jump|plunge|hit|reach|break)/,
      /\b(jet fuel|diesel|petrol|gasoline|kerosene) (price|prices) (rise|fall|climb|drop|surge|slide|hit|break)/,
      /\b(supply (tighten|tightens|squeeze)|demand (jump|rise|fall|drop)|inventory (build|draw))/,
      // "refiner margins" / "refining margins" are the same signal as
      // "refinery margin" — wire-service styling varies word by word.
      /\b(refin(?:ery|er|ing) margins?|crack spreads?)/,
      // NOTE: refinery/depot FIRES are deliberately NOT classified here.
      // An involuntary fire is neither a market nor an operator RESPONSE,
      // and the owner's ruling is that a fire enters this table only when
      // the reporting itself evidences a material effect on the covered
      // markets — which a bare "refinery ablaze" headline does not. Fires
      // still appear in the report's incident sections; they are only
      // excluded from the responses table.
      // Supply resuming / arriving / shortage easing is a genuine availability
      // signal (bearish for local pump prices), not a policy action.
      /\b(supply|supplies|fuel|petrol|diesel|cargo|shipment|tanker|stock|stocks) .{0,30}(arriv\w+|resum\w+|restor\w+|replenish\w+|normalis\w+)/,
      /\b(shortage|crisis|outage|disruption) .{0,30}(ease|eases|easing|end|ends|over|resolv\w+)/,
      /\bfails?\s+to\s+ease\b.{0,50}\b(shortage|crisis|fuel shortage|fuel crisis)\b/,
    ],
  },
];

function classifyCategory(t: string): FuelActionCategory | null {
  for (const rule of CATEGORY_RULES) {
    if (rule.test.some((re) => re.test(t))) return rule.category;
  }
  return null;
}

function isStatementOnlyHeadline(t: string): boolean {
  const hasOperationalAction = /\b(production|output|export|pipeline|bypass|cut|hike|restart|shut|contract|tender|supply deal|long[- ]term|maintenance|outage|expand|increase|reduce|announce\w* output)\b/.test(t);
  if (hasOperationalAction) return false;
  if (/\b(condemn|condemns|condemned|denounc|deplor|strongly condemns)\b/.test(t)) return true;
  if (/\b(issues statement|statement clarifying)\b/.test(t)
      && !/\b(attack|attacks|pipeline|output|production|export|restart|shut|maintenance|outage)\b/.test(t)) return true;
  return false;
}

/** Commentary / outlook pieces — not an operator response action. */
function isCommentaryOnlyHeadline(t: string): boolean {
  if (/\b(electric aviation|e[- ]?vtol|hybrid[- ]electric aircraft|battery[- ]electric aircraft)\b/.test(t)) {
    return true;
  }
  if (
    /\b(commentary|analyst view|perspective|long[- ]term trend|industry trend)\b/.test(t)
    && !/\b(suspend|cancel|cut|ground|ration|rationing|export ban|production cut|restart|shut|pipeline|contract|tender|opec|iea)\b/.test(t)
  ) {
    return true;
  }
  if (
    /\b(analysts? say)\b/.test(t)
    && !/\b(opec|iea|airline|carrier|suspend|cancel|cut|ground|ration|rationing|export ban|production cut|restart|shut|pipeline|contract|tender)\b/.test(t)
  ) {
    return true;
  }
  return false;
}

/** Producer-named incident reporting (attack on a vessel/facility) — not a supply-side action. */
function isVictimProducerIncidentHeadline(t: string): boolean {
  if (/\b(issues statement|statement clarifying|announc\w+|said it will|plans to|complet\w+|expand\w+|restart\w+|resume\w+|restore\w+|shut\w+|cut\w+|hike\w+|raise\w+|reduce\w+|export\w+|import\w+|sign\w+|award\w+|launch\w+|open\w+|close\w+|bypass\w+|pipeline|contract|tender|supply deal|long[- ]term|output increase|production (cut|hike|increase|reduce))\b/.test(t)) {
    return false;
  }
  const producerNamed = /\b(adnoc|saudi aramco|aramco|qatarenergy|petrobras|rosneft|gazprom|cnooc|pertamina|petronas|reliance industries|reliance jamnagar|jamnagar|ongc)\b/.test(t);
  if (!producerNamed) return false;
  return /\b(vessel|tanker|ship|facilit(?:y|ies)|terminal|platform|refiner(?:y|ies))\b.{0,80}\b(attack|attacked|attacking|struck|hit|targeted|targeting|fired on|damaged)\b|\b(attack|attacked|attacking|struck|hit|targeted|targeting|fired on|damaged)\b.{0,80}\b(vessel|tanker|ship|facilit(?:y|ies)|terminal|platform|refiner(?:y|ies))\b/.test(t);
}

// Per-row operational-read derivation. Each row gets a sentence shaped
// by keywords in the actual action text, so rows in the same category
// don't all carry an identical generic line. Falls back to a per-
// category default only when no keyword matches.
function deriveOperationalRead(t: string, category: FuelActionCategory): string {
  // Margin / crack-spread rows are a SUPPORTING market indicator, not a
  // separate operational driver — the read must frame them that way
  // (owner ruling), so this branch precedes the generic refinery branch.
  if (/\b(refin(?:ery|er|ing) margins?|crack spreads?)\b/.test(t))
    return "Supporting market indicator: margin strength corroborates tight refined-product supply. Not an operational driver on its own.";
  if (/\b(condemn|condemns|condemned|denounc|deplor)\b/.test(t))
    return "Statement only — no confirmed operational supply change unless reporting evidences output, routing or allocation impact.";
  if (/\bfails?\s+to\s+ease\b/.test(t))
    return "The expected relief did not materialise; the shortage or tightness persists and keeps local pricing under pressure.";
  if (/\b(refinery|refining)\b/.test(t))
    return "Refinery-side change to regional product supply; watch crack spreads and downstream product availability.";
  if ((/\b(flight|flights|route|routes|capacity|airline|carrier|airways)\b/.test(t))
      && /\b(suspend|cancel|cut|cuts|ground|grounded|reduc|axe|halt|slash|defer|trim|drop)\w*/.test(t)
      && !/\b(tax|taxes|windfall|levy|levies|duty|export ban|import ban|subsidy|subsidies)\b/.test(t))
    return "Aviation demand response: carriers trimming capacity signal jet-fuel cost or availability stress feeding straight into route economics.";
  if (/\b(fuel (cost|costs|price|prices)|jet fuel|aviation fuel)\b/.test(t)
      && /\b(airline|airways|flight|flights|aviation|air india)\b/.test(t))
    return "Aviation cost pressure: fuel expense is feeding into airline operating economics; watch schedule, surcharge and capacity responses.";
  if (/\b(opec\+?|iea)\b/.test(t) && /\b(forecast|outlook|disagre\w*|demand outlook|demand forecast)\b/.test(t))
    return "Market-outlook signal: a supply-demand forecast split feeds crude and product pricing expectations. Treat as a pricing and planning input, not a physical supply change on its own.";
  if (/\b(ration|rationing|allocation|curfew)\b/.test(t))
    return "Rationing or allocation controls confirm a physical shortage; commercial offtake is restricted before pump prices fully adjust.";
  if (/\b(export ban|import ban|export quota|import quota|embargo)\b/.test(t))
    return "Trade controls reroute flows; expect tighter spot availability and wider freight differentials on affected grades.";
  if (/\b(subsidy|subsidies|levy|levies|duty|excise|tax|price control|price cap|price freeze)\b/.test(t))
    return "Policy reset: review pump-price exposure and contract pass-through clauses before the next billing cycle.";
  if (/\b(jet fuel|bunker|fuel) hedg/.test(t))
    return "Hedging signals buyers positioning against sustained fuel-cost pressure on similar grades.";
  if (/\b(spot purchase|tender|long[- ]term contract|long[- ]term deal|supply (contract|deal|agreement|swap))\b/.test(t))
    return "Procurement signal: near-term demand pulled forward; watch tender outcomes and freight follow-through.";
  if (/\b(strategic reserve|\bspr\b|storage|stockpile|reserve) (release|draw|tap|build|expand)/.test(t))
    return "Reserve action smooths near-term pricing but does not fix the underlying supply tightness.";
  if (/\b(pipeline|terminal|jetty|berth|loading)\b.{0,30}(bypass|reroute|rerouting|open|close|shut|expand|sabotage|attack)/.test(t)
      || /\b(alternative route|bypass(?:ing)? hormuz|red sea bypass)/.test(t)
      || /\b(reroute|rerouting|rerouted)\b/.test(t))
    return "Rerouting adds voyage time and freight cost to affected fuel cargoes; landed cost and delivery schedules on the corridor are the direct exposure.";
  if (/\b(production|output) (cut|reduce|curtail)/.test(t))
    return "Output discipline tightens balances and supports a firmer crude floor.";
  if (/\b(production|output) (hike|increase|boost|expand|raise|restart)/.test(t))
    return "Added barrels ease near-term tightness but rarely move prices on their own without demand confirmation.";
  if (/\b(supply (tighten|tightens|squeeze)|inventory draw)/.test(t))
    return "Tightening balances put a floor under prices and reduce buyer flexibility in the weeks ahead.";
  if (/\b(supply|supplies|fuel|petrol|diesel|cargo|shipment|tanker|stock|stocks) .{0,30}(arriv\w+|resum\w+|restor\w+|replenish\w+|normalis\w+)/.test(t)
      || (/\b(shortage|crisis|outage|disruption) .{0,30}(ease|eases|easing|end|ends|over|resolv\w+)/.test(t) && !/\bfails?\s+to\s+ease\b/.test(t)))
    return "Supply resuming eases the local shortage; pump-price and surcharge pressure should soften as availability normalises.";
  if (/\b(price|prices) (rise|climb|surge|jump|hit|reach|break)/.test(t))
    return "Reinforces the cost-pressure picture on freight surcharges and bunker invoices.";
  // Per-category fallbacks (different from each other so the table never
  // shows the same operational read across multiple categories).
  switch (category) {
    case "Producer action":
      return "Supply-side move with read-through to bunker, jet and downstream pricing if the action sustains.";
    case "Buyer action":
      return "Buyer-side shift; watch spot and contract pricing on similar grades for follow-on effects.";
    case "Government / policy action":
      return "Policy intervention resets pump-price and surcharge exposure for the next contract cycle.";
    case "Infrastructure / routing action":
      return "Routing or infrastructure change with direct bearing on fuel delivery cost and transit time.";
    case "Market / supply signal":
      return "Confirming evidence in the market indicators; treat as supporting context rather than a fresh driver.";
  }
}

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  } catch { return ""; }
}

// Headline -> declarative action text. Conservative sentence-casing: a
// word is lowercased ONLY when it is a plain Capitalised word (never an
// acronym like "US"/"OPEC") AND appears on the curated common-word list
// below — proper nouns (Saudi, Suez, Cuba, Aramco …) are never on the
// list, so they keep their capitals. No-fabrication: every word is the
// headline's own; only casing changes and a trailing "— <country>" is
// appended when the text itself does not already name the place. The
// WHEN is the date line rendered under the action cell on both surfaces.
const SENTENCE_LOWER = new Set([
  // articles / conjunctions / prepositions / auxiliaries
  "a", "an", "the", "and", "or", "but", "as", "at", "by", "for", "from",
  "in", "into", "of", "on", "to", "toward", "towards", "via", "with",
  "over", "under", "after", "before", "amid", "against", "near", "off",
  "out", "up", "down", "this", "that", "its", "is", "are", "was", "were",
  "has", "have", "will", "could", "may", "says", "say", "said", "not",
  "no", "now", "new", "more", "than", "their", "his", "her",
  // common fuel-market vocabulary (never a proper noun)
  "oil", "fuel", "fuels", "gas", "gasoline", "petrol", "diesel", "crude",
  "kerosene", "jet", "bunker", "tanker", "tankers", "ship", "ships",
  "vessel", "vessels", "cargo", "cargoes", "refinery", "refineries",
  "refiner", "refiners", "refining", "margins", "margin", "price",
  "prices", "pricing", "supply", "supplies", "shortage", "shortages",
  "crisis", "imports", "import", "exports", "export", "output",
  // NOTE: "canal" / "strait" / "sea" / "gulf" are deliberately absent —
  // they are almost always part of a proper name (Suez Canal, Red Sea,
  // Strait of Hormuz) and must keep their capitals.
  "production", "pipeline", "pipelines", "terminal", "storage",
  "reserve", "reserves", "stockpile", "route",
  "routes", "routing", "reroute", "reroutes", "rerouting", "rerouted",
  "bypass", "bypassing", "flights", "flight", "capacity", "week",
  "month", "year", "record", "records", "highs", "high", "lows", "low",
  "concerns", "concern", "damage", "grow", "grows", "growing", "deepens",
  "deepen", "spiked", "spikes", "spike", "surge", "surges", "rise",
  "rises", "rising", "fall", "falls", "falling", "hits", "hit", "cuts",
  "cut", "cutting", "suspends", "suspend", "suspended", "cancels",
  "cancel", "cancelled", "turns", "turn", "turned", "seeks", "seeking",
  "buys", "buy", "buying", "sells", "sell", "selling", "two", "three",
  "four", "five", "six", "seven", "eight", "nine", "ten", "toll",
  "amid", "worsens", "worsening", "eases", "easing", "announces",
  "announce", "announced", "plans", "plan", "planned", "begins",
  "begin", "began", "starts", "start", "started", "halts", "halt",
  "halted", "resumes", "resume", "resumed",
]);
function sentenceCaseHeadline(title: string): string {
  return title
    .split(/(\s+)/)
    .map((w, idx) => {
      if (/^\s+$/.test(w)) return w;
      // Preserve acronyms and initialisms (ADNOC, UAE, US, OPEC).
      if (/^[A-Z0-9]{2,}$/.test(w)) return w;
      if (idx === 0) return w;
      if (!/^[A-Z][a-z'’-]*$/.test(w)) return w;
      const key = w.toLowerCase().replace(/[^a-z']/g, "");
      return SENTENCE_LOWER.has(key) ? w.toLowerCase() : w;
    })
    .join("");
}

// WHERE for the action cell: the incident's country stamp, appended ONLY
// when the sentence-cased headline carries no other capitalised token —
// i.e. the text itself names no actor or geography of its own. A headline
// that already names a place or actor ("US refiner margins…", "Two Saudi
// Oil Tankers…") gets NO suffix: the country stamp can reflect reporting
// origin rather than the event's geography, and appending it there would
// mislead (no-fabrication).
function actionPlaceSuffix(sentenceCased: string, country: string | null | undefined): string {
  const c = (country ?? "").trim();
  if (!c || /^unknown$/i.test(c)) return "";
  const words = sentenceCased.split(/\s+/);
  const carriesOwnCue = words.some((w, idx) => {
    if (!/^[A-Z]/.test(w)) return false;
    // The first word is always capitalised; it only counts as a cue when
    // it is NOT a known common word ("US refiner margins…" / "Aramco cuts
    // output" → cue; "Refinery output cut…" → not a cue).
    if (idx === 0) return !SENTENCE_LOWER.has(w.toLowerCase().replace(/[^a-z']/g, ""));
    return true;
  });
  if (carriesOwnCue) return "";
  return ` — ${c}`;
}

// Corridor grouping for reroute story-key dedupe: syndicated copies of one
// rerouting development ("Two Saudi Oil Tankers Reroute in the Red Sea
// Toward the Suez Canal" vs "Asian refineries reroute Saudi oil imports
// via the Suez Canal") share too few distinctive tokens for the near-
// duplicate guard, but traffic shifting on ONE corridor in one window is
// ONE operational development — one row. Red Sea / Suez / Bab el-Mandeb /
// Cape of Good Hope form a single diversion axis.
function detectRerouteCorridor(t: string): string | null {
  if (/\b(red sea|suez|bab[- ]el[- ]mandeb|cape of good hope)\b/.test(t)) return "red-sea-suez";
  if (/\bhormuz\b/.test(t)) return "hormuz";
  if (/\bmalacca\b/.test(t)) return "malacca";
  if (/\bpanama\b/.test(t)) return "panama";
  return null;
}

function pickActor(i: TopicFastFactsIncident, category: FuelActionCategory): string {
  const t = haystack(i);
  // "Reliance" is a common English noun ("reduce reliance on …"), so the actor
  // is only the company when the distinctive corporate/refinery tokens appear.
  if (/\b(reliance industries|reliance jamnagar|jamnagar)\b/.test(t))
    return "Reliance";
  const ACTORS = [
    "OPEC+", "OPEC", "IEA", "Saudi Aramco", "ADNOC", "QatarEnergy", "Petrobras",
    "Rosneft", "Gazprom", "Sinopec", "CNPC", "CNOOC",
    "Indian Oil", "Bharat Petroleum", "Hindustan Petroleum", "ONGC",
    "Pertamina", "Petronas",
    // Airlines (aviation demand response shows the carrier as the actor).
    "IndiGo", "Emirates", "easyJet", "Jet2", "Lufthansa", "Qantas",
    "Ryanair", "Wizz Air", "Air India", "SpiceJet", "Vistara", "Cathay",
    "Singapore Airlines", "Garuda", "Lion Air", "Thai Airways",
    "Vietnam Airlines", "Philippine Airlines", "Cebu Pacific", "AirAsia",
    "Akasa", "Yemenia",
  ];
  for (const a of ACTORS) {
    if (t.includes(a.toLowerCase())) return a;
  }
  if (category === "Government / policy action") {
    const c = incidentCountry(i);
    if (c) return c;
    return "Government";
  }
  if (category === "Buyer action") {
    if (/\b(airline|aviation|jet fuel|carrier|flight|airways|airlines)\b/.test(t)) return "Aviation sector";
    const c = incidentCountry(i);
    if (c) return c;
    return "Buyer";
  }
  if (category === "Infrastructure / routing action") {
    // No named corporate actor matched above. Falling back to the bare
    // generic label "Infrastructure operator" made two unrelated events
    // (e.g. Saudi tankers rerouting vs a Kuwaiti pipeline discussion) show
    // up as identical, undifferentiated rows in the Market and Operator
    // Responses table. Use the cross-checked incident location rather than
    // the raw field, which can be a vessel flag state or source geography.
    const c = incidentCountry(i);
    if (c) return `${c} infrastructure operator`;
    // No incident-location country. A flag state still differentiates the row
    // ("6 Saudi-flagged oil carriers reroute" → "Saudi Arabia-flagged
    // operator") without pretending the event happened in that country.
    const flag = deriveFlagState(i);
    if (flag) return `${flag}-flagged operator`;
    return "Infrastructure operator";
  }
  if (category === "Market / supply signal") return "Market";
  if (category === "Producer action") {
    if (/\b(saudi aramco|aramco)\b/.test(t)) return "Saudi Aramco";
    if (/\b(adnoc)\b/.test(t)) return "ADNOC";
    if (/\b(russia|rosneft|gazprom|belarus|naftan)\b/.test(t)) return "Russia";
    const c = incidentCountry(i);
    if (c) return c;
    return "Producer";
  }
  return "—";
}

export interface ProducerBuyerActionRow {
  actor: string;
  category: FuelActionCategory;
  action: string;
  operationalRead: string;
  date: string;
}

// Significant-token set for an action title, used for near-duplicate
// detection. Drops short filler words so syndicated re-writes of the
// same story ("New UAE Pipeline Bypassing Hormuz Now 50% Complete,
// ADNOC CEO Says" vs "UAE crude oil pipeline bypassing Hormuz 50%
// complete, ADNOC says") collapse to one row.
const DEDUPE_STOP = new Set([
  "the", "and", "for", "with", "from", "into", "over", "amid", "after",
  "says", "say", "said", "now", "new", "via", "per", "out", "off", "near",
  "could", "may", "will", "would", "this", "that", "are", "was", "has",
  "have", "its", "his", "her", "their", "not", "but", "yet", "all",
  // Generic fuel-report vocabulary that recurs across unrelated stories in
  // this section (every headline here is fuel-adjacent by construction) and
  // would otherwise inflate overlap between genuinely different incidents —
  // e.g. two different airlines both cutting capacity "amid major fuel
  // crisis 2026" sharing only that boilerplate. Stripped so overlap reflects
  // the story's actual subject (actor, target, action), not its beat.
  "fuel", "crisis", "major",
]);
function sigTokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !DEDUPE_STOP.has(w)),
  );
}
function nearDuplicate(a: Set<string>, b: Set<string>): boolean {
  let overlap = 0;
  for (const x of a) if (b.has(x)) overlap++;
  const smaller = Math.min(a.size, b.size);
  if (smaller === 0) return false;
  // Jaccard similarity guards the absolute-overlap branch. During a fuel
  // crisis two genuinely DIFFERENT actions ("IndiGo Suspends 7 Asian
  // Routes … Fuel Crisis 2026" vs "Emirates Cuts 14% of Flights … Fuel
  // Crisis 2026") share a block of generic crisis vocabulary ("fuel",
  // "crisis", "major", the year) — enough to trip a bare overlap >= 4 and
  // wrongly collapse two distinct carriers' actions into one row. A real
  // syndicated rewrite of the SAME story shares its DISTINCTIVE tokens at
  // a high ratio, so requiring Jaccard >= 0.4 alongside the absolute count
  // keeps true syndication merging while letting the two airlines stand.
  const jaccard = overlap / (a.size + b.size - overlap);
  // Same story when the titles share a strong block of distinctive content
  // words (absolute overlap AND a high similarity ratio), or when most of
  // the shorter title's content is contained in the other. The containment
  // bar is 0.55, not 0.7: two independent wire rewrites of the same
  // incident (e.g. "Houthis claim missile attack on Saudi oil tanker" vs
  // "Houthis claim fresh attack on Saudi oil tanker; oil rebounds...")
  // typically share ~55-65% of the shorter title's distinctive tokens once
  // each outlet adds its own market-reaction framing — 0.7 was tuned tight
  // enough to let two genuinely different actors' actions stand apart, but
  // it also let true syndicated duplicates of the same attack survive as
  // separate rows. 0.55 still keeps unrelated same-beat stories (different
  // actors, different chokepoint events) below the bar — see the fixture
  // pairs in fuelGulfChokepointWatch.test.ts, all well under 0.4.
  return (overlap >= 4 && jaccard >= 0.4) || overlap >= Math.ceil(0.55 * smaller);
}

// ---------------------------------------------------------------------------
// Qualifying-set cross-read: fuel-continuity events filed under other topics.
//
// The fuel relevance gate is deliberately scoped to fuel-OPERATIONAL stories,
// so two classes of genuinely fuel-relevant events never reach the qualifying
// set on their own topic alone:
//   1. shipping-topic KINETIC events on a tracked fuel-route chokepoint
//      (a missile strike on a vessel in the Gulf of Oman or Bab-el-Mandeb is
//      chokepoint pressure whether or not the headline names a fuel cargo);
//   2. energy-topic fuel-to-power continuity failures (gas-shortage-driven
//      load shedding, fuel rationing, power cuts) — the downstream face of a
//      fuel supply problem.
// Both admits are precision-gated, bounded to the SAME report window, and
// collapsed for syndication (the same strike arrives as many rewrites) so a
// single event can never inflate the report-wide qualifying count.
// ---------------------------------------------------------------------------

// Tracked fuel-route chokepoint names. Mirrors fuelCanonicalFacts routeFor()
// (a VALUE import from there would close the module cycle
// fuelNarratives -> fuelCanonicalFacts -> fuelReportFacts -> fuelNarratives,
// so the name list is kept in sync here instead).
const CHOKEPOINT_NAME_RE =
  /strait of hormuz|\bhormuz\b|gulf of oman|bab[- ]el[- ]mandeb|bab al[- ]mandab|bab el[- ]mandab|\bred sea\b|\bsuez\b|\bmalacca\b|\bpersian gulf\b|\barabian gulf\b/i;

const CHOKEPOINT_KINETIC_RE =
  /\b(missile|drone|attack(?:ed|s)?|struck|hit by|explosion|blast|hijack\w*|seiz\w*|mined|sabotage|blockad\w*|closure|closed|shut)\b/i;

const EXPLAINER_NOISE_RE =
  /\bguide\b|here'?s (?:your|what|how)|\bhow to\b|\bexplained\b|\bexplainer\b|\bwhat to know\b|\bfaq\b/i;

const FUEL_POWER_CONTINUITY_RE =
  // Load-shedding is inherently a supply-rationing signal; every other
  // branch requires an explicit fuel/gas anchor so an ordinary grid fault or
  // storm blackout (an energy story with no fuel dimension) can never enter
  // Fuel Watch.
  /\bload[\s-]?shedding\b|\b(?:fuel|gas|diesel|petrol|gasoline|kerosene|lpg|lng)\b[^.]{0,60}\b(?:shortage|rationing|crisis|scarcity|cut-?offs?|cuts?)\b|\b(?:shortage|rationing)s?\b[^.]{0,40}\b(?:fuel|gas|diesel|petrol|gasoline)\b/i;

/**
 * Cross-read additions to the fuel QUALIFYING set. Returns in-window rows
 * from the shipping topic (kinetic chokepoint events) and the energy topic
 * (fuel-to-power continuity failures), syndication-collapsed to one
 * representative per event and de-duplicated against the fuel window the
 * caller already holds. Capped so a heavy syndication week cannot swamp the
 * fuel-topic core of the report.
 */
export function filterFuelContinuityCrossRead(
  incidents: TopicFastFactsIncident[],
  issueDate: string,
  fuelWindow: TopicFastFactsIncident[],
  maxAdds = 8,
): TopicFastFactsIncident[] {
  const keyOf = (i: TopicFastFactsIncident): string =>
    (i.sourceUrl && i.sourceUrl.trim().toLowerCase()) ||
    (i.id != null ? `id:${i.id}` : `t:${i.title.trim().toLowerCase()}`);
  const seen = new Set(fuelWindow.map(keyOf));
  // A shipping/energy rewrite of a story the fuel window ALREADY carries has
  // a different URL/id, so identity keys alone double-count it — seed the
  // syndication collapse with the fuel window's title tokens too.
  const fuelWindowTokens = fuelWindow.map((i) =>
    sigTokens(stripWireCruft(i.title ?? "")),
  );

  const shippingCandidates: TopicFastFactsIncident[] = [];
  for (const i of filterTopicReportIncidents(incidents, "shipping", issueDate)) {
    const hay = `${haystack(i)} ${(i.location ?? "").toLowerCase()}`;
    if (!CHOKEPOINT_NAME_RE.test(hay)) continue;
    if (!CHOKEPOINT_KINETIC_RE.test(hay)) continue;
    shippingCandidates.push(i);
  }
  const energyCandidates: TopicFastFactsIncident[] = [];
  for (const i of filterTopicReportIncidents(incidents, "energy", issueDate)) {
    const hay = haystack(i);
    if (!FUEL_POWER_CONTINUITY_RE.test(hay)) continue;
    // Service guides / explainers ("your complete guide to TNPDCL services",
    // "here's what to know about power cuts") mention outage vocabulary
    // without reporting an event — reject them so they can't consume a slot
    // a real load-shedding report needs.
    if (EXPLAINER_NOISE_RE.test(stripWireCruft(i.title ?? ""))) continue;
    energyCandidates.push(i);
  }

  // Most significant first, then syndication-collapse. Chokepoint strikes
  // arrive as MANY rewrites whose distinctive tokens diverge (casualty
  // nationality vs vessel name vs strait name), so title-token nearDuplicate
  // alone under-collapses them: kinetic events at the SAME chokepoint on the
  // SAME day additionally fold to one representative — a chokepoint watch
  // needs the event once, not each outlet's angle on it. The two source
  // pools are capped separately so a heavy strike week cannot starve the
  // fuel-to-power admits out of the report (or vice versa).
  const collapse = (
    pool: TopicFastFactsIncident[],
    cap: number,
    coarseKey?: (i: TopicFastFactsIncident) => string | null,
  ): TopicFastFactsIncident[] => {
    const ranked = pool.slice().sort((a, b) => compareIncidentSignificance(a, b));
    const kept: TopicFastFactsIncident[] = [];
    const keptTokens: Set<string>[] = [];
    const keptCoarse = new Set<string>();
    for (const i of ranked) {
      const k = keyOf(i);
      if (seen.has(k)) continue;
      const tok = sigTokens(stripWireCruft(i.title ?? ""));
      if (fuelWindowTokens.some((t) => nearDuplicate(tok, t))) continue;
      if (keptTokens.some((t) => nearDuplicate(tok, t))) continue;
      const coarse = coarseKey ? coarseKey(i) : null;
      if (coarse !== null) {
        if (keptCoarse.has(coarse)) continue;
        keptCoarse.add(coarse);
      }
      seen.add(k);
      keptTokens.push(tok);
      kept.push(i);
      if (kept.length >= cap) break;
    }
    return kept;
  };
  const dayOf = (i: TopicFastFactsIncident): string =>
    (i.occurredAt ?? "").slice(0, 10);
  const chokepointDayKey = (i: TopicFastFactsIncident): string | null => {
    const hay = `${haystack(i)} ${(i.location ?? "").toLowerCase()}`;
    let name = CHOKEPOINT_NAME_RE.exec(hay)?.[0] ?? "chokepoint";
    // Canonicalise spelling variants so "Bab el-Mandeb" and "Bab al-Mandab"
    // rewrites of the same strike share one key.
    if (name.startsWith("bab")) name = "bab-el-mandeb";
    if (name.includes("hormuz")) name = "hormuz";
    if (name.includes("gulf") && !name.includes("oman")) name = "persian gulf";
    return `${name}:${dayOf(i)}`;
  };
  const shippingCap = Math.min(4, maxAdds);
  const kept = [
    ...collapse(shippingCandidates, shippingCap, chokepointDayKey),
    ...collapse(energyCandidates, Math.max(0, maxAdds - shippingCap)),
  ];
  return kept;
}

// Fuel-market topical guard for cross-topic action rows. A shipping-topic
// incident is admitted to the Producer/Buyer Actions table ONLY when it
// carries an unambiguous fuel / crude / refined-product / national-oil-
// company signal, so a container-ship, grain or piracy story that happens
// to match a generic action pattern (e.g. a bare "export ban") never leaks.
const FUEL_ACTION_TOPICAL_RE =
  /(?<!\b(?:palm|cooking|vegetable|veg|olive|sunflower|soybean|soy|coconut|mustard|castor|sesame|groundnut|peanut|edible)\s)\b(oil|crude|petroleum|refiner\w*|refined|gasoline|petrol|diesel|jet fuel|kerosene|lpg|naphtha|fuel oil|fuel costs?|fuel prices?|bunker|barrel|barrels|bpd|opec\+?|iea|aramco|adnoc|petrobras|rosneft|gazprom|qatarenergy|pertamina|petronas|cnpc|sinopec|cnooc|ongc|reliance industries|jamnagar)\b/;

// OPEC/IEA supply-demand outlook splits are fuel-market relevant even when
// they are not a producer output action. Used to admit them via the shipping
// cross-read without reopening the door to bare "oil prices jump" wires.
const OPEC_IEA_FORECAST_RE =
  /\b(opec\+?|iea)\b.{0,100}\b(forecast|outlook|disagre\w*|demand outlook|demand forecast|demand estimate|supply outlook)\b|\b(forecast|outlook|demand (forecast|outlook|estimate)|disagre\w*)\b.{0,80}\b(opec\+?|iea)\b/;

// The cross-read from the shipping topic admits genuine actions plus
// OPEC/IEA supply-demand outlook splits. A bare oil-price-movement wire
// ("oil prices jump") is still not a fuel-market development of that kind
// and stays out. Fuel-topic rows keep their full category range.
const CROSS_READ_ACTION_CATEGORIES = new Set<FuelActionCategory>([
  "Producer action",
  "Buyer action",
  "Government / policy action",
  "Infrastructure / routing action",
]);

/**
 * Incident set for the Market and Operator Responses table. It merges the
 * canonical in-window fuel incidents with fuel-market-relevant rows that
 * the ingestion pipeline files under the `shipping` topic (OPEC+ output
 * moves, ADNOC / Aramco / Pertamina tenders, crude-route producer actions,
 * OPEC/IEA outlook splits). Inclusion is material relevance to fuel
 * markets — supply, production, pricing, transport, aviation fuel,
 * distribution, sanctions, disruption or wider market impact — not a
 * requirement that the row be a direct producer action.
 *
 * The cross-read is strictly bounded to the SAME reporting window (both fuel
 * and shipping are weekly, so the window bounds are identical) and requires
 * a fuel-market topical signal plus either a discrete action category or an
 * OPEC/IEA outlook split. Bare "oil prices jump" wires stay out. Every OTHER
 * Fuel Watch section stays on the canonical fuel window, untouched.
 */
export function filterFuelActionIncidents(
  incidents: TopicFastFactsIncident[],
  issueDate: string,
): TopicFastFactsIncident[] {
  const fuelWindow = filterTopicReportIncidents(incidents, "fuel", issueDate);
  const shippingWindow = filterTopicReportIncidents(incidents, "shipping", issueDate);

  const keyOf = (i: TopicFastFactsIncident): string =>
    (i.sourceUrl && i.sourceUrl.trim().toLowerCase()) ||
    (i.id != null ? `id:${i.id}` : "") ||
    `t:${i.title.trim().toLowerCase()}`;

  const seen = new Set<string>();
  const out: TopicFastFactsIncident[] = [];
  for (const i of fuelWindow) {
    const k = keyOf(i);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(i);
  }
  for (const i of shippingWindow) {
    const t = haystack(i);
    if (!FUEL_ACTION_TOPICAL_RE.test(t)) continue;
    const cat = classifyCategory(t);
    if (cat === null) continue;
    const admitMarketOutlook =
      cat === "Market / supply signal" && OPEC_IEA_FORECAST_RE.test(t);
    if (!CROSS_READ_ACTION_CATEGORIES.has(cat) && !admitMarketOutlook) continue;
    const k = keyOf(i);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(i);
  }
  return out;
}

/**
 * Classified producer / buyer / government / infrastructure / market
 * actions referenced in the window. Returns ordered table rows or an
 * empty array when nothing matches.
 */
export function buildFuelProducerBuyerActions(opts: {
  issueDate: string;
  incidents: TopicFastFactsIncident[];
}): ProducerBuyerActionRow[] {
  const window = filterFuelActionIncidents(opts.incidents, opts.issueDate);
  if (window.length === 0) return [];

  const raw: (ProducerBuyerActionRow & { tokens: Set<string> })[] = [];
  const seen = new Set<string>();
  for (const i of window) {
    const t = haystack(i);
    if (isStatementOnlyHeadline(t)) continue;
    if (isCommentaryOnlyHeadline(t)) continue;
    if (isVictimProducerIncidentHeadline(t)) continue;
    const category = classifyCategory(t);
    if (!category) continue;
    // Action cell: WHO/WHAT from the headline (conservatively sentence-
    // cased so it reads as a statement, not a news headline), WHERE
    // appended from the incident's country stamp when the text itself
    // does not carry it. WHEN is the date line under the cell.
    const headline = normalizeFuelHeadline(i.title.trim().replace(/\.$/, ""));
    const action = capitalizeFirst(
      summarizeFuelDevelopmentClause({
        title: headline,
        summary: i.summary,
        country: i.country,
        location: i.location,
      }),
    );
    if (isGenericPolicyAction(action)) continue;
    const dedupeKey = headline.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    const actionNorm = bulletNormKey(action);
    if (seen.has(`action:${actionNorm}`)) continue;
    // Supplier-pivot story-key collapse: syndicated rewrites of one buyer
    // pivot share too few distinctive tokens for the near-duplicate guard, but
    // one buyer pivoting on one product in one window is ONE action.
    if (
      category === "Buyer action" &&
      (SUPPLIER_PIVOT_RES.some((re) => re.test(t))
        || (/\bturn(?:s|ed|ing)? to\b/.test(t) && PIVOT_PRODUCT_RE.test(t)))
    ) {
      const product = PIVOT_PRODUCT_RE.exec(t)?.[1] ?? "";
      const subject = /\b(russia|russian)\b/.test(t)
        ? "russia"
        : /\b(pakistan)\b/.test(t)
          ? "pakistan"
          : sigTokens(action).values().next().value ?? "";
      const pivotKey = `pivot:${subject}:${product}`;
      if (seen.has(pivotKey)) continue;
      seen.add(pivotKey);
    }
    // Reroute story-key collapse: syndicated copies of one corridor's
    // rerouting development describe the SAME operational development
    // even when the headlines share few distinctive tokens ("Two Saudi
    // Oil Tankers Reroute…Suez" vs "Asian refineries reroute Saudi oil
    // imports via the Suez Canal"). One corridor, one window — one row.
    if (
      category === "Infrastructure / routing action" &&
      /\b(reroute|rerouting|rerouted|bypass(?:ing)?)\b/.test(t)
    ) {
      const corridor = detectRerouteCorridor(t);
      if (corridor) {
        const rerouteKey = `reroute:${corridor}`;
        if (seen.has(rerouteKey)) continue;
        seen.add(rerouteKey);
      }
    }
    // Near-duplicate guard: collapse syndicated re-writes of the same
    // story within a category (e.g. the ADNOC / UAE Hormuz-bypass
    // pipeline reported under several different headlines) so the table
    // never lists the same action twice.
    const tokens = sigTokens(action);
    const actor = pickActor(i, category);
    if (raw.some((r) => r.category === category && r.actor === actor && nearDuplicate(tokens, r.tokens))) {
      continue;
    }
    seen.add(dedupeKey);
    seen.add(`action:${actionNorm}`);
    raw.push({
      actor,
      category,
      action,
      operationalRead: deriveOperationalRead(t, category),
      date: fmtDate(i.occurredAt),
      tokens,
    });
  }
  if (raw.length === 0) return [];

  const actorsWithSpecificPolicy = new Set(
    raw
      .filter(
        (r) =>
          r.category === "Government / policy action" &&
          !isGenericPolicyAction(r.action),
      )
      .map((r) => r.actor.toLowerCase()),
  );
  const filtered = raw.filter((r) => {
    if (r.category !== "Government / policy action") return true;
    if (!isGenericPolicyAction(r.action)) return true;
    return !actorsWithSpecificPolicy.has(r.actor.toLowerCase());
  });

  // Group by category in the priority order so the strongest signals
  // (Producer / Buyer / Government) lead the table. Cap to PER_CATEGORY
  // rows per category and TOTAL_CAP rows overall — fewer, better rows
  // beat a long list padded with generic entries.
  const ORDER: FuelActionCategory[] = [
    "Producer action",
    "Buyer action",
    "Government / policy action",
    "Infrastructure / routing action",
    "Market / supply signal",
  ];
  const PER_CATEGORY = 3;
  // Up to 8 rows overall. During an active fuel crisis the window carries
  // many genuine producer/buyer/government actions, so a 4-row cap read as
  // sparse; 8 captures the breadth while the PDF exporter's pre-measured
  // keep-together logic paginates the block cleanly (no orphaned rows).
  const TOTAL_CAP = 8;
  const out: ProducerBuyerActionRow[] = [];
  for (const cat of ORDER) {
    const items = filtered.filter((r) => r.category === cat).slice(0, PER_CATEGORY);
    for (const r of items) {
      if (out.length >= TOTAL_CAP) break;
      // Drop the internal token set from the emitted row.
      out.push({
        actor: r.actor,
        category: r.category,
        action: r.action,
        operationalRead: r.operationalRead,
        date: r.date,
      });
    }
    if (out.length >= TOTAL_CAP) break;
  }
  return out;
}

/**
 * Operational Read — translates the in-window incident picture into a
 * short prose section (1-2 paragraphs). Aggregates by issue family so
 * the section never repeats the Related Incidents table.
 */
export function buildFuelOperationalRead(opts: {
  issueDate: string;
  incidents: TopicFastFactsIncident[];
  /** When supplied, used directly instead of re-filtering the incident feed. */
  window?: TopicFastFactsIncident[];
}): string | null {
  const window = opts.window ?? filterTopicReportIncidents(opts.incidents, "fuel", opts.issueDate);
  if (window.length === 0) return null;

  const counts = new Map<IssueFamily["key"], { fam: IssueFamily; items: TopicFastFactsIncident[] }>();
  for (const i of window) {
    const t = haystack(i);
    for (const fam of ISSUE_FAMILIES) {
      if (fam.test.some((re) => re.test(t))) {
        const slot = counts.get(fam.key) ?? { fam, items: [] };
        slot.items.push(i);
        counts.set(fam.key, slot);
        break;
      }
    }
  }
  if (counts.size === 0) {
    // We have window items but none mapped to a recognised family. Say
    // so plainly rather than padding with generic language.
    return "Fuel-related developments this week do not point to a single dominant theme. Treat the picture as provisional until availability, routing and policy effects firm up.";
  }

  // Geography roll-up for the closing line — significance-based, not volume.
  const byCountry = new Map<string, TopicFastFactsIncident[]>();
  for (const i of window) {
    const k = incidentCountry(i);
    if (!k) continue;
    byCountry.set(k, [...(byCountry.get(k) ?? []), i]);
  }

  const ordered = Array.from(counts.values()).sort(
    (a, b) =>
      aggregateIncidentSignificance(b.items) - aggregateIncidentSignificance(a.items),
  );

  const themeLine = ordered
    .slice(0, 3)
    .map(({ fam }) => fam.phrase)
    .join("; ");

  const lead = ordered[0];
  // Use `opMeaning` here, not `why` — `why` is already used verbatim in
  // Regional Highlights and we don't want the same sentence in two
  // adjacent sections.
  const driverPara = `The main themes right now are ${themeLine}. ${lead.fam.opMeaning}`;

  const watchLines: string[] = [];
  for (const { fam } of ordered.slice(0, 2)) watchLines.push(fam.watch);

  // Name geographies only when significance is material — never rank by
  // raw record volume ("carries N records" / "most activity this week").
  const sigCountries = Array.from(byCountry.entries())
    .filter(([, items]) => aggregateIncidentSignificance(items) >= 4)
    .sort((a, b) => aggregateIncidentSignificance(b[1]) - aggregateIncidentSignificance(a[1]))
    .slice(0, 3)
    .map(([c]) => titleCase(c));
  const where =
    sigCountries.length > 0
      ? ` Physical restrictions are most visible in ${joinWithAnd(sigCountries)}.`
      : "";

  const closingPara = `${watchLines.join(" ")}${where}`.trim();

  return `${driverPara}\n\n${closingPara}`;
}

// ---------------------------------------------------------------------------
// Bullet-section minimums (Watch Next / Implications for Business)
//
// The Fuel Watch "Watch Next" and "Implications for Business" sections render
// as bullet lists. When an analyst saves a thin report (one or two bullets)
// the section reads as an afterthought, so we top each list up to a minimum
// with evergreen, fuel-relevant defaults. Stored bullets always lead; the
// defaults only fill the gap up to the minimum and never beyond the cap.
// ---------------------------------------------------------------------------

export const FUEL_DEFAULT_WATCH_NEXT: string[] = [
  "Subsidy or levy decisions — a single gazette notice can reset pump price and contract economics overnight.",
  "Rationing or forecourt disruption — queue formation, allocation cuts or station closures are the fastest operational tells.",
  "Refinery outages or force-majeure declarations — these feed into crack spreads and downstream pricing within days.",
  "Tanker and route disruption — fresh Gulf, Hormuz or Red Sea advisories, naval movement or vessel reroutes shift war-risk premium and transit time.",
  "Generator fuel availability — diesel and LPG stock cover at high-fuel-use sites is the continuity tell when forecourts tighten.",
];

export const FUEL_DEFAULT_IMPLICATIONS: string[] = [
  "Revisit contract pricing on bulk fuel and surcharge pass-through clauses in freight and logistics agreements before the next billing cycle reprices them.",
  "Forward-cover the bulk and aviation fuel lines you depend on rather than waiting for the spot move to be confirmed.",
  "Check on-site fuel stock cover and generator runtime assumptions, and pull commercial-allocation conversations forward with suppliers.",
  "Agree escalation triggers in advance — queues, allocation cuts, station closures — so mitigations fire automatically rather than after the fact.",
  "Where Gulf or Red Sea routing matters, treat route diversification as a live mitigation, not a future option.",
];

function bulletNormKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w.length > 2 && !DEDUPE_STOP.has(w))
    .slice(0, 6)
    .join(" ");
}

/** Split stored bullet/prose text into discrete items, tolerant of
 *  "- "/"*"/"•" markers, blank-line paragraphs, or single-newline lists. */
function splitStoredBullets(text: string | null | undefined): string[] {
  const s = (text ?? "").trim();
  if (!s) return [];
  const lines = s.split(/\r?\n/).map((l) => l.trim());
  const marked = lines
    .filter((l) => /^[-*\u2022]\s+/.test(l))
    .map((l) => l.replace(/^[-*\u2022]\s+/, "").trim())
    .filter(Boolean);
  if (marked.length > 0) return marked;
  const byBlank = s.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (byBlank.length > 1) return byBlank;
  return lines.filter(Boolean);
}

/**
 * Return a "- " bulleted block built from the stored text, topped up with
 * fuel-relevant defaults until it holds at least `min` items (never more
 * than `max`). Stored items lead and are de-duplicated against the defaults.
 */
export function topUpFuelBullets(
  stored: string | null | undefined,
  defaults: string[],
  min: number,
  max: number,
): string {
  const items: string[] = [];
  const keys = new Set<string>();
  const tokenSets: Set<string>[] = [];
  // Accept a candidate only if it is neither an exact normalised duplicate
  // nor a near-duplicate (heavy token overlap) of anything already kept.
  const tryAdd = (candidate: string): void => {
    if (items.length >= max) return;
    const c = candidate.trim();
    if (!c) return;
    const k = bulletNormKey(c);
    if (k && keys.has(k)) return;
    const toks = sigTokens(c);
    if (tokenSets.some((t) => nearDuplicate(toks, t))) return;
    items.push(c);
    if (k) keys.add(k);
    tokenSets.push(toks);
  };
  for (const s of splitStoredBullets(stored)) tryAdd(s);
  for (const d of defaults) {
    if (items.length >= min) break;
    tryAdd(d);
  }
  return items.map((b) => `- ${b}`).join("\n");
}

// ---------------------------------------------------------------------------
// Fuel severity normalisation
//
// EXTREME (the reserved subdued-red tier) is restricted to casualty-grade or
// emergency events. A lot of imported Fuel Watch records are pure market /
// price / policy / forecast signals (e.g. "StanChart Says Record SPR
// Withdrawals…") that were stored as "extreme", which is wrong for a market
// indicator. capFuelMarketSeverity downgrades those to "moderate" while
// leaving genuine physical disruptions (shutdown, attack, fire, blockade…)
// and any casualty-bearing record untouched.
// ---------------------------------------------------------------------------

const SEV_RANK: Record<string, number> = {
  insignificant: 1, low: 2, moderate: 3, high: 4, extreme: 5,
};
const FUEL_CASUALTY_RE =
  /\b(killed|dead|deaths?|died|fatal(it(y|ies))?|casualt(y|ies)|injur(y|ies|ed)|wounded|massacre|martial law|state of emergency|hostage|kidnap(ped|ping)?)\b/i;
/** Fuel availability, pricing or continuity signals — severity must track these. */
export const FUEL_CONTINUITY_RE =
  /\b(ration|rationing|shortage|queues?|forecourt|pump price|availability|supply cut|load[- ]shedding|export ban|import ban|allocation|curfew|diesel|petrol|gasoline|gasoil|kerosene|lpg|jet fuel|refinery|pipeline|depot|terminal|bunker|fuel crisis|fuel shortage)\b/i;
const FUEL_MARITIME_ONLY_RE =
  /\b(vessel|tanker|ship|maritime|crew|sailor|seafarer|seafaring|red sea|bab[- ]el[- ]mandeb|bab al[- ]mandab|strait of hormuz|\bhormuz\b)\b/i;
// DIRECT operational disruption only — physical events that have actually
// occurred and impede fuel production, movement or supply. A market/price/
// policy headline that merely "warns" of or comments on these has no such
// keyword (or is caught by the speculative guard below) and is downgraded.
// Note: the over-broad "disruption" token is deliberately NOT here — it
// matches market/supply commentary ("supply disruption could lift prices")
// rather than a concrete physical event.
const FUEL_OPERATIONAL_RE =
  /\b(shutdown|shut down|closure|closed|attack(ed|ing)?|drone|missile|rocket|blockade[d]?|seizure|seized|sabotage[d]?|fire|explosion|blast|outage|halt(ed)?|strike|walkout|spill|leak|derail(ed|ment)?|ambush|raid(ed)?|hijack(ed)?|damaged|destroyed)\b/i;
// Speculative / commentary / policy-warning framing. When a record is phrased
// as a warning, forecast, risk or proposal rather than a concrete event, it is
// market commentary or policy signalling — NOT an "extreme"/"high" operational
// disruption — even if it name-drops an operational word ("strike could worsen
// markets", "warns supply may halt"). Casualty records bypass this guard.
const FUEL_SPECULATIVE_RE =
  /\b(warn(s|ed|ing)?|could|may|might|likely|risk(s|ing)?|threat(en(s|ed|ing)?)?|fear(s|ed)?|set to|expected to|forecast(s|ed)?|outlook|propos(e|ed|al|als)|plan(s|ned)? to|weigh(s|ed)?|mull(s|ed)?|eye(s|ing)?|consider(s|ing)?|sceptic|skeptic|postpone)\b/i;

/**
 * Cap a fuel incident's severity at "moderate" UNLESS it reports a concrete,
 * already-occurred operational disruption or carries casualties. Market
 * commentary, price moves, policy/levy warnings, forecasts and "could/may"
 * speculation are NOT "extreme"/"high" by default — they are downgraded, even
 * when they mention an operational word in passing. Only downgrades (never
 * raises) and only touches "high"/"extreme".
 */
export function capFuelMarketSeverity(
  severity: string | null | undefined,
  title: string,
  summary: string,
): string {
  const sev = (severity ?? "").toLowerCase();
  if ((SEV_RANK[sev] ?? 0) <= SEV_RANK.moderate) return severity ?? "";
  const hay = `${title}\n${summary}`;
  // Casualties keep the elevated rating only when they bear on fuel
  // availability, pricing or continuity — bare maritime crew fatalities
  // must not drive an Extreme market-watch call on their own.
  if (FUEL_CASUALTY_RE.test(hay)) {
    if (FUEL_MARITIME_ONLY_RE.test(hay) && !FUEL_CONTINUITY_RE.test(hay)) {
      return "moderate";
    }
    return severity ?? "";
  }
  // Warning / forecast / policy-proposal framing is commentary → downgrade.
  if (FUEL_SPECULATIVE_RE.test(hay)) return "moderate";
  // Bare maritime kinetic reporting (missile on a vessel, naval landing ship)
  // without fuel infrastructure, cargo or continuity language is NOT a fuel-
  // market severity driver — cap at moderate.
  const FUEL_FUEL_INFRA_RE =
    /\b(refinery|pipeline|terminal|depot|bunker|fuel cargo|oil export|crude export|gasoline|diesel|jet fuel|fuel shortage|fuel ration|forecourt|pump|load[- ]shedding|oil tanker|fuel tanker|lpg tanker|tanker transit|\btanker\b)\b/i;
  if (
    FUEL_MARITIME_ONLY_RE.test(hay) &&
    !FUEL_CONTINUITY_RE.test(hay) &&
    !FUEL_FUEL_INFRA_RE.test(hay)
  ) {
    return "moderate";
  }
  // A concrete physical disruption keeps the elevated rating.
  if (FUEL_OPERATIONAL_RE.test(hay)) return severity ?? "";
  // Shortage, rationing and availability signals keep elevated severity.
  if (FUEL_CONTINUITY_RE.test(hay)) return severity ?? "";
  // Everything else (pure market/price/policy signal) → downgrade.
  return "moderate";
}

// ---------------------------------------------------------------------------
// Fuel Watch analytical prose — count-free, headline-free narrative sections
// derived from canonical facts and the qualifying incident set.
// ---------------------------------------------------------------------------

const PROSE_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function proseDay(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${parseInt(m[3], 10)} ${PROSE_MONTHS[parseInt(m[2], 10) - 1]} ${m[1]}`;
}

function directionPhrase(direction: FuelDirection): string {
  switch (direction) {
    case "rising": return "rose over the week";
    case "falling": return "fell over the week";
    case "broadly stable": return "moved only marginally";
    case "unchanged": return "held flat";
  }
}

function pctClause(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return "";
  const sign = pct >= 0 ? "+" : "";
  return ` (${sign}${pct.toFixed(1)}% over the week)`;
}

function marketPriceParagraph(facts: FuelCanonicalFacts): string {
  const lines = facts.marketIndicators.slice(0, 3).map((i) => {
    const dir = directionPhrase(i.direction);
    return `${i.label} ${dir}${pctClause(i.percentageChange)}`;
  });
  if (!lines.length) {
    return "Market price observations were not supplied for this period; treat cost exposure from the prior week as unchanged until fresh quotes land.";
  }
  return `The principal market move is on crude and aviation fuel: ${lines.join("; ")}.`;
}

function incidentsHaystack(incidents: CanonicalFuelIncident[]): string {
  return incidents.map((i) => `${i.title} ${i.raw.summary ?? ""}`).join(" ").toLowerCase();
}

function hasPattern(hay: string, res: RegExp[]): boolean {
  return res.some((re) => re.test(hay));
}

function physicalSupplyParagraph(facts: FuelCanonicalFacts): string {
  const hay = incidentsHaystack(facts.qualifyingIncidents);
  if (facts.qualifyingIncidents.length === 0) {
    return "No confirmed physical supply or distribution disruption was logged in the reporting window; cost pressure, if any, is market-led rather than availability-led.";
  }
  if (hasPattern(hay, ISSUE_FAMILIES.find((f) => f.key === "shortage")!.test)) {
    return "The most important physical issue is availability: rationing, forecourt limits or depot shortfalls are restricting access in at least one market, not just raising the posted price.";
  }
  if (hasPattern(hay, ISSUE_FAMILIES.find((f) => f.key === "refinery")!.test)) {
    return "Refinery or production disruption is the main physical constraint, tightening regional product balances and feeding into crack spreads and downstream pump pressure.";
  }
  if (hasPattern(hay, ISSUE_FAMILIES.find((f) => f.key === "chokepoint")!.test)) {
    return "Route and chokepoint pressure is the dominant physical story: dependent flows are facing longer transit, higher war-risk premium or intermittent disruption even where barrels are still available.";
  }
  if (hasPattern(hay, ISSUE_FAMILIES.find((f) => f.key === "tanker")!.test)) {
    return "Inland distribution is the binding constraint: tanker, convoy or driver disruption is delaying delivery to depots and forecourts despite wholesale supply appearing adequate on paper.";
  }
  const label = facts.primaryPressurePoint.kind === "distributed"
    ? "several theatres"
    : facts.primaryPressurePoint.label;
  return `Operational stress is concentrated around ${label}, where confirmed developments point to tighter availability or costlier delivery rather than a purely paper-market move.`;
}

function responseParagraph(facts: FuelCanonicalFacts): string {
  const hay = incidentsHaystack(facts.qualifyingIncidents);
  const parts: string[] = [];
  if (hasPattern(hay, ISSUE_FAMILIES.find((f) => f.key === "policy")!.test)) {
    parts.push("governments moved on duties, subsidies, rationing rules or price controls");
  }
  if (/\b(aramco|adnoc|saudi|opec|iea|india|reliance|ongc|petronas)\b/.test(hay)
      && /\b(load|loading|export|import|ship|shipment|supply|output|cut|resume|resumed|tender|contract)\b/.test(hay)) {
    parts.push("producers and major buyers adjusted export, import or loading posture");
  }
  if (/\b(airline|airways|indigo|carrier)\b/.test(hay)
      && /\b(jet fuel|fuel cost|surcharge|capacity|flight)\b/.test(hay)) {
    parts.push("airline operators responded to jet-fuel cost pressure through capacity or surcharge moves");
  }
  if (!parts.length) {
    return "No single producer, government or buyer intervention clearly dominated the week; the market and routing backdrop is doing most of the work.";
  }
  return `The most significant responses came where ${joinWithAnd(parts)} — resetting local economics and contract pass-through assumptions for the next cycle.`;
}

function businessContinuityParagraph(facts: FuelCanonicalFacts): string {
  const rising = facts.marketIndicators.some((i) => i.direction === "rising");
  const falling = facts.marketIndicators.some((i) => i.direction === "falling");
  const hay = incidentsHaystack(facts.qualifyingIncidents);
  const physical = hasPattern(hay, ISSUE_FAMILIES.find((f) => f.key === "shortage")!.test)
    || hasPattern(hay, ISSUE_FAMILIES.find((f) => f.key === "refinery")!.test);
  const route = hasPattern(hay, ISSUE_FAMILIES.find((f) => f.key === "chokepoint")!.test);
  const costBit = rising && !falling
    ? "Fuel-linked invoices, freight surcharges and generator running costs should be budgeted for further pressure."
    : falling && !rising
      ? "There is near-term relief on the cost line, but the move can reverse quickly while route and availability risks remain live."
      : "Cost exposure is broadly stable for now, but physical or routing shocks can reprice contracts with little notice.";
  const opsBit = physical
    ? "Road transport, backup power and commercial allocation are the immediate continuity exposures where rationing or refinery curtailment persists."
    : route
      ? "Transport and bunker-dependent operations face the clearest continuity risk through rerouting, delay and war-risk premium on affected corridors."
      : "Continuity risk is mainly on cost pass-through rather than physical stock-outs this week.";
  return `${costBit} ${opsBit}`;
}

function normalizeFuelHeadline(title: string): string {
  return stripWireCruft(title)
    .replace(/\s*\|\s*(Videos?|Photos?|Live updates?|Breaking news?)\s*$/i, "")
    .replace(/\s*[—–-]\s*(Reuters|Bloomberg|AFP|AP|BBC|CNN|Al Jazeera|World in Brief).*$/i, "")
    .replace(/:\s*Inside .+?(?:crisis|shortage|rationing).+$/i, "")
    .replace(/\b(?:crisis|shortage|rationing)\s+\d{4}\b/gi, "")
    .replace(/\b(videos?|photos?|live updates?|breaking:?)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

interface FuelDevelopmentInput {
  title: string;
  summary?: string | null;
  country?: string | null;
  location?: string | null;
  routeOrChokepoint?: string | null;
}

function developmentHaystack(opts: FuelDevelopmentInput): string {
  return [opts.title ?? "", opts.summary ?? ""].join(" ").toLowerCase();
}

function capitalizeFirst(text: string): string {
  const s = text.trim();
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function lowercaseLeadClause(text: string): string {
  const s = text.trim();
  if (!s) return s;
  const m = s.match(/^([A-Za-z0-9][A-Za-z0-9'’-]*)([\s\S]*)$/);
  if (!m) return s;
  const lead = m[1];
  if (/^[A-Z0-9]{2,}$/.test(lead)) return `${lead}${m[2]}`;
  return `${lead.charAt(0).toLowerCase()}${lead.slice(1)}${m[2]}`;
}

function declarativeFromHeadline(cleanTitle: string): string {
  let text = cleanTitle.replace(/\.$/, "").replace(/['"].*?['"]/g, "").replace(/\s+/g, " ").trim();
  if (!text) return "a confirmed fuel-market development was reported";
  text = sentenceCaseHeadline(text).replace(/:\s*Inside .+$/i, "").trim();
  return lowercaseLeadClause(text);
}

function headlineNamesGeography(title: string): boolean {
  const words = sentenceCaseHeadline(normalizeFuelHeadline(title)).split(/\s+/);
  return words.some((w, idx) => {
    if (!/^[A-Z]/.test(w)) return false;
    if (idx === 0) return !SENTENCE_LOWER.has(w.toLowerCase().replace(/[^a-z']/g, ""));
    return true;
  });
}

function optionalCountryHint(opts: FuelDevelopmentInput): string {
  const c = (opts.country ?? "").trim();
  if (!c || /^unknown$/i.test(c)) return "";
  if (headlineNamesGeography(opts.title)) return "";
  return ` in ${c}`;
}

/** Operational clause for What Happened and the Market/Operator table — never a raw headline. */
export function summarizeFuelDevelopmentClause(opts: FuelDevelopmentInput): string {
  const t = developmentHaystack(opts);
  if (/\b(india|indian)\b/.test(t) && /\b(gasoline|petrol)\b/.test(t) && /\b(russia|russian)\b/.test(t)
      && /\b(fail(?:s|ed)?|does not|did not|unable to|fails to)\b/.test(t)) {
    return "Indian gasoline shipments failed to ease Russia's domestic shortage, leaving availability tight in affected regions";
  }
  if (/\b(russia|russian)\b/.test(t) && PIVOT_PRODUCT_RE.test(t)
      && (/\b(india|indian)\b/.test(t) || /\bseek(?:s|ing)?\b/.test(t) || /\bturn(?:s|ed|ing)? to\b/.test(t))) {
    return "Russia pivoted to Indian gasoline imports as domestic refinery damage tightened supply";
  }
  if (/\b(pakistan)\b/.test(t) && /\b(kuwait)\b/.test(t) && PIVOT_PRODUCT_RE.test(t)) {
    return "Pakistan pivoted to Kuwaiti diesel imports as domestic supply tightened";
  }
  if (/\b(india|indian)\b/.test(t) && /\b(gasoline|petrol)\b/.test(t) && /\b(russia|russian)\b/.test(t)) {
    return "Indian gasoline shipments to Russia continued as Moscow's domestic shortage persisted";
  }
  if (SUPPLIER_PIVOT_RES.some((re) => re.test(t))
      || (/\bturn(?:s|ed|ing)? to\b/.test(t) && PIVOT_PRODUCT_RE.test(t))) {
    return "a buyer pivoted import sourcing for refined products as domestic supply tightened";
  }
  if (/\bexport ban\b/.test(t)) {
    const product = /\bdiesel\b/.test(t) ? "diesel" : /\b(petrol|gasoline)\b/.test(t) ? "petrol" : "fuel";
    return `authorities ordered a ${product} export ban${optionalCountryHint(opts)} amid tightening domestic supply`;
  }
  if (/\b(red sea|houthi)\b/.test(t) && /\b(missile|attack|killed|seafarer|crew|bodies)\b/.test(t)
      && !/\bexit(ing)?\s+(the\s+)?strait of hormuz\b/.test(t)) {
    return "a missile attack in the Red Sea killed seafarers on a commercial vessel, separate from Hormuz transit incidents";
  }
  if (/\b(bulker|tanker|vessel|ship)\b/.test(t) && /\b(attack|struck|killed|engineer)\b/.test(t)
      && /\b(strait of hormuz|\bhormuz\b)\b/.test(t)) {
    return "a commercial vessel was attacked while transiting the Strait of Hormuz, killing crew and disrupting passage";
  }
  if (/\b(adnoc)\b/.test(t) && /\b(vessel|attack|struck|hormuz)\b/.test(t)) {
    return "an ADNOC-linked vessel was attacked in the Strait of Hormuz without reported injuries";
  }
  if (/\b(jazan)\b/.test(t) && /\b(refinery|attack|drone|missile|strike)\b/.test(t)) {
    return "a claimed attack targeted the Jazan refinery, raising product-output risk in Saudi Arabia";
  }
  if (/\b(aramco|saudi aramco)\b/.test(t) && /\b(resume|resumed|loading|load|export)\b/.test(t)
      && !/\b(attack|drone|strike|destroyed|claim)\b/.test(t)) {
    return "Saudi Aramco resumed crude loading and export activity after earlier Gulf-route disruption";
  }
  if (/\b(aramco|saudi aramco)\b/.test(t) && /\b(attack|drone|strike|destroyed|claim)\b/.test(t)) {
    return "reporting described a claimed drone strike on Saudi Aramco infrastructure, with operational impact still being assessed";
  }
  if (/\b(moscow|ration|rationing)\b/.test(t) && /\b(petrol|gasoline|fuel|forecourt|purchase limit)\b/.test(t)) {
    return "Moscow tightened petrol purchase limits and rationing as forecourt shortages spread";
  }
  if (/\b(russia)\b/.test(t) && /\b(shortage|fuel crisis)\b/.test(t)
      && /\b(region|spread|nationwide|33)\b/.test(t)) {
    return "Russia's domestic fuel shortage spread across multiple regions after refinery strikes and distribution strain";
  }
  if (/\b(russia|belarus|naftan)\b/.test(t) && /\b(refinery|maintenance|outage)\b/.test(t)
      && /\b(shortage|september|fuel)\b/.test(t)) {
    return "Russia faced renewed petrol pressure as Belarusian refinery maintenance tightened regional product supply";
  }
  if (/\b(india|indian)\b/.test(t) && /\b(windfall tax|export duty|export tax|excise|levy)\b/.test(t)
      && /\b(petrol|diesel|aviation|jet)\b/.test(t)) {
    return "India cut windfall taxes on petrol, diesel and aviation-fuel exports, resetting refiner export economics";
  }
  if (/\b(jet fuel|aviation fuel)\b/.test(t) && /\b(airline|airfare|carrier|surge|costs?|prices?)\b/.test(t)) {
    return "aviation operators faced sustained jet-fuel cost pressure feeding into fares and surcharge negotiations";
  }
  if (/\b(trump|sanction|blockade)\b/.test(t) && /\b(hormuz|iran)\b/.test(t)) {
    return "reporting flagged potential Iran sanctions and continued naval pressure in the Strait of Hormuz without a confirmed closure";
  }
  if (/\b(reroute|rerouting|rerouted|bypass)\b/.test(t)
      && /\b(red sea|suez|hormuz|canal|corridor|malacca|panama)\b/.test(t)) {
    if (/\b(hormuz)\b/.test(t) && !/\b(red sea|suez)\b/.test(t)) {
      return "operators rerouted cargoes away from Hormuz to reduce transit risk";
    }
    if (/\b(saudi|asian refineries|tankers?)\b/.test(t) && /\b(red sea|suez)\b/.test(t)) {
      return "Asian refineries rerouted Saudi oil imports via the Suez corridor to avoid Red Sea delay";
    }
    if (/\b(red sea|suez)\b/.test(t)) {
      return "operators rerouted cargoes via the Red Sea–Suez corridor to avoid chokepoint delay";
    }
    if (/\b(malacca)\b/.test(t)) {
      return "operators rerouted cargoes away from the Strait of Malacca to reduce transit risk";
    }
    return "operators rerouted fuel cargoes via alternative corridors to avoid chokepoint delay";
  }
  if (/\b(ration|rationing|forecourt|purchase limit)\b/.test(t)) {
    return "authorities imposed or extended fuel rationing and forecourt purchase limits";
  }
  if (/\b(export ban|import ban|windfall|subsidy|duty|levy)\b/.test(t)
      && hasSpecificPolicySignal(t)) {
    return `government policy on fuel duties or trade controls changed${optionalCountryHint(opts)}, resetting local price assumptions`;
  }
  if (/\b(refiner margins|crack spread)\b/.test(t)) {
    return "refiner margins moved sharply, corroborating tight refined-product supply rather than signalling a fresh operational change on their own";
  }
  if (/\b(refinery|pipeline|terminal)\b/.test(t)
      && /\b(outage|fire|attack|maintenance|shutdown|halt)\b/.test(t)) {
    return "refinery or terminal disruption curtailed regional product output";
  }
  if (/\b(hormuz|red sea|bab[- ]el)\b/.test(t) && /\b(attack|disrupt|closure|blockade)\b/.test(t)) {
    return "chokepoint disruption raised war-risk premium and transit delay on affected fuel routes";
  }
  return declarativeFromHeadline(normalizeFuelHeadline(opts.title));
}

function eventLocationForProse(i: CanonicalFuelIncident): string | null {
  const t = developmentHaystack({
    title: i.title,
    summary: i.raw.summary,
    country: i.country,
    location: i.physicalLocation,
    routeOrChokepoint: i.routeOrChokepoint,
  });
  if (/\b(moscow)\b/.test(t)) return "Moscow";
  if (/\b(jazan)\b/.test(t)) return "Jazan, Saudi Arabia";
  if (/\b(red sea|houthi|mokha|yemen)\b/.test(t) && !/\bexit(ing)?\s+(the\s+)?strait of hormuz\b/.test(t)) {
    return "the Red Sea";
  }
  if (/\b(strait of hormuz|\bhormuz\b)\b/.test(t)) return "the Strait of Hormuz";
  if (/\b(russia|moscow)\b/.test(t) && /\b(shortage|ration|refinery|fuel|petrol|gasoline)\b/.test(t)) {
    return "Russia";
  }
  if (/\b(india|indian)\b/.test(t) && /\b(windfall|duty|tax|levy|export ban|subsidy)\b/.test(t)) {
    return "India";
  }
  if (/\b(india|indian)\b/.test(t) && /\b(gasoline|petrol)\b/.test(t) && /\b(russia|russian)\b/.test(t)) {
    return "Russia";
  }
  if (i.physicalLocation && !/^terminal \d+/i.test(i.physicalLocation)) return i.physicalLocation;
  if (i.routeOrChokepoint) {
    const r = i.routeOrChokepoint;
    return /^(Strait|Red|Suez|Bab|Persian|Gulf)/i.test(r) ? r : i.routeOrChokepoint;
  }
  const stamped = i.country;
  if (stamped && !/^unknown$/i.test(stamped)) {
    if (stamped.toLowerCase() === "ukraine"
        && /\b(india|russia|gasoline|petrol|moscow)\b/.test(t)) {
      return null;
    }
    return stamped;
  }
  return null;
}

function businessImpactForDevelopment(i: CanonicalFuelIncident): string {
  const t = developmentHaystack({
    title: i.title,
    summary: i.raw.summary,
    country: i.country,
    location: i.physicalLocation,
    routeOrChokepoint: i.routeOrChokepoint,
  });
  if (/\b(moscow|ration|rationing)\b/.test(t) && /\b(russia|petrol|gasoline)\b/.test(t)) {
    return "Forecourt rationing puts road transport and commercial allocation ahead of pump-price moves for any Russia-exposed operation.";
  }
  if (/\b(russia)\b/.test(t) && /\b(shortage|refinery|maintenance|belarus|naftan)\b/.test(t)) {
    return "Domestic product tightness raises the risk that export cuts or allocation limits reach commercial buyers before published pump prices move.";
  }
  if (/\b(india|indian)\b/.test(t) && /\b(windfall|duty|tax|levy)\b/.test(t)) {
    return "Duty changes reset export economics for Indian refiners and any contract indexed to sub-continent product benchmarks.";
  }
  if (/\b(india|indian)\b/.test(t) && /\b(gasoline|petrol)\b/.test(t) && /\b(russia|russian)\b/.test(t)) {
    return "Cross-border gasoline flows shift who supplies Russia's shortage, affecting landed cost for buyers still lifting Russian product.";
  }
  if (/\b(aramco|saudi)\b/.test(t) && /\b(resume|loading|export)\b/.test(t)) {
    return "Resumed Saudi loading eases immediate crude availability but leaves Gulf route risk priced into differentials.";
  }
  if (/\b(jazan)\b/.test(t) && /\b(refinery|attack)\b/.test(t)) {
    return "Product output risk at a Saudi refinery feeds straight into regional gasoline and jet balances.";
  }
  if (/\b(red sea|houthi)\b/.test(t) && /\b(attack|missile|killed)\b/.test(t)) {
    return "Red Sea kinetic reporting keeps Suez–Red Sea route economics elevated for bunker and product cargoes.";
  }
  if (/\b(hormuz)\b/.test(t) && /\b(attack|vessel|blockade|sanction)\b/.test(t)) {
    return "Hormuz transit pressure lifts war-risk premium and delays tanker movement even when barrels remain available elsewhere.";
  }
  if (/\b(jet fuel|aviation fuel|airline)\b/.test(t)) {
    return "Jet-fuel cost pressure flows to aviation surcharges and route profitability within the next operating month.";
  }
  const fam = ISSUE_FAMILIES.find((f) => f.test.some((re) => re.test(t)));
  return fam?.opMeaning
    ?? "This feeds into landed cost, delivery timing or local availability for dependent operations.";
}

function normalizeDevelopmentText(title: string): string {
  return normalizeFuelHeadline(title);
}

function locationAlreadyInClause(clause: string, where: string): boolean {
  const c = clause.toLowerCase();
  const w = where.toLowerCase();
  if (c.includes(w)) return true;
  if (w.includes("hormuz") && /\bhormuz\b/.test(c)) return true;
  if (w.includes("red sea") && /\bred sea\b/.test(c)) return true;
  if (w === "moscow" && /\bmoscow\b/.test(c)) return true;
  if (w === "russia" && /\brussia\b/.test(c)) return true;
  if (w === "india" && /\bindia\b/.test(c)) return true;
  return false;
}

function isGenericPolicyAction(action: string): boolean {
  return /^Government policy on fuel duties or trade controls changed/i.test(action);
}

function hasSpecificPolicySignal(t: string): boolean {
  return /\b(windfall|export ban|import ban|subsidy cut|duty cut|tax cut|levy cut|excise|export duty|export tax)\b/.test(t);
}

type DevelopmentTheme =
  | "shortage"
  | "policy"
  | "producer"
  | "refinery"
  | "chokepoint-redsea"
  | "chokepoint-hormuz"
  | "aviation"
  | "other";

function developmentTheme(i: CanonicalFuelIncident): DevelopmentTheme {
  const t = developmentHaystack({
    title: i.title,
    summary: i.raw.summary,
    country: i.country,
    location: i.physicalLocation,
    routeOrChokepoint: i.routeOrChokepoint,
  });
  if (/\b(moscow|ration|rationing)\b/.test(t) && /\b(russia|petrol|gasoline)\b/.test(t)) return "shortage";
  if (/\b(russia)\b/.test(t) && /\b(shortage|fuel crisis|refinery)\b/.test(t)) return "shortage";
  if (/\b(india|indian)\b/.test(t) && /\b(windfall|duty|tax|levy|subsidy)\b/.test(t)) return "policy";
  if (/\b(aramco|adnoc|saudi)\b/.test(t) && /\b(resume|loading|export|output)\b/.test(t)) return "producer";
  if (/\b(jazan)\b/.test(t) && /\b(refinery|attack)\b/.test(t)) return "refinery";
  if (/\b(red sea|houthi|mokha|yemen)\b/.test(t) && !/\bexit(ing)?\s+(the\s+)?strait of hormuz\b/.test(t)) {
    return "chokepoint-redsea";
  }
  if (/\b(strait of hormuz|\bhormuz\b)\b/.test(t)) return "chokepoint-hormuz";
  if (/\b(jet fuel|aviation fuel|airline|airfare)\b/.test(t)) return "aviation";
  return "other";
}

function materialDevelopmentScore(i: CanonicalFuelIncident): number {
  const t = developmentHaystack({
    title: i.title,
    summary: i.raw.summary,
    country: i.country,
    location: i.physicalLocation,
    routeOrChokepoint: i.routeOrChokepoint,
  });
  let score = aggregateIncidentSignificance([
    { ...i.raw, occurredAt: i.date, severity: i.severity },
  ]);
  if (/\b(ration|rationing|moscow)\b/.test(t) && /\b(russia|petrol|gasoline)\b/.test(t)) score += 30;
  if (/\b(windfall|duty|tax|levy)\b/.test(t) && /\b(india|indian)\b/.test(t)) score += 24;
  if (/\b(aramco|loading|resume)\b/.test(t) && /\b(saudi|export)\b/.test(t)) score += 22;
  if (/\b(jazan)\b/.test(t) && /\b(refinery|attack)\b/.test(t)) score += 20;
  if (/\b(red sea|houthi)\b/.test(t) && /\b(attack|missile|killed)\b/.test(t)) score += 12;
  if (/\b(hormuz)\b/.test(t) && /\b(attack|vessel|blockade)\b/.test(t)) score += 10;
  return score;
}

function keepMaterialDevelopment(
  i: CanonicalFuelIncident,
  kept: CanonicalFuelIncident[],
  keptTokens: Set<string>[],
): boolean {
  const toks = sigTokens(normalizeDevelopmentText(i.title));
  if (keptTokens.some((k) => nearDuplicate(toks, k))) return false;
  kept.push(i);
  keptTokens.push(toks);
  return true;
}

function rankMaterialDevelopments(facts: FuelCanonicalFacts): CanonicalFuelIncident[] {
  const sorted = facts.qualifyingIncidents
    .slice()
    .sort((a, b) => materialDevelopmentScore(b) - materialDevelopmentScore(a));
  const kept: CanonicalFuelIncident[] = [];
  const keptTokens: Set<string>[] = [];
  const themePriority: DevelopmentTheme[] = [
    "shortage",
    "policy",
    "producer",
    "refinery",
    "chokepoint-redsea",
    "chokepoint-hormuz",
  ];
  for (const theme of themePriority) {
    const pick = sorted.find((i) => developmentTheme(i) === theme && !kept.includes(i));
    if (pick) keepMaterialDevelopment(pick, kept, keptTokens);
  }
  for (const i of sorted) {
    if (kept.length >= 10) break;
    if (kept.includes(i)) continue;
    keepMaterialDevelopment(i, kept, keptTokens);
  }
  return kept;
}

function rankBusinessSignificantDevelopments(facts: FuelCanonicalFacts): CanonicalFuelIncident[] {
  const sorted = facts.qualifyingIncidents
    .slice()
    .sort((a, b) => materialDevelopmentScore(b) - materialDevelopmentScore(a));
  const kept: CanonicalFuelIncident[] = [];
  const keptTokens: Set<string>[] = [];
  const usedThemes = new Set<DevelopmentTheme>();
  const businessPriority: DevelopmentTheme[] = [
    "shortage",
    "policy",
    "producer",
    "refinery",
    "chokepoint-redsea",
    "chokepoint-hormuz",
    "aviation",
    "other",
  ];
  for (const theme of businessPriority) {
    if (usedThemes.has(theme)) continue;
    const pick = sorted.find((i) => developmentTheme(i) === theme && !kept.includes(i));
    if (!pick) continue;
    if (!keepMaterialDevelopment(pick, kept, keptTokens)) continue;
    usedThemes.add(theme);
    if (kept.length >= 3) break;
  }
  for (const i of sorted) {
    if (kept.length >= 3) break;
    if (kept.includes(i)) continue;
    keepMaterialDevelopment(i, kept, keptTokens);
  }
  return kept.slice(0, 3);
}

function developmentSentence(i: CanonicalFuelIncident): string {
  const where = eventLocationForProse(i);
  const date = proseDay(i.date);
  const fact = summarizeFuelDevelopmentClause({
    title: i.title,
    summary: i.raw.summary,
    country: i.country,
    location: i.physicalLocation,
    routeOrChokepoint: i.routeOrChokepoint,
  });
  const factText = fact.replace(/\.$/, "");
  const loc = where && !locationAlreadyInClause(factText, where) ? ` in ${where}` : "";
  return `On ${date}${loc}, ${factText}.`;
}

function buildFuelExecutiveSummary(facts: FuelCanonicalFacts): string {
  return [
    marketPriceParagraph(facts),
    physicalSupplyParagraph(facts),
    responseParagraph(facts),
    businessContinuityParagraph(facts),
  ].join("\n\n");
}

function buildFuelSituationAssessment(facts: FuelCanonicalFacts): string {
  const hay = incidentsHaystack(facts.qualifyingIncidents);
  const parts: string[] = [];
  const marketDir = facts.marketIndicators.some((i) => i.direction === "rising")
    ? "Market-price pressure is upward on crude and refined products."
    : facts.marketIndicators.some((i) => i.direction === "falling")
      ? "Market-price pressure eased over the week, but the backdrop remains sensitive to route and supply shocks."
      : facts.marketIndicators.length
        ? "Market prices are broadly stable, leaving physical and policy developments as the main swing factors."
        : "Market-price direction is unclear from the supplied observations.";
  parts.push(marketDir);
  if (hasPattern(hay, ISSUE_FAMILIES.find((f) => f.key === "shortage")!.test)) {
    parts.push("Physical shortages and rationing are live in at least one market, separating pump access from headline price.");
  }
  if (hasPattern(hay, ISSUE_FAMILIES.find((f) => f.key === "refinery")!.test)) {
    parts.push("Refinery or production disruption is tightening regional product supply and pushing crack spreads wider.");
  }
  if (hasPattern(hay, ISSUE_FAMILIES.find((f) => f.key === "policy")!.test)) {
    parts.push("Government policy moves on duties, subsidies or allocation are resetting local price assumptions.");
  }
  if (/\b(export|import|load|loading|ship|shipment|tender|contract|buy|buyer|turns to|seeking)\b/.test(hay)
      && /\b(gasoline|petrol|diesel|jet fuel|crude|fuel)\b/.test(hay)) {
    parts.push("Producer and buyer responses — export shifts, import tenders or cross-border product flows — are reshaping who supplies whom.");
  }
  if (hasPattern(hay, ISSUE_FAMILIES.find((f) => f.key === "chokepoint")!.test)) {
    parts.push("Route and chokepoint pressure on Hormuz, the Red Sea or adjacent corridors is lifting transit time and war-risk premium even when barrels are still moving.");
  }
  if (facts.qualifyingIncidents.length === 0) {
    parts.push("With no fresh operational reporting in the window, the standing cost-and-continuity exposures carry over from recent weeks.");
  }
  return parts.join(" ");
}

function buildFuelWhatHappenedProse(facts: FuelCanonicalFacts): string {
  if (facts.qualifyingIncidents.length === 0) {
    return "No material fuel-market developments were confirmed in the reporting window; the assessment leans on market observations and standing route exposure until fresh operational reporting lands.";
  }
  return rankMaterialDevelopments(facts)
    .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title))
    .map(developmentSentence)
    .join("\n\n");
}

function buildFuelWhatMattersProse(facts: FuelCanonicalFacts): string {
  const lead = rankBusinessSignificantDevelopments(facts);
  if (!lead.length) {
    return businessContinuityParagraph(facts);
  }
  const paras = lead.map((i, idx) => {
    const where = eventLocationForProse(i);
    const impact = businessImpactForDevelopment(i);
    const opener = idx === 0
      ? "The development with the greatest business significance"
      : idx === 1
        ? "A second material line"
        : "Also worth weighting";
    const loc = where && !locationAlreadyInClause(impact, where) ? ` in ${where}` : "";
    return `${opener} is the confirmed change${loc} on ${proseDay(i.date)}. ${impact}`;
  });
  return paras.join("\n\n");
}

function buildFuelImplicationsProse(facts: FuelCanonicalFacts): string {
  const hay = incidentsHaystack(facts.qualifyingIncidents);
  const bullets: string[] = [];
  const rising = facts.marketIndicators.some((i) => i.direction === "rising");
  if (rising) {
    bullets.push("Revisit bulk-fuel and aviation surcharge pass-through clauses now — elevated Brent, WTI or jet observations typically reach invoices on the next billing cycle, not the current one.");
  }
  if (hasPattern(hay, ISSUE_FAMILIES.find((f) => f.key === "shortage")!.test)) {
    bullets.push("Where rationing or forecourt limits apply, keep road-transport and commercial-allocation conversations live with suppliers rather than assuming pump access will hold.");
  }
  if (/\b(diesel|generator|lpg|backup power)\b/.test(hay)
      && hasPattern(hay, ISSUE_FAMILIES.find((f) => f.key === "shortage")!.test)) {
    bullets.push("Check on-site diesel or LPG stock and generator runtime assumptions in markets showing rationing or depot shortfalls.");
  }
  if (hasPattern(hay, ISSUE_FAMILIES.find((f) => f.key === "policy")!.test)) {
    bullets.push("Align contract indexation and surcharge formulas to the gazette or policy effective dates flagged this period — today's economics may not survive the next duty or subsidy move.");
  }
  if (hasPattern(hay, ISSUE_FAMILIES.find((f) => f.key === "chokepoint")!.test)) {
    bullets.push("Where Gulf, Hormuz or Red Sea routing matters, refresh war-risk, transit-time and landed-cost assumptions on affected cargoes rather than treating reroutes as background noise.");
  }
  if (/\b(jet fuel|aviation fuel|airline|airways)\b/.test(hay)) {
    bullets.push("Pass aviation fuel-cost pressure into route economics and surcharge discussions before schedule or capacity decisions harden for the next operating month.");
  }
  return topUpFuelBullets(bullets.join("\n"), FUEL_DEFAULT_IMPLICATIONS, 3, 5);
}

function buildFuelWatchNextFromFacts(facts: FuelCanonicalFacts): string {
  const hay = incidentsHaystack(facts.qualifyingIncidents);
  const items: string[] = [];
  if (/\b(ration|rationing|purchase limit|forecourt|queue)\b/.test(hay) && /\b(russia|moscow)\b/.test(hay)) {
    items.push("Expansion or relaxation of Russian fuel-purchase limits and any widening of Moscow-area rationing.");
  }
  if (/\b(ration|rationing|forecourt|queue|station closure)\b/.test(hay)) {
    items.push("Station closures, queues or diesel shortages in markets already showing allocation pressure.");
  }
  if (/\bnaftan\b/.test(hay)) {
    items.push("The maintenance schedule and restart timing at the Naftan refinery.");
  }
  if (/\b(duty|duties|levy|levies|excise|subsidy|subsidies)\b/.test(hay)) {
    items.push("Implementation or amendment of fuel-duty or subsidy decisions flagged this period.");
  }
  if (/\b(aramco|saudi)\b/.test(hay) && /\b(load|loading|resume|resumed|export)\b/.test(hay)) {
    items.push("Further Saudi loading activity and any confirmed refinery disruption.");
  }
  if (/\b(jazan|refinery)\b/.test(hay) && /\b(attack|fire|damage|drone|missile)\b/.test(hay)) {
    items.push("Confirmation of damage, restart or force-majeure at the affected Saudi refinery site.");
  }
  if (/\bhormuz|strait of hormuz|iranian export\b/.test(hay)) {
    items.push("Changes affecting Hormuz fuel movements, transit advisories and Iranian export flows.");
  }
  if (/\b(india|indian)\b/.test(hay) && /\b(gasoline|petrol|export|shipment|ship)\b/.test(hay)) {
    items.push("Follow-through on Indian product export or policy moves affecting cross-border gasoline flows.");
  }
  for (const w of facts.watchIndicators) {
    if (w.trim()) items.push(w.trim());
  }
  return topUpFuelBullets(items.join("\n"), FUEL_DEFAULT_WATCH_NEXT, 3, 6);
}

function buildFuelPolestarJudgement(facts: FuelCanonicalFacts): string {
  if (facts.analystReviewRequired) {
    return "Hold wider circulation until sourcing is firm enough for operational claims. Several developments in the window still lack confirmed location or outcome, so cost and continuity judgements should stay provisional.";
  }
  const rising = facts.marketIndicators.filter((i) => i.direction === "rising").length;
  const falling = facts.marketIndicators.filter((i) => i.direction === "falling").length;
  const costDir = rising > falling
    ? "Cost risk is tilted upward for the next billing cycle."
    : falling > rising
      ? "Cost risk eased over the week but can reverse quickly if route or supply stress returns."
      : "Cost risk is broadly stable, with physical and routing shocks as the main repricing triggers.";
  const exposure = facts.primaryPressurePoint.kind === "distributed"
    ? "Exposure is spread across several markets and corridors rather than a single theatre."
    : facts.primaryPressurePoint.kind === "route"
      ? `${facts.primaryPressurePoint.label} routing is the clearest continuity exposure for bunker, freight and import-dependent sites.`
      : `${facts.primaryPressurePoint.label} is the geography where availability and pass-through pressure land first for local operations.`;
  const hay = incidentsHaystack(facts.qualifyingIncidents);
  const nearTerm = hasPattern(hay, ISSUE_FAMILIES.find((f) => f.key === "shortage")!.test)
    ? "The near-term decision is to secure commercial allocation and road-transport cover where rationing persists, not to wait for pump prices to catch up."
    : hasPattern(hay, ISSUE_FAMILIES.find((f) => f.key === "chokepoint")!.test)
      ? "The near-term decision is to refresh routing, war-risk and landed-cost assumptions on any cargo still committed through affected chokepoints."
      : rising > falling
        ? "The near-term decision is to lock surcharge and indexation language before the next invoice cycle reprices exposed contracts."
        : "The near-term decision is to keep current resilience measures in place while watching for fresh operational confirmation.";
  const confidence = facts.evidenceConfidence === "High"
    && facts.qualifyingIncidents.every((i) => i.physicalLocation || i.country)
    ? ""
    : " Confidence stays moderate while locations, event status or routing outcomes remain partly unresolved.";
  return `${costDir} ${exposure} ${nearTerm}${confidence}`;
}

/** Build count-free analytical sections from canonical facts. */
export function buildFuelAnalyticalSections(
  facts: FuelCanonicalFacts,
): Pick<
  FuelCanonicalSections,
  | "executiveSummary"
  | "situation"
  | "whatHappened"
  | "regionalHighlights"
  | "whatMatters"
  | "polestarView"
  | "operationalRead"
  | "implications"
  | "watchNext"
> {
  const pressure =
    facts.primaryPressurePoint.kind === "distributed"
      ? { distributed: true as const, primaryCountry: null }
      : facts.primaryPressurePoint.kind === "country"
        ? { distributed: false as const, primaryCountry: facts.primaryPressurePoint.label }
        : { distributed: false as const, primaryCountry: null };
  const regionalHighlights =
    buildFuelRegionalHighlights({
      issueDate: facts.reportingPeriod.issueDate,
      incidents: facts.qualifyingIncidents.map((i) => i.raw),
      window: facts.qualifyingIncidents.map((i) => i.raw),
      pressure,
    })
    ?? "No regional theatre carried a material, confirmed fuel-market development this period.";
  const operationalRead =
    buildFuelOperationalRead({
      issueDate: facts.reportingPeriod.issueDate,
      incidents: facts.qualifyingIncidents.map((i) => i.raw),
      window: facts.qualifyingIncidents.map((i) => i.raw),
    })
    ?? "No confirmed operational fuel constraint dominated the reporting window.";
  return {
    executiveSummary: buildFuelExecutiveSummary(facts),
    situation: buildFuelSituationAssessment(facts),
    whatHappened: buildFuelWhatHappenedProse(facts),
    regionalHighlights,
    whatMatters: buildFuelWhatMattersProse(facts),
    polestarView: buildFuelPolestarJudgement(facts),
    operationalRead,
    implications: buildFuelImplicationsProse(facts),
    watchNext: buildFuelWatchNextFromFacts(facts),
  };
}
