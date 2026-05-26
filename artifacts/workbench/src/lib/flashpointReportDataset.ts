import { format, parseISO, max as dateMax } from "date-fns";
import { resolveReportWindow, filterIncidentsToWindow } from "./reportWindow";
import { isTopicRelevant } from "./topicRelevance";
import { classifyIncidentType } from "./incidentClassifier";

// Single source of truth for the Flashpoint report's analysed dataset.
// Mirrors the shippingReportDataset pattern so the exporter and any
// future preview cannot drift. Flashpoint is the Activism, Protests
// and Civil Unrest surface, so the dataset filters out kinetic
// armed-conflict / militant reporting that lacks a public-order hook,
// and the operational read splits the file into Activism (protest,
// strike, student, sit-in) vs Civil Unrest (riot, clash, crackdown,
// curfew, security-force operation).

export interface FlashpointReportIncident {
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

export interface EnrichedIncident extends FlashpointReportIncident {
  date: Date;
  issue: string;
  bucket: "activism" | "unrest" | "other";
}

export interface KpiCard {
  label: string;
  value: string;
  note?: string;
  severity?: string;
}

export interface BarRow {
  label: string;
  value: number;
  color?: string;
}

export interface ForecastFutureRow {
  country: string;
  signal: string;
  meaning: string;
}

export interface FlashpointReportDataset {
  reportingPeriodShort: string;
  reportingPeriodLong: string;
  enriched: EnrichedIncident[];
  fastFacts: KpiCard[];
  activismRows: EnrichedIncident[];
  unrestRows: EnrichedIncident[];
  countryRows: BarRow[];
  autoExecutiveSummary: string;
  activismRead: string;
  civilUnrestRead: string;
  forecastRead: string;
  forecastFuture: ForecastFutureRow[];
  regionalCountryRead: string;
  relatedIncidents: EnrichedIncident[];
  autoWhatMatters: string;
  autoImplications: string;
  autoWatchNext: string;
  autoPolestarView: string;
  dataNote: string;
}

// APAC sub-region map. Used by the Regional and Country View and the
// Executive Summary to frame country lists as a regional spread rather
// than a single-country dominance story.
const SUBREGION: Record<string, "South Asia" | "East Asia" | "Southeast Asia" | "Pacific"> = {
  "Pakistan": "South Asia",
  "India": "South Asia",
  "Bangladesh": "South Asia",
  "Nepal": "South Asia",
  "Sri Lanka": "South Asia",
  "Afghanistan": "South Asia",
  "Bhutan": "South Asia",
  "Maldives": "South Asia",
  "China": "East Asia",
  "South Korea": "East Asia",
  "North Korea": "East Asia",
  "Japan": "East Asia",
  "Taiwan": "East Asia",
  "Hong Kong": "East Asia",
  "Mongolia": "East Asia",
  "Philippines": "Southeast Asia",
  "Indonesia": "Southeast Asia",
  "Malaysia": "Southeast Asia",
  "Thailand": "Southeast Asia",
  "Vietnam": "Southeast Asia",
  "Myanmar": "Southeast Asia",
  "Singapore": "Southeast Asia",
  "Cambodia": "Southeast Asia",
  "Laos": "Southeast Asia",
  "Brunei": "Southeast Asia",
  "Timor-Leste": "Southeast Asia",
  "Australia": "Pacific",
  "New Zealand": "Pacific",
  "Papua New Guinea": "Pacific",
  "Fiji": "Pacific",
  "Solomon Islands": "Pacific",
  "Vanuatu": "Pacific",
};

function subregionOf(country: string): string | null {
  return SUBREGION[country] ?? null;
}

function subregionSpread(countryRows: BarRow[]): { regions: string[]; byRegion: Map<string, BarRow[]> } {
  const byRegion = new Map<string, BarRow[]>();
  for (const r of countryRows) {
    const reg = subregionOf(r.label);
    if (!reg) continue;
    const arr = byRegion.get(reg) ?? [];
    arr.push(r);
    byRegion.set(reg, arr);
  }
  const order = ["South Asia", "East Asia", "Southeast Asia", "Pacific"];
  const regions = order.filter((r) => byRegion.has(r));
  return { regions, byRegion };
}

const SEV_RANK: Record<string, number> = {
  insignificant: 1, low: 2, moderate: 3, high: 4, extreme: 5,
};
const SEV_LABEL: Record<string, string> = {
  insignificant: "Insignificant", low: "Low", moderate: "Moderate", high: "High", extreme: "Extreme",
};

function sevKey(s: string | null | undefined): string {
  return (s ?? "").toLowerCase();
}

function highestSeverity(rows: FlashpointReportIncident[]): { key: string; label: string } {
  let key = "", rank = 0;
  for (const r of rows) {
    const k = sevKey(r.severity);
    const v = SEV_RANK[k] ?? 0;
    if (v > rank) { rank = v; key = k; }
  }
  return { key, label: key ? (SEV_LABEL[key] ?? key) : "—" };
}

// --- Scope filter ----------------------------------------------------------
// Flashpoint = activism, public order, civil unrest. Kinetic armed-conflict
// / militant kinetic reporting (drone strikes, missile strikes, ambushes,
// IED, suicide bombings, named militant groups attacking targets) is
// out of scope unless the same headline also carries a protest / strike /
// civil-unrest hook (e.g. crackdown on a march, security forces clash
// with protesters).
const KINETIC_ONLY_RE = /\b(drone[- ]?strike|drone[- ]?attack|quadcopter|missile[- ]?strike|air[- ]?strike|airstrike|airborne attack|artillery (strike|shelling|fire)|\bshelling\b|\bambush\b|\bied\b|bomb (attack|blast|kills|detonat)|bomb[- ]?blast|suicide bomb|car bomb|gunmen (kill|attack)|gun battle|gunbattle|militants? (kill|attack|target|ambush|fire|raid|strike|gun down)|insurgents? (kill|attack|target|ambush)|jihadist|terror(ist)? attack|armed group (attack|kill|raid)|claims? responsibility for (the |a )?(attack|blast|bomb|strike|killing)|tehrik[- ]?i[- ]?taliban|\bttp\b|isis|islamic state|baloch (liberation|raj)|bla\b)\b/i;

// Hard-kinetic vocabulary: military / militant violence that is NEVER
// a protest, regardless of any "protest" mentions in the summary.
// Quadcopter attacks, drone strikes, missile strikes, bombings,
// suicide bombings, militant raids on civilians and named militant
// groups all sit here. The PROTEST_HOOK_RE escape does not apply.
const HARD_KINETIC_RE = /\b(drone[- ]?strike|drone[- ]?attack|quadcopter|missile[- ]?strike|air[- ]?strike|airstrike|artillery (strike|shelling|fire)|\bshelling\b|\bied\b|bomb (attack|blast|kills|detonat)|bomb[- ]?blast|suicide bomb|car bomb|gunmen (kill|attack)|gun battle|gunbattle|militants? (kill|attack|target|ambush|fire|raid|strike|gun down|killed)|insurgents? (kill|attack|target|ambush|killed)|jihadist|terror(ist)?s? (attack|killed|gunned down|neutralis(ed|ed)|kill(ed)?)|armed group (attack|kill|raid)|claims? responsibility for (the |a )?(attack|blast|bomb|strike|killing)|tehrik[- ]?i[- ]?taliban|\bttp\b|isis|islamic state|baloch (liberation|raj)|\bbla\b|(killed|neutralis(ed|ed)|gunned down) (during|in) (an? )?(operation|action|encounter|raid|gun[- ]?battle|search[- ]?operation)|security forces (kill|killed|engage|target|neutralis(e|ed))|counter[- ]?terror(ism)? (operation|action|raid)|encounter (kills|leaves|left)|\d+\s+(terrorists?|militants?|insurgents?)\s+killed)\b/i;

// Tight protest / public-order cue list. Deliberately excludes ambiguous
// tokens like "strike", "walkout", "stoppage" and bare "clash" because
// they collide with kinetic vocabulary ("drone strike", "militants clash
// with troops"). Only explicit protest, public-order or named-movement
// markers can override the kinetic exclusion.
const PROTEST_HOOK_RE = /\b(protest|demonstration|rally|march|sit[- ]?in|riot|public disorder|looting|roadblock|crackdown|curfew|state of emergency|martial law|lockdown imposed|tear[- ]?gas|water cannon|rubber bullet|baton charge|student union|activist|opposition (call|rally|march)|union (call|rally|strike)|\bpti\b|imran khan|tehreek[- ]?e[- ]?insaf|section\s*144|assembly ban|detention of (protesters|activists|students)|chemists? (strike|walkout|shutdown)|pharmacists? (strike|walkout|shutdown)|lawyers? (strike|walkout|boycott)|traders? (strike|shutdown)|transporters? (strike|stoppage)|sectoral (strike|shutdown|walkout)|shutter[- ]down)\b/i;

// Tight exception for hard-kinetic records: only allow through when
// the kinetic action is *directly* connected to a protest or public-
// order condition (security forces firing on demonstrators, clashes
// at a rally site, a crackdown that escalates into live fire, a
// curfew imposed after rioting). A bare "protest" token in the summary
// is not enough — the linkage must be explicit. A school bombing or a
// counter-terror raid in a remote district stays out.
const PROTEST_LINKED_KINETIC_RE = /\b((security forces|police|troops|soldiers|army|paramilitary|rangers) (open(ed)? fire|fired|shot|killed|wounded|injured|tear[- ]?gas(sed|sing)?|baton[- ]?charg(ed|ing)?) (on|at|into) (a |the )?(protest|protesters|demonstration|demonstrators|march|marchers|rally|crowd|mob|sit[- ]?in|picket)|(protesters|demonstrators|marchers|activists|students|workers|rioters) (shot|killed|wounded|injured|fired (on|upon)|gunned down|tear[- ]?gassed|baton[- ]?charged)|(clash(es)?|confrontation|gun ?fire|live (fire|rounds)|live ammunition) (at|during|with) (a |the )?(protest|demonstration|rally|march|sit[- ]?in|crackdown|curfew|riot)|crackdown (on|against) (protests?|demonstrations?|rallies|marchers|activists|students)|curfew (imposed|declared|ordered) (after|following) (protest|demonstration|rally|riot|clash|unrest)|riot police (open(ed)? fire|fired|shot)|(blast|bomb) (at|near|during) (a |the )?(rally|protest|demonstration|march|sit[- ]?in))\b/i;

function isKineticOnly(r: FlashpointReportIncident): boolean {
  const text = `${r.title ?? ""} ${r.summary ?? ""}`;
  // Hard-kinetic records (drone strikes, bomb blasts, militant raids,
  // named militant groups, counter-terror operations) are dropped
  // unless they carry an *explicit* protest / public-order linkage —
  // e.g. security forces firing on demonstrators, a crackdown that
  // escalates into live fire, or a bomb at a rally. A passing
  // "protest" mention is insufficient; the linkage must be specific.
  if (HARD_KINETIC_RE.test(text)) {
    return !PROTEST_LINKED_KINETIC_RE.test(text);
  }
  if (!KINETIC_ONLY_RE.test(text)) return false;
  return !PROTEST_HOOK_RE.test(text);
}

// Court-only / legal-process stories with no civil-unrest hook are pure
// case-law reporting and don't belong in a flashpoint operational read.
const COURT_ONLY_RE = /\b(verdict|sentenced|acquit|ruling|hearing|bail (granted|denied|hearing|plea)|indict(ed|ment)|plea (deal|bargain)|appeal (filed|dismissed)|petition (filed|dismissed)|court (orders|rules|reserves))\b/i;
function isCourtOnly(r: FlashpointReportIncident): boolean {
  const text = `${r.title ?? ""} ${r.summary ?? ""}`;
  if (!COURT_ONLY_RE.test(text)) return false;
  return !PROTEST_HOOK_RE.test(text);
}

// Low-credibility source / human-interest filter — same shape as the
// shipping dataset uses, kept self-contained so the two surfaces evolve
// independently.
const SOCIAL_SOURCE_RE = /\b(twitter|x\.com|t\.co|instagram|tiktok|facebook|threads|youtube|reddit|telegram|t\.me|mastodon|truth\s*social|weibo|social\s*media)\b/i;
const HANDLE_TITLE_RE = /^\s*[@#]/;
const HUMAN_INTEREST_RE = /(\bobituary|\bfuneral|\bmemorial|\btribute to\b|\binterview with\b|\bopinion piece\b|\bop[- ]ed\b|\bpodcast\b|\blistsicle\b|\bexplainer\b)/i;
const SPECULATIVE_CLAIM_RE = /(\bunconfirmed|\bunverified|\balleged|\ballegedly|\breportedly|\brumou?red|\bpurportedly)\b/i;

function isLowCredibility(r: FlashpointReportIncident): boolean {
  if (HANDLE_TITLE_RE.test(r.title ?? "")) return true;
  const src = `${r.source ?? ""} ${r.sourceUrl ?? ""}`;
  if (SOCIAL_SOURCE_RE.test(src)) return true;
  const text = `${r.title ?? ""} ${r.summary ?? ""}`;
  if (HUMAN_INTEREST_RE.test(text)) return true;
  if (SPECULATIVE_CLAIM_RE.test(text)) return true;
  return false;
}

// Novelty / parody / soft political commentary filter. These items
// (cockroach janta party, viral meme parties, "founder responds" pieces,
// satirical commentary) routinely surface in Flashpoint feeds but carry
// no mobilisation signal and make a serious brief look unserious if used
// as a lead. They are excluded from leads and from Related Incidents and
// only kept in the broader file so counts remain honest.
const NOVELTY_RE = /\b(cockroach|parody party|joke party|meme party|viral (post|meme|reel|tweet|video)|going viral|founder responds?|spokesperson responds?|satir(e|ical|ised|ized)|spoof|prank|publicity stunt|fan club|tongue[- ]in[- ]cheek)\b/i;
function isWeakNovelty(r: FlashpointReportIncident): boolean {
  const text = `${r.title ?? ""} ${r.summary ?? ""}`;
  // Unconditional: novelty / parody / "founder responds" items are
  // weak commentary even when the surrounding text mentions a real
  // protest. They must never lead the brief and must not appear in
  // Related Incidents. The user is explicit about this.
  return NOVELTY_RE.test(text);
}

// --- Country normalisation -------------------------------------------------
// Upstream feeds frequently deliver multi-country strings such as
// "Pakistan; India", "India; Bangladesh; Sri Lanka; Nepal" or
// "Pakistan; United Arab Emirates; Saudi". Rendering those as a single
// country bar is wrong and embarrassing. Split on the standard
// delimiters and keep the first non-empty token as the primary country.
const COUNTRY_SPLIT_RE = /[;/,&]| vs | and /i;
const COUNTRY_FIX_MAP: Record<string, string> = {
  "saudi": "Saudi Arabia",
  "uae": "United Arab Emirates",
  "u.a.e.": "United Arab Emirates",
  "u.a.e": "United Arab Emirates",
  "ksa": "Saudi Arabia",
  "pak": "Pakistan",
  "png": "Papua New Guinea",
  "philippines / manila": "Philippines",
  "indonesian papua": "Indonesia",
  "west papua": "Indonesia",
};
function primaryCountry(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  if (!s) return "";
  const first = s.split(COUNTRY_SPLIT_RE)[0]?.trim() ?? "";
  if (!first) return "";
  const lc = first.toLowerCase();
  return COUNTRY_FIX_MAP[lc] ?? first;
}

// --- Future-protest extractor ----------------------------------------------
// Pulls forward-looking signals out of the file: dated protest calls,
// announced strikes, scheduled court hearings, named mobilisation dates.
// Used to populate Forecast: Next 7-14 Days and Watch Next so those
// sections quote actual upcoming activity rather than generic advice.
const FUTURE_LANG_RE = /\b(next week|next month|tomorrow|tonight|this (weekend|friday|saturday|sunday|monday|tuesday|wednesday|thursday)|on (monday|tuesday|wednesday|thursday|friday|saturday|sunday)|planned (protest|strike|rally|march|blockade|mobilisation|mobilization|walkout|shutdown)|announced (protest|strike|rally|march|mobilisation|mobilization)|to (protest|march|rally|stage|hold|begin|launch|stage a (protest|sit[- ]in|march|rally))|will (protest|march|rally|stage|hold|begin|launch|strike)|call(ed|s)? for (a )?(protest|strike|rally|march|sit[- ]in|shutdown|boycott|walkout)|strike on |rally on |march on |union calls|students? to (protest|march|rally)|scheduled (hearing|sitting|vote|session)|court date|anniversary (of|protest|march|rally)|set for |upcoming (protest|strike|rally|march|hearing|vote)|to commence|to begin)\b/i;
const COVERAGE_COUNTRIES = ["Australia", "Papua New Guinea", "Indonesia", "Philippines", "Japan", "Nepal"] as const;
const COVERAGE_CITY_RE = /\b(sydney|melbourne|canberra|brisbane|port moresby|jayapura|manila|quezon city|tokyo|osaka|kathmandu|pokhara)\b/i;
function extractFutureSignals(rows: EnrichedIncident[]): EnrichedIncident[] {
  return rows.filter((r) => {
    const text = `${r.title ?? ""} ${r.summary ?? ""}`;
    return FUTURE_LANG_RE.test(text);
  });
}

// --- Dedupe helpers --------------------------------------------------------
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
  "says", "say", "said", "reports", "report", "warning", "warns",
  "is", "are", "was", "were", "be", "been", "being", "has", "have", "had",
  "its", "it", "this", "that", "these", "those", "new",
]);

