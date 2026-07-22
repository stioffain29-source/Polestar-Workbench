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

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

function haystack(i: TopicFastFactsIncident): string {
  return [i.title ?? "", i.summary ?? ""].join(" ").toLowerCase();
}

/**
 * Normalise a raw country field for use as a regional-highlight key.
 * Some upstream records carry combined values like "United Arab
 * Emirates; Iran" or "Saudi Arabia / Yemen"; we split on `;` / `/` /
 * `,` / `&` and pick the first usable country so the highlight row
 * is anchored on one place. Returns null when nothing usable remains.
 */
function normaliseCountry(c: string | null | undefined): string | null {
  if (!c) return null;
  const parts = c.split(/\s*[;/,&]\s*|\s+\bvs?\.?\b\s+/i);
  for (const raw of parts) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const lc = trimmed.toLowerCase();
    if (lc === "unknown" || lc === "n/a" || lc === "global" || lc === "international") continue;
    return trimmed;
  }
  return null;
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
    opMeaning: "Affected grades go on allocation first; commercial buyers usually feel it before the published pump price moves.",
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
}): string | null {
  const window = filterTopicReportIncidents(opts.incidents, "fuel", opts.issueDate);
  if (window.length === 0) return null;

  const byCountry = new Map<string, TopicFastFactsIncident[]>();
  for (const i of window) {
    const key = normaliseCountry(i.country);
    if (!key) continue;
    const arr = byCountry.get(key) ?? [];
    arr.push(i);
    byCountry.set(key, arr);
  }
  if (byCountry.size === 0) return null;

  const ranked = Array.from(byCountry.entries()).sort((a, b) => b[1].length - a[1].length);
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
    india: {
      why: "Pump-price moves, forecourt disruption and transport cost are where this lands first; local movement and distribution economics absorb the shock before the published headline catches up.",
      watch: "Watch for state-level fuel-tax changes, fresh forecourt or rationing reports and any operator-side surcharge announcements on road and rail.",
    },
    pakistan: {
      why: "Availability, pricing and power resilience are the main pressure points here; fuel for generators, freight and field operations is where it bites first, well before it shows up in the wider economy.",
      watch: "Watch for load-shedding patterns, depot-stock advisories and any government action on fuel pricing or commercial allocation.",
    },
    russia: {
      why: "The pressure here is on the export and sanctions side: crude and product flows, discounts and the buyers still willing to lift Russian barrels are what reset landed costs for dependent importers.",
      watch: "Watch for sanctions-enforcement steps, price-cap changes, export-duty moves and any shift in the discount at which Russian crude and products clear.",
    },
    ukraine: {
      why: "The pressure here is on physical supply and distribution: refinery and depot damage, import dependence and the logistics of keeping fuel moving are what determine availability on the ground.",
      watch: "Watch for damage to refining and storage, import and rail-supply arrangements and any rationing or allocation measures for commercial users.",
    },
  };
  const paragraphs: string[] = [];
  for (let idx = 0; idx < lead.length; idx++) {
    const [country, items] = lead[idx];
    const fam = familyFor(items);
    const phrase = fam?.phrase ?? "fuel-operational reporting";
    // normaliseCountry() preserves original case ("India", "Pakistan");
    // overlay keys are lowercase, so lookup must lowercase the country.
    const overlay = COUNTRY_OVERLAY[country.toLowerCase()];
    const why = overlay?.why
      ?? fam?.why
      ?? "There is underlying pressure on local fuel availability and cost.";
    const watch = overlay?.watch
      ?? fam?.watch
      ?? "Watch the coming weeks to confirm whether the pattern persists or eases.";
    const recordsClause = "Recent activity points to";
    let opener: string;
    if (idx === 0) {
      opener = `${titleCase(country)} is the clearest pressure point right now.`;
    } else if (idx === 1) {
      opener = `${titleCase(country)} is a secondary but credible concern.`;
    } else {
      opener = `${titleCase(country)} adds further weight to the picture.`;
    }
    paragraphs.push(`${opener} ${recordsClause} ${phrase}. ${why} ${watch}`);
  }
  return paragraphs.join("\n\n");
}

