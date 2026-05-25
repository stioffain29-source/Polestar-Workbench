import { format, parseISO, max as dateMax, subDays } from "date-fns";
import { resolveReportWindow, filterIncidentsToWindow } from "./reportWindow";
import { isTopicRelevant } from "./topicRelevance";
import {
  CHOKEPOINTS, detectChokepoints, classifyPiracy,
  classifyVesselIncident, type VesselIncidentType,
  classifyIssue,
  classifyRegion, REGION_COLOR, type Region,
  TRANSIT_ISSUES, COMMERCIAL_ISSUES,
  type ChokepointKey,
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
  /** Short label for the rolling 30-day window used by Chokepoint / Vessel / Piracy. */
  thirtyDayShortLabel: string;
  enriched: EnrichedIncident[];
  outOfScopeCount: number;
  fastFacts: KpiCard[];
  /** Count of records in the weekly window whose incident location could not be identified. */
  locationNotIdentifiedCount: number;
  /** Chokepoint Watch over the last 30 days (not the weekly window). */
  chokepointRows: ChokepointRow[];
  /** Vessel attacks over the last 30 days. */
  vesselRows: VesselRow[];
  /** Piracy / armed robbery over the last 30 days. */
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
// Used to keep social-media-style, repatriation/human-interest, speculative
// strike-claim and generic commentary items out of the surfaces where they
// would otherwise drive the analyst narrative (chokepoint operational read;
// Commercial Impact on Shipping; Vessel and Piracy reads).

const SOCIAL_SOURCE_RE = /\b(twitter|x\.com|t\.co|instagram|tiktok|facebook|threads|youtube|reddit|telegram|t\.me|mastodon|truth\s*social|weibo|social\s*media)\b/i;
const HANDLE_TITLE_RE = /^\s*[@#]/;

// Repatriation, crew-welfare and human-interest items are real but they are
// downstream of the maritime security picture, not operational drivers of it.
// They should not lead a Chokepoint, Vessel or Piracy read. Stems are kept
// open (no trailing word-boundary) so inflections like "repatriated" /
// "repatriation" / "memorialised" all match.
const HUMAN_INTEREST_RE = /(\brepatriat|\bseafarer welfare|\bcrew welfare|\bmemorial|\bfuneral|\brescued (and )?(repatriated|returned home)|\bbrought home\b|\breunion\b|\bwidow|\bmother of\b|\bfamily of\b|\btribute to\b|\binterview with\b|\bopinion piece\b|\bop[- ]ed\b|\baboard us-?seized vessels?\b|\bcrew (members? )?(released|freed|safe|safely)|\bdetained crew (returned|released|repatriated))/i;

// Speculative strike claims and unverified rumour traffic. "Iran claims
// missile strike", "Houthis claim attack", "claims to have struck" — when
// these dominate they push the read away from validated maritime security.
// Also catches "X says it hit/targeted Y" style claim language and the
// classic "may have / appears to have" hedge stack.
const SPECULATIVE_CLAIM_RE = /(\bunconfirmed|\bunverified|\balleged|\ballegedly|\breportedly|\bclaim(s|ed)\b[^.]{0,40}\b(strike|attack|hit|missile|drone|target|targeted|fired|sank|downed|shot down|launched)|\bclaim(s|ed) to have\b|\bclaim(s|ed) responsibility|\brumou?red|\bpurportedly|\bmay have (been )?(struck|hit|attacked|targeted)|\bappears to have been|\b(says|said) it (hit|struck|targeted|attacked|launched|downed))/i;

// Pure commentary, explainer and analysis-piece headlines with no
// operational anchor ("explained", "what to know", "five things", "in
// charts", "guide to", listicles). These dilute operational reads.
const GENERIC_COMMENTARY_RE = /\b(explained|explainer|what (you )?(need to )?know|what to know|five things|10 things|in charts|guide to|primer|deep dive|long read|backgrounder|analysis: |opinion: |commentary: |viewpoint: |q&a|qa with|interview: |podcast|listicle)\b/i;

// Pure freight-market index / rate-tracker commentary with no operational
// anchor. Drewry WCI, Baltic indices, container freight rate weekly
// updates, etc. Blocked outright unless the headline also carries an
// operational anchor (port closure, strike, attack, seizure).
const FREIGHT_MARKET_INDEX_RE = /\b(drewry|world container index|\bwci\b|baltic (dry|exchange|capesize|panamax|supramax|handysize) index|\bbdi\b|\bbci\b|\bbpi\b|harpex|shanghai containerized freight index|\bscfi\b|ningbo containerized freight index|\bncfi\b|container (rate|rates|spot rate|spot rates|index) (rise|rises|risen|rose|edged|jump|jumped|fall|fell|drop|dropped|slide|slid|surge|surged|hold|holds|holding|steady|stable|flat|softer|firmer)|freight (rate|rates) (rise|rises|risen|rose|edged|jump|jumped|fall|fell|drop|dropped|slide|slid|surge|surged|hold|holds|holding|steady|stable|flat|softer|firmer)|spot rates? (rise|rises|risen|rose|edged|jump|jumped|fall|fell|drop|dropped|slide|slid|surge|surged|hold|holds|holding|steady|stable|flat|softer|firmer))\b/i;

function isLowCredibilitySource(r: ShippingReportIncident): boolean {
  if (HANDLE_TITLE_RE.test(r.title ?? "")) return true;
  const src = (r.source ?? "") + " " + (r.sourceUrl ?? "");
  if (SOCIAL_SOURCE_RE.test(src)) return true;
  const text = `${r.title ?? ""} ${r.summary ?? ""}`;
  if (HUMAN_INTEREST_RE.test(text)) return true;
  if (SPECULATIVE_CLAIM_RE.test(text)) return true;
  if (GENERIC_COMMENTARY_RE.test(text)) return true;
  return false;
}

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

  // Rolling 30-day window for Chokepoint Watch, Vessel Attacks and
  // Piracy / Armed Robbery. These sections look back further than the
  // weekly briefing window so the reader has a fuller picture of
  // hostile maritime activity even on quiet weeks.
  let endDate: Date;
  try { endDate = parseISO(issueDate); } catch { endDate = new Date(); }
  if (isNaN(endDate.getTime())) endDate = new Date();
  const start30 = subDays(endDate, 29);
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

  // Chokepoint counts — derived from the 30-day window so the headline
  // "Main Affected Chokepoint" matches the Chokepoint Watch table below.
  const cpCounts = new Map<ChokepointKey, number>();
  for (const r of enriched30) for (const cp of detectChokepoints(r)) cpCounts.set(cp, (cpCounts.get(cp) ?? 0) + 1);
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

  // Vessel / piracy — 30-day window so the dedicated sections show a
  // meaningful operational picture even on a quiet weekly cycle.
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
      .filter((r): r is VesselRow => r.vesselType !== null),
  );
  const vesselDeduped = dedupeByTitle(vesselAll);
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
      .map((r) => ({ ...r, act: classifyPiracy(r) }))
      .filter((r): r is PiracyRow => r.act !== null),
  );
  const PIRACY_TABLE_CAP = 12;
  const piracyRows: PiracyRow[] = dedupeByTitle(piracyAll).slice(0, PIRACY_TABLE_CAP);

  // Weekly-window vessel/piracy counts (used only by the Daily Intelligence
  // Summary line, which describes the weekly briefing window itself).
  const vesselRowsWeekly = enriched
    .map((r) => ({ ...r, vesselType: classifyVesselIncident(r) as VesselIncidentType | null }))
    .filter((r): r is VesselRow => r.vesselType !== null);
  const vAttackSeizeWeekly = vesselRowsWeekly
    .filter((r) => r.vesselType === "Attack" || r.vesselType === "Seized").length;
  const piracyRowsWeekly = enriched
    .map((r) => ({ ...r, act: classifyPiracy(r) }))
    .filter((r): r is PiracyRow => r.act !== null);

  const hsAll = highestSeverity(enriched);
  const latestDate = enriched.length > 0 ? dateMax(enriched.map((r) => r.date)) : null;
  const latestSig = sortByDateDesc(enriched).find((r) => r.severity === "extreme" || r.severity === "high")
    ?? sortByDateDesc(enriched)[0]
    ?? null;

  // Single, deduplicated Fast Facts grid (7 cards).
  const fastFacts: KpiCard[] = [
    { label: "Reporting Period", value: win.shortLabel },
    { label: "Records In Window", value: String(enriched.length) },
    { label: "Highest Severity", value: hsAll.label, severity: hsAll.key || undefined },
    {
      label: "Main Affected Chokepoint (30d)",
      value: topCp || "—",
      note: topCpN > 0
        ? `${topCpN} record${topCpN === 1 ? "" : "s"}`
        : (topRegion ? `Fallback to region: ${topRegion} (${topRegionN})` : "No chokepoint mention in last 30 days"),
    },
    { label: "Vessel Attacks / Seizures (30d)", value: String(vAttackSeize) },
    {
      label: "Piracy / Armed Robbery (30d)",
      value: String(piracyRows.length),
      note: `Latest record in window: ${latestDate ? format(latestDate, "dd MMM yyyy") : "—"}`,
    },
    {
      label: "Latest Significant Incident",
      value: latestSig ? format(latestSig.date, "dd MMM yyyy") : "—",
      severity: latestSig ? sevKey(latestSig.severity) : undefined,
      note: latestSig ? latestSig.title : undefined,
    },
  ];

  // Chokepoint Watch rows — 30-day window.
  // The lead "operational read" must come from a credible maritime / security /
  // industry / news source. Social-media-style records (e.g. titles starting
  // with "@" or sources matching twitter/x.com/instagram/etc.) may still sit
  // in the underlying count, but they are not allowed to drive the narrative.
  // If only low-credibility records exist for a chokepoint, fall back to a
  // low-confidence note instead of quoting them.
  const chokepointRows: ChokepointRow[] = CHOKEPOINTS.map((cp) => {
    const records = enriched30.filter((r) => detectChokepoints(r).includes(cp));
    const credible = records.filter((r) => !isLowCredibilitySource(r));
    const hs = highestSeverity(records);
    const sorted = sortByDateDesc(records);
    const credibleSorted = sortByDateDesc(credible);
    const latest = sorted[0] ?? null;
    const credibleLatest = credibleSorted[0] ?? null;
    let readText: string;
    if (records.length === 0) {
      readText = "Quiet over the last 30 days; no qualifying activity on file.";
    } else if (credibleLatest === null) {
      readText = "Low-confidence reporting only; no validated maritime advisory or credible operational incident identified in the last 30 days.";
    } else if (records.length === 1) {
      readText = `Activity here was anchored by a single entry, "${credibleLatest.title}", over the last 30 days.`;
    } else {
      readText = `Reporting was led by "${credibleLatest.title}", with ${records.length} qualifying records over the last 30 days.`;
    }
    return {
      name: cp,
      count: records.length,
      highestSeverityKey: hs.key,
      highestSeverityLabel: hs.label,
      latestDate: latest ? latest.date : null,
      latestTitle: latest ? latest.title : null,
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
  const vesselPiracyRead = buildVesselPiracyRead({
    vesselRows30: vesselRows,
    piracyRows30: piracyRows,
    vesselRowsWeekly,
    piracyRowsWeekly,
    vAttackSeize30: vAttackSeize,
    vAttackSeizeWeekly,
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
  // market items are dropped entirely. Capped tight so Source Notes /
  // Disclaimer don't get pushed alone onto a near-empty final page.
  const relatedIncidents = prioritiseRelated(enriched);

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
      `Hostile activity against vessels still anchors the risk picture, with ${ctx.vesselHostile.length} attack or seizure record${ctx.vesselHostile.length === 1 ? "" : "s"} and ${ctx.piracyRows.length} piracy or armed-robbery entr${ctx.piracyRows.length === 1 ? "y" : "ies"} on file over the trailing 30 days (${ctx.thirtyDayLabel}). Any operator running through the affected lanes should be reviewing crew-change locations, war-risk and P&I premium exposure, and the threshold at which their advisory partners would recommend re-routing.`,
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
  const parts: string[] = [];
  parts.push(
    `Operators with route exposure through ${cp ? cp.name : "the affected corridors"} should be running a live review of vessel scheduling, port-call sequencing and bunker planning against the latest advisory traffic. War-risk and P&I premium adjustments tend to land one to two cycles after the operational signal firms, so the time to size insurance exposure is now rather than after the first underwriting notice.`,
  );
  if (ctx.vesselHostile.length > 0 || ctx.piracyRows.length > 0) {
    parts.push(
      `Crew-change locations should be re-examined for any voyage transiting the affected lanes. The cleanest mitigation is a shift to a safer port of crew change, paired with naval-escort or convoy options where advisory partners support them. Cargo owners should expect higher demurrage and schedule-reliability variance on rerouted strings, and should be writing in flexibility clauses on near-term lifting contracts.`,
    );
  }
  if (ctx.commercialRecords.length > 0) {
    parts.push(
      `Freight pass-through to shippers on affected lanes is the second-order consequence. Port-call disruption and schedule slippage typically convert into surcharges within one to two weeks; cargo flow planning should price that in rather than assume the disruption stays on the carrier balance sheet.`,
    );
  } else {
    parts.push(
      `Freight-market commentary stays muted this cycle on the operational definition used here. That can flip quickly: a single port closure or a credible war-risk adjustment can pull surcharges across an entire trade lane within days.`,
    );
  }
  return parts.join("\n\n");
}

function buildShippingWatchNext(ctx: ShippingAutoCtx): string {
  const cp = ctx.cpRanked[0];
  const lines: string[] = [];
  lines.push(
    `Track fresh naval and maritime advisories on ${cp ? cp.name : "Hormuz, Bab-el-Mandeb, the Red Sea and Malacca"}, plus any UKMTO, IMB or coalition-force bulletins. Those move ahead of headline freight rates and signal where pressure is firming.`,
  );
  lines.push(
    `Watch for war-risk and P&I premium movement on the affected lanes, operator decisions to divert or skip a port call, and any escalation in naval escort or convoy posture. Reliability indices and schedule-reliability monthly bulletins are the cleanest lagging confirmation that the operational signal has converted into commercial pressure.`,
  );
  if (ctx.vesselHostile.length + ctx.piracyRows.length > 0) {
    lines.push(
      `On vessel and crew risk: monitor crew-change advisories from major manning hubs, any change in flag-state guidance, and whether insurance underwriters extend hostile-area surcharges to adjacent waters. A widening of the hostile-area perimeter is the single clearest sign the threat picture is firming, not easing.`,
    );
  } else {
    lines.push(
      `Even on a quiet cycle, monitor crew-change advisories, flag-state guidance updates and any extension of hostile-area underwriting clauses. Those are early indicators that the threat picture is firming again ahead of the next reporting cycle.`,
    );
  }
  return lines.join("\n\n");
}

function buildShippingPolestarView(ctx: ShippingAutoCtx): string {
  const cp = ctx.cpRanked[0];
  const region = [...ctx.regionRows].filter((r) => r.value > 0).sort((a, b) => b.value - a.value)[0];
  const lead: string[] = [];
  lead.push(
    `Our read on the cycle is that the underlying maritime security picture remains structurally elevated even when the weekly file looks quieter than the trailing 30 days. ${cp ? `${cp.name} continues to set the tempo` : `No single chokepoint dominated this week, but the regional baseline has not reset`}, and operators should be planning against a "quiet weeks, sharp incidents" cadence rather than a sustained easing.`,
  );
  lead.push(
    `For commercial decisions, the practical implication is that routing, port-call sequencing and crew-change planning should be treated as live risk decisions every cycle — not annual reviews. War-risk and P&I premium movement remains the cleanest single signal that the operational picture is firming; reliability indices and headline freight rates lag it.`,
  );
  if (region) {
    lead.push(
      `Geographically the pressure this cycle sat with ${region.label}. We expect the same lanes and corridors to set the tempo through the next reporting window unless a fresh naval-force posture change or a credible diplomatic move on the underlying conflicts disrupts the pattern.`,
    );
  }
  return lead.join("\n\n");
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
    return `No qualifying chokepoint or route-disruption records reached the file over the last 30 days (${thirtyDayLabel}). Read this as a coverage gap rather than confirmation that pressure has eased — chokepoint advisories tend to be lumpy and a quiet cycle does not redefine the underlying risk picture on Hormuz, Bab-el-Mandeb or the Red Sea.\n\nKeep tracking maritime advisories, naval movement and any operator decisions on routing or war-risk premium. A return of activity is usually visible in advisory traffic before it shows up in commercial freight rates.`;
  }
  const lead = cpRanked[0];
  const second = cpRanked[1];
  const cpPhrase = lead
    ? `The 30-day picture is led by ${lead.name}, which carries ${lead.count} qualifying record${lead.count === 1 ? "" : "s"}${lead.highestSeverityKey ? ` and a highest severity of ${lead.highestSeverityLabel.toLowerCase()}` : ""}.${second ? ` ${second.name} follows with ${second.count} record${second.count === 1 ? "" : "s"}.` : ""}`
    : "Chokepoint coverage is thin this cycle but transit-side activity still warrants attention.";
  const weeklyTransit = weeklyEnriched.filter((r) =>
    TRANSIT_ISSUES.has(r.issue) || detectChokepoints(r).length > 0,
  ).length;
  const transitLine = weeklyTransit > 0
    ? `Inside the weekly briefing window, ${weeklyTransit} record${weeklyTransit === 1 ? "" : "s"} pointed at transit, diversion or advisory pressure — a tighter view of what shippers actually felt across the cycle.`
    : `Inside the weekly briefing window itself, no fresh transit-side advisories landed, so the cycle leans on the trailing 30-day picture for context.`;
  const watch = lead
    ? `Watch for new naval advisories on ${lead.name}, any war-risk premium adjustments and operator commentary on rerouting. Those are the early indicators of escalation; commercial freight rates lag them by days.`
    : `Watch for fresh advisory traffic and any operator decisions on diversion — those move ahead of headline freight rates and signal where pressure is building.`;
  return `${cpPhrase}\n\n${transitLine}\n\n${watch}`;
}

function buildVesselPiracyRead(opts: {
  vesselRows30: VesselRow[];
  piracyRows30: PiracyRow[];
  vesselRowsWeekly: VesselRow[];
  piracyRowsWeekly: PiracyRow[];
  vAttackSeize30: number;
  vAttackSeizeWeekly: number;
  thirtyDayLabel: string;
}): string {
  const { vesselRows30, piracyRows30, vesselRowsWeekly, piracyRowsWeekly, vAttackSeize30, vAttackSeizeWeekly, thirtyDayLabel } = opts;
  if (vesselRows30.length + piracyRows30.length === 0) {
    return `Nothing hostile against vessels and no piracy or armed-robbery records reached the file over the last 30 days (${thirtyDayLabel}). The underlying threat picture in the region has not been benign for long, so treat the quiet cycle as a reporting gap and keep crew-change, advisory and naval-patrol signals on the watchlist.\n\nA return to hostile activity is usually announced first by naval forces, then by maritime risk bulletins, before it shows up in P&I or war-risk premium movement.`;
  }
  // Lead-title quotes must come from a credible maritime / security /
  // industry / news source — never from social-media handles, low-credibility
  // sources, repatriation or human-interest items, or speculative "X claims
  // missile strike" headlines. Falls back to a counts-only sentence when no
  // credible lead exists.
  const vesselLead = vesselRows30.find((r) => !isLowCredibilitySource(r));
  const piracyLead = piracyRows30.find((r) => !isLowCredibilitySource(r));
  const vesselSegment = vesselRows30.length > 0
    ? `Hostile activity against vessels over the last 30 days runs to ${vesselRows30.length} record${vesselRows30.length === 1 ? "" : "s"}, of which ${vAttackSeize30} ${vAttackSeize30 === 1 ? "is" : "are"} an attack or seizure rather than a softer boarding or approach.${vesselLead ? ` The lead entry is "${vesselLead.title}".` : ` Available headlines on the file are dominated by low-credibility or speculative reporting, so no validated lead entry is quoted here.`}`
    : `No vessel-attack or seizure records landed in the 30-day window, even with piracy activity still on the file.`;
  const piracySegment = piracyRows30.length > 0
    ? `Piracy and armed-robbery reporting carries ${piracyRows30.length} record${piracyRows30.length === 1 ? "" : "s"} across the same window${piracyLead ? `, with "${piracyLead.title}" as the lead entry.` : `; no credible single lead is quoted as the file leans on low-credibility or speculative reporting.`}`
    : `Piracy and armed-robbery reporting is empty across the 30-day window, which is unusual rather than reassuring for this geography.`;
  const weeklyV = vesselRowsWeekly.length;
  const weeklyP = piracyRowsWeekly.length;
  const weeklySegment = (weeklyV + weeklyP) > 0
    ? `Inside the weekly briefing cycle, ${weeklyV} vessel-side record${weeklyV === 1 ? "" : "s"} (${vAttackSeizeWeekly} attack or seizure) and ${weeklyP} piracy or armed-robbery entr${weeklyP === 1 ? "y" : "ies"} were filed — useful for sizing momentum against the trailing month.`
    : `Inside the weekly briefing cycle itself, no fresh vessel-side or piracy records were filed; the read leans on the trailing 30-day picture.`;
  const watch = `Track maritime advisories, naval-force statements and any movement in war-risk or P&I premiums on affected routes. Those are the cleanest early indicators that hostile activity is firming or easing.`;
  return `${vesselSegment} ${piracySegment}\n\n${weeklySegment}\n\n${watch}`;
}

function buildCommercialImpactRead(commercialRecords: EnrichedIncident[]): string {
  if (commercialRecords.length === 0) {
    return `No port, freight, insurance or commercial-shipping disruption records reached the file in the weekly window. Pure market commentary — newbuild orders, vessel S&P, fleet finance, earnings, share-price moves — is intentionally excluded from this section, so a blank cycle here means the operational disruption signal was genuinely quiet rather than under-reported.\n\nWatch for fresh port advisories, schedule slippage out of the major box and tanker hubs, and any insurance-premium adjustments tied to specific routes. Those are the next signals that operational commercial pressure is firming.`;
  }
  const n = commercialRecords.length;
  const lead = commercialRecords[0];
  const second = commercialRecords[1];
  const intro = `Operational commercial pressure on shipping in the weekly window centres on port disruption, freight or insurance movement with an operational hook, and commercial-shipping disruption tied directly to vessel or cargo flows. The cycle carries ${n} qualifying record${n === 1 ? "" : "s"} on this definition.`;
  const examples = second
    ? `The lead entry is "${lead.title}" (${lead.issue.toLowerCase()}); "${second.title}" sits alongside it (${second.issue.toLowerCase()}).`
    : `The lead entry is "${lead.title}" (${lead.issue.toLowerCase()}).`;
  const watch = `Watch for follow-on schedule disruption, premium adjustments on affected routes, and any operator decisions on diversion or port-skipping. Commercial pass-through to shippers typically follows the operational signal by one to two weeks.`;
  return `${intro} ${examples}\n\n${watch}`;
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
  const countryLine = topCountries.length > 0
    ? `At country level the cycle is led by ${joinList(topCountries.map((c) => `${c.label} (${c.value})`))}.`
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
function prioritiseRelated(rows: EnrichedIncident[]): EnrichedIncident[] {
  const strong: EnrichedIncident[] = [];
  const rest: EnrichedIncident[] = [];
  for (const r of rows) {
    if (isShippingMarketOnly(r)) continue;
    const text = `${r.title ?? ""} ${r.summary ?? ""}`.toLowerCase();
    const isVesselHostile = OPERATIONAL_HOOK_RE.test(text) && /\b(attack|attacked|hijack|piracy|seized|missile|drone|hostilit)\b/.test(text);
    const isPortRouteOrChoke = /\b(port|terminal|berth|chokepoint|hormuz|red\s*sea|bab[\s-]?el[\s-]?mandeb|suez|malacca|reroute|diversion|advisory|war[\s-]?risk|insurance|premium)\b/.test(text);
    const isWeakBucket = r.issue === "Unclassified maritime record" || /^other\s.+/i.test(r.issue);
    if ((isVesselHostile || isPortRouteOrChoke) && !isWeakBucket) strong.push(r);
    else if (!isWeakBucket) rest.push(r);
  }
  const ordered = dedupeByTitle([...strong, ...rest]);
  // Cap tight so the Source Notes / Disclaimer block can be pulled back
  // onto the same page rather than orphaned on a near-empty final page.
  return ordered.slice(0, 8);
}

export const SHIPPING_SEV_LABEL = SEV_LABEL;
export const SHIPPING_SEV_COLOR = SEV_COLOR;
export { sevKey as shippingSevKey };
