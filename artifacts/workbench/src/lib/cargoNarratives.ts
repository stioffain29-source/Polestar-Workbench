// Cargo Watch auto-derived analyst prose.
//
// Two reads are generated from the in-window cargo incidents and slotted
// into the report between Fast Facts and the editor-authored sections:
//
//   1. Cargo Security Read — hijack, truck/container theft, raid,
//      pilferage and route-side cargo loss.
//   2. Logistics Hub Read — warehouse, depot, terminal, yard, customs
//      bond store and similar logistics-hub incidents.
//
// Forbidden idioms (also banned from Fuel and Shipping prose):
//   - "X records sit in window"
//   - "Activity concentrates"
//   - "Most recent"
//   - "The leading patterns are"
//   - "The usable signal is"
//   - "Detail sits"
//   - "The reporting window is noisy"
// Every line is analyst-style: tells the reader what to take from the
// data, not just how many records there were.

import { format, parseISO } from "date-fns";
import { isUnattributedCountry, splitAttributedCountries } from "./topicRelevance";
import {
  classifyIncidentType,
  classifyLocationType,
  type CargoIncidentLike,
} from "./cargoAnalysis";

export interface CargoNarrativeIncident {
  id?: number | string;
  topic: string;
  title: string;
  severity: string;
  occurredAt: string;
  country?: string | null;
  summary?: string | null;
  source?: string | null;
  sourceUrl?: string | null;
  location?: string | null;
}

const CARGO_SECURITY_RE = /\b(hijack|hijacked|hijacking|truck (theft|robbery|raid|hijack)|container (theft|stolen|raid)|cargo (theft|loss|robbery|stolen)|convoy (attack|raid|hit)|pilferage|seal (broken|tamper|tampering)|in[- ]transit (theft|loss|robbery))\b/i;
const LOGISTICS_HUB_RE = /\b(warehouse|depot|distribution centre|distribution center|fulfilment centre|fulfillment center|yard|terminal|customs bond|bonded warehouse|freight (terminal|yard)|inland container depot|icd|cold[- ]chain (facility|warehouse))\b/i;