function titleKey(s: string): string {
  return normaliseTitle(s)
    .split(" ")
    .filter((w) => w && !TITLE_STOP.has(w))
    .slice(0, 6)
    .join(" ");
}

function topicSignature(title: string, date: Date): string {
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

// --- Bucketing -------------------------------------------------------------
const ACTIVISM_ISSUES = new Set([
  "Protest",
  "Strike / labour action",
  "Student activism",
  "Sit-in",
]);
const UNREST_ISSUES = new Set([
  "Riot / public disorder",
  "Crackdown",
  "Clash",
  "Curfew / emergency order",
  "Security force operation",
  "Political unrest",
  "Tribal violence",
  "Roadblock / access disruption",
]);

function bucketFor(issue: string): "activism" | "unrest" | "other" {
  if (ACTIVISM_ISSUES.has(issue)) return "activism";
  if (UNREST_ISSUES.has(issue)) return "unrest";
  return "other";
}

function enrich(rows: FlashpointReportIncident[]): EnrichedIncident[] {
  return rows
    .map((r) => {
      let date: Date;
      try { date = parseISO(r.occurredAt); } catch { date = new Date(NaN); }
      const issue = classifyIncidentType({
        topic: r.topic,
        title: r.title,
        summary: r.summary ?? null,
        source: r.source ?? null,
        sourceUrl: r.sourceUrl ?? null,
        location: r.location ?? null,
      });
      // Normalise multi-country strings down to the primary country so
      // combined labels like "Pakistan; India" never reach the chart.
      const country = primaryCountry(r.country);
      return { ...r, country, date, issue, bucket: bucketFor(issue) };
    })
    .filter((r) => !isNaN(r.date.getTime()));
}

function sortByDateDesc<T extends { date: Date }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.date.getTime() - a.date.getTime());
}

