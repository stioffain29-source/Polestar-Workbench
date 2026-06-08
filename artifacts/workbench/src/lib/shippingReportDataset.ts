import { format, parseISO, max as dateMax } from "date-fns";
import { resolveReportWindow, filterIncidentsToWindow } from "./reportWindow";
import { isTopicRelevant } from "./topicRelevance";
import {
  CHOKEPOINTS, detectChokepoints, classifyPiracy,
  classifyVesselIncident, type VesselIncidentType,
  classifyIssue,
  classifyRegion, REGION_COLOR, type Region,
  TRANSIT_ISSUES, COMMERCIAL_ISSUES,
  type ChokepointKey,
  isLowCredibilityShippingRecord,
  isConfirmedOperationalIncident,
  FREIGHT_MARKET_INDEX_RE,
} from "./shippingAnalysis";
import { deriveIncidentCountry, LOCATION_NOT_IDENTIFIED } from "./shippingCountry";

// Single source of truth for the Shipping report's analysed dataset.
// Both the PDF exporter (exportShippingReportPdf) and the on-screen
// editor preview (ShippingReportPreview) consume this so they cannot drift.

export interface ShippingReportIncident {
  id: number | string;
  title: string;
  topic: string;
  severity: string;
  occurredAt: string;
  country?: string | null;
  summary?: string | null;
  source?: string | null;
  sourceUrl?: string | null;
  location?: string | null;
}

export interface EnrichedIncident extends ShippingReportIncident {
  date: Date;
  incidentCountry: string | null;
  region: Region;
  issue: string;
}

export interface VesselRow extends EnrichedIncident { vesselType: VesselIncidentType }
export interface PiracyRow extends EnrichedIncident { act: NonNullable<ReturnType<typeof classifyPiracy>> }

export interface KpiCard {
  label: string;
  value: string;
  note?: string;
  /** Lowercase severity key — used to pick the accent colour. */
  severity?: string;
}

export interface ChokepointRow {
  name: ChokepointKey;
  count: number;
  highestSeverityKey: string; // "" when empty
  highestSeverityLabel: string;
  latestDate: Date | null;
  latestTitle: string | null;
  readText: string;
}

export interface BarRow { label: string; value: number; color?: string }

export interface ShippingReportDataset {
  reportingPeriodShort: string;
  reportingPeriodLong: string;
  /** Short date-range label for the report window (Chokepoint / Vessel / Piracy). */
  thirtyDayShortLabel: string;
  enriched: EnrichedIncident[];
  outOfScopeCount: number;
  fastFacts: KpiCard[];
  /** Count of records in the weekly window whose incident location could not be identified. */
  locationNotIdentifiedCount: number;
  /** Chokepoint Watch over the report window. */
  chokepointRows: ChokepointRow[];
  /** Vessel attacks over the report window. */
  vesselRows: VesselRow[];
  /** Piracy / armed robbery over the report window. */
  piracyRows: PiracyRow[];
  regionRows: BarRow[];
  countryRows: BarRow[];
  commercialRows: EnrichedIncident[];
  /** Analyst-prose reads. Each one introduces the data that follows it. */
  chokepointRouteRead: string;
  vesselPiracyRead: string;
  commercialImpactRead: string;
  regionalCountryRead: string;
  /** Prioritised in-window operational incidents for the closing table. */
  relatedIncidents: EnrichedIncident[];
  /** Auto-derived analyst prose, used when the editor leaves the matching
   *  section blank. Editor-authored text always wins when supplied. */
  autoWhatMatters: string;
  autoImplications: string;
  autoWatchNext: string;
  autoPolestarView: string;
  dataNote: string;
}

const SEV_RANK: Record<string, number> = {
  insignificant: 1, low: 2, moderate: 3, high: 4, extreme: 5,
};
const SEV_LABEL: Record<string, string> = {
  insignificant: "Insignificant", low: "Low", moderate: "Moderate", high: "High", extreme: "Extreme",
};
// Five-tier severity palette. Kept separate from the Polestar brand
// colours so the tiers remain visually distinguishable.
const SEV_COLOR: Record<string, string> = {
  insignificant: "#B8C2CC", low: "#6FB872", moderate: "#E67E22", high: "#C0392B", extreme: "#800000",
};

function sevKey(s: string | null | undefined): string {
  return (s ?? "").toLowerCase();
}
function highestSeverity(rows: ShippingReportIncident[]): { key: string; label: string } {
  let key = "", rank = 0;
  for (const r of rows) {
    const k = sevKey(r.severity);
    const v = SEV_RANK[k] ?? 0;
    if (v > rank) { rank = v; key = k; }
  }
  return { key, label: key ? (SEV_LABEL[key] ?? key) : "—" };
}

function enrich(rows: ShippingReportIncident[]): EnrichedIncident[] {
  return rows
    .map((r) => {
      let date: Date;
      try { date = parseISO(r.occurredAt); } catch { date = new Date(NaN); }
      const incidentCountry = deriveIncidentCountry(r);
      return {
        ...r,
        date,
        incidentCountry,
        region: classifyRegion(incidentCountry),
        issue: classifyIssue(r),
      };
    })
    .filter((r) => !isNaN(r.date.getTime()));
}

function sortByDateDesc<T extends { date: Date }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.date.getTime() - a.date.getTime());
}

// --- Source-credibility helpers --------------------------------------------
// Noise / human-interest / low-credibility filters used to live here. They
// now live in `shippingAnalysis.ts` as the single source of truth so the
// Shipping page and the Shipping report PDF apply identical exclusions.
// Local alias kept so the existing call sites read naturally.
const isLowCredibilitySource = isLowCredibilityShippingRecord;

// --- Dedupe helpers --------------------------------------------------------
// Maritime stories get syndicated heavily — the same vessel attack or
// seizure routinely appears under five or six near-identical headlines on
// the same day. Collapse those before they dominate the tables.

function normaliseTitle(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[\u2018\u2019\u201C\u201D"'`]/g, "")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const TITLE_STOP = new Set([
  "the", "a", "an", "of", "in", "on", "at", "to", "for", "and", "as", "by",
  "off", "near", "after", "amid", "with", "from", "into", "over", "under",
  "says", "say", "said", "reports", "report", "warning", "warns", "amid",
  "is", "are", "was", "were", "be", "been", "being", "has", "have", "had",
  "its", "it", "this", "that", "these", "those", "new",
]);

function titleKey(s: string): string {
  // First 6 significant words. Tighter than 8 so re-ordered syndicated
  // rewrites collapse together.
  return normaliseTitle(s)
    .split(" ")
    .filter((w) => w && !TITLE_STOP.has(w))
    .slice(0, 6)
    .join(" ");
}

function topicSignature(title: string, date: Date): string {
  // Date-bucketed signature based on the 5 longest substantive words,
  // sorted alphabetically. Catches syndicated rewrites that keep the
  // same nouns / event words but reorder or rephrase them (e.g.
  // "Iran seizes oil tanker in Hormuz" vs "Oil tanker held by Iranian
  // forces near Strait of Hormuz"). The two-day bucket allows for
  // wire-pickup lag without merging unrelated incidents.
  const day = date.toISOString().slice(0, 10);
  const yyyy = day.slice(0, 4);
  const mm = day.slice(5, 7);
  const dd = Number(day.slice(8, 10));
  const bucket = `${yyyy}-${mm}-p${Math.floor((dd - 1) / 2)}`;
  const words = normaliseTitle(title)
    .split(" ")
    .filter((w) => w && !TITLE_STOP.has(w) && w.length >= 4);
  const top = [...new Set(words)]
    .sort((a, b) => b.length - a.length || a.localeCompare(b))
    .slice(0, 5)
    .sort();
  return `${bucket}|${top.join(" ")}`;
}