function recordDate(i: CargoNarrativeIncident): Date | null {
  try {
    const d = parseISO(i.occurredAt);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

// Country tokenisation (compound-string splitting + unattributed drop) lives
// in the shared relevance lib as splitAttributedCountries, so the Reads, the
// editor seed and the Fast Facts card normalise countries the same way and can
// never disagree (e.g. "Indonesia; West Papua" never appears as one country).
function topCountries(rows: CargoNarrativeIncident[], n: number): { country: string; count: number }[] {
  const m = new Map<string, number>();
  for (const r of rows) {
    // "Unknown" is not a country. Counting it let the prose claim a window
    // was "led by Unknown" and contradicted the Fast Facts card.
    for (const c of splitAttributedCountries(r.country)) {
      m.set(c, (m.get(c) ?? 0) + 1);
    }
  }
  return Array.from(m.entries())
    .map(([country, count]) => ({ country, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}

interface CountryPicture {
  top: { country: string; count: number }[];
  identified: number;
  total: number;
  strong: boolean;
  line: string;
}

// Single source of truth for how cargo prose talks about country
// attribution. When most records carry no confirmed country, the prose
// must explain that gap rather than assert a firm single lead — so the
// Fast Facts card, the Reads and the analyst sections never disagree.
// `scope` describes WHICH records the line covers. The Reads work on a subset
// of the window (route-side or hub-side records), so their country line must
// say "among these route-side records" rather than "in the window" — otherwise
// a subset leader (e.g. Papua New Guinea on the route-side) reads as a flat
// contradiction of the overall-window lead named in the Fast Facts card and
// Executive Summary. Naming the scope explains the gap instead of hiding it.
function countryPicture(
  rows: CargoNarrativeIncident[],
  n: number,
  scope = "in the window",
): CountryPicture {
  const top = topCountries(rows, n);
  // `identified` is ROW-level (does this record carry any attribution at all),
  // while `top` is TOKEN-level (per-country mentions after splitting). The
  // strong/weak gate below compares identified ROWS against total ROWS, so a
  // partially-attributed row ("Indonesia; West Papua") counts once as
  // identified — intentional: the record is attributed even if multi-country.
  let identified = 0;
  for (const r of rows) {
    if (!isUnattributedCountry(r.country)) identified++;
  }
  const total = rows.length;
  const strong = top.length > 0 && identified >= 2 && identified * 2 >= total;
  let line: string;
  if (top.length === 0) {
    line = `Country attribution is sparse this cycle and limits the geographic read.`;
  } else if (strong) {
    line = `Country attribution ${scope} is led by ${joinCountries(top)}.`;
  } else {
    line = `Most records ${scope} carry no confirmed country; among the identified minority the recurring geographies are ${joinCountries(top)}, too thin to read as a single firm lead.`;
  }
  return { top, identified, total, strong, line };
}

function joinCountries(rows: { country: string; count: number }[]): string {
  if (rows.length === 0) return "";
  const parts = rows.map((r) => `${r.country} (${r.count})`);
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function leadEntry(rows: CargoNarrativeIncident[]): CargoNarrativeIncident | null {
  if (rows.length === 0) return null;
  // Prefer the most recent operational entry — gives the reader something
  // concrete and current to anchor the section on.
  const dated = rows
    .map((r) => ({ r, d: recordDate(r) }))
    .filter((x): x is { r: CargoNarrativeIncident; d: Date } => x.d !== null);
  if (dated.length === 0) return rows[0];
  dated.sort((a, b) => b.d.getTime() - a.d.getTime());
  return dated[0].r;
}

export function buildCargoSecurityRead(windowIncidents: CargoNarrativeIncident[]): string {
  const matches = windowIncidents.filter((i) => {
    const text = `${i.title} ${i.summary ?? ""}`;
    return CARGO_SECURITY_RE.test(text);
  });
  if (matches.length === 0) {
    return `No qualifying truck-hijack, container theft, in-transit loss, pilferage or convoy-attack records reached the file in this cycle. Cargo-security reporting tends to be lumpy and a quiet window should be treated as a coverage gap rather than confirmation that route-side risk has eased.\n\nWatch insurance underwriter bulletins, transport-association advisories and any operator decisions on convoying or rerouting. Those signals usually move ahead of headline crime reporting on the routes that matter.`;
  }
  const lead = leadEntry(matches)!;
  const leadDate = recordDate(lead);
  const countryLine = countryPicture(matches, 3, "among these route-side records").line;
  const intro = `Route-side and convoy cargo risk shows up across ${matches.length} qualifying record${matches.length === 1 ? "" : "s"} this cycle, covering truck hijack, container theft, in-transit loss and similar operational crime. The lead entry is "${lead.title}"${leadDate ? `, filed ${format(leadDate, "dd MMM yyyy")}` : ""}.`;
  const watch = `Watch for clustering on specific corridors, repeat operator names in the same week and any escalation from pilferage to coordinated hijack. Insurance loss bulletins and transport-association advisories are the cleanest early signals that route-side risk is firming.`;
  return `${intro} ${countryLine}\n\n${watch}`;
}

// --- Cargo analyst auto-prose for the four standard sections ---------------
// Editor-authored text always wins; these builders provide Fuel-Watch-level
// substance when the analyst leaves a section blank. Inventory loss,
// fulfilment impact, insurance exposure, repeat corridors, depot controls,
// driver / yard staff vetting, route security, seal integrity and high-value
// cargo moves are the anchor concepts.

interface CargoAutoCtx {
  windowIncidents: CargoNarrativeIncident[];
  securityMatches: CargoNarrativeIncident[];
  hubMatches: CargoNarrativeIncident[];
}

function buildCargoAutoCtx(windowIncidents: CargoNarrativeIncident[]): CargoAutoCtx {
  const securityMatches = windowIncidents.filter((i) =>
    CARGO_SECURITY_RE.test(`${i.title} ${i.summary ?? ""}`),
  );
  const hubMatches = windowIncidents.filter((i) =>
    LOGISTICS_HUB_RE.test(`${i.title} ${i.summary ?? ""}`),
  );
  return { windowIncidents, securityMatches, hubMatches };
}

export function buildCargoWhatMatters(windowIncidents: CargoNarrativeIncident[]): string {
  const ctx = buildCargoAutoCtx(windowIncidents);
  const cp = countryPicture(ctx.windowIncidents, 3);
  const parts: string[] = [];
  if (ctx.securityMatches.length === 0 && ctx.hubMatches.length === 0) {
    return `No qualifying truck-hijack, container theft, in-transit loss or logistics-hub logistics incident reached the file this cycle. Cargo-crime reporting is lumpy and a blank window should be read as a coverage gap rather than confirmation that route-side or depot-side risk has eased. Treat the underlying inventory-loss, fulfilment and insurance-exposure picture as unchanged until at least two clean cycles in a row.`;
  }
  parts.push(
    `What this cycle changes for cargo owners and operators is concentrated in two places: route-side incidents (${ctx.securityMatches.length} qualifying record${ctx.securityMatches.length === 1 ? "" : "s"}) that translate directly into inventory loss, fulfilment slippage and insurance-claim exposure; and logistics-hub losses (${ctx.hubMatches.length} qualifying record${ctx.hubMatches.length === 1 ? "" : "s"}) that test warehouse and depot controls, driver and yard-staff vetting, and seal and handover integrity.`,
  );
  if (cp.top.length > 0) {
    parts.push(
      `${cp.line} Repeat hits in the same country across consecutive cycles are the cleanest early signal that a specific corridor or operator is being worked by an organised crew — that is the point at which insurance bulletins and police alerts typically follow.`,
    );
  }
  parts.push(
    `For high-value cargo moves the implication is to assume route-side risk has not eased even on a quiet week. Pre-route security reviews, seal and lock integrity checks at handover, and driver-vetting on contracted hauliers are the cheapest mitigation; they only get expensive after a loss.`,
  );
  return parts.join("\n\n");
}

export function buildCargoImplications(_windowIncidents: CargoNarrativeIncident[]): string {
  // Fixed-shape bullet set covering route review, escort use, depot
  // and warehouse access control, driver and yard-staff vetting,
  // seal / lock checks at handover, insurance cover on repeat
  // corridors and incident reporting / recovery procedures. Order
  // runs from operational (route, escort) through facility controls
  // (depot, vetting, seals) to commercial / process (insurance,
  // reporting).
  void _windowIncidents;
  const bullets: string[] = [
    `Run a fresh route review on repeat-loss corridors and re-baseline expected transit risk before the next high-value move.`,
    `Use escort or convoy cover on high-value loads through known-hot lanes; the cost only looks high until a single loss prices it in.`,
    `Tighten depot and warehouse access control — visitor logs, after-hours staffing, CCTV blind spots and perimeter integrity at named hubs.`,
    `Re-baseline driver and yard-staff vetting on contracted hauliers; insider involvement is the consistent thread behind larger losses.`,
    `Enforce seal and lock checks at every handover, with photographic evidence captured and matched at origin and destination.`,
    `Review insurance cover and deductibles on repeat corridors; expect underwriter response within one to two cycles on lanes with recurring activity.`,
    `Confirm incident-reporting and recovery procedures end-to-end — police notification, insurer notification, internal escalation and stock-recovery actions — so the response is rehearsed, not improvised.`,
  ];
  return bullets.map((b) => `- ${b}`).join("\n");
}

export function buildCargoWatchNext(_windowIncidents: CargoNarrativeIncident[]): string {
  // Fixed-shape watch indicators per spec: repeat losses on the same
  // corridor, copycat theft within two weeks, insider involvement,
  // depot access failures, seal / lock failures, fresh arrests or
  // recoveries, route displacement to weaker depots, and insurance
  // or police alerts.
  void _windowIncidents;
  const bullets: string[] = [
    `Repeat losses on the same corridor across consecutive cycles — clearest sign an organised crew is working a specific lane.`,
    `Copycat theft within two weeks of a publicised hijack — one event commonly draws three or four imitators.`,
    `Insider involvement signals — out-of-hours loading, driver or yard-staff turnover coinciding with a loss, seal or lock anomalies.`,
    `Depot access failures, after-hours entries and CCTV outages on the same shift — facility-side organisation rather than opportunistic pilferage.`,
    `Seal or lock failures at handover — leading indicator of a compromised driver, agent or yard handler.`,
    `Fresh arrests, recoveries or charge-sheet filings on prior losses — tells you whether the law-enforcement response is firming or stalling.`,
    `Route displacement away from controlled depots toward weaker ones under cost pressure — common precursor to a fresh loss cycle.`,
    `Insurance underwriter bulletins, transport-association advisories and police-alert circulars on affected corridors — the cleanest market-side signal.`,
  ];
  return bullets.map((b) => `- ${b}`).join("\n");
}

export function buildCargoPolestarView(windowIncidents: CargoNarrativeIncident[]): string {
  const ctx = buildCargoAutoCtx(windowIncidents);
  // Country picture is split deliberately: overall total leader (drives
  // the Fast Facts "Most Affected Country" card) vs the logistics-hub
  // leader. If they differ, the prose calls that out instead of letting
  // the report appear self-contradictory.
  const cp = countryPicture(ctx.windowIncidents, 3);
  const hubTop = topCountries(ctx.hubMatches, 1);
  const securityTop = topCountries(ctx.securityMatches, 1);
  const parts: string[] = [];

  // 1. Judgement: larger losses driven by route familiarity and
  // likely insider knowledge.
  parts.push(
    `Our read on the cycle is that the larger cargo losses on the file are being driven by route familiarity and likely insider knowledge rather than opportunistic crime. The pattern across hijack reports, depot raids and seal-failure entries is too consistent to read as chance — repeat corridors, named depots and the same modus operandi recur.`,
  );

  // 2. Country picture. Only assert a firm operating geography and the
  // route-vs-hub split when attribution is strong enough to carry it;
  // otherwise state the gap so the Fast Facts card and the prose agree.
  if (cp.top.length > 0) {
    if (cp.strong) {
      const hub = hubTop[0]?.country ?? null;
      const sec = securityTop[0]?.country ?? null;
      const split = hub && sec && hub !== sec
        ? ` ${sec} leads route-side cargo-security reporting on the file while ${hub} leads logistics-hub and warehouse exposure — different lanes of the same problem, not separate issues.`
        : "";
      parts.push(
        `The main operating geographies this cycle are ${joinCountries(cp.top)}.${split}`,
      );
    } else {
      parts.push(cp.line);
    }
  }

  // 3. Route-side and hub-side risk are linked — treat them as one
  // exposure picture, not two separate buckets.
  parts.push(
    `Route-side hijack risk and logistics-hub theft should be treated as linked exposures rather than separate problems. Inventory that survives the road can still be lost at the depot, and crews working a corridor are often the same crews working a yard at the other end of it.`,
  );

  // 4. Where business users should actually focus.
  parts.push(
    `For business users the focus should sit on four controls: handover discipline (seals, locks, photographic evidence at origin and destination); driver and yard-staff vetting on contracted hauliers; depot discipline on access, staffing and after-hours integrity; and routing that treats repeat-loss corridors as live exposure rather than a default lane choice. These are the controls that hold up across cycles regardless of how loud or quiet any single week looks.`,
  );

  return parts.join("\n\n");
}

// Auto-prose for the Situation section. The Fast Facts "Most Affected
// Country" card uses a raw total-records leader; this builder mirrors
// the same logic so the headline figure and the prose cannot disagree.
// When the logistics-hub leader differs from the overall leader, both
// are named so the country split is explicit, not contradictory.
export function buildCargoSituation(windowIncidents: CargoNarrativeIncident[]): string {
  const ctx = buildCargoAutoCtx(windowIncidents);
  if (ctx.windowIncidents.length === 0) {
    return `Warehouse, depot and road-corridor exposure persists regardless of how quiet the reporting window looks. Cargo-crime reporting is lumpy and a blank window should be read as a coverage gap, not confirmation that route-side or hub-side risk has eased.`;
  }
  const cp = countryPicture(ctx.windowIncidents, 3);
  const overall = cp.top[0]?.country ?? null;
  const hub = topCountries(ctx.hubMatches, 1)[0]?.country ?? null;
  const focus = `Warehouse, depot and road corridors hold the live exposure this cycle, with route familiarity and insider risk as the persistent drivers.`;
  let where = "";
  if (cp.strong && overall && hub && overall !== hub) {
    where = ` ${overall} leads total reporting on the file, while ${hub} leads logistics-hub and warehouse risk — both sit inside the same operating picture.`;
  } else if (cp.strong && overall) {
    where = ` ${overall} sits at the centre of the recurring geography on this cycle.`;
  } else if (cp.top.length > 0) {
    where = ` ${cp.line}`;
  }
  return `${focus}${where}`;
}

export function buildLogisticsHubRead(windowIncidents: CargoNarrativeIncident[]): string {
  const matches = windowIncidents.filter((i) => {
    const text = `${i.title} ${i.summary ?? ""}`;
    return LOGISTICS_HUB_RE.test(text);
  });
  if (matches.length === 0) {
    return `No qualifying warehouse, depot, terminal or yard incidents reached the file in this cycle. Logistics-hub losses often go unreported until insurance claims are filed, so a blank window does not redefine the underlying picture on storage and last-mile facilities.\n\nKeep tracking facility-security bulletins, insurer loss notices and any operator commentary on staffing or perimeter changes. Those are the early indicators that hub-side risk is firming on a specific corridor.`;
  }
  const lead = leadEntry(matches)!;
  const leadDate = recordDate(lead);
  const countryLine = countryPicture(matches, 3, "among these hub-side records").line;
  const intro = `Logistics hub risk across warehouses, depots, distribution centres, terminals and bonded storage appears across ${matches.length} qualifying record${matches.length === 1 ? "" : "s"} this cycle. The lead entry is "${lead.title}"${leadDate ? `, filed ${format(leadDate, "dd MMM yyyy")}` : ""}.`;
  const watch = `Watch for repeat incidents at the same facility or operator, escalation from pilferage to organised raids, and any insurance-premium movement on affected corridors. Hub-side losses typically precede a hardening of underwriting terms by one to two cycles.`;
  return `${intro} ${countryLine}\n\n${watch}`;
}

// --- Country Risk Breakdown -------------------------------------------------
// A per-country table for the Cargo Watch report: the recurring geographies
// named in the prose are broken out with a coloured five-tier risk rating, the
// dominant theft pattern, and a short operational read. Everything here is
// DERIVED from the in-window incidents — no hardcoded countries, ratings or
// patterns — so the table cannot drift from the data the rest of the report
// reads. The on-screen preview and the PDF both build from this one function
// and render the same rows in the same order.

const SEV_RANK_C: Record<string, number> = {
  insignificant: 1,
  low: 2,
  moderate: 3,
  high: 4,
  extreme: 5,
};
const SEV_LABEL_C: Record<string, string> = {
  insignificant: "Insignificant",
  low: "Low",
  moderate: "Moderate",
  high: "High",
  extreme: "Extreme",
};
const SEV_RANK_TO_KEY_C: Record<number, string> = {
  1: "insignificant",
  2: "low",
  3: "moderate",
  4: "high",
  5: "extreme",
};

export interface CargoCountryRow {
  country: string;
  count: number;
  /** Dominant theft pattern phrase, e.g. "Truck hijacking, container theft, route-side exposure". */
  pattern: string;
  /** Lowercase tier key used to colour the rating chip (the worst recurring tier). */
  severityKey: string;
  /** Display label — a single tier ("High") or a range ("Moderate to High"). */
  severityLabel: string;
  /** Whether route-side or hub-side reporting dominates this country (drives the read). */
  lead: "route" | "hub" | "mixed";
  operationalRead: string;
}

export interface CargoCountryBreakdown {
  rows: CargoCountryRow[];
  regionalRead: string;
}

function incidentText(i: CargoNarrativeIncident): string {
  return `${i.title} ${i.summary ?? ""}`;
}

// Group rows by attributed country (compounds split, Unknown dropped). A row
// attributed to two countries counts under each — matching topCountries().
function groupByCountry(
  rows: CargoNarrativeIncident[],
): Map<string, CargoNarrativeIncident[]> {
  const m = new Map<string, CargoNarrativeIncident[]>();
  for (const r of rows) {
    for (const c of splitAttributedCountries(r.country)) {
      const list = m.get(c) ?? [];
      list.push(r);
      m.set(c, list);
    }
  }
  return m;
}

// The country's rating reflects the PREVAILING (modal) tier, nudged up by AT
// MOST ONE tier and only when a strictly-higher tier RECURS (>=2 records). A
// single stray High never inflates an otherwise-Moderate country, and a mostly-
// Low country with a couple of Extremes reads "Low to Moderate" — not Extreme —
// so the coloured chip states the typical posture rather than the worst outlier.
function pickCountrySeverity(rows: CargoNarrativeIncident[]): {
  key: string;
  label: string;
} {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const k = (r.severity ?? "").trim().toLowerCase();
    if (SEV_RANK_C[k]) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  if (counts.size === 0) return { key: "moderate", label: "Moderate" };
  let modal = "";
  let modalCount = -1;
  let peakRepeated = "";
  for (const [k, c] of counts) {
    if (c > modalCount || (c === modalCount && SEV_RANK_C[k] > SEV_RANK_C[modal])) {
      modal = k;
      modalCount = c;
    }
    if (c >= 2 && (!peakRepeated || SEV_RANK_C[k] > SEV_RANK_C[peakRepeated])) {
      peakRepeated = k;
    }
  }
  if (peakRepeated && SEV_RANK_C[peakRepeated] > SEV_RANK_C[modal]) {
    // Cap the escalation at one tier above the prevailing rating.
    const cappedRank = Math.min(SEV_RANK_C[modal] + 1, SEV_RANK_C[peakRepeated]);
    const peakKey = SEV_RANK_TO_KEY_C[cappedRank];
    return { key: peakKey, label: `${SEV_LABEL_C[modal]} to ${SEV_LABEL_C[peakKey]}` };
  }
  return { key: modal, label: SEV_LABEL_C[modal] };
}

const LOC_EXPOSURE: Record<string, string> = {
  Warehouse: "warehouse exposure",
  Depot: "depot exposure",
  Airport: "airport cargo exposure",
  Port: "port-side exposure",
  Highway: "route-side exposure",
};

// The dominant theft pattern: the top one or two incident types present, plus
// the most common premises exposure. All derived from the cargo classifiers.
function patternPhrase(rows: CargoNarrativeIncident[]): string {
  const typeCounts = new Map<string, number>();
  const locCounts = new Map<string, number>();
  for (const r of rows) {
    const li = r as unknown as CargoIncidentLike;
    const t = classifyIncidentType(li);
    if (t && t !== "Other") typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
    const l = classifyLocationType(li);
    if (l && l !== "\u2014" && l !== "-") locCounts.set(l, (locCounts.get(l) ?? 0) + 1);
  }
  // "Other land-based cargo theft" is the classifier's weak fallback bucket.
  // Drop it from the pattern phrase whenever a stronger, named type exists so
  // the column reads on modus operandi, not on the catch-all label.
  const WEAK_TYPE = "Other land-based cargo theft";
  const typeEntries = [...typeCounts.entries()].sort((a, b) => b[1] - a[1]);
  const strong = typeEntries.filter((e) => e[0] !== WEAK_TYPE);
  const ranked = strong.length > 0 ? strong : typeEntries;
  const topTypes = ranked.slice(0, 2).map((e) => e[0]);
  const topLoc = [...locCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const parts = [...topTypes];
  // Avoid redundant wording like "Warehouse theft, warehouse exposure": only
  // add the premises exposure when its keyword is not already in a named type.
  if (topLoc && LOC_EXPOSURE[topLoc]) {
    const locWord = topLoc.toLowerCase();
    const dup = topTypes.some((t) => t.toLowerCase().includes(locWord));
    if (!dup) parts.push(LOC_EXPOSURE[topLoc]);
  }
  if (parts.length === 0) return "Mixed cargo theft";
  const phrase = parts.join(", ");
  return phrase.charAt(0).toUpperCase() + phrase.slice(1).toLowerCase();
}

function operationalReadFor(
  lead: "route" | "hub" | "mixed",
  severityKey: string,
): string {
  let s: string;
  if (lead === "route") {
    s = "Road-movement risk is the main exposure; concern rises for high-value loads moving outside secured corridors.";
  } else if (lead === "hub") {
    s = "Hub-side exposure dominates; watch depot and warehouse access, seal integrity and contractor vetting.";
  } else {
    s = "Mixed road and storage exposure; hold baseline route security and depot access controls.";
  }
  if (severityKey === "high" || severityKey === "extreme") {
    s += " Loss values and reporting point to organised targeting rather than casual theft.";
  }
  return s;
}

function joinCountryNames(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function buildRegionalRead(rows: CargoCountryRow[]): string {
  if (rows.length === 0) return "";
  const lead = rows[0];
  const hubNames = rows.filter((r) => r.lead === "hub").map((r) => r.country);
  const routeNames = rows.filter((r) => r.lead === "route").map((r) => r.country);
  const highest = rows
    .slice()
    .sort((a, b) => SEV_RANK_C[b.severityKey] - SEV_RANK_C[a.severityKey])[0];
  const parts: string[] = [];
  const leadFocus =
    lead.lead === "hub"
      ? "warehouse and depot-linked incidents clustering around logistics hubs"
      : lead.lead === "route"
        ? "road-movement incidents clustering on the route side"
        : "a mix of road-movement and storage incidents";
  parts.push(
    `${lead.country} is the lead pressure point this cycle on ${lead.count} record${lead.count === 1 ? "" : "s"}, with ${leadFocus}.`,
  );
  if (highest && highest.country !== lead.country && SEV_RANK_C[highest.severityKey] >= 4) {
    parts.push(
      `${highest.country} carries the highest severity (${highest.severityLabel.toLowerCase()}), consistent with organised, higher-value targeting rather than opportunistic theft.`,
    );
  }
  if (hubNames.length > 0 && routeNames.length > 0) {
    parts.push(
      `For clients the practical split is simple: ${joinCountryNames(hubNames)} need hub-control scrutiny on access, seals and vendor vetting, while ${joinCountryNames(routeNames)} need route security and driver and vendor control.`,
    );
  } else if (hubNames.length > 0) {
    parts.push(
      `For clients the focus is hub control across ${joinCountryNames(hubNames)} — depot access, seal integrity and vendor vetting.`,
    );
  } else if (routeNames.length > 0) {
    parts.push(
      `For clients the focus is route security across ${joinCountryNames(routeNames)} — corridor selection, escorts on high-value loads and driver vetting.`,
    );
  }
  return parts.join(" ");
}

export function buildCargoCountryBreakdown(
  windowIncidents: CargoNarrativeIncident[],
  maxRows = 6,
): CargoCountryBreakdown {
  const groups = groupByCountry(windowIncidents);
  const entries = [...groups.entries()]
    .map(([country, rows]) => ({ country, rows }))
    .sort((a, b) => b.rows.length - a.rows.length);
  // Prefer the recurring geographies (>=2 records). Fall back to whatever is
  // attributed when the window is too thin to have repeats, so the table still
  // renders rather than silently vanishing.
  const recurring = entries.filter((e) => e.rows.length >= 2);
  const chosen = (recurring.length >= 2 ? recurring : entries).slice(0, maxRows);
  const rows: CargoCountryRow[] = chosen.map(({ country, rows }) => {
    const sev = pickCountrySeverity(rows);
    const routeSide = rows.filter((r) => CARGO_SECURITY_RE.test(incidentText(r))).length;
    const hubSide = rows.filter((r) => LOGISTICS_HUB_RE.test(incidentText(r))).length;
    let lead: "route" | "hub" | "mixed";
    if (routeSide === 0 && hubSide === 0) lead = "mixed";
    else if (routeSide > hubSide) lead = "route";
    else if (hubSide > routeSide) lead = "hub";
    else lead = "mixed";
    return {
      country,
      count: rows.length,
      pattern: patternPhrase(rows),
      severityKey: sev.key,
      severityLabel: sev.label,
      lead,
      operationalRead: operationalReadFor(lead, sev.key),
    };
  });
  return { rows, regionalRead: buildRegionalRead(rows) };
}