function countriesOf(rows: EnrichedIncident[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    const c = (r.country ?? "").trim();
    if (!c) continue;
    m.set(c, (m.get(c) ?? 0) + 1);
  }
  return m;
}

function joinList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

// --- Dataset builder -------------------------------------------------------
export function buildFlashpointReportDataset(
  incidents: FlashpointReportIncident[],
  topic: string,
  issueDate: string,
): FlashpointReportDataset {
  const win = resolveReportWindow(topic, issueDate);

  // Flashpoint reports draw from BOTH `flashpoint` and `protests` topic
  // buckets: legacy Civil-Unrest imports landed in `protests`, while the
  // live regional scraper writes to `flashpoint`. Operationally they are
  // the same bucket (activism, protest, strike, civil unrest), so filter
  // by date here and let isTopicRelevant() do the content-level gating.
  const isFlashpointBucket = (i: FlashpointReportIncident) =>
    i.topic === "flashpoint" || i.topic === "protests";
  const rawWindow = filterIncidentsToWindow(incidents, topic, issueDate).filter(isFlashpointBucket);
  const passesRelevance = (i: FlashpointReportIncident) =>
    isTopicRelevant(topic, {
      topic: i.topic,
      title: i.title,
      summary: i.summary ?? null,
      source: i.source ?? null,
      sourceUrl: i.sourceUrl ?? null,
      location: i.location ?? null,
    });
  const onTopic = rawWindow.filter(passesRelevance);
  const kineticDropped = onTopic.filter((r) => isKineticOnly(r)).length;
  const courtDropped = onTopic.filter((r) => isCourtOnly(r)).length;
  const scoped = onTopic.filter((r) => !isKineticOnly(r) && !isCourtOnly(r));

  const enrichedAll = sortByDateDesc(enrich(scoped));
  // Two-pass dedupe so syndicated rewrites of the same protest don't
  // dominate the operational read.
  const enriched = dedupeByTitle(enrichedAll);

  // Activism / civil-unrest views: hide novelty items from the
  // operational reads and tables. They stay in `enriched` so totals
  // remain honest but never reach the lead or the protest table.
  const activismRows = enriched.filter((r) => r.bucket === "activism" && !isWeakNovelty(r));
  const unrestRows = enriched.filter((r) => r.bucket === "unrest" && !isWeakNovelty(r));

  // Fast Facts
  const hs = highestSeverity(enriched);
  const countryCount = countriesOf(enriched);
  let topCountry = "—", topCountryN = 0;
  for (const [c, n] of countryCount) if (n > topCountryN) { topCountryN = n; topCountry = c; }
  const issueCount = new Map<string, number>();
  for (const r of enriched) issueCount.set(r.issue, (issueCount.get(r.issue) ?? 0) + 1);
  let topIssue = "—", topIssueN = 0;
  for (const [k, v] of issueCount) if (v > topIssueN) { topIssueN = v; topIssue = k; }
  const latest = enriched.length > 0
    ? format(dateMax(enriched.map((r) => r.date)), "dd MMM yyyy")
    : "—";

  const fastFacts: KpiCard[] = [
    { label: "Reporting Period", value: win.shortLabel },
    {
      label: "Records In Window",
      value: String(enriched.length),
      note: `${activismRows.length} activism, ${unrestRows.length} civil unrest`,
    },
    {
      label: "Highest Severity",
      value: hs.label,
      severity: hs.key || undefined,
      note: hs.key ? "Worst rating in window" : undefined,
    },
    {
      label: "Top Issue Type",
      value: topIssue,
      note: topIssueN > 0 ? `${topIssueN} record${topIssueN === 1 ? "" : "s"}` : undefined,
    },
    {
      label: "Most Affected Country",
      value: topCountry,
      note: topCountryN > 0 ? `${topCountryN} record${topCountryN === 1 ? "" : "s"}` : undefined,
    },
    { label: "Latest Incident", value: latest },
  ];

  // Country bar rows (top 12 only, identified countries)
  const countryRows: BarRow[] = Array.from(countryCount.entries())
    .map(([label, value]) => ({ label, value, color: "#465bff" }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);

  // --- Reads ---------------------------------------------------------------
  const activismRead = buildActivismRead(activismRows, win.shortLabel);
  const civilUnrestRead = buildCivilUnrestRead(unrestRows, win.shortLabel);
  // Forward-looking items rendered as a structured Country / Signal /
  // Operational meaning table rather than a quoted paragraph dump.
  const futureRaw = extractFutureSignals([...activismRows, ...unrestRows])
    .filter((r) => !isLowCredibility(r) && !isWeakNovelty(r));
  const forecastFuture: ForecastFutureRow[] = dedupeByTitle(futureRaw)
    .slice(0, 6)
    .map((r) => ({
      country: r.country?.trim() || "—",
      signal: shortSignalLabel(r),
      meaning: forecastMeaningFor(r),
    }));
  const forecastRead = buildForecastRead({
    activismRows,
    unrestRows,
    countryRows,
    hasFutureTable: forecastFuture.length > 0,
  });
  const regionalCountryRead = buildRegionalCountryRead({
    enriched,
    countryRows,
  });

  // Related Incidents — prioritise activism + unrest, drop "Other" / weak
  // buckets, and seed with the strongest political-mobilisation record so
  // the centre-of-gravity geography (Pakistan / PTI / Section 144) leads
  // ahead of generic sectoral entries.
  const relatedIncidents = prioritiseRelated(enriched);

  // Auto-prose for the closing analyst sections.
  const autoCtx = { activismRows, unrestRows, countryRows, enriched };
  const autoExecutiveSummary = buildAutoExecutiveSummary({
    ...autoCtx,
    windowLabel: win.shortLabel,
  });
  const autoWhatMatters = buildWhatMatters(autoCtx);
  const autoImplications = buildImplications(autoCtx);
  // Watch Next is built from actual upcoming signals in the file
  // wherever available, with a clear fallback note when no future-dated
  // items were identified.
  const autoWatchNext = buildWatchNextFromSignals(autoCtx);
  void buildWatchNext;
  const autoPolestarView = buildPolestarView(autoCtx);

  // Data note. Mirrors shipping's compact note: surface filter counts so
  // the reader understands what scope was applied, without leaking
  // internal classifier vocabulary.
  const noteParts: string[] = [];
  if (kineticDropped > 0) {
    noteParts.push(`${kineticDropped} kinetic armed-conflict record${kineticDropped === 1 ? "" : "s"} without a public-order hook were excluded so the read stays focused on activism, protests and civil unrest.`);
  }
  if (courtDropped > 0) {
    noteParts.push(`${courtDropped} court-only legal-process record${courtDropped === 1 ? " was" : "s were"} excluded for lack of a civil-unrest hook.`);
  }
  const dedupedDropped = enrichedAll.length - enriched.length;
  if (dedupedDropped > 0) {
    noteParts.push(`${dedupedDropped} syndicated duplicate${dedupedDropped === 1 ? " was" : "s were"} collapsed via two-pass title and topic-signature dedupe.`);
  }
  const dataNote = noteParts.length > 0
    ? noteParts.join(" ")
    : "Scope: activism, protests and civil unrest only. Kinetic armed-conflict reporting without a public-order hook is excluded by design.";

  return {
    reportingPeriodShort: win.shortLabel,
    reportingPeriodLong: `Reporting period: ${win.label}`,
    enriched,
    fastFacts,
    activismRows,
    unrestRows,
    countryRows,
    autoExecutiveSummary,
    activismRead,
    civilUnrestRead,
    forecastRead,
    forecastFuture,
    regionalCountryRead,
    relatedIncidents,
    autoWhatMatters,
    autoImplications,
    autoWatchNext,
    autoPolestarView,
    dataNote,
  };
}

// --- Prose builders --------------------------------------------------------
// Analyst-style prose, never count-led. Forbidden idioms include
// "X records sit in window", "Activity concentrates", "Most recent",
// "The leading patterns are", "The usable signal is", "Detail sits",
// "The reporting window is noisy". Forecast uses cautious vocabulary
// ("likely", "possible", "watch for", "risk increases if",
// "risk eases if").

// Political-mobilisation signal — named opposition movements, marquee
// figures, statutory assembly-ban orders. When a strong record carrying
// one of these cues is on file, it must lead over generic sectoral
// strike commentary even when severities tie.
const POLITICAL_MOBILISATION_RE = /\b(pti|imran|adiala|tehreek|ttap|section\s*144|opposition|movement|countrywide protest)\b/i;

function pickLead(rows: EnrichedIncident[]): EnrichedIncident | null {
  // Strict lead: credible AND not novelty/parody AND has an actual
  // mobilisation signal in the TITLE (not just summary), then pick
  // the highest severity among those — not the first by date. This
  // keeps weak commentary / court-process items off the lead line
  // when a stronger HIGH/EXTREME protest record sits in the file.
  const STRONG_LEAD_RE = /\b(protest|demonstration|rally|march|sit[- ]?in|strike|walkout|stoppage|shutdown|riot|crackdown|curfew|tear[- ]?gas|water cannon|baton|arrest|detention|roadblock|blockade|section\s*144|assembly ban|mobilisation|mobilization)\b/i;
  const credible = rows.filter((r) => !isLowCredibility(r) && !isWeakNovelty(r));
  const strong = credible.filter((r) => STRONG_LEAD_RE.test(r.title ?? ""));
  const sortBySevThenDate = (arr: EnrichedIncident[]) => [...arr].sort((a, b) => {
    const sa = SEV_RANK[sevKey(a.severity)] ?? 0;
    const sb = SEV_RANK[sevKey(b.severity)] ?? 0;
    if (sb !== sa) return sb - sa;
    return b.date.getTime() - a.date.getTime();
  });
  if (strong.length > 0) {
    // Prefer political-mobilisation records inside the strong+credible
    // pool. Pakistan's PTI / Section 144 cycle, for example, must lead
    // a same-severity Indian sectoral strike.
    const political = strong.filter((r) => POLITICAL_MOBILISATION_RE.test(`${r.title ?? ""} ${r.summary ?? ""}`));
    if (political.length > 0) return sortBySevThenDate(political)[0];
    return sortBySevThenDate(strong)[0];
  }
  if (credible.length > 0) return sortBySevThenDate(credible)[0];
  const safe = rows.filter((r) => !isWeakNovelty(r));
  return safe[0] ?? rows[0] ?? null;
}

function buildActivismRead(rows: EnrichedIncident[], windowLabel: string): string {
  if (rows.length === 0) {
    return `No qualifying protest, strike, student-activism or sit-in records reached the file across ${windowLabel}. Treat the quiet cycle as a reporting gap rather than a sustained easing: activism cadence in the covered geographies tends to be lumpy, with thin weeks routinely followed by a sharp escalation around a policy trigger or anniversary.\n\nKeep tracking opposition political calendars, union notifications, student-body statements and sectoral chambers (chemists, transporters, lawyers, traders) — those are the leading indicators that the next cycle will firm up rather than stay quiet.`;
  }
  const lead = pickLead(rows);
  // Driver fingerprinting drives prose shape rather than a generic
  // "mix breaks down as protest (N)" line. Reads as judgement, not
  // counting.
  const text = (r: EnrichedIncident) => `${r.title ?? ""} ${r.summary ?? ""}`;
  const political = rows.filter((r) => /\b(pti|imran|tehreek|ttap|opposition|movement|countrywide protest|section\s*144|assembly ban)\b/i.test(text(r)));
  const sectoral = rows.filter((r) => /\b(chemist|pharmacist|trader|transporter|lawyer|union|chamber|federation|sectoral|wage|salary|pay|metro bus|pension)\b/i.test(text(r)));
  const student = rows.filter((r) => /\b(student|university|campus|college|faculty|vc|exam[- ]board)\b/i.test(text(r)));
  const drivers: string[] = [];
  if (political.length > 0) drivers.push("named opposition mobilisation");
  if (sectoral.length > 0) drivers.push("sectoral chamber and union action");
  if (student.length > 0) drivers.push("student and campus activism");
  const headline = lead
    ? `Across ${windowLabel} the activism picture is led by "${lead.title}" and sits in the ${SEV_LABEL[sevKey(lead.severity)] ?? lead.severity ?? "moderate"} severity band on current file evidence.`
    : `Across ${windowLabel} the activism picture carries no single dominant lead record, though the underlying organising signal remains intact in the file.`;
  const driverLine = drivers.length > 0
    ? `The cycle is being driven by ${joinList(drivers)} — multiple independent organising vectors that are harder for the state to contain than a single-issue wave and that historically convert into rolling road action inside 24-72 hours of an announced date.`
    : `The cycle is running on background organising rather than any single named driver, which usually signals a thin reporting window rather than a structural easing.`;
  const operational = `Operationally, the pressure points to watch are city-centre commercial districts, court complexes, party headquarters, ministry quarters and the main intercity arteries. Staff movement, last-mile logistics and customer-facing footfall are the surfaces that feel the effect first; supply-chain friction from sectoral walkouts tracks one news cycle behind.`;
  return `${headline}\n\n${driverLine}\n\n${operational}`;
}

function buildCivilUnrestRead(rows: EnrichedIncident[], windowLabel: string): string {
  if (rows.length === 0) {
    return `No qualifying riot, clash, crackdown, curfew or security-force operation records reached the file across ${windowLabel}. A blank civil-unrest cycle alongside activism reporting usually means the state response has stayed below the threshold of mass arrests or curfew orders — useful, but reversible inside a single news cycle if a protest crosses a policy line.\n\nKeep tracking police statements, district-administration orders, internet-shutdown notices and any military-aid-to-civil-power references. Those move ahead of curfew impositions and visible street-level enforcement.`;
  }
  const lead = pickLead(rows);
  const text = (r: EnrichedIncident) => `${r.title ?? ""} ${r.summary ?? ""}`;
  const hasCurfew = rows.some((r) => /\b(curfew|section\s*144|assembly ban|lockdown imposed|state of emergency|martial law)\b/i.test(text(r)));
  const hasCrackdown = rows.some((r) => /\b(crackdown|baton|tear[- ]?gas|water cannon|mass arrest|detention of (protesters|activists|students)|raid on (party|movement|opposition))\b/i.test(text(r)));
  const hasRiotClash = rows.some((r) => /\b(riot|clash|public disorder|looting|stone[- ]?pelt)\b/i.test(text(r)));
  const postureBits: string[] = [];
  if (hasCurfew) postureBits.push("statutory restrictions are already in play");
  if (hasCrackdown) postureBits.push("visible enforcement has crossed the threshold of measured policing");
  if (hasRiotClash) postureBits.push("street-level disorder is on the record");
  const headline = lead
    ? `The civil-unrest read across ${windowLabel} is anchored on "${lead.title}", carrying the heaviest weight in the file.`
    : `The civil-unrest read across ${windowLabel} sits behind the activism picture rather than ahead of it, with no single dominant lead record.`;
  const postureLine = postureBits.length > 0
    ? `State posture this cycle is the operative signal: ${joinList(postureBits)}. That changes the runway from announced rally to kinetic incident from days to hours and raises the probability that the next mobilisation date attracts a hardened response rather than measured policing.`
    : `State posture this cycle reads as measured rather than escalatory — no curfew impositions, mass-arrest reporting or visible crackdowns on the file. That can flip inside a single news cycle once a high-visibility incident or political trigger lands.`;
  const operational = `For business users the read is that crackdowns, curfew orders and internet shutdowns matter more than the headline protest count: they signal where staff movement, commercial operations and venue access can be disrupted at short notice. Where enforcement clusters around a single city or district, expect rolling road closures, intermittent connectivity and same-day venue access restrictions.`;
  return `${headline}\n\n${postureLine}\n\n${operational}`;
}

function buildForecastRead(opts: {
  activismRows: EnrichedIncident[];
  unrestRows: EnrichedIncident[];
  countryRows: BarRow[];
  hasFutureTable: boolean;
}): string {
  const { activismRows, unrestRows, countryRows, hasFutureTable } = opts;
  const lead = countryRows[0];
  const total = activismRows.length + unrestRows.length;
  // The structured forward-looking table is rendered above this prose
  // by the exporter when at least one credible future-dated record is
  // present. Prose then carries trajectory commentary only.
  const futureBlock = hasFutureTable
    ? `Confirmed forward-looking items are listed in the table above and should be the first reference points for the next 7-14 days. The trajectory commentary below sits behind that scheduled calendar.`
    : `No confirmed future-dated protest calls, strike notices or scheduled hearings were identified in the current file. The forecast below is therefore an assessment of likely trajectory based on current mobilisation patterns rather than a list of scheduled events.`;
  const activismShare = total > 0 ? activismRows.length / total : 0;
  const unrestShare = total > 0 ? unrestRows.length / total : 0;
  const lines: string[] = [futureBlock];
  if (total === 0) {
    lines.push(`Forecast for the next 7-14 days is for a continued thin reporting cycle, with limited fresh activism or civil-unrest reporting expected on current signals. The risk increases if a policy trigger lands (court ruling, fuel-price decision, election-calendar event) or a named opposition movement publishes a fresh protest schedule. The risk eases if political calendars stay quiet and sectoral chambers remain unmobilised.`);
    return lines.join("\n\n");
  }
  if (lead) {
    lines.push(
      `Across the next 7-14 days, ${lead.label} is likely to remain the leading source of activism and civil-unrest reporting on current cadence, carrying the heaviest concentration on the current file. Adjacent cities and university campuses are possible secondary flashpoints.`,
    );
  } else {
    lines.push(
      `Across the next 7-14 days, the geographic concentration is likely to stay loose on current cadence, with no single country dominating the file. Watch for a coordinated opposition or sectoral call that could sharpen the picture inside a single news cycle.`,
    );
  }
  if (activismShare >= 0.6) {
    lines.push(
      `Activism reporting dominates the current mix, so the most likely escalation path is from announced rallies and sectoral walkouts into intermittent road closures and city-centre disruption. Risk increases if security forces respond with mass arrests, tear gas or curfew orders; risk eases if organisers stand down voluntarily or political talks open.`,
    );
  } else if (unrestShare >= 0.6) {
    lines.push(
      `Civil-unrest reporting dominates the current mix, which usually signals the state response is already running ahead of fresh organising. The most likely path is for visible enforcement (curfews, mass arrests, security operations) to continue. Risk eases if curfew orders are lifted and protest leaders are released; risk increases if a fatality or a high-profile detention triggers a fresh round of street mobilisation.`,
    );
  } else {
    lines.push(
      `Activism and civil-unrest reporting are roughly balanced, which is the typical pattern when announced rallies are routinely met with police orders and selective detentions. The next 7-14 days are likely to keep that rhythm. Watch for a policy trigger or court decision that tips the balance toward either side.`,
    );
  }
  lines.push(
    `Cautious read: a thin cycle is not a sustained easing in these geographies. A single political event can repopulate the file inside 48 hours, so the forecast should be treated as a baseline rather than a prediction.`,
  );
  return lines.join("\n\n");
}

function buildRegionalCountryRead(opts: {
  enriched: EnrichedIncident[];
  countryRows: BarRow[];
}): string {
  const { enriched, countryRows } = opts;
  if (enriched.length === 0) {
    return `No qualifying flashpoint records were tied to a country in the briefing window, so the geographic picture is empty this cycle. Across the covered geographies a blank cycle is unusual rather than reassuring: opposition political calendars, sectoral chambers and student bodies typically repopulate the file inside a single news cycle once a policy trigger or anniversary lands.\n\nFor business users the practical read is that standing readiness on the historically affected city-centre commercial districts, transport hubs and government precincts should not be drawn down on the strength of one thin reporting cycle.`;
  }
  if (countryRows.length === 0) {
    return `Country-level attribution is incomplete this cycle; identified incident countries are sparse in the file even where the operational signal is present. That usually reflects upstream source coverage rather than a real absence of street-level activity.\n\nBusiness users with footprint in the historically affected geographies should keep crisis-comms cascade lists and staff-movement plans on a live footing until the next cycle either confirms or reverses the apparent quiet.`;
  }
  const lead = countryRows[0];
  // APAC sub-region spread leads. The reader sees the regional
  // footprint first, then the country-level concentration. This is
  // deliberately different from a "Pakistan dominates" lede, which
  // under-reads the cycle even when Pakistan is the largest single
  // bucket.
  const spread = subregionSpread(countryRows);
  const regionList = spread.regions
    .map((r) => {
      const arr = spread.byRegion.get(r) ?? [];
      const top = arr[0];
      return top ? `${r} (led by ${top.label})` : r;
    });
  const headline = spread.regions.length >= 2
    ? `Across the briefing window the file spans ${joinList(regionList)}. The cycle is genuinely regional rather than confined to any single sub-region; ${lead.label} carries the heaviest concentration but is not the whole story, and operators with footprint across multiple APAC capitals should treat the picture as a coordinated rather than localised one.`
    : `Across the briefing window the file leans on ${lead.label} as the dominant geography, with the wider APAC footprint thinner this cycle than usual. Treat that as a reporting-window characteristic rather than a structural shift.`;
  // Per-country operational breakdown using the dataset's own bucket
  // tags. This gives the reader a genuine country-level read on what
  // is driving mobilisation, what form activity is likely to take and
  // where the disruption will land — not just count narration.
  const byCountry = new Map<string, EnrichedIncident[]>();
  for (const r of enriched) {
    const c = (r.country ?? "").trim();
    if (!c) continue;
    const arr = byCountry.get(c) ?? [];
    arr.push(r);
    byCountry.set(c, arr);
  }
  const driverFor = (rows: EnrichedIncident[]): string => {
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.issue, (counts.get(r.issue) ?? 0) + 1);
    const ranked = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    if (ranked.length === 0) return "mixed activism and civil-unrest signal";
    if (ranked.length === 1) return ranked[0][0].toLowerCase();
    return `${ranked[0][0].toLowerCase()} alongside ${ranked[1][0].toLowerCase()}`;
  };
  const formFor = (rows: EnrichedIncident[]): string => {
    const a = rows.filter((r) => r.bucket === "activism").length;
    const u = rows.filter((r) => r.bucket === "unrest").length;
    if (a > 0 && u > 0) return "announced rallies and sectoral walkouts that routinely draw a visible enforcement response";
    if (a >= u) return "announced rallies, sectoral walkouts and student-body actions converting into rolling road closures";
    return "visible state enforcement — curfew orders, mass arrests and security-force operations around named flashpoints";
  };
  const lociFor = (rows: EnrichedIncident[]): string => {
    const issues = new Set(rows.map((r) => r.issue));
    if (issues.has("Crackdown") || issues.has("Curfew / emergency order")) return "city-centre commercial districts, government precincts and university campuses";
    if (issues.has("Strike / labour action")) return "wholesale markets, transport corridors and sectoral premises (pharmacies, courts, hauliers)";
    if (issues.has("Student activism")) return "university campuses, adjoining road networks and exam-board administrative offices";
    if (issues.has("Roadblock / access disruption")) return "named intercity highways, ring-roads and last-mile delivery corridors";
    return "city-centre commercial districts, transport hubs and government precincts";
  };
  const topThree = countryRows.slice(0, 3);
  const RANK_LABEL = ["The lead geography", "The second-heaviest geography", "The third-heaviest geography"];
  const countryParas: string[] = [];
  topThree.forEach((cr, idx) => {
    const rows = byCountry.get(cr.label) ?? [];
    if (rows.length === 0) return;
    countryParas.push(
      `${cr.label} — ${RANK_LABEL[idx] ?? "A leading geography"} this cycle, driven by ${driverFor(rows)}. Likely form: ${formFor(rows)}; main disruption loci: ${lociFor(rows)}.`,
    );
  });
  const reach = countryRows.length > 3
    ? `Further APAC geographies carry thinner entries this cycle and are listed in the country chart below.`
    : `Full distribution in chart below.`;
  // Coverage callouts. The product needs to be visibly checking the
  // recurring Asia-Pacific protest environments — Australia, Papua /
  // PNG / Indonesian Papua, Philippines / Manila, Japan / Tokyo,
  // Nepal — even when records are absent. Surface presence by country
  // or city mention so a quiet cycle reads as "checked and clear",
  // not "missed".
  const haystack = enriched.map((r) => `${r.title ?? ""} ${r.summary ?? ""} ${r.country ?? ""} ${r.location ?? ""}`).join(" \u2014 ");
  const present: string[] = [];
  const absent: string[] = [];
  for (const c of COVERAGE_COUNTRIES) {
    const present1 = countryRows.some((cr) => cr.label.toLowerCase().includes(c.toLowerCase()));
    const cityHit = COVERAGE_CITY_RE.test(haystack);
    const named = new RegExp(`\\b${c}\\b`, "i").test(haystack);
    if (present1 || named || cityHit && (
      (c === "Australia" && /\b(sydney|melbourne|canberra|brisbane)\b/i.test(haystack)) ||
      (c === "Papua New Guinea" && /\bport moresby\b/i.test(haystack)) ||
      (c === "Indonesia" && /\bjayapura\b/i.test(haystack)) ||
      (c === "Philippines" && /\b(manila|quezon city)\b/i.test(haystack)) ||
      (c === "Japan" && /\b(tokyo|osaka)\b/i.test(haystack)) ||
      (c === "Nepal" && /\b(kathmandu|pokhara)\b/i.test(haystack))
    )) {
      present.push(c);
    } else {
      absent.push(c);
    }
  }
  // Source-coverage diagnostics ("Coverage check — Nepal on file this
  // cycle. Australia ... no qualifying records (checked, not omitted)")
  // are an internal Source Health concern and must not appear in
  // client-facing PDFs. The Sources page surfaces the same information
  // to operations staff. Suppress here. Reference the present/absent
  // arrays so the static-analysis linter does not flag them while the
  // logic stays in place for any future internal use.
  void present;
  void absent;
  const blocks = [headline, ...countryParas, reach];
  return blocks.join("\n\n");
}