// Event-key dedupe for vessel rows — CONSERVATIVE, shared by the REPORT.
// The same UAE/Hormuz seizure often shows up under five or six rewrites on the
// same day with different noun ordering ("Vessel seized off UAE coast", "UKMTO
// says vessel seized off UAE", "Hormuz Crisis: Vessel Seized Off UAE Heading to
// Iran") — `dedupeByTitle` keeps them apart because the first 6 significant
// words diverge. This pass collapses anything sharing the same {day, act,
// chokepoint/country anchor-set}. It deliberately keys on the EXACT calendar day
// and EXACT anchor subset so it only ever merges near-identical same-day copies
// — the report's vessel section is the comprehensive product, so it must not
// risk collapsing two genuinely distinct incidents. (The monitor uses the wider
// `dedupeVesselEventsClustered` below for one-event-one-card summary cards.)
function vesselEventKey<T extends { title: string; date: Date; vesselType: VesselIncidentType }>(r: T): string {
  const day = r.date.toISOString().slice(0, 10);
  const text = (r.title ?? "").toLowerCase();
  const anchors: string[] = [];
  const anchorTests: [RegExp, string][] = [
    [/\bhormuz\b/, "hormuz"],
    [/\bbab[\s-]?el[\s-]?mandeb\b/, "bab"],
    [/\bred\s*sea\b/, "redsea"],
    [/\bgulf\s+of\s+oman\b/, "gulfoman"],
    [/\bpersian\s+gulf|arabian\s+gulf\b/, "persiangulf"],
    [/\bsuez\b/, "suez"],
    [/\bmalacca\b/, "malacca"],
    [/\bsingapore\s+strait\b/, "sgstrait"],
    [/\buae|emirates|abu\s+dhabi|dubai|fujairah\b/, "uae"],
    [/\biran(ian)?\b/, "iran"],
    [/\bsomalia(n)?\b/, "somalia"],
    [/\byemen|houthi\b/, "yemen"],
  ];
  for (const [re, tag] of anchorTests) if (re.test(text)) anchors.push(tag);
  const act = r.vesselType.toLowerCase();
  return `${day}|${act}|${anchors.sort().join(",")}`;
}
function dedupeByEventKey<T extends { title: string; date: Date; severity: string; vesselType: VesselIncidentType }>(rows: T[]): T[] {
  const better = (a: T, b: T) => {
    const sa = SEV_RANK[sevKey(a.severity)] ?? 0;
    const sb = SEV_RANK[sevKey(b.severity)] ?? 0;
    if (sa !== sb) return sa > sb;
    return a.date.getTime() >= b.date.getTime();
  };
  const out = new Map<string, T>();
  for (const r of rows) {
    const k = vesselEventKey(r);
    // Empty-anchor rows shouldn't collapse together — keep them distinct
    // unless their title also collides.
    if (k.endsWith("|")) { out.set(`__${r.title}|${k}`, r); continue; }
    const prev = out.get(k);
    if (!prev || better(r, prev)) out.set(k, r);
  }
  return Array.from(out.values());
}

// Coarse maritime theatre of a vessel headline. The fine-grained anchors
// (hormuz / uae / iran / gulf of oman ...) all describe ONE chokepoint complex,
// so a single seizure picked up by different wires cites different subsets ("off
// UAE", "near Strait of Hormuz", "heading to Iran"). Used ONLY by the monitor's
// aggressive clusterer below.
const COARSE_REGION_TESTS: [RegExp, string][] = [
  [/\bhormuz\b|\bgulf\s+of\s+oman\b|\bpersian\s+gulf|arabian\s+gulf\b|\buae\b|emirates|abu\s+dhabi|dubai|fujairah|\biran(ian)?\b|\boman\b|\bqatar\b|\bdoha\b/, "gulf"],
  [/\bbab[\s-]?el[\s-]?mandeb\b|\bred\s*sea\b|\byemen|houthi\b|\baden\b/, "redsea"],
  [/\bsuez\b/, "suez"],
  [/\bmalacca\b|\bsingapore\s+strait\b/, "malacca"],
  [/\bsomalia(n)?\b/, "somalia"],
];
function coarseRegion(title: string): string {
  const text = (title ?? "").toLowerCase();
  for (const [re, tag] of COARSE_REGION_TESTS) if (re.test(text)) return tag;
  return "";
}

// Aggressive vessel-event clustering — MONITOR ONLY. The same seizure drifts
// across several calendar days as wires re-pick it up ("13 May Hormuz Crisis:
// Vessel Seized Off UAE Heading to Iran", "14 May Vessel seized off UAE coast,
// moved toward Iranian waters", "15 May UKMTO Reports Vessel Seized Near Strait
// of Hormuz"), and each wire names a different anchor subset, so neither
// `dedupeByTitle` nor the exact-day `dedupeByEventKey` collapses them. The
// monitor's vessel cards are an explicit SUMMARY ("Full records remain available
// in the incident table"), so here we group by {act, coarse theatre} and
// single-link in time: rows of the same act in the same theatre within a few
// days of each other collapse to ONE row (most severe / most recent), so the
// same incident can never show as both Extreme and Low. This is intentionally
// more aggressive than the report path and is NOT used by the report, which must
// stay comprehensive. Headlines with no recognised theatre pass through
// untouched — only the earlier title/signature passes can merge those.
const EVENT_GAP_DAYS = 3; // max gap between consecutive copies in a cluster
const EVENT_SPAN_DAYS = 6; // max total spread of one cluster (anti-chaining)
function dedupeVesselEventsClustered<T extends { title: string; date: Date; severity: string; vesselType: VesselIncidentType }>(rows: T[]): T[] {
  const better = (a: T, b: T) => {
    const sa = SEV_RANK[sevKey(a.severity)] ?? 0;
    const sb = SEV_RANK[sevKey(b.severity)] ?? 0;
    if (sa !== sb) return sa > sb;
    return a.date.getTime() >= b.date.getTime();
  };
  const DAY = 86_400_000;
  const groups = new Map<string, T[]>();
  const passthrough: T[] = [];
  for (const r of rows) {
    const region = coarseRegion(r.title);
    if (!region) { passthrough.push(r); continue; }
    const gk = `${r.vesselType.toLowerCase()}|${region}`;
    const arr = groups.get(gk);
    if (arr) arr.push(r); else groups.set(gk, [r]);
  }
  const out: T[] = [...passthrough];
  for (const grp of groups.values()) {
    const sorted = [...grp].sort((a, b) => a.date.getTime() - b.date.getTime());
    let cluster: T[] = [];
    let prevMs = -Infinity;
    let startMs = -Infinity;
    const flush = () => {
      if (!cluster.length) return;
      out.push(cluster.reduce((best, r) => (better(r, best) ? r : best)));
      cluster = [];
    };
    for (const r of sorted) {
      const t = r.date.getTime();
      const sameCluster =
        cluster.length > 0 &&
        t - prevMs <= EVENT_GAP_DAYS * DAY &&
        t - startMs <= EVENT_SPAN_DAYS * DAY;
      if (sameCluster) {
        cluster.push(r);
        prevMs = t;
      } else {
        flush();
        cluster.push(r);
        startMs = t;
        prevMs = t;
      }
    }
    flush();
  }
  return out;
}

function dedupeByTitle<T extends { title: string; date: Date; severity: string }>(rows: T[]): T[] {
  // Two-pass: exact-title-key dedupe (catches direct republishing), then
  // date+nouns signature dedupe (catches reworded syndication). Keeps
  // the higher-severity / more-recent version of each underlying event.
  const better = (a: T, b: T) => {
    const sa = SEV_RANK[sevKey(a.severity)] ?? 0;
    const sb = SEV_RANK[sevKey(b.severity)] ?? 0;
    if (sa !== sb) return sa > sb;
    return a.date.getTime() >= b.date.getTime();
  };
  const byTitle = new Map<string, T>();
  for (const r of rows) {
    const k = titleKey(r.title);
    if (!k) { byTitle.set(`__${Math.random()}`, r); continue; }
    const prev = byTitle.get(k);
    if (!prev || better(r, prev)) byTitle.set(k, r);
  }
  const bySig = new Map<string, T>();
  for (const r of byTitle.values()) {
    const k = topicSignature(r.title, r.date);
    const prev = bySig.get(k);
    if (!prev || better(r, prev)) bySig.set(k, r);
  }
  return Array.from(bySig.values());
}