// ---------------------------------------------------------------------------
// Gulf & Hormuz Chokepoint Watch
//
// A standing chokepoint view that looks back further than the 7-day market
// window (default 60 days) so a Gulf/Hormuz escalation that fell just outside
// the reporting week is still surfaced. The selector is DELIBERATELY NARROW:
// bare OPEC / Saudi / Israel market chatter is excluded because it floods the
// window with generic oil-market noise; only genuine Strait-of-Hormuz /
// Persian-Gulf / Arabian-Gulf / Red-Sea / Bab-el-Mandeb chokepoint vocabulary
// qualifies. STRICT no-fabrication: prose is theme-detected from the matched
// records ONLY, cites real dated anchor events, carries no numeric counts, and
// never asserts a "currently rising" trend the data does not support — an
// escalation that has since gone quiet is reported as easing, not as live.
// ---------------------------------------------------------------------------

const GULF_CHOKEPOINT_RE =
  /\b(strait of hormuz|hormuz|persian gulf|arabian gulf|bab[- ]?el[- ]?mandeb|red sea)\b/i;

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

const GULF_SEV_RANK: Record<string, number> = {
  insignificant: 1,
  low: 2,
  moderate: 3,
  high: 4,
  extreme: 5,
};

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
  /** Older chokepoint material, retained as standing context only. */
  standingItems: FuelGulfWatchItem[];
  /** Pre-formatted lines for the standing-context block. */
  standingItemLines: string[];
  /** One-line intro for the standing-context block; null when no older items. */
  standingNote: string | null;
  /** Date span of the current activity (or the standing set when none is current). */
  rangeLabel: string;
}