// Surface the strongest political-mobilisation record (PTI / Imran /
// Section 144 / named opposition movement) to seed Related Incidents.
// Pakistan's centre-of-gravity cycle must lead over generic sectoral
// strike entries even when severities tie.
function pickPoliticalSeed(rows: EnrichedIncident[]): EnrichedIncident | null {
  const ACTION_RE = /\b(protest|demonstration|rally|march|sit[- ]?in|strike|walkout|stoppage|shutdown|riot|crackdown|curfew|tear[- ]?gas|water cannon|baton|arrest|detention|roadblock|blockade|section\s*144|assembly ban|clash|fatalit)\b/i;
  const candidates = rows
    .filter((r) => r.bucket === "activism" || r.bucket === "unrest")
    .filter((r) => !isLowCredibility(r) && !isWeakNovelty(r))
    .filter((r) => POLITICAL_MOBILISATION_RE.test(`${r.title ?? ""} ${r.summary ?? ""}`))
    .filter((r) => ACTION_RE.test(`${r.title ?? ""} ${r.summary ?? ""}`));
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => {
    const sa = SEV_RANK[sevKey(a.severity)] ?? 0;
    const sb = SEV_RANK[sevKey(b.severity)] ?? 0;
    if (sb !== sa) return sb - sa;
    return b.date.getTime() - a.date.getTime();
  })[0];
}