// Monitor-side deduplication. The Shipping monitor page (Shipping.tsx) renders
// a cleaned + deduplicated SUMMARY — one card per real event. It runs the same
// noise filter and title/signature dedupe as the report, but for vessel rows it
// uses the wider `dedupeVesselEventsClustered` (same act + coarse theatre within
// a few days collapses to one) instead of the report's conservative exact-day
// `dedupeByEventKey`. This is deliberate: the same seizure drifts across several
// calendar days under different wire headlines, and the monitor must show it as
// ONE card (never both Extreme and Low). The report keeps the conservative pass
// because it is the comprehensive product and must not risk merging two distinct
// incidents. Clustering is applied ONLY to vessel rows — running it across all
// rows would wrongly merge unrelated same-theatre items.
export function dedupeShippingMonitorRows<
  T extends {
    title: string;
    severity: string;
    occurredDate: Date;
    summary?: string | null;
    location?: string | null;
    source?: string | null;
    sourceUrl?: string | null;
  },
>(rows: T[]): T[] {
  const tagged = rows.map((r) => ({
    ...r,
    date: r.occurredDate,
    vesselType: classifyVesselIncident(r),
  }));
  // Rows with an unparseable date can't be keyed (the dedupe helpers call
  // `date.toISOString()`, which throws on an invalid Date). They were never
  // deduped under the old monitor pipeline either, so pass them through
  // untouched rather than dropping them or crashing.
  const validDate = (r: { date: Date }) => !isNaN(r.date.getTime());
  const undatable = tagged.filter((r) => !validDate(r));
  const datable = tagged.filter(validDate);
  const vessel = datable.filter(
    (r): r is typeof r & { vesselType: VesselIncidentType } => r.vesselType !== null,
  );
  const nonVessel = datable.filter((r) => r.vesselType === null);
  const deduped = [
    ...dedupeVesselEventsClustered(dedupeByTitle(vessel)),
    ...dedupeByTitle(nonVessel),
    ...undatable,
  ];
  return deduped as unknown as T[];
}

// Pure shipping-market / corporate-finance items with no operational hook
// (vessel S&P stories, newbuild orders, earnings, fleet finance, etc.).
// These get filtered out of the Commercial Impact table unless the title or
// summary also carries an operational/insurance/freight-pressure signal.
const MARKET_ONLY_RE = /\b(newbuild|newbuilds|orderbook|order\s*book|sale\s*and\s*purchase|s\s*&\s*p\b|secondhand|second-hand|cashes?\s*in|cashed\s*in|lands?\s*\$|raises?\s*\$|secures?\s*\$|earnings|q[1-4]\s*results|annual\s*results|profit|ipo\b|listing|share\s*price|stock\s*price|shareholder|dividend|acquisition|acquires?|merger|takeover|bondholder|fleet\s*sale|fleet\s*purchase|scrapping|demolition|recycling|sells|bought|buys|charter\s*rate|time-?charter|fixture|tonnage\s*deal|suezmax\s*pair|vlcc\s*pair)\b/i;
const OPERATIONAL_HOOK_RE = /\b(port|strike|closure|closes?|closed|delay|delayed|diversion|diverted|detain|detained|seizure|seized|attack|attacked|hijack|piracy|advisory|advisories|war[\s-]?risk|insurance|premium|premiums|sanction|sanctions|disruption|congest|congestion|backlog|blocked|blockade|terminal|berth|cargo\s*flow|chokepoint|hormuz|red\s*sea|bab[\s-]?el[\s-]?mandeb|suez|malacca|hostilit|crew\s*change|missile|drone|houthi|ukmtu|ukmto|imb|p&i|protection\s*and\s*indemnity)\b/i;

function isShippingMarketOnly(r: ShippingReportIncident): boolean {
  const text = `${r.title ?? ""} ${r.summary ?? ""}`;
  if (MARKET_ONLY_RE.test(text) && !OPERATIONAL_HOOK_RE.test(text)) return true;
  // Pure freight-market index commentary (Drewry / WCI / BDI / SCFI /
  // weekly rate-tracker headlines) is blocked outright unless the same
  // headline also carries a true operational anchor.
  if (FREIGHT_MARKET_INDEX_RE.test(text) && !OPERATIONAL_HOOK_RE.test(text)) return true;
  return false;
}

// Stronger commercial-operational anchor than OPERATIONAL_HOOK_RE alone.
// Used by the Commercial Impact gate so generic mentions of "port" or
// "insurance" inside a freight-market piece don't sneak through. We
// require a verb or event word that signals real-world disruption.
const COMMERCIAL_OPERATIONAL_RE = /\b(port (clos|closes|closed|closure|shut|halt|disrupt|congest|congestion|strike|stoppage|stopped|fire|blast|outage)|berth (clos|closes|closed|closure|congest|congestion|delay|delays|delayed)|terminal (clos|closes|closed|closure|fire|congest|disrupt|outage)|dock(workers?| strike|workers strike|workers walk)|stevedore strike|wharf (strike|stoppage)|canal (clos|closes|closed|closure|congest|congestion|disrupt|halt)|(vessel|ship|tanker|carrier|fleet) (divert|diverted|reroute|rerouted|re-?routed|delay|delayed|stranded|adrift|grounded|stopped|halt|halted|skipped)|skip(ping)? (port|call|calls)|port skipping|schedule (slip|slippage|disruption|reliability|miss|missed)|sailing cancel|blank sailing|service (suspension|suspended|cancel|cancelled|withdrawn)|liner service (suspension|cancel|cancelled)|war[\s-]?risk (premium|surcharge|adjust|adjustment|widened|extended|raised|raise|hike|hiked|review|reviewed)|insurance (premium|surcharge) (rise|rises|risen|jump|jumped|hike|hiked|adjust|adjustment|widen|widened|extended|raised|raise)|p&i (premium|surcharge|warning|advisory)|protection and indemnity (premium|warning|advisory)|surcharge (introduce|introduced|impose|imposed|raise|raised|hike|hiked|extend|extended)|advisory (issued|expanded|extended|widened|tightened)|naval (escort|patrol|protection)|convoy (operation|escort|protection)|crew (change|repatriation) (disrupt|delay|delayed|suspended|halted)|cargo (flow|movement|disruption|halt|backlog|backlogged)|export (halt|suspension|suspended|ban|banned)|import (halt|disruption|backlog)|attack(ed)? .{0,30}(vessel|tanker|ship|carrier|port|terminal)|seiz(ed|ure)? .{0,30}(vessel|tanker|ship|carrier|cargo)|hijack(ed)? .{0,30}(vessel|tanker|ship|carrier|cargo)|drone .{0,30}(vessel|tanker|ship|carrier|port|terminal)|missile .{0,30}(vessel|tanker|ship|carrier|port|terminal))\b/i;