/** Shift a yyyy-mm-dd day-key by whole days in UTC (tz-drift-free). */
function shiftDayKey(key: string, deltaDays: number): string {
  return new Date(new Date(`${key}T00:00:00Z`).getTime() + deltaDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/**
 * Build the Gulf & Hormuz Chokepoint Watch section from the fuel incident
 * set. Returns null when no genuine chokepoint reporting falls in the
 * lookback window, so the caller omits the section entirely (no placeholder).
 *
 * The section is anchored on the report ISSUE DATE (the same window the rest
 * of the report uses), NOT the market-close date. Chokepoint records are split
 * into a CURRENT period (the issue-date report window, extended to the market
 * close if that lands slightly later) and older STANDING CONTEXT. Current
 * material always leads; older material is shown separately and never demotes
 * a current-week Hormuz item. The "no fresh reporting" line is computed only
 * from the current-period set, so it can never contradict fresh items shown
 * elsewhere in the same report.
 *
 * Both the on-screen preview and the PDF receive the identical raw incident
 * array and this function is fully deterministic, so screen == PDF.
 */
export function buildFuelGulfChokepointWatch(opts: {
  /** Report issue date (drives the current-period window). */
  issueDate: string;
  /** The market-close date, used only to extend the current end if later. */
  periodEnd?: string;
  incidents: TopicFastFactsIncident[];
  lookbackDays?: number;
  maxItems?: number;
}): FuelGulfChokepointWatch | null {
  const lookbackDays = opts.lookbackDays ?? 60;
  const maxItems = opts.maxItems ?? 6;
  const issueKey = gulfDayKey(opts.issueDate);
  if (!issueKey) return null;

  // Current period = the SAME issue-date report window the rest of the report
  // uses (weekly fuel = 7 days), extended to the market close if that lands a
  // day or two later, so current-week chokepoint items are always treated as
  // current — never demoted to standing context.
  const windowDays = reportWindowDefaultDays("fuel");
  const currentStartKey = shiftDayKey(issueKey, -(windowDays - 1));
  const periodEndKey = gulfDayKey(opts.periodEnd ?? null);
  const currentEndKey =
    periodEndKey && periodEndKey > issueKey ? periodEndKey : issueKey;
  // Standing context reaches back further for older anchor material.
  const standingStartKey = shiftDayKey(currentStartKey, -lookbackDays);

  // 1. Select fuel chokepoint records within the wider lookback window. Match on
  //    the TITLE ONLY (not the summary): a genuine Gulf/Hormuz chokepoint story
  //    names the chokepoint in its headline, whereas a domestic pump-price cut,
  //    an SPR-withdrawal note or a fuel-levy debate merely MENTIONS Hormuz as
  //    background market colour in its body. Title-matching keeps the section
  //    precision-first so those passing mentions never masquerade as anchors.
  //    A genuine Gulf/Hormuz chokepoint event (a tanker struck in the strait, a
  //    crude reroute) is often filed by ingestion under the `shipping` topic
  //    rather than `fuel`, and those rows already surface in the Fuel Watch
  //    Producer/Buyer Actions table via the cross-read. Admit shipping-topic
  //    rows here too — gated on the SAME fuel-market signal the cross-read uses
  //    — so a current-week chokepoint item shown elsewhere in the report can
  //    never be contradicted by a stale "no fresh reporting" line here.
  const matched = opts.incidents
    .filter(
      (i) =>
        i.topic === "fuel" ||
        (i.topic === "shipping" && FUEL_ACTION_TOPICAL_RE.test(haystack(i))),
    )
    .map((i) => ({ i, key: gulfDayKey(i.occurredAt) }))
    .filter(
      (x): x is { i: TopicFastFactsIncident; key: string } =>
        x.key !== null && x.key >= standingStartKey && x.key <= currentEndKey,
    )
    .filter(({ i }) => GULF_CHOKEPOINT_RE.test(i.title ?? ""));
  if (matched.length === 0) return null;

  const currentMatched = matched.filter((x) => x.key >= currentStartKey);
  const standingMatched = matched.filter((x) => x.key < currentStartKey);

  // 2. Rank most-severe-then-newest, then dedupe syndication so one event with
  //    many rewrites collapses to a single representative row. `seed` carries
  //    already-kept token sets so a standing copy of a current event is dropped.
  type Kept = { i: TopicFastFactsIncident; key: string; title: string };
  const rankAndDedupe = (
    arr: { i: TopicFastFactsIncident; key: string }[],
    seed: Set<string>[],
  ): Kept[] => {
    const ranked = arr.slice().sort((a, b) => {
      const sa = GULF_SEV_RANK[(a.i.severity ?? "").toLowerCase()] ?? 0;
      const sb = GULF_SEV_RANK[(b.i.severity ?? "").toLowerCase()] ?? 0;
      if (sb !== sa) return sb - sa;
      return b.key.localeCompare(a.key);
    });
    const kept: Kept[] = [];
    const keptTokens: Set<string>[] = [...seed];
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

  const currentKept = rankAndDedupe(currentMatched, []);
  const standingKept = rankAndDedupe(
    standingMatched,
    currentKept.map((k) => sigTokens(k.title)),
  );
  if (currentKept.length === 0 && standingKept.length === 0) return null;

  const toItems = (kept: Kept[]): FuelGulfWatchItem[] =>
    kept.slice(0, maxItems).map(({ i, key, title }) => ({
      title,
      date: key,
      severity: (i.severity ?? "").toLowerCase(),
      country: normaliseCountry(i.country),
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
  const currentKeys = currentMatched.map((x) => x.key);
  const standingKeys = standingMatched.map((x) => x.key);
  const rangeLabel =
    currentKeys.length > 0 ? spanLabel(currentKeys) : spanLabel(standingKeys);

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
  const distinctCurrentDays = new Set(currentMatched.map((x) => x.key)).size;
  const broadCoverage = currentKept.length >= 4 && distinctCurrentDays >= 3;

  // 4. Compose deterministic, no-fabrication prose. Current period leads.
  const p1: string[] = [];
  const p2: string[] = [];
  if (currentKept.length > 0) {
    p1.push(
      broadCoverage
        ? "The Strait of Hormuz and wider Gulf were this reporting period's dominant fuel-route risk, with a marked concentration of chokepoint reporting."
        : "The Strait of Hormuz and wider Gulf featured in this reporting period's fuel-route reporting.",
    );
    if (hasClosure) {
      p1.push(
        "Coverage centred on Hormuz closure and shipping disruption, forcing dependent crude and product flows onto longer, costlier routes and lifting the war-risk premium.",
      );
    }
    const anchor = currentKept[0];
    const anchorSevRank =
      GULF_SEV_RANK[(anchor.i.severity ?? "").toLowerCase()] ?? 0;
    if (hasKinetic && anchorSevRank >= 4) {
      p1.push(
        `Pressure peaked on ${gulfFmtDay(anchor.key)} with the period's most serious chokepoint incident: ${anchor.title}.`,
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
  } else {
    // No current-period chokepoint reporting. Say so plainly — computed only
    // from the current set, so it can never contradict fresh items elsewhere.
    p1.push(
      "No fresh Gulf or Hormuz chokepoint reporting surfaced in this reporting period.",
    );
    const standingLatestKey =
      standingKeys.length > 0 ? standingKeys.slice().sort().slice(-1)[0] : null;
    if (standingLatestKey) {
      p1.push(
        `The most recent chokepoint activity on record dates to ${gulfFmtDay(standingLatestKey)}, retained below as standing context; the route stays a standing watch given its fragility.`,
      );
    } else {
      p1.push("The route stays a standing watch given its fragility.");
    }
  }
  const read = [p1.join(" "), p2.join(" ")].filter((s) => s.trim()).join("\n\n");

  const standingNote =
    standingKept.length > 0
      ? "Older chokepoint reporting from before this period, retained for context only — not current-period activity."
      : null;

  return {
    read,
    currentItems: toItems(currentKept),
    currentItemLines: toLines(currentKept),
    standingItems: toItems(standingKept),
    standingItemLines: toLines(standingKept),
    standingNote,
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
      // A refinery / fuel-depot fire or blast is an involuntary supply
      // signal (capacity loss), not an actor's action — it belongs under
      // Market / supply signal. NOTE: CATEGORY_RULES is first-match, so a
      // fire headline that NAMES a national oil company still classifies
      // Producer via the earlier bare-NOC rule (load-bearing; see
      // fuel-producer-buyer-table.md watch-points). This rule catches the
      // no-NOC case (e.g. "Oil refinery ablaze in Cuba").
      /\b(refinery|fuel depot|oil depot|oil terminal) .{0,30}(ablaze|on fire|blaze|fire|explosion|blast)/,
      // Supply resuming / arriving / shortage easing is a genuine availability
      // signal (bearish for local pump prices), not a policy action.
      /\b(supply|supplies|fuel|petrol|diesel|cargo|shipment|tanker|stock|stocks) .{0,30}(arriv\w+|resum\w+|restor\w+|replenish\w+|normalis\w+)/,
      /\b(shortage|crisis|outage|disruption) .{0,30}(ease|eases|easing|end|ends|over|resolv\w+)/,
    ],
  },
];

function classifyCategory(t: string): FuelActionCategory | null {
  for (const rule of CATEGORY_RULES) {
    if (rule.test.some((re) => re.test(t))) return rule.category;
  }
  return null;
}

// Per-row operational-read derivation. Each row gets a sentence shaped
// by keywords in the actual action text, so rows in the same category
// don't all carry an identical generic line. Falls back to a per-
// category default only when no keyword matches.
function deriveOperationalRead(t: string, category: FuelActionCategory): string {
  if (/\b(refinery|refining|crack spread)\b/.test(t))
    return "Refinery-side move: regional crack spreads tighten and downstream pump and bunker pricing usually firms within days.";
  if ((/\b(flight|flights|route|routes|capacity|aviation|airline|carrier|airways)\b/.test(t))
      && /\b(suspend|cancel|cut|cuts|ground|grounded|reduc|axe|halt|slash|defer|trim|drop)\w*/.test(t))
    return "Aviation demand response: carriers trimming capacity signal jet-fuel cost or availability stress feeding straight into route economics.";
  if (/\b(ration|rationing|allocation|curfew)\b/.test(t))
    return "Rationing or allocation controls confirm a physical shortage; commercial offtake is restricted before pump prices fully adjust.";
  if (/\b(export ban|import ban|export quota|import quota|embargo)\b/.test(t))
    return "Trade controls reroute flows; expect tighter spot availability and wider freight differentials on affected grades.";
  if (/\b(subsidy|subsidies|levy|levies|duty|excise|tax|price control|price cap|price freeze)\b/.test(t))
    return "Policy reset: review pump-price exposure and contract pass-through clauses before the next billing cycle.";
  if (/\b(jet fuel|bunker|fuel) hedg/.test(t))
    return "Hedging signal from buyers; contract pricing on similar grades typically follows the lead within weeks.";
  if (/\b(spot purchase|tender|long[- ]term contract|long[- ]term deal|supply (contract|deal|agreement|swap))\b/.test(t))
    return "Procurement signal: near-term demand pulled forward; watch tender outcomes and freight follow-through.";
  if (/\b(strategic reserve|\bspr\b|storage|stockpile|reserve) (release|draw|tap|build|expand)/.test(t))
    return "Reserve action smooths near-term pricing but does not fix the underlying supply tightness.";
  if (/\b(pipeline|terminal|jetty|berth|loading)\b.{0,30}(bypass|reroute|rerouting|open|close|shut|expand|sabotage|attack)/.test(t)
      || /\b(alternative route|bypass(?:ing)? hormuz|red sea bypass)/.test(t))
    return "Logistics rerouting raises bunker and transit cost on dependent fuel flows.";
  if (/\b(production|output) (cut|reduce|curtail)/.test(t))
    return "Output discipline tightens balances and supports a firmer crude floor.";
  if (/\b(production|output) (hike|increase|boost|expand|raise|restart)/.test(t))
    return "Added barrels ease near-term tightness but rarely move prices on their own without demand confirmation.";
  if (/\b(supply (tighten|tightens|squeeze)|inventory draw)/.test(t))
    return "Tightening balances put a floor under prices and reduce buyer flexibility in the weeks ahead.";
  if (/\b(supply|supplies|fuel|petrol|diesel|cargo|shipment|tanker|stock|stocks) .{0,30}(arriv\w+|resum\w+|restor\w+|replenish\w+|normalis\w+)/.test(t)
      || /\b(shortage|crisis|outage|disruption) .{0,30}(ease|eases|easing|end|ends|over|resolv\w+)/.test(t))
    return "Supply resuming eases the local shortage; pump-price and surcharge pressure should soften as availability normalises.";
  if (/\b(price|prices) (rise|climb|surge|jump|hit|reach|break)/.test(t))
    return "Reinforces the cost-pressure picture; freight surcharges and bunker invoices follow in the weeks ahead.";
  // Per-category fallbacks (different from each other so the table never
  // shows the same operational read across multiple categories).
  switch (category) {
    case "Producer action":
      return "Supply-side move with read-through to bunker, jet and downstream pricing if the action sustains.";
    case "Buyer action":
      return "Buyer behaviour to track; spot and contract pricing on similar grades tends to follow the lead.";
    case "Government / policy action":
      return "Policy intervention resets pump-price and surcharge exposure for the next contract cycle.";
    case "Infrastructure / routing action":
      return "Keeps Gulf and Red Sea routing diversification a live mitigation theme rather than a future option.";
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

function pickActor(i: TopicFastFactsIncident, category: FuelActionCategory): string {
  const t = haystack(i);
  // "Reliance" is a common English noun ("reduce reliance on …"), so the actor
  // is only the company when the distinctive corporate/refinery tokens appear.
  if (/\b(reliance industries|reliance jamnagar|jamnagar)\b/.test(t))
    return "Reliance";
  const ACTORS = [
    "OPEC+", "OPEC", "Saudi Aramco", "ADNOC", "QatarEnergy", "Petrobras",
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
  if (category === "Government / policy action") return "Government / policy";
  if (category === "Infrastructure / routing action") return "Infrastructure operator";
  if (category === "Market / supply signal") return "Market";
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
  // the shorter title's content is contained in the other.
  return (overlap >= 4 && jaccard >= 0.4) || overlap >= Math.ceil(0.7 * smaller);
}

// Fuel-market topical guard for cross-topic action rows. A shipping-topic
// incident is admitted to the Producer/Buyer Actions table ONLY when it
// carries an unambiguous fuel / crude / refined-product / national-oil-
// company signal, so a container-ship, grain or piracy story that happens
// to match a generic action pattern (e.g. a bare "export ban") never leaks.
const FUEL_ACTION_TOPICAL_RE =
  /(?<!\b(?:palm|cooking|vegetable|veg|olive|sunflower|soybean|soy|coconut|mustard|castor|sesame|groundnut|peanut|edible)\s)\b(oil|crude|petroleum|refiner\w*|refined|gasoline|petrol|diesel|jet fuel|kerosene|lpg|naphtha|fuel oil|bunker|barrel|barrels|bpd|opec\+?|aramco|adnoc|petrobras|rosneft|gazprom|qatarenergy|pertamina|petronas|cnpc|sinopec|cnooc|ongc|reliance industries|jamnagar)\b/;

// The cross-read from the shipping topic admits ONLY genuine actions — a
// bare oil-price-movement / market signal is not a producer or buyer ACTION
// and reintroduces exactly the crude-market noise the fuel topic is
// deliberately scoped to exclude, so it never enters via cross-read. (Fuel-
// topic rows keep their full category range, market signals included.)
const CROSS_READ_ACTION_CATEGORIES = new Set<FuelActionCategory>([
  "Producer action",
  "Buyer action",
  "Government / policy action",
  "Infrastructure / routing action",
]);

/**
 * Incident set for the Producer/Buyer Actions table ONLY. It merges the
 * canonical in-window fuel incidents with genuine fuel-market ACTIONS that
 * the ingestion pipeline files under the `shipping` topic (OPEC+ output
 * moves, ADNOC / Aramco / Pertamina tenders, crude-route producer actions).
 * These are real producer/buyer actions that never reach the fuel topic
 * because the fuel relevance gate is deliberately scoped to fuel-OPERATIONAL
 * incidents and excludes OPEC / crude-market framing.
 *
 * The cross-read is strictly bounded to the SAME reporting window (both fuel
 * and shipping are weekly, so the window bounds are identical) and requires
 * BOTH a discrete action category AND a fuel-market topical signal — so no
 * out-of-window row and no non-fuel shipping story can enter. Every OTHER
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
    if (cat === null || !CROSS_READ_ACTION_CATEGORIES.has(cat)) continue;
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
    const category = classifyCategory(t);
    if (!category) continue;
    const action = i.title.trim().replace(/\.$/, "");
    const dedupeKey = action.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    // Supplier-pivot story-key collapse: syndicated rewrites of one buyer
    // pivot ("Russia Turns To India For Gasoline" vs "Russia seeking extra
    // gasoline from one of its top oil buyers") share too few distinctive
    // tokens for the near-duplicate guard, but one buyer pivoting on one
    // product in one window is ONE action — keep the first copy only.
    if (
      category === "Buyer action" &&
      SUPPLIER_PIVOT_RES.some((re) => re.test(t))
    ) {
      const subject = sigTokens(action).values().next().value ?? "";
      const product = PIVOT_PRODUCT_RE.exec(t)?.[1] ?? "";
      const pivotKey = `pivot:${subject}:${product}`;
      if (seen.has(pivotKey)) continue;
      seen.add(pivotKey);
    }
    // Near-duplicate guard: collapse syndicated re-writes of the same
    // story within a category (e.g. the ADNOC / UAE Hormuz-bypass
    // pipeline reported under several different headlines) so the table
    // never lists the same action twice.
    const tokens = sigTokens(action);
    if (raw.some((r) => r.category === category && nearDuplicate(tokens, r.tokens))) {
      continue;
    }
    seen.add(dedupeKey);
    raw.push({
      actor: pickActor(i, category),
      category,
      action,
      operationalRead: deriveOperationalRead(t, category),
      date: fmtDate(i.occurredAt),
      tokens,
    });
  }
  if (raw.length === 0) return [];

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
    const items = raw.filter((r) => r.category === cat).slice(0, PER_CATEGORY);
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
}): string | null {
  const window = filterTopicReportIncidents(opts.incidents, "fuel", opts.issueDate);
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
    return `Fuel-related developments this week do not point to a single dominant theme. Treat the picture as a rough guide and rely on the incidents listed below for the detail.`;
  }

  // Country roll-up for the closing line ("strongest operational signal").
  const byCountry = new Map<string, number>();
  for (const i of window) {
    const k = normaliseCountry(i.country);
    if (!k) continue;
    byCountry.set(k, (byCountry.get(k) ?? 0) + 1);
  }
  const topCountries = Array.from(byCountry.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3);

  const ordered = Array.from(counts.values()).sort((a, b) => b.items.length - a.items.length);

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

  const where =
    topCountries.length > 0
      ? ` ${topCountries.map(([c]) => titleCase(c)).join(", ")} carr${topCountries.length === 1 ? "ies" : "y"} the most activity this week.`
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
  // Casualties always keep the elevated rating.
  if (FUEL_CASUALTY_RE.test(hay)) return severity ?? "";
  // Warning / forecast / policy-proposal framing is commentary → downgrade.
  if (FUEL_SPECULATIVE_RE.test(hay)) return "moderate";
  // A concrete physical disruption keeps the elevated rating.
  if (FUEL_OPERATIONAL_RE.test(hay)) return severity ?? "";
  // Everything else (pure market/price/policy signal) → downgrade.
  return "moderate";
}