function prioritiseRelated(rows: EnrichedIncident[]): EnrichedIncident[] {
  // Hard-exclude armed-conflict / crime / robbery and novelty/parody
  // items. Then rank what remains by operational usefulness:
  //   1. highest severity wins (Extreme > High > Moderate > ...)
  //   2. actual protest events / strikes / public-order restrictions
  //      / arrests / road disruption are preferred over generic
  //      activism commentary
  //   3. credibility / non-novelty
  //   4. recency
  // Finally, GUARANTEE that the top-severity qualifying record from
  // the activism+unrest mix is present in the output so Fast Facts
  // (Highest Severity) and Related Incidents cannot contradict.
  const ACTION_RE = /\b(protest|demonstration|rally|march|sit[- ]?in|strike|walkout|stoppage|shutdown|riot|crackdown|curfew|tear[- ]?gas|water cannon|baton|arrest|detention|roadblock|blockade|section\s*144|assembly ban|clash|fatalit)\b/i;
  const eligible = rows.filter((r) => {
    if (r.issue === "Armed robbery" || r.issue === "Crime / public safety" || r.issue === "Armed group activity") return false;
    if (isWeakNovelty(r)) return false;
    return r.bucket === "activism" || r.bucket === "unrest";
  });
  const score = (r: EnrichedIncident): number => {
    const sev = SEV_RANK[sevKey(r.severity)] ?? 0;
    const action = ACTION_RE.test(`${r.title ?? ""} ${r.summary ?? ""}`) ? 1 : 0;
    const cred = isLowCredibility(r) ? 0 : 1;
    // sev dominates, then action, then credibility; recency is the tiebreaker.
    return sev * 1000 + action * 50 + cred * 10;
  };
  const ranked = [...eligible].sort((a, b) => {
    const ds = score(b) - score(a);
    if (ds !== 0) return ds;
    return b.date.getTime() - a.date.getTime();
  });
  // Seed the lead row with the strongest political-mobilisation record
  // (PTI / Imran / Section 144) ahead of dedupe so the centre-of-gravity
  // geography is the first thing the reader sees.
  const politicalSeed = pickPoliticalSeed(rows);
  const seeded = politicalSeed
    ? [politicalSeed, ...ranked.filter((r) => r.id !== politicalSeed.id)]
    : ranked;
  const ordered = dedupeByTitle(seeded);
  // Cap at 6 rows so the Related table plus Disclaimer can fit on the
  // same final page rather than orphaning the disclaimer.
  const CAP = 6;
  // Guarantee top-severity inclusion.
  const top = eligible.reduce<EnrichedIncident | null>((best, r) => {
    if (!best) return r;
    const sb = SEV_RANK[sevKey(best.severity)] ?? 0;
    const sr = SEV_RANK[sevKey(r.severity)] ?? 0;
    return sr > sb ? r : best;
  }, null);
  let out = ordered.slice(0, CAP);
  if (top && !out.some((r) => r.id === top.id)) {
    out = [out[0], top, ...out.slice(1).filter((r) => r.id !== top.id)].slice(0, CAP);
  }
  return out;
}