export function buildShippingReportDataset(
  incidents: ShippingReportIncident[],
  topic: string,
  issueDate: string,
): ShippingReportDataset {
  const win = resolveReportWindow(topic, issueDate);

  // Same scope filter as the Shipping dashboard: shipping topic only, strip
  // off-topic noise, then drop records that classify outside APAC + ME.
  const rawWindow = filterIncidentsToWindow(incidents, topic, issueDate, { byTopic: true });
  const passesShipping = (i: ShippingReportIncident) =>
    isTopicRelevant(topic, {
      topic: i.topic,
      title: i.title,
      summary: i.summary ?? null,
      source: i.source ?? null,
      sourceUrl: i.sourceUrl ?? null,
      location: i.location ?? null,
    });
  const windowed = rawWindow.filter(passesShipping);
  const enrichedAll = sortByDateDesc(enrich(windowed));
  const enriched = enrichedAll.filter((r) => r.region !== "Out of scope");
  const outOfScopeCount = enrichedAll.length - enriched.length;
  // Single canonical pool of CONFIRMED operational incidents — the same gate
  // every incident table uses. The headline KPIs (Confirmed Incidents,
  // Highest Severity, Latest Significant Incident) all read from this so the
  // top-of-report numbers can never exceed what the tables below actually
  // list. The region/country DISTRIBUTION charts keep the broader `enriched`
  // set on purpose (they answer "where did reporting cluster", a different
  // question) and are labelled "Records by …" so the two are never confused.
  const confirmedIncidents = enriched.filter((r) => isConfirmedOperationalIncident(r));

  // Chokepoint Watch, Vessel Attacks and Piracy / Armed Robbery are bounded to
  // the SAME report window as every other section. They previously used a
  // rolling 30-day look-back, which surfaced pre-window incidents beneath a
  // current-dated cover. Option A: a report describes one window only, so the
  // reader never sees stale records presented as part of the current cycle.
  const endDate = win.end;
  const start30 = win.start;
  const start30Ms = start30.getTime();
  const end30Ms = endDate.getTime();
  const raw30 = incidents.filter((i) => {
    if (i.topic !== topic) return false;
    try {
      const d = parseISO(i.occurredAt);
      if (isNaN(d.getTime())) return false;
      const ms = d.getTime();
      return ms >= start30Ms && ms <= end30Ms;
    } catch { return false; }
  });
  const windowed30 = raw30.filter(passesShipping);
  const enriched30 = sortByDateDesc(enrich(windowed30)).filter((r) => r.region !== "Out of scope");
  const thirtyDayShortLabel = `${format(start30, "d MMM")} - ${format(endDate, "d MMM yyyy")}`;

  // Chokepoint counts — derived from the report window so the headline
  // "Main Affected Chokepoint" matches the Chokepoint Watch table below.
  // Only CONFIRMED operational events feed the headline count, so political
  // closure rhetoric/claims, planning/intent language, advisory/escort
  // posture, transit-volume commentary, media-packaging wrappers and
  // human-interest follow-ups can no longer inflate "Main Affected
  // Chokepoint". Bab-el-Mandeb (or any chokepoint) is therefore never shown
  // as an affected chokepoint on the strength of an unconfirmed mention.
  const cpCounts = new Map<ChokepointKey, number>();
  for (const r of enriched30) {
    if (!isConfirmedOperationalIncident(r)) continue;
    for (const cp of detectChokepoints(r)) cpCounts.set(cp, (cpCounts.get(cp) ?? 0) + 1);
  }
  let topCp: ChokepointKey | "" = "", topCpN = 0;
  for (const [k, v] of cpCounts) if (v > topCpN) { topCpN = v; topCp = k; }

  // Region counts (weekly window — drives Regional and Country View charts)
  const regionCounts = new Map<Region, number>();
  for (const r of enriched) regionCounts.set(r.region, (regionCounts.get(r.region) ?? 0) + 1);
  let topRegion: Region | "" = "", topRegionN = 0;
  for (const [k, v] of regionCounts) {
    if (k === "Country not identified") continue;
    if (v > topRegionN) { topRegionN = v; topRegion = k; }
  }

  // Vessel / piracy — bounded to the report window so the dedicated
  // sections describe the same cycle as every other section.
  //
  // Two passes:
  //   1. Syndicated dupes (same headline picked up by five wires on the
  //      same day) are collapsed via `dedupeByTitle` — keeps the most
  //      severe / most recent version of each underlying incident.
  //   2. Tables are capped at 12 rows each, prioritising attack/seizure
  //      over softer boarding/approach activity so the section stops
  //      visually dominating the report on noisy cycles.
  const vesselAll: VesselRow[] = sortByDateDesc(
    enriched30
      .map((r) => ({ ...r, vesselType: classifyVesselIncident(r) as VesselIncidentType | null }))
      // The "Vessel Attacks" table is for confirmed hostile vessel
      // incidents only. A bare advisory ("Threat" — e.g. a UKMTO
      // "threat to shipping remains critical" warning) is not an attack:
      // it describes elevated risk, not a physical event, and rates LOW on
      // the incident-severity scale, so listing it as an "attack" reads as a
      // contradiction (critical-sounding headline, LOW chip). Keep only the
      // concrete physical types (Attack / Near miss / Seized).
      .filter((r): r is VesselRow => r.vesselType !== null && r.vesselType !== "Threat")
      // Drop repatriation / crew-return human-interest items, speculative
      // "X claims missile strike" rumour traffic, generic commentary and
      // social/handle sources before they reach the table or the prose.
      .filter((r) => !isLowCredibilitySource(r)),
  );
  const vesselDeduped = dedupeByEventKey(dedupeByTitle(vesselAll));
  const vesselHostile = vesselDeduped.filter(
    (r) => r.vesselType === "Attack" || r.vesselType === "Seized",
  );
  const vesselOther = vesselDeduped.filter(
    (r) => r.vesselType !== "Attack" && r.vesselType !== "Seized",
  );
  const VESSEL_TABLE_CAP = 12;
  // Hostile (attack / seizure) rows always take priority for the cap.
  // Only when there is headroom do softer boarding / approach records
  // fill the remaining slots. Each bucket is sorted newest-first inside
  // its own group so we never displace a hostile row with a fresher
  // non-hostile one.
  const hostileSorted = sortByDateDesc(vesselHostile);
  const otherSorted = sortByDateDesc(vesselOther);
  const hostileSlice = hostileSorted.slice(0, VESSEL_TABLE_CAP);
  const remaining = VESSEL_TABLE_CAP - hostileSlice.length;
  const vesselRows: VesselRow[] =
    remaining > 0
      ? [...hostileSlice, ...otherSorted.slice(0, remaining)]
      : hostileSlice;
  const vAttackSeize = vesselHostile.length;

  const piracyAll: PiracyRow[] = sortByDateDesc(
    enriched30
      .filter((r) => !isLowCredibilitySource(r))
      .map((r) => ({ ...r, act: classifyPiracy(r) }))
      .filter((r): r is PiracyRow => r.act !== null),
  );
  const PIRACY_TABLE_CAP = 12;
  const piracyRows: PiracyRow[] = dedupeByTitle(piracyAll).slice(0, PIRACY_TABLE_CAP);

  // Highest Severity reads from the confirmed pool so the chip can never be
  // driven by an advisory/claim record the incident tables do not list.
  const hsAll = highestSeverity(confirmedIncidents);
  const latestDate = enriched.length > 0 ? dateMax(enriched.map((r) => r.date)) : null;
  // Latest Significant Incident must skip repatriation / crew-return /
  // social-handle / speculative-claim records so the headline can't be
  // hijacked by a human-interest follow-up that happens to be tagged
  // extreme. Falls back to the raw most-recent record only if the cleaned
  // pool is empty.
  // Capability / procurement / exercise stories (e.g. a navy's new
  // minehunting drone) are also excluded here so a capability headline can
  // never be promoted to Latest Significant Incident in place of a real
  // operational event.
  // Latest Significant Incident is drawn from the SAME confirmed-operational
  // pool that feeds the Related Incidents table, so the headline card can
  // never name a claim, threat, advisory or commentary item the table does
  // not also carry. If no confirmed event exists in the window, the card
  // reads "—" rather than falling back to rhetoric or a human-interest row.
  const latestSig = sortByDateDesc(confirmedIncidents).find((r) => r.severity === "extreme" || r.severity === "high")
    ?? sortByDateDesc(confirmedIncidents)[0]
    ?? null;

  // Single, deduplicated Fast Facts grid (7 cards).
  const fastFacts: KpiCard[] = [
    { label: "Reporting Period", value: win.shortLabel },
    // Labelled "Confirmed Incidents" (not "Records In Window") and counted
    // from the confirmed pool so it tallies with the incident tables below.
    // The old "Records In Window" counted every `enriched` record (e.g. 55),
    // which dwarfed the visible tables (2 vessel attacks, 0 piracy, 2
    // chokepoint) and collided with the broad "Records by …" charts that use
    // the same word. Distinct label + confirmed count removes both clashes.
    { label: "Confirmed Incidents", value: String(confirmedIncidents.length) },
    { label: "Highest Severity", value: hsAll.label, severity: hsAll.key || undefined },
    {
      label: "Main Affected Chokepoint",
      value: topCp || "—",
      note: topCpN > 0
        ? `${topCpN} record${topCpN === 1 ? "" : "s"}`
        : (topRegion ? `Fallback to region: ${topRegion} (${topRegionN})` : "No chokepoint mention in window"),
    },
    { label: "Vessel Attacks / Seizures", value: String(vAttackSeize) },
    {
      label: "Piracy / Armed Robbery",
      value: String(piracyRows.length),
      note: piracyRows.length > 0
        ? `Latest record in window: ${format(piracyRows[0].date, "dd MMM yyyy")}`
        : "No qualifying piracy record in window",
    },
    {
      label: "Latest Significant Incident",
      value: latestSig ? format(latestSig.date, "dd MMM yyyy") : "—",
      severity: latestSig ? sevKey(latestSig.severity) : undefined,
      note: latestSig ? latestSig.title : undefined,
    },
  ];

  // Chokepoint Watch rows — report window.
  // The lead "operational read" must come from a credible maritime / security /
  // industry / news source. Social-media-style records (e.g. titles starting
  // with "@" or sources matching twitter/x.com/instagram/etc.) may still sit
  // in the underlying count, but they are not allowed to drive the narrative.
  // If only low-credibility records exist for a chokepoint, fall back to a
  // low-confidence note instead of quoting them.
  const chokepointRows: ChokepointRow[] = CHOKEPOINTS.map((cp) => {
    // Use credible-only records for count, highest severity, latest date
    // and latest title so the Chokepoint Watch row cannot quote a
    // repatriation / social-handle / speculative-claim record. Page rows
    // are built the same way (cleanEnriched) — the two surfaces must
    // agree.
    const credible = enriched30
      .filter((r) => detectChokepoints(r).includes(cp))
      .filter((r) => isConfirmedOperationalIncident(r));
    const hs = highestSeverity(credible);
    const credibleSorted = sortByDateDesc(credible);
    const credibleLatest = credibleSorted[0] ?? null;
    let readText: string;
    if (credible.length === 0) {
      readText = "Quiet across the reporting window; no qualifying activity on file.";
    } else if (credible.length === 1) {
      readText = `Activity here was anchored by a single entry, "${credibleLatest!.title}", in the reporting window.`;
    } else {
      readText = `Reporting was led by "${credibleLatest!.title}", with ${credible.length} qualifying records in the reporting window.`;
    }
    return {
      name: cp,
      count: credible.length,
      highestSeverityKey: hs.key,
      highestSeverityLabel: hs.label,
      latestDate: credibleLatest ? credibleLatest.date : null,
      latestTitle: credibleLatest ? credibleLatest.title : null,
      readText,
    };
  });

  // Commercial Impact must stay focused on the operational consequence of
  // shipping disruption: port closures, route diversion, schedule
  // reliability, war-risk / P&I premium movement, cargo flow impact and
  // insurance pressure with a route or vessel anchor. Pure shipping-market
  // commentary (vessel S&P, newbuilds, fleet finance, earnings, share-price
  // moves, freight-rate-only stories with no disruption anchor) is filtered
  // out so the section does not drift into freight-market reporting.
  const commercialRecords = dedupeByTitle(
    enriched
      .filter((r) => COMMERCIAL_ISSUES.has(r.issue))
      .filter((r) => !isShippingMarketOnly(r))
      .filter((r) => !FREIGHT_MARKET_INDEX_RE.test(`${r.title ?? ""} ${r.summary ?? ""}`))
      .filter((r) => COMMERCIAL_OPERATIONAL_RE.test(`${r.title ?? ""} ${r.summary ?? ""}`)),
  ).slice(0, 10);

  const transitRecords = enriched.filter(
    (r) => TRANSIT_ISSUES.has(r.issue) || detectChokepoints(r).length > 0,
  );

  // Chokepoint / Route Read — analyst prose over the 30-day chokepoint
  // picture, with the weekly transit signal as colour. Avoids stock
  // filler ("X records sit in window", "Activity concentrates", "Most
  // recent", "The leading patterns are") and answers what changed,
  // where the pressure is heaviest and what the reader should track.
  const cpRanked = [...chokepointRows].filter((r) => r.count > 0).sort((a, b) => b.count - a.count);
  const chokepointRouteRead = buildChokepointRouteRead({
    cpRanked,
    transitRecords,
    weeklyEnriched: enriched,
    thirtyDayLabel: thirtyDayShortLabel,
  });

  // Vessel Threat and Piracy Read — built from the 30-day vessel and
  // piracy classifications plus the weekly window for cycle context.
  // Three counts feed in separately so the prose cannot mix capped
  // display rows with underlying totals: vessel-threat total (deduped,
  // uncapped), displayed table rows (capped), and attack/seizure count.
  const vesselPiracyRead = buildVesselPiracyRead({
    vesselThreat30Total: vesselDeduped.length,
    vesselTableShown: vesselRows.length,
    vesselRows30: vesselRows,
    piracyRows30: piracyRows,
    vAttackSeize30: vAttackSeize,
    thirtyDayLabel: thirtyDayShortLabel,
  });

  // Commercial Impact Read — leads with the operational reason the
  // commercial pressure shows up, before the table of records.
  const commercialImpactRead = buildCommercialImpactRead(commercialRecords);

  // Region rows in fixed order — "Country not identified" is intentionally
  // excluded from the regional comparison chart so location-unknown records
  // do not dominate it. The count is surfaced separately in the data note
  // and via locationNotIdentifiedCount on the dataset.
  const locationNotIdentifiedCount = regionCounts.get("Country not identified" as Region) ?? 0;
  const regionRows: BarRow[] = (["Middle East", "APAC"] as Region[]).map((region) => ({
    label: region,
    value: regionCounts.get(region) ?? 0,
    color: REGION_COLOR[region],
  }));

  // Country rows (top 12), only identified countries
  const countryMap = new Map<string, number>();
  for (const r of enriched) {
    if (r.incidentCountry === null) continue;
    countryMap.set(r.incidentCountry, (countryMap.get(r.incidentCountry) ?? 0) + 1);
  }
  const countryRows = Array.from(countryMap.entries())
    .map(([label, value]) => ({ label, value, color: "#465bff" }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);

  // Regional and Country View prose — describes where the weekly
  // operational pressure landed, anchored on the bar chart that follows.
  const regionalCountryRead = buildRegionalCountryRead({
    regionRows,
    countryRows,
    weeklyCount: enriched.length,
    locationNotIdentifiedCount,
  });

  // Related Incidents — prioritised operational records for the closing
  // table. Vessel and piracy hits lead, then port / chokepoint / route /
  // war-risk records, then the rest of the weekly window. Pure shipping-
  // market items are dropped entirely. Capped tight so the Disclaimer
  // block can be pulled back onto the same page rather than orphaned.
  //
  // Balance rule: when the report carries a meaningful Vessel Threat
  // section, the Related Incidents table must not collapse to
  // chokepoint-only headlines. We seed the table with the strongest
  // vessel-threat record from the 30-day file (already filtered for
  // credibility, repatriation and human-interest noise) so the closing
  // table reflects the operational lead, not just the lane-level
  // commentary. Weak repatriation / generic items cannot reach this
  // path because they were dropped upstream in the vessel pipeline.
  const vesselThreatSeed = (vesselHostile[0] ?? vesselOther[0]) ?? null;
  // Seed the Latest Significant Incident at the head as well, so the closing
  // table is guaranteed to carry the same incident the headline card names —
  // the two surfaces can never disagree. Both seeds are confirmed-operational
  // by construction, and prioritiseRelated dedupes any overlap.
  const relatedIncidents = prioritiseRelated(enriched, [latestSig, vesselThreatSeed]);

  // Shipping-specific auto-prose for the four analyst sections. Editor
  // text takes precedence in the exporter and preview; these fallbacks
  // ensure the report reads at Fuel Watch-level substance even before
  // the analyst has written into the form.
  const autoCtx = {
    cpRanked,
    vesselHostile,
    piracyRows,
    commercialRecords,
    regionRows,
    countryRows,
    thirtyDayLabel: thirtyDayShortLabel,
    weeklyCount: enriched.length,
  };
  const autoWhatMatters = buildShippingWhatMatters(autoCtx);
  const autoImplications = buildShippingImplications(autoCtx);
  const autoWatchNext = buildShippingWatchNext(autoCtx);
  const autoPolestarView = buildShippingPolestarView(autoCtx);

  // Source / data note. Records without a confirmed incident country are
  // counted in totals but excluded from country and regional charts so
  // they cannot distort the geographic picture. Vessel flag state is
  // never counted as incident country. The placeholder label is an
  // internal classification only and is intentionally NOT surfaced here.
  const locNote = locationNotIdentifiedCount > 0
    ? `${locationNotIdentifiedCount} record${locationNotIdentifiedCount === 1 ? "" : "s"} in the window could not be tied to a confirmed incident country; ${locationNotIdentifiedCount === 1 ? "it is" : "they are"} included in total counts but excluded from the country and regional charts to avoid geographic distortion. Vessel flag state is never counted as incident country.`
    : `Vessel flag state is never counted as incident country.`;
  const dataNote = outOfScopeCount > 0
    ? `${outOfScopeCount} shipping record${outOfScopeCount === 1 ? "" : "s"} from outside APAC and the Middle East were excluded from this view, matching the Shipping dashboard scope. ${locNote}`
    : locNote;

  return {
    reportingPeriodShort: win.shortLabel,
    reportingPeriodLong: `Reporting period: ${win.label}`,
    thirtyDayShortLabel,
    enriched,
    outOfScopeCount,
    fastFacts,
    locationNotIdentifiedCount,
    chokepointRows,
    vesselRows,
    piracyRows,
    regionRows,
    countryRows,
    commercialRows: commercialRecords,
    chokepointRouteRead,
    vesselPiracyRead,
    commercialImpactRead,
    regionalCountryRead,
    relatedIncidents,
    autoWhatMatters,
    autoImplications,
    autoWatchNext,
    autoPolestarView,
    dataNote,
  };
}

// --- Shipping analyst auto-prose ------------------------------------------
// Editor-authored text always wins. When the analyst leaves a section
// blank these builders provide Fuel-Watch-level substance, anchored on
// routing, port calls, war-risk / P&I premium, vessel scheduling,
// bunker planning, cargo flow and operator advisories.

interface ShippingAutoCtx {
  cpRanked: ChokepointRow[];
  vesselHostile: VesselRow[];
  piracyRows: PiracyRow[];
  commercialRecords: EnrichedIncident[];
  regionRows: BarRow[];
  countryRows: BarRow[];
  thirtyDayLabel: string;
  weeklyCount: number;
}

function buildShippingWhatMatters(ctx: ShippingAutoCtx): string {
  const cp = ctx.cpRanked[0];
  const cp2 = ctx.cpRanked[1];
  const region = [...ctx.regionRows].filter((r) => r.value > 0).sort((a, b) => b.value - a.value)[0];
  const lines: string[] = [];
  if (cp) {
    lines.push(
      `The cycle's centre of gravity is ${cp.name}, which carries ${cp.count} qualifying record${cp.count === 1 ? "" : "s"}${cp2 ? ` ahead of ${cp2.name} on ${cp2.count}` : ""}. That matters for routing decisions because every additional advisory tightens transit-time variance and feeds straight into vessel scheduling and bunker planning for any operator with exposure to the region.`,
    );
  } else {
    lines.push(
      `No single chokepoint dominated this cycle, which sounds reassuring but is usually a coverage gap rather than a genuine easing. Treat the picture as fragile: when activity returns it tends to land on the same two or three transit corridors.`,
    );
  }
  if (ctx.vesselHostile.length > 0 || ctx.piracyRows.length > 0) {
    lines.push(
      `Hostile activity against vessels still anchors the risk picture, with ${ctx.vesselHostile.length} attack or seizure record${ctx.vesselHostile.length === 1 ? "" : "s"} and ${ctx.piracyRows.length} piracy or armed-robbery entr${ctx.piracyRows.length === 1 ? "y" : "ies"} on file across the reporting window (${ctx.thirtyDayLabel}). Any operator running through the affected lanes should be reviewing crew-change locations, war-risk and P&I premium exposure, and the threshold at which their advisory partners would recommend re-routing.`,
    );
  } else {
    lines.push(
      `Vessel-side and piracy reporting was thin this cycle. The underlying threat picture has not been benign for long, so a quiet window should be read as a reporting gap and not as a sustained easing of crew, hull or cargo risk.`,
    );
  }
  if (ctx.commercialRecords.length > 0) {
    lines.push(
      `On the commercial side the cycle carries ${ctx.commercialRecords.length} qualifying record${ctx.commercialRecords.length === 1 ? "" : "s"} of port disruption, schedule slippage, war-risk or insurance movement with a clean operational anchor. That feeds directly into cargo flow planning, port-call sequencing and freight-cost pass-through to shippers.`,
    );
  }
  if (region) {
    lines.push(
      `Regionally the weekly window leaned on ${region.label}; country-level concentration is set out in the chart below.`,
    );
  }
  return lines.join("\n\n");
}

function buildShippingImplications(ctx: ShippingAutoCtx): string {
  const cp = ctx.cpRanked[0];
  const where = cp ? cp.name : "the affected corridors";
  const bullets: string[] = [
    `Run a live review of vessel scheduling, port-call sequencing and bunker planning against the latest advisories for ${where}.`,
    `Size war-risk and P&I exposure now — premium adjustments typically land one to two cycles after the operational signal firms.`,
    `Pre-position alternative routings and skip-call options on affected strings; brief commercial teams on demurrage and schedule-reliability risk.`,
  ];
  if (ctx.vesselHostile.length + ctx.piracyRows.length > 0) {
    bullets.push(
      `Re-examine crew-change locations on voyages transiting the affected lanes; shift to safer ports where supported.`,
    );
    bullets.push(
      `Confirm naval-escort or convoy options with advisory partners for the highest-risk strings.`,
    );
  }
  if (ctx.commercialRecords.length > 0) {
    bullets.push(
      `Price surcharge pass-through into cargo-flow planning — port-call disruption converts to surcharges within one to two weeks.`,
    );
  } else {
    bullets.push(
      `Write flexibility clauses into near-term lifting contracts — a single port closure or war-risk move can pull surcharges across a lane within days.`,
    );
  }
  return bullets.map((b) => `- ${b}`).join("\n");
}

function buildShippingWatchNext(ctx: ShippingAutoCtx): string {
  const cp = ctx.cpRanked[0];
  const where = cp ? cp.name : "Hormuz, Bab-el-Mandeb, the Red Sea and Malacca";
  const bullets: string[] = [
    `Fresh naval and maritime advisories on ${where}: leading signal for where pressure is firming.`,
    `UKMTO, IMB and coalition-force bulletins: move ahead of headline freight rates.`,
    `War-risk and P&I premium movement on affected lanes: cleanest confirmation that the operational signal has firmed commercially.`,
    `Operator decisions to divert or skip a port call: trigger schedule-reliability and demurrage review.`,
    `Escalation in naval-escort or convoy posture: signal that advisory partners are sizing up the threat.`,
  ];
  if (ctx.vesselHostile.length + ctx.piracyRows.length > 0) {
    bullets.push(
      `Crew-change advisories and flag-state guidance updates: re-examine manning-hub plans on transiting voyages.`,
    );
    bullets.push(
      `Hostile-area underwriting extended to adjacent waters: clearest sign the threat perimeter is widening, not easing.`,
    );
  } else {
    bullets.push(
      `Any extension of hostile-area underwriting clauses: early indicator the threat picture is firming again.`,
    );
  }
  return bullets.map((b) => `- ${b}`).join("\n");
}

// Polestar View: a concise two-paragraph judgement, not a five-bullet
// recap. Paragraph 1 names the dominant pressure point (typically
// Hormuz) across the reporting window and frames the vessel threat
// picture. Paragraph 2 frames the cycle as a routing / insurance /
// advisory-monitoring problem — not a broad maritime shutdown — and
// names the practical business levers (war-risk, P&I, crew change,
// port call).
function buildShippingPolestarView(ctx: ShippingAutoCtx): string {
  const cp = ctx.cpRanked[0];
  const vesselThreat30 = ctx.vesselHostile.length + ctx.piracyRows.length;
  const pressurePoint = cp ? cp.name : "Hormuz and the Red Sea corridor";

  const para1Pressure = cp
    ? `${pressurePoint} remains the dominant shipping pressure point across the reporting window, and that is where the structural risk continues to sit regardless of any individual cycle's cadence.`
    : `${pressurePoint} remains the dominant shipping pressure point across the reporting window, and that is where the structural risk continues to sit regardless of any individual cycle's cadence.`;
  const para1Vessel = vesselThreat30 > 0
    ? ` The vessel threat picture across the window — ${ctx.vesselHostile.length} attack or seizure record${ctx.vesselHostile.length === 1 ? "" : "s"} and ${ctx.piracyRows.length} piracy or armed-robbery entr${ctx.piracyRows.length === 1 ? "y" : "ies"} — still matters. A quiet cycle in this geography is the normal pattern, not a benign trend, so it should be read as a reporting gap rather than a sustained easing.`
    : ` Vessel-side activity is limited this cycle, but the threat picture still matters: the same lanes have not been clean for long, so a thin window should be read as cycle noise rather than a sustained easing.`;
  const para1 = `${para1Pressure}${para1Vessel}`;

  const para2 = `Operators should treat the current cycle as a routing, insurance and advisory-monitoring problem rather than a broad maritime shutdown. The practical business levers sit with war-risk and P&I premium reviews, crew-change locations on voyages transiting ${pressurePoint}, and the port-call sequencing decisions that follow from fresh advisories — not with any expectation of a regional standstill.`;

  return `${para1}\n\n${para2}`;
}



// --- Prose builders --------------------------------------------------------
// Analyst-style prose, never count-led. Forbidden idioms include
// "X records sit in window", "Activity concentrates", "Most recent",
// "The leading patterns are", "The usable signal is", "Detail sits",
// "The reporting window is noisy". Each builder returns a self-
// contained paragraph block ready to feed straight into renderProse.

function joinList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function buildChokepointRouteRead(opts: {
  cpRanked: ChokepointRow[];
  transitRecords: EnrichedIncident[];
  weeklyEnriched: EnrichedIncident[];
  thirtyDayLabel: string;
}): string {
  const { cpRanked, transitRecords, weeklyEnriched, thirtyDayLabel } = opts;
  if (cpRanked.length === 0 && transitRecords.length === 0) {
    return `No qualifying chokepoint or route-disruption records reached the file across the reporting window (${thirtyDayLabel}). Read this as a coverage gap rather than confirmation that pressure has eased — chokepoint advisories tend to be lumpy and a quiet cycle does not redefine the underlying risk picture on Hormuz, Bab-el-Mandeb or the Red Sea.\n\nKeep tracking maritime advisories, naval movement and any operator decisions on routing or war-risk premium. A return of activity is usually visible in advisory traffic before it shows up in commercial freight rates.`;
  }
  const lead = cpRanked[0];
  const second = cpRanked[1];
  const cpPhrase = lead
    ? `The reporting window is led by ${lead.name}, which carries ${lead.count} qualifying record${lead.count === 1 ? "" : "s"}${lead.highestSeverityKey ? ` and a highest severity of ${lead.highestSeverityLabel.toLowerCase()}` : ""}.${second ? ` ${second.name} follows with ${second.count} record${second.count === 1 ? "" : "s"}.` : ""}`
    : "Chokepoint coverage is thin this cycle but transit-side activity still warrants attention.";
  const weeklyTransit = weeklyEnriched.filter((r) =>
    TRANSIT_ISSUES.has(r.issue) || detectChokepoints(r).length > 0,
  ).length;
  const transitLine = weeklyTransit > 0
    ? `Across the window, ${weeklyTransit} record${weeklyTransit === 1 ? "" : "s"} pointed specifically at transit, diversion or advisory pressure — a tighter view of what shippers actually felt across the cycle.`
    : `No fresh transit-side advisories landed inside the window, so the read leans on the broader chokepoint picture above for context.`;
  const watch = lead
    ? `Watch for new naval advisories on ${lead.name}, any war-risk premium adjustments and operator commentary on rerouting. Those are the early indicators of escalation; commercial freight rates lag them by days.`
    : `Watch for fresh advisory traffic and any operator decisions on diversion — those move ahead of headline freight rates and signal where pressure is building.`;
  return `${cpPhrase}\n\n${transitLine}\n\n${watch}`;
}

function buildVesselPiracyRead(opts: {
  vesselThreat30Total: number;
  vesselTableShown: number;
  vesselRows30: VesselRow[];
  piracyRows30: PiracyRow[];
  vAttackSeize30: number;
  thirtyDayLabel: string;
}): string {
  const { vesselThreat30Total, vesselTableShown, vesselRows30, piracyRows30, vAttackSeize30, thirtyDayLabel } = opts;
  if (vesselThreat30Total + piracyRows30.length === 0) {
    return `Nothing hostile against vessels and no piracy or armed-robbery records reached the file across the reporting window (${thirtyDayLabel}). The underlying threat picture in the region has not been benign for long, so treat the quiet cycle as a reporting gap and keep crew-change, advisory and naval-patrol signals on the watchlist.\n\nA return to hostile activity is usually announced first by naval forces, then by maritime risk bulletins, before it shows up in P&I or war-risk premium movement.`;
  }
  // Lead-title quotes must come from a credible maritime / security /
  // industry / news source. The vessel pipeline is already filtered for
  // social, repatriation and speculative items, so the first deduped
  // row is a safe pick.
  const vesselLead = vesselRows30[0] ?? null;
  const piracyLead = piracyRows30.find((r) => !isLowCredibilitySource(r));
  // Three distinct counts kept separate so the prose cannot contradict
  // itself: (1) total vessel-threat events on the 30-day file after
  // dedupe and credibility filtering, (2) the attack/seizure subset of
  // that total, (3) the capped row count shown in the table below.
  const capNote = vesselTableShown < vesselThreat30Total
    ? ` The table below shows the top ${vesselTableShown} of these, prioritising attack and seizure events.`
    : "";
  const vesselSegment = vesselThreat30Total > 0
    ? `Vessel-threat reporting across the reporting window carries ${vesselThreat30Total} qualifying event${vesselThreat30Total === 1 ? "" : "s"}, of which ${vAttackSeize30} ${vAttackSeize30 === 1 ? "is" : "are"} an attack or seizure rather than a softer boarding or approach.${capNote}${vesselLead ? ` The lead entry is "${vesselLead.title}".` : ""}`
    : `No vessel-attack or seizure records landed in the reporting window, even with piracy activity still on the file.`;
  const piracySegment = piracyRows30.length > 0
    ? `Piracy and armed-robbery reporting carries ${piracyRows30.length} record${piracyRows30.length === 1 ? "" : "s"} across the same window${piracyLead ? `, with "${piracyLead.title}" as the lead entry.` : `; no credible single lead is quoted as the file leans on low-credibility or speculative reporting.`}`
    : `Piracy and armed-robbery reporting is empty across the reporting window, which is unusual rather than reassuring for this geography.`;
  const watch = `Track maritime advisories, naval-force statements and any movement in war-risk or P&I premiums on affected routes. Those are the cleanest early indicators that hostile activity is firming or easing.`;
  return `${vesselSegment} ${piracySegment}\n\n${watch}`;
}

function buildCommercialImpactRead(commercialRecords: EnrichedIncident[]): string {
  if (commercialRecords.length === 0) {
    return `No port, freight, insurance or commercial-shipping disruption records reached the file in the weekly window. Pure market commentary — newbuild orders, vessel S&P, fleet finance, earnings, share-price moves — is intentionally excluded from this section, so a blank cycle here means the operational disruption signal was genuinely quiet rather than under-reported.\n\nWatch for fresh port advisories, schedule slippage out of the major box and tanker hubs, and any insurance-premium adjustments tied to specific routes. Those are the next signals that operational commercial pressure is firming.`;
  }
  const n = commercialRecords.length;
  const lead = commercialRecords[0];
  const second = commercialRecords[1];
  const intro = `Operational commercial pressure on shipping in the weekly window centres on port disruption, freight or insurance movement with an operational hook, and commercial-shipping disruption tied directly to vessel or cargo flows. The cycle carries ${n} qualifying record${n === 1 ? "" : "s"} on this definition.`;
  // With one or two records the commercial picture is too thin to read as a
  // trend. Say the signal is limited and treat it as a watch item rather than
  // overstating a broad commercial impact the data does not support.
  const limited =
    n <= 2
      ? ` On a single weekly window this is a thin, directional signal rather than a confirmed commercial trend — treat it as a watch item, not evidence of broad commercial disruption.`
      : "";
  const examples = second
    ? `The lead entry is "${lead.title}" (${lead.issue.toLowerCase()}); "${second.title}" sits alongside it (${second.issue.toLowerCase()}).`
    : `The lead entry is "${lead.title}" (${lead.issue.toLowerCase()}).`;
  const watch = `Watch for follow-on schedule disruption, premium adjustments on affected routes, and any operator decisions on diversion or port-skipping. Commercial pass-through to shippers typically follows the operational signal by one to two weeks.`;
  return `${intro}${limited} ${examples}\n\n${watch}`;
}

function buildRegionalCountryRead(opts: {
  regionRows: BarRow[];
  countryRows: BarRow[];
  weeklyCount: number;
  locationNotIdentifiedCount: number;
}): string {
  const { regionRows, countryRows, weeklyCount, locationNotIdentifiedCount } = opts;
  if (weeklyCount === 0) {
    return `No qualifying maritime records reached the file across APAC and the Middle East in the weekly window. The underlying picture has not been benign for long, so a blank cycle should be treated as a reporting gap rather than a sustained easing of regional risk.`;
  }
  const regionRanked = [...regionRows].filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
  const lead = regionRanked[0];
  const second = regionRanked[1];
  const regionLine = lead
    ? `Across the weekly briefing window, ${lead.label} carries the heavier share with ${lead.value} record${lead.value === 1 ? "" : "s"}${second ? ` against ${second.value} for ${second.label}` : ""}.`
    : `Regional attribution is thin this cycle, with most records sitting outside the APAC and Middle East scope.`;
  const topCountries = countryRows.slice(0, 3).filter((r) => r.value > 0);
  const identifiedTotal = countryRows.reduce((sum, r) => sum + r.value, 0);
  // When as many (or more) records are unattributed as are tied to a country,
  // the country ranking is not a safe basis for conclusions — say so plainly
  // rather than letting the lead countries read as settled fact.
  const heavyGap = locationNotIdentifiedCount > 0 && locationNotIdentifiedCount >= identifiedTotal;
  const countryQualifier = heavyGap
    ? ` These country totals are indicative only: with ${locationNotIdentifiedCount} record${locationNotIdentifiedCount === 1 ? "" : "s"} unattributed against ${identifiedTotal} tied to a confirmed incident country, country-level conclusions should be treated as low-confidence.`
    : "";
  const countryLine = topCountries.length > 0
    ? `At country level the cycle is led by ${joinList(topCountries.map((c) => c.label))}.${countryQualifier}`
    : `Country-level attribution is incomplete this cycle; identified incident countries are sparse in the file.`;
  const gapLine = locationNotIdentifiedCount > 0
    ? `A further ${locationNotIdentifiedCount} record${locationNotIdentifiedCount === 1 ? "" : "s"} could not be tied to a confirmed incident country and ${locationNotIdentifiedCount === 1 ? "is" : "are"} excluded from the country chart to avoid distortion.`
    : "";
  return `${regionLine} ${countryLine}${gapLine ? `\n\n${gapLine}` : ""}`;
}

// Operational priority for the closing Related Incidents table.
//
// Strong: hostile vessel actions, piracy, port/chokepoint/route
// disruption, war-risk and P&I commentary with an operational hook.
// Weak: residual "Other" / "Unclassified" buckets and any record we
// already flagged as pure shipping-market noise.
function prioritiseRelated(
  rows: EnrichedIncident[],
  seeds: Array<EnrichedIncident | null> = [],
): EnrichedIncident[] {
  const strong: EnrichedIncident[] = [];
  const rest: EnrichedIncident[] = [];
  for (const r of rows) {
    if (isShippingMarketOnly(r)) continue;
    // Mirror the Commercial Impact gate: pure freight-market / rate-tracker
    // commentary (Drewry, WCI, BDI, "freight rate recovery") must not
    // appear here either. If Commercial Impact excludes it, Related
    // Incidents excludes it.
    const text2 = `${r.title ?? ""} ${r.summary ?? ""}`;
    if (FREIGHT_MARKET_INDEX_RE.test(text2) && !COMMERCIAL_OPERATIONAL_RE.test(text2)) continue;
    // Confirmed-operational gate: only events that actually occurred (attack,
    // seizure, piracy, concrete port/route/physical disruption) may appear as
    // related incidents. Claims, threats, planning/intent, predictions,
    // advisory/escort posture and bare chokepoint commentary are excluded so
    // nothing is presented as a confirmed disruption that is not one.
    if (!isConfirmedOperationalIncident(r)) continue;
    const text = text2.toLowerCase();
    const isVesselHostile = OPERATIONAL_HOOK_RE.test(text) && /\b(attack|attacked|hijack|piracy|seized|missile|drone|hostilit)\b/.test(text);
    const isPortRouteOrChoke = /\b(port|terminal|berth|chokepoint|hormuz|red\s*sea|bab[\s-]?el[\s-]?mandeb|suez|malacca|reroute|diversion|advisory|war[\s-]?risk|insurance|premium)\b/.test(text);
    const isWeakBucket = r.issue === "Unclassified maritime record" || /^other\s.+/i.test(r.issue);
    if ((isVesselHostile || isPortRouteOrChoke) && !isWeakBucket) strong.push(r);
    else if (!isWeakBucket) rest.push(r);
  }
  // Seed the supplied records (Latest Significant Incident, then the
  // strongest vessel-threat record) at the head of the list. dedupeByTitle
  // below collapses any overlap with weekly-window rows. Every seed is
  // confirmed-operational by construction, so seeding never reintroduces a
  // claim, advisory, repatriation or generic-commentary item.
  const seedList = seeds.filter((s): s is EnrichedIncident => s !== null);
  const seeded = [...seedList, ...strong, ...rest];
  const ordered = dedupeByTitle(seeded);
  // Cap tight so the Disclaimer block can be pulled back onto the same
  // page rather than orphaned on a near-empty final page.
  return ordered.slice(0, 6);
}

export const SHIPPING_SEV_LABEL = SEV_LABEL;
export const SHIPPING_SEV_COLOR = SEV_COLOR;
export { sevKey as shippingSevKey };