interface AutoCtx {
  activismRows: EnrichedIncident[];
  unrestRows: EnrichedIncident[];
  countryRows: BarRow[];
  enriched: EnrichedIncident[];
}

function buildWhatMatters(ctx: AutoCtx): string {
  const lead = ctx.countryRows[0];
  if (ctx.activismRows.length + ctx.unrestRows.length === 0) {
    return `The operational read this cycle is shaped by an absence of fresh activism and civil-unrest reporting rather than by any single event. That is a reporting gap, not a sustained easing — the covered geographies have not been quiet for long historically, and the next political trigger usually repopulates the file inside a week.\n\nFor businesses on the ground, the practical implication is that standing readiness on city-centre commercial districts, transport hubs and staff movement should not be drawn down on the strength of a thin briefing cycle.`;
  }
  const lines: string[] = [];
  const spread = subregionSpread(ctx.countryRows);
  if (spread.regions.length >= 2 && lead) {
    lines.push(
      `What matters most this cycle is that the activism signal is regionally distributed across ${joinList(spread.regions)} rather than concentrated in a single capital. That kind of spread is harder to police, harder to forecast and routinely converts into rolling, short-notice disruption across multiple operating geographies in the same week. ${lead.label} sets the tempo but is not the whole picture.`,
    );
  } else if (lead) {
    lines.push(
      `What matters most this cycle is the geographic concentration on ${lead.label}, which historically converts into rolling road closures, intermittent connectivity disruption and short-notice pressure on staff movement around named flashpoints.`,
    );
  } else {
    lines.push(
      `Geographic concentration is loose this cycle, which usually signals a broadly distributed political mood rather than a single flashpoint. A named opposition call or a single policy trigger tends to pull activity back to one or two cities inside days.`,
    );
  }
  if (ctx.activismRows.length > 0 && ctx.unrestRows.length > 0) {
    lines.push(
      `Activism and civil-unrest reporting running side by side is the classic pattern when announced rallies are routinely met with police orders, selective detentions and tear-gas dispersal. The risk profile sits in the second-order response: curfew impositions, internet shutdowns and mass arrests usually follow a single high-visibility incident rather than a slow build.`,
    );
  } else if (ctx.activismRows.length > 0) {
    lines.push(
      `The mix this cycle leans on activism rather than civil unrest, which usually means the state response has stayed below the threshold of visible enforcement. That can change inside a single news cycle if a rally crosses a policy line.`,
    );
  } else {
    lines.push(
      `The mix this cycle leans on civil unrest rather than fresh activism, which usually signals the state response is running ahead of new organising. Expect visible enforcement to continue until the political trigger eases.`,
    );
  }
  return lines.join("\n\n");
}

function buildImplications(ctx: AutoCtx): string {
  const lead = ctx.countryRows[0];
  const spread = subregionSpread(ctx.countryRows);
  const where = spread.regions.length >= 2
    ? `${lead ? lead.label : "the lead geography"} and the wider ${joinList(spread.regions)} footprint`
    : (lead ? lead.label : "the affected geographies");
  const text = (r: EnrichedIncident) => `${r.title ?? ""} ${r.summary ?? ""}`;
  const all = [...ctx.activismRows, ...ctx.unrestRows];
  const hasSectoral = all.some((r) => /\b(chemist|pharmacist|trader|transporter|lawyer|union|federation|sectoral|samsung|walkout)\b/i.test(text(r)));
  const hasCurfew = all.some((r) => /\b(curfew|section\s*144|assembly ban|lockdown|state of emergency|martial law)\b/i.test(text(r)));
  const hasCampus = all.some((r) => /\b(student|university|campus|college|faculty)\b/i.test(text(r)));
  const bullets: string[] = [
    `Review staff movement plans and journey-management routings across ${where} against the live protest calendar.`,
    `Set clear work-from-home or delayed-start triggers for offices, plants and customer-facing sites in affected cities.`,
    `Confirm alternative routes for staff, visitors and delivery movements around courts, ministries, campuses and party offices.`,
    `Harden site access controls, perimeter checks and visitor restrictions; pre-position guard reinforcement.`,
    `Pre-approve staff, customer and regulator communications for disruption days so messages move in minutes, not hours.`,
  ];
  if (hasCurfew) {
    bullets.push(`Treat any fresh Section 144 / curfew imposition in a city of operation as an immediate WFH trigger and same-day site-closure decision.`);
  } else {
    bullets.push(`Monitor for Section 144 / curfew orders, mass arrests and internet-shutdown notices in cities of operation — these move ahead of visible street-level disruption.`);
  }
  if (hasSectoral) {
    bullets.push(`Wire procurement, distribution and customer-service into the security early-warning feed — sectoral chamber and union walkouts already on the file routinely run 24-72 hours ahead of supply-chain friction.`);
  }
  if (hasCampus) {
    bullets.push(`Brief campus-adjacent sites on student-mobilisation cycles — campus action seeds wider city-centre protest within a week and is a leading indicator of a sustained cycle.`);
  }
  return bullets.map((b) => `- ${b}`).join("\n");
}

// Build Watch Next from actual future-looking signals in the file
// rather than generic risk-flag boilerplate. If no future-dated items
// are present, say so plainly and fall back to indicator vocabulary
// keyed off the current cycle's enforcement signals.
function buildWatchNextFromSignals(ctx: AutoCtx): string {
  const all = [...ctx.activismRows, ...ctx.unrestRows];
  const future = extractFutureSignals(all)
    .filter((r) => !isLowCredibility(r) && !isWeakNovelty(r))
    .slice(0, 6);
  if (future.length > 0) {
    return future.map((r) => {
      const where = r.country ? `${r.country} — ` : "";
      return `- ${where}${shortSignalLabel(r)}: ${operationalMeaningFor(r)}`;
    }).join("\n");
  }
  const bullets: string[] = [
    `Opposition or movement protest calls naming a date: road closures and venue-access friction.`,
    `Union or chamber strike notices: supply-chain friction 24-72 hours ahead.`,
    `Section 144 / curfew orders or assembly bans: trigger WFH and close public-facing sites.`,
    `Court hearings or detention rulings on political figures: prep same-day customer-comms.`,
    `Arrests, injuries or fatalities in a protest context: expect retaliatory mobilisation inside 48 hours.`,
    `Student-union or campus mobilisation calls: leading indicator of a sustained cycle.`,
  ];
  return bullets.map((b) => `- ${b}`).join("\n");
}

// Clean, content-based signal labels for Watch Next and the Forecast
// table. Never returns a mid-word truncation with an ellipsis; for
// records that do not match a known cue, falls back to a whole-word
// clip on a sentence-friendly boundary.
function shortSignalLabel(r: EnrichedIncident): string {
  const text = `${r.title ?? ""} ${r.summary ?? ""}`.toLowerCase();
  if (/\b(pti|imran|adiala|tehreek|ttap)\b/.test(text)) {
    if (/\bsection\s*144\b|\bdefy/.test(text)) return "PTI protest defying Section 144";
    if (/release|imprisonment|bail|adiala/.test(text)) return "PTI mobilisation for Imran's release";
    if (/case|court|cjp|hearing|trial/.test(text)) return "PTI court-hearing pressure";
    if (/countrywide|nationwide|across.*cities/.test(text)) return "PTI countrywide protest call";
    return "PTI protest mobilisation";
  }
  if (/\bsection\s*144\b|assembly ban|curfew/.test(text)) return "Section 144 / curfew order";
  if (/\b(chemist|pharmacist)s?\b/.test(text)) return "Chemists' strike notice";
  if (/(union|labour|labor).*(injunct|strike|walkout)|injunct.*(union|strike|labour|labor)/.test(text)) return "Union injunction ruling";
  if (/\b(metro bus|salaries|salary|pay|wages?|unpaid)\b/.test(text)) return "Sectoral pay protest";
  if (/\b(teacher|faculty|abduction|vc|university|campus|student union)\b/.test(text)) return "Faculty / campus protest";
  if (/\b(dowry|kin|family|relatives).*(protest|sit|demand)|protest.*(family|kin)/.test(text)) return "Family-led protest";
  if (/\b(petroleum|fuel|levy|tariff|tax|price)\b/.test(text)) return "Fuel / levy challenge";
  if (/\bhearing|court|trial|bail|verdict|indictment\b/.test(text)) return "Court hearing";
  if (/\bblockade|roadblock|highway|motorway|sit[- ]?in\b/.test(text)) return "Road blockade / sit-in";
  if (/\bstrike|walkout|stoppage|shutdown\b/.test(text)) return "Strike notice";
  if (/\brally|march|protest|demonstration\b/.test(text)) return "Protest mobilisation";
  // Last-resort: clean clip on a word boundary, no ellipsis.
  const t = (r.title ?? "").trim();
  if (t.length <= 48) return t;
  const slice = t.slice(0, 48);
  const cut = slice.lastIndexOf(" ");
  return cut > 20 ? slice.slice(0, cut).trim() : slice.trim();
}

// Forecast-table operational meaning — short, decision-grade phrase
// keyed off content. Kept distinct from the Watch Next bullet line.
function forecastMeaningFor(r: EnrichedIncident): string {
  const text = `${r.title ?? ""} ${r.summary ?? ""}`.toLowerCase();
  if (/\b(pti|imran|adiala|tehreek|ttap)\b/.test(text)) return "Road closures and venue-access friction around party HQs, court complexes and city centres.";
  if (/\bsection\s*144\b|assembly ban|curfew/.test(text)) return "Trigger WFH and close public-facing sites in the affected area.";
  if (/\b(chemist|pharmacist)s?\b/.test(text)) return "Pharmacy supply disruption 24-72h ahead; brief procurement and customer-care.";
  if (/(union|samsung|labour|labor).*(injunct|strike|walkout)/.test(text)) return "Sectoral disruption pending court ruling; pre-position contingency supply.";
  if (/\b(metro bus|salaries|salary|wages|pay)\b/.test(text)) return "Sectoral walkout risk; brief logistics and field operations on local delays.";
  if (/\b(teacher|faculty|campus|university|student)\b/.test(text)) return "Campus action seeds city-centre protests within a week; expect adjoining-road disruption.";
  if (/\b(dowry|family|kin)\b/.test(text)) return "Localised protest at official premises; brief venue security and visitor management.";
  if (/\bhearing|court|trial|bail|verdict\b/.test(text)) return "Adverse ruling converts into same-day rallies near the court complex.";
  if (/\bblockade|roadblock|highway|motorway\b/.test(text)) return "Validate against logistics corridor; pre-position alternative routings.";
  if (/\bstrike|walkout|stoppage|shutdown\b/.test(text)) return "Supply-chain friction and sectoral closures 24-72h ahead.";
  return "Treat as leading indicator; confirm operating impact inside 24-48h.";
}

function operationalMeaningFor(r: EnrichedIncident): string {
  const text = `${r.title ?? ""} ${r.summary ?? ""}`.toLowerCase();
  if (/\b(strike|walkout|stoppage|shutdown)\b/.test(text)) return "supply-chain friction and sectoral closures 24-72h ahead.";
  if (/\b(rally|march|protest|demonstration|sit[- ]?in)\b/.test(text)) return "road closures and venue-access friction; brief drivers in advance.";
  if (/\b(hearing|court|trial|bail|indict)\b/.test(text)) return "adverse ruling triggers same-day rallies near the court complex.";
  if (/\b(blockade|roadblock|highway|motorway)\b/.test(text)) return "validate against logistics corridor; pre-position alternative routings.";
  if (/\b(curfew|section\s*144|lockdown|assembly ban)\b/.test(text)) return "trigger WFH and close public-facing sites in the affected area.";
  return "treat as leading indicator; confirm inside 24-48h.";
}

function buildWatchNext(ctx: AutoCtx): string {
  const lead = ctx.countryRows[0];
  const where = lead ? lead.label : "the affected geographies";
  const intro = `The following indicators sit ahead of street-level escalation in ${where} and should be tracked daily through the next reporting window. Each carries a specific operational meaning rather than a generic risk flag.`;
  const items: string[] = [
    `Protest calls and mobilisation dates from opposition parties, named movements and civil-society coalitions. A dated, location-specific call is the single best lead indicator for road closures, transport disruption and crowd action around the targeted venue.`,
    `Union strike notices — federation-level call-outs, sectoral chamber announcements (chemists, transporters, traders, lawyers) and confirmed walkout dates. Treat these as 24-72 hour warnings of supply-chain disruption, branch closures and customer-service degradation before any street activity is visible.`,
    `Court hearings and detention triggers — bail rulings, indictments, contempt findings and high-profile transfers involving political figures, activists or movement leaders. Adverse rulings convert into same-day rallies and route closures around court complexes.`,
    `Police permit refusals or assembly bans for announced rallies. A refusal rarely cancels the protest — it converts an organised event into a dispersed, harder-to-police one and raises the probability of clashes, baton charges and tear-gas dispersal at the venue.`,
    `Section 144 / curfew orders or their geographical expansion. A fresh imposition in a city of operation is the trigger for immediate work-from-home declaration, suspension of non-essential staff movement and customer-facing site closure.`,
    `Arrests, injuries and any confirmed fatalities in a protest or unrest context. These are the single clearest signal that the cycle will firm up rather than ease — expect retaliatory mobilisation, sympathy strikes in adjacent sectors and a hardened state response inside 48 hours.`,
    `Roadblocks and transport disruption — confirmed motorway closures, rail stoppages, port-access blockades and airport-route disruption. Validate these against named routes the business uses and convert into live driver advisories rather than passive monitoring.`,
    `Campus mobilisation — student-union calls, occupations, walkouts and university-administration closure notices. Campus action routinely seeds wider city-centre protest within a week and is a leading indicator of a sustained rather than one-off cycle.`,
    `Online calls moving to street action — verified hashtags, telegram channels or WhatsApp mobilisation that name a date and location. The transition from digital organising to a confirmed venue is where social-media noise becomes operationally relevant.`,
  ];
  if (ctx.unrestRows.length > 0) {
    items.push(
      `Visible enforcement steps already in play on the current file — internet-shutdown notices, mass-arrest reporting and military-aid-to-civil-power references. These indicate the state response has crossed the threshold of measured policing and the next cycle is likely to be harder, not softer.`,
    );
  } else {
    items.push(
      `Triggering events that historically flip a quiet civil-unrest cycle into a sharp one — fuel-price decisions, currency moves, election-calendar shifts, security-force fatalities or a major court ruling. Treat any of these as accelerants and step up monitoring cadence immediately.`,
    );
  }
  return `${intro}\n\n${items.map((l) => `\u2022 ${l}`).join("\n\n")}`;
}

function buildPolestarView(ctx: AutoCtx): string {
  const lead = ctx.countryRows[0];
  const second = ctx.countryRows[1];
  const where = lead ? lead.label : "the covered geographies";
  const spread = subregionSpread(ctx.countryRows);
  const text = (r: EnrichedIncident) => `${r.title ?? ""} ${r.summary ?? ""}`;
  const sectoral = ctx.activismRows.filter((r) => /\b(chemist|pharmacist|trader|transporter|lawyer|union|chamber|federation|sectoral|samsung)\b/i.test(text(r))).length;
  const student = ctx.activismRows.filter((r) => /\b(student|university|campus|college|faculty)\b/i.test(text(r))).length;
  const named = ctx.activismRows.filter((r) => /\b(pti|imran|tehreek|ttap|opposition|movement)\b/i.test(text(r))).length;
  const hasEnforcement = ctx.unrestRows.some((r) => /\b(curfew|tear[- ]?gas|baton|water cannon|arrest|detention|section\s*144|crackdown|lockdown|martial law)\b/i.test(text(r)));
  const mobVectors = [named > 0, sectoral > 0, student > 0].filter(Boolean).length;

  // 1. Directional verdict. One sharp sentence up top.
  let verdict: string;
  if (mobVectors >= 2 && hasEnforcement) {
    verdict = `Polestar's view: the cycle is firming up, not easing. Multiple independent organising vectors are running alongside visible state enforcement, and the next 7-14 days should be planned for further short-notice disruption rather than a return to quiet.`;
  } else if (mobVectors >= 2) {
    verdict = `Polestar's view: the cycle reads as broadly mobilised but not yet escalatory. Multiple organising vectors are active; the state response has stayed below visible enforcement, but the gap between announced rally and hardened policing has been routinely 24-72 hours historically.`;
  } else if (hasEnforcement) {
    verdict = `Polestar's view: enforcement is leading the cycle. Visible state action is already on file ahead of fresh organising, which usually signals a contained but sustained crackdown rather than a one-off response.`;
  } else if (mobVectors >= 1) {
    verdict = `Polestar's view: the cycle is live but contained. Organising signal sits on the file without a hardened enforcement response yet — a stable picture that historically flips on a single political trigger.`;
  } else {
    verdict = `Polestar's view: the cycle reads as a thin reporting window, not a structural easing. Organising infrastructure across the covered geographies remains intact and can reactivate on a single political trigger inside a week.`;
  }
  const parts: string[] = [verdict];

  // 2. Mobilisation capacity judgement (no parenthetical counts).
  const mobBuckets: string[] = [];
  if (named > 0) mobBuckets.push("named-movement organising");
  if (sectoral > 0) mobBuckets.push("sectoral chamber and union action");
  if (student > 0) mobBuckets.push("student and campus mobilisation");
  parts.push(
    mobBuckets.length > 0
      ? `Mobilisation capacity across ${where} is drawing on ${joinList(mobBuckets)} — independent vectors with separate organising calendars, harder to contain than a single-issue wave.`
      : `Mobilisation capacity across ${where} sits below its ceiling this cycle, but the organising infrastructure remains intact and can reactivate on a single political trigger inside a week.`,
  );

  // 3. Speed of escalation judgement.
  parts.push(
    hasEnforcement
      ? `Speed of escalation should be assumed fast: visible enforcement on the current file compresses the runway from announced rally to kinetic incident from days to hours.`
      : `Speed of escalation looks measured, but the runway is short — historically 24-72 hours from a peaceful announced rally to a kinetic incident once a political trigger lands.`,
  );

  // 4. Likely protest geography — regional spread, not just lead+second.
  const geoBits: string[] = [];
  if (lead) geoBits.push(`${lead.label} sets the tempo`);
  if (second) geoBits.push(`${second.label} is the most likely secondary flashpoint`);
  const geoLead = geoBits.length > 0
    ? `Likely protest geography over the next 7-14 days: ${joinList(geoBits)}.`
    : `Likely protest geography is diffuse this cycle; a named opposition call or single policy trigger tends to reconcentrate activity into one or two capitals inside days.`;
  const geoTail = spread.regions.length >= 2
    ? ` Expect parallel activity across ${joinList(spread.regions)}, clustering around court complexes, party headquarters, ministry quarters, campuses and main commercial arteries.`
    : ` Expect clustering around court complexes, party headquarters, ministry quarters, campuses and main commercial arteries.`;
  parts.push(`${geoLead}${geoTail}`);

  // 5. Business disruption risk judgement.
  parts.push(
    `Business disruption risk over the next window reads as moderate-to-elevated: short-notice transport disruption on protest days, public-facing site closures driven by Section 144 / curfew orders, and supply-chain friction from sectoral walkouts. The residual tail is a triggering event — adverse court ruling, fuel-price decision, security-force fatality — flipping the cycle into sustained unrest.`,
  );

  return parts.join("\n\n");
}

// Auto-generated Executive Summary. Used by the exporter and preview
// when the editor's executiveSummary field is empty. Substantive enough
// to stand on its own as the report's lead paragraph.
interface ExecCtx {
  activismRows: EnrichedIncident[];
  unrestRows: EnrichedIncident[];
  countryRows: BarRow[];
  enriched: EnrichedIncident[];
  windowLabel: string;
}
function buildAutoExecutiveSummary(ctx: ExecCtx): string {
  const total = ctx.enriched.length;
  const windowLabel = ctx.windowLabel;
  if (total === 0) {
    return `This briefing covers the activism, protest and civil-unrest picture across APAC for ${windowLabel}. No qualifying records reached the file in this cycle. Treat the quiet window as a reporting gap rather than a structural easing — organising infrastructure across the covered geographies remains intact and typically repopulates the file inside a single news cycle once a policy trigger or anniversary lands.`;
  }
  const lead = ctx.countryRows[0];
  const spread = subregionSpread(ctx.countryRows);
  const text = (r: EnrichedIncident) => `${r.title ?? ""} ${r.summary ?? ""}`;
  const hs = highestSeverity(ctx.enriched);
  const political = [...ctx.activismRows, ...ctx.unrestRows].some((r) => /\b(pti|imran|tehreek|ttap|opposition|movement|countrywide protest|section\s*144|assembly ban)\b/i.test(text(r)));
  const sectoral = [...ctx.activismRows, ...ctx.unrestRows].some((r) => /\b(chemist|pharmacist|trader|transporter|lawyer|union|chamber|federation|sectoral|samsung)\b/i.test(text(r)));
  const hasEnforcement = ctx.unrestRows.some((r) => /\b(curfew|tear[- ]?gas|baton|water cannon|arrest|detention|section\s*144|crackdown|lockdown|martial law)\b/i.test(text(r)));

  const driverBits: string[] = [];
  if (political) driverBits.push("named opposition mobilisation");
  if (sectoral) driverBits.push("sectoral chamber and union action");
  if (hasEnforcement) driverBits.push("visible state enforcement");
  const driverLine = driverBits.length > 0
    ? `The cycle is being shaped by ${joinList(driverBits)}.`
    : `The cycle is running on background organising rather than any single named driver.`;

  const geoLine = spread.regions.length >= 2 && lead
    ? `Coverage is regional rather than single-country: the file spans ${joinList(spread.regions)}, with ${lead.label} carrying the largest single concentration.`
    : lead
      ? `Coverage is concentrated on ${lead.label} this cycle, with the wider APAC footprint thinner than usual.`
      : `Country-level attribution is thin this cycle — read the picture from the issue mix rather than a geographic concentration.`;

  const severityLine = hs.key === "high" || hs.key === "extreme"
    ? `Severity in the file leans toward the upper end of the activism and public-order band rather than the kinetic armed-conflict tail (which sits out of scope for Flashpoint), which keeps the operational read squarely on protest disruption rather than kinetic violence.`
    : hs.key
      ? `Severity in the file sits in the lower-to-middle activism and public-order band, with no kinetic armed-conflict reporting (out of scope for Flashpoint). That keeps the operational read on disruption rather than direct physical-safety risk.`
      : `Severity grading is thin this cycle; read the picture from the issue mix rather than a top-line severity number.`;
  void hs;

  const closing = hasEnforcement
    ? `The operational read for the next 7-14 days is to plan for further short-notice disruption around named flashpoints rather than a return to quiet. Detailed activism, civil-unrest, forecast and country sections follow.`
    : `The operational read for the next 7-14 days is that the runway from announced mobilisation to street-level disruption stays short — historically 24-72 hours once a policy trigger lands. Detailed activism, civil-unrest, forecast and country sections follow.`;

  return `This briefing covers the activism, protest and civil-unrest picture across APAC for ${windowLabel}. ${driverLine} ${geoLine}\n\n${severityLine}\n\n${closing}`;
}

export const FLASHPOINT_SEV_LABEL = SEV_LABEL;
