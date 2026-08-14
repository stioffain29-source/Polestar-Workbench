import { format, parseISO, max as dateMax, differenceInCalendarDays } from "date-fns";
import { resolveReportWindow, filterIncidentsToWindow } from "./reportWindow";
import { isTopicRelevant } from "./topicRelevance";
import { classifyIncidentType } from "./incidentClassifier";
import { stripWireCruft } from "./incidentTitle";
import {
  extractFutureSignals,
  hasUpcomingSignal,
  shortSignalLabel,
  forecastMeaningFor,
  operationalMeaningFor,
  locationForeignToCountry,
} from "./upcomingSignals";
import { deriveIncidentCountry, LOCATION_NOT_IDENTIFIED } from "./shippingCountry";
import {
  aggregateIncidentSignificance,
  compareIncidentSignificance,
  incidentSeverityRank,
} from "@workspace/country-engine";
// Subpath import only — the @workspace/ingest ROOT barrel drags pg/rss-parser
// into the browser bundle and crashes the app ("Buffer is not defined").
import { isReactionLed } from "@workspace/ingest/severity";

// Single source of truth for the Flashpoint report's analysed dataset.
// Mirrors the shippingReportDataset pattern so the exporter and any
// future preview cannot drift. Flashpoint is the Activism, Protests
// and Civil Unrest surface, so the dataset filters out kinetic
// armed-conflict / militant reporting that lacks a public-order hook,
// and the operational read splits the file into Activism (protest,
// strike, student, sit-in) vs Civil Unrest (riot, clash, crackdown,
// curfew, security-force operation).

// Hard cap on the Flashpoint report's Related Incidents table. The server only
// generates per-incident AI summaries for the first MAX_PROSE_INCIDENTS rows
// (see artifacts/api-server/src/lib/countryProse.ts), so this must never exceed
// that cap — otherwise rows beyond it would silently show the deterministic
// line. Asserted in __tests__/workbench/relatedIncidentsCap.test.ts.
export const FLASHPOINT_RELATED_ROW_CAP = 6;

// Rows actually rendered by the Activism / Civil Unrest incident tables in
// BOTH the preview (FlashpointReportPreview IncidentTable rowLimit) and the
// PDF (exportFlashpointReportPdf drawIncidentTable rowLimit). Keep the three
// in lockstep — the cross-section dedupe below uses this cap to decide which
// incidents have already been surfaced.
export const FLASHPOINT_TABLE_ROW_CAP = 12;

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
  // Explicitly STATED event date lifted verbatim from the source text
  // ("set for 13 August", "through 16 August"). Never inferred — when the
  // text states no date this stays null and the table renders "—".
  date: string | null;
}

// Lift an explicitly stated future date out of the announcement text. Only a
// literal "on/set for/until/through/by/from <day> <month>" (or "<month> <day>")
// qualifies — no guessing, per the no-fabrication rule in upcomingSignals.ts.
const FORECAST_MONTH =
  "(january|february|march|april|may|june|july|august|september|october|november|december)";
const FORECAST_DATE_RE = new RegExp(
  `\\b(?:on|set for|until|through|by|from|starting)\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s+${FORECAST_MONTH}\\b` +
    `|\\b(?:on|set for|until|through|by|from|starting)\\s+${FORECAST_MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`,
  "i",
);
const BARE_FORECAST_DATE_RE = new RegExp(
  `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${FORECAST_MONTH}\\b`,
  "i",
);
function explicitForecastDate(r: { title?: string | null; summary?: string | null }): string | null {
  const text = `${r.title ?? ""} ${r.summary ?? ""}`;
  const m = FORECAST_DATE_RE.exec(text);
  if (m) {
    const day = m[1] ?? m[4];
    const month = m[2] ?? m[3];
    if (day && month) {
      return `${parseInt(day, 10)} ${month.charAt(0).toUpperCase()}${month.slice(1).toLowerCase()}`;
    }
  }
  // Bare "10 August" in a strike/protest headline (no "on/set for" prefix).
  if (/\b(protest|demonstration|rally|march|strike|walkout|shutdown|sit[- ]?in)\b/i.test(text)) {
    const bare = BARE_FORECAST_DATE_RE.exec(text);
    if (bare) {
      const day = bare[1];
      const month = bare[2];
      if (day && month) {
        return `${parseInt(day, 10)} ${month.charAt(0).toUpperCase()}${month.slice(1).toLowerCase()}`;
      }
    }
  }
  return null;
}

// A forecast entry whose explicitly-stated date is ON or BEFORE the report's
// issue date has already happened — it belongs in the window narrative, not
// the forward-looking table ("10 August" rows rendering in a 10-August report
// was an owner-flagged defect). Dateless rows are unaffected. A stated date
// far behind the window end is treated as next year's event, not a passed one.
const MONTH_INDEX: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

/** End of the report issue date in UTC — forecast status compares against this. */
function endOfReportDay(issueDate: Date): Date {
  return new Date(
    Date.UTC(
      issueDate.getUTCFullYear(),
      issueDate.getUTCMonth(),
      issueDate.getUTCDate(),
      23,
      59,
      59,
      999,
    ),
  );
}

function parseStatedEventDate(
  r: { title?: string | null; summary?: string | null },
  refYear: number,
): Date | null {
  const s = explicitForecastDate(r);
  if (!s) return null;
  const [d, mName] = s.split(" ");
  const m = MONTH_INDEX[(mName ?? "").toLowerCase()];
  if (m === undefined) return null;
  return new Date(Date.UTC(refYear, m, parseInt(d ?? "0", 10)));
}

/** Lift a verbatim stated event date and resolve year rollover near window end. */
function normalizeStatedEventDate(
  r: { title?: string | null; summary?: string | null },
  referenceEnd: Date,
): Date | null {
  let dt = parseStatedEventDate(r, referenceEnd.getUTCFullYear());
  if (!dt) return null;
  if (referenceEnd.getTime() - dt.getTime() > 180 * 86400000) {
    dt = parseStatedEventDate(r, referenceEnd.getUTCFullYear() + 1);
  }
  return dt;
}

/** Effective event date for period totals: stated date in source text, else publication date. */
function effectiveEventDate(
  r: EnrichedIncident,
  referenceEnd: Date,
): Date {
  return normalizeStatedEventDate(r, referenceEnd) ?? r.date;
}

function isInReportingPeriod(r: EnrichedIncident, win: { start: Date; end: Date }): boolean {
  const refEnd = endOfReportDay(win.end);
  const eventMs = effectiveEventDate(r, refEnd).getTime();
  const startMs = Date.UTC(
    win.start.getUTCFullYear(),
    win.start.getUTCMonth(),
    win.start.getUTCDate(),
  );
  return eventMs >= startMs && eventMs <= refEnd.getTime();
}

/** True when source text names an event date outside the reporting window. */
function isScheduledOutsideReportingPeriod(
  r: { title?: string | null; summary?: string | null },
  topic: string,
  issueDate: string,
): boolean {
  const win = resolveReportWindow(topic, issueDate);
  const refEnd = endOfReportDay(win.end);
  const stated = normalizeStatedEventDate(r, refEnd);
  if (!stated) return false;
  const startMs = Date.UTC(
    win.start.getUTCFullYear(),
    win.start.getUTCMonth(),
    win.start.getUTCDate(),
  );
  return stated.getTime() > refEnd.getTime() || stated.getTime() < startMs;
}

function forecastDateHasPassed(
  r: { title?: string | null; summary?: string | null },
  issueDate: Date,
): boolean {
  const refEnd = endOfReportDay(issueDate);
  const stated = normalizeStatedEventDate(r, refEnd);
  if (!stated) return false;
  return stated.getTime() <= refEnd.getTime();
}

function buildScreeningNote(args: {
  rawWindowCount: number;
  distinct: number;
  dedupedDropped: number;
  offTopicDropped: number;
  kineticDropped: number;
  courtDropped: number;
  outOfScopeCrimeDropped: number;
  weakNoveltyDropped: number;
  weakOperationalDropped: number;
  /** Usable rows whose stated event date falls outside the reporting window. */
  forecastHeld: number;
}): string {
  const excluded =
    args.offTopicDropped +
    args.kineticDropped +
    args.courtDropped +
    args.outOfScopeCrimeDropped +
    args.weakNoveltyDropped +
    args.weakOperationalDropped;
  const parts: string[] = [`${args.rawWindowCount} records screened`];
  if (args.dedupedDropped > 0) {
    parts.push(
      `${args.dedupedDropped} syndicated duplicate${args.dedupedDropped === 1 ? "" : "s"} removed`,
    );
  }
  if (excluded > 0) {
    parts.push(`${excluded} excluded as off-topic or low-signal`);
  }
  if (args.forecastHeld > 0) {
    parts.push(
      `${args.forecastHeld} held for forecast (event date outside reporting period)`,
    );
  }
  parts.push(`${args.distinct} distinct incident${args.distinct === 1 ? "" : "s"}`);
  return `${parts.join("; ")}.`;
}

// ONE shared enforcement detector. Every "police response" claim in the
// report (Civil Unrest posture line, What Matters, Polestar's View, Exec
// Summary bottom line) MUST use this over the SAME row set, or the sections
// contradict each other ("no arrests reported" next to an arrest row — an
// owner-flagged defect). Covers lethal force ("police kill five"), dispersal
// hardware, plain arrests/detentions and statutory orders.
const ENFORCEMENT_RE =
  /\b(curfew|section\s*144|assembly ban|lockdown imposed|state of emergency|martial law|crackdown|baton|lathi[- ]?charge|tear[- ]?gas|water cannon|rubber bullet|mass arrest|arrest(?:s|ed)?|detain(?:s|ed)?|detention|police (?:fired?|kill(?:s|ed)?|shot|open(?:ed)? fire)|forcibly dispersed|dispersed by (?:police|force))\b/i;
function hasEnforcementSignal(rows: { title?: string | null; summary?: string | null }[]): boolean {
  return rows.some((r) => ENFORCEMENT_RE.test(`${r.title ?? ""} ${r.summary ?? ""}`));
}

// How many usable incidents sit at the SAME severity tier as the top-severity
// incident. When more than one, no single event may be called "the most
// serious" — the prose must acknowledge the tie (owner-flagged defect: "the
// most serious single incident" while five Highs were on file).
function topSeverityTieCount(
  rows: { severity: string }[],
  top: { severity: string } | null,
): number {
  if (!top) return 0;
  const k = sevKey(top.severity);
  return rows.filter((r) => sevKey(r.severity) === k).length;
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
// Brand five-tier severity ramp — mirrors SEV_COLOR in pdfChrome.ts. Kept
// local so this dataset stays free of the jsPDF/@assets import chain that
// pdfChrome pulls in (which would break the jest/tsx callers of this file).
// If a tier colour changes there, change it here in lockstep.
// A33232 = Extreme only, 1B6B7A = Insignificant only.
const SEV_HEX: Record<string, string> = {
  insignificant: "#1B6B7A", low: "#6FB872", moderate: "#E67E22", high: "#C0392B", extreme: "#A33232",
};

function sevKey(s: string | null | undefined): string {
  const k = (s ?? "").toLowerCase();
  // Canonical tier is "moderate"; tolerate the "medium" synonym so a
  // mis-labelled row still gets the amber chip instead of falling back grey.
  return k === "medium" ? "moderate" : k;
}

function highestSeverity(rows: FlashpointReportIncident[]): { key: string; label: string } {
  let key = "", rank = 0;
  for (const r of rows) {
    const k = sevKey(r.severity);
    const v = incidentSeverityRank(r.severity);
    if (v > rank) { rank = v; key = k; }
  }
  return { key, label: key ? (SEV_LABEL[key] ?? key) : "—" };
}

// The single highest-severity incident in a set (ties resolved by first
// seen). Used to separate the SEVERITY lead (escalation ceiling) from
// the VOLUME lead (record count) so the prose can reconcile the two
// instead of letting the country chart and forecast table contradict.
function topSeverityIncident(rows: EnrichedIncident[]): EnrichedIncident | null {
  return [...rows].sort((a, b) =>
    compareIncidentSignificance(
      { severity: a.severity, title: a.title, summary: a.summary, occurredAt: a.occurredAt },
      { severity: b.severity, title: b.title, summary: b.summary, occurredAt: b.occurredAt },
    ),
  )[0] ?? null;
}

// Signature phrases lifted from the legacy generic prose templates
// (draftReportProse.ts FLASHPOINT / PROTESTS packs). Saved report prose
// that still matches one of these is canned seed text, never an analyst
// edit, so the renderer (preview + PDF) replaces it with the
// data-driven auto-prose instead of showing or prepending the filler.
// This is what lets cleaned-up reports stop displaying stale boilerplate
// ("Operational tempo, not headline severity") without a manual reseed.
const GENERIC_FLASHPOINT_PROSE: string[] = [
  "operational-tempo issue rather than a single headline event",
  "what the incident layer adds is speed",
  "operational tempo, not headline severity",
  "the story this cycle is operational tempo rather than headline severity",
  "speed is the issue: these events move from notice to road closure",
  "these events move quickly from notice to disruption",
  "hold journey management at short notice",
  "review staff movement plans, journey management for affected cities",
  "track planned political dates, calls to mobilise",
  "track planned protest dates, university and union calls",
  "what matters most this week is that activity is spread across",
  "this week has both organised protests and police enforcement against them",
  "review staff movement and journey plans in",
  "polestar's view: this was an active week",
];

export function isGenericFlashpointProse(text: string | null | undefined): boolean {
  const t = (text ?? "").trim().toLowerCase();
  if (!t) return false;
  return GENERIC_FLASHPOINT_PROSE.some((sig) => t.includes(sig));
}

/**
 * Pick analyst-section prose (What Matters, Implications, Watch Next,
 * Polestar View). Editor text replaces auto ONLY when it is a substantive
 * custom write (>= 240 chars). Thin editor stubs and generic seed packs are
 * discarded in favour of the data-driven auto-prose so the section never
 * stacks two near-duplicate blocks (owner-flagged What Matters defect).
 */
export function pickFlashpointAnalystProse(
  editor: string | null | undefined,
  auto: string,
): string {
  const t = (editor ?? "").trim();
  if (!t || isGenericFlashpointProse(t)) return auto;
  // Saved seed packs can exceed 240 chars but still be template filler —
  // prefer data-driven auto when the editor opens like canned prose.
  if (/^what matters most this week is that activity is spread across/i.test(t)) return auto;
  if (/^review staff movement and journey plans in/i.test(t)) return auto;
  if (/^polestar'?s view: this was an active week/i.test(t)) return auto;
  if (t.length >= 240) return t;
  return auto;
}

/** Editor > AI > auto, with generic/template text stripped at each layer. */
export function resolveFlashpointAnalystProse(
  editor: string | null | undefined,
  ai: string | null | undefined,
  auto: string,
): string {
  const resolvedAuto = pickFlashpointAnalystProse(ai, auto);
  return pickFlashpointAnalystProse(editor, resolvedAuto);
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
// The last alternatives cover soft literary human-interest FEATURES that carry
// the protest vocabulary in the summary (so the relevance gate keeps them) but
// read as a livelihood / community colour piece, not an operational incident —
// e.g. "They sang on Kathmandu's streets to survive. The city silenced the
// music" (a municipal busker crackdown feature). Bound to distinctive feature
// idioms so a live "police silenced the protest" report is untouched.
const HUMAN_INTEREST_RE = /(\bobituary|\bfuneral|\bmemorial|\btribute to\b|\binterview with\b|\bopinion piece\b|\bop[- ]ed\b|\bpodcast\b|\blistsicle\b|\bexplainer\b|\bsilenced the music\b|\bcrocodile tears\b)/i;
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
const NOVELTY_RE = /\b(cockroach|parody party|joke party|meme party|viral (post|meme|reel|tweet|video)|going viral|founder responds?|spokesperson responds?|satir(e|ical|ised|ized)|spoof|prank|publicity stunt|fan club|tongue[- ]in[- ]cheek|kite of dreams|amplify (the )?voices of|reaches? .{0,25}summit to (amplify|raise|honour|honor))\b/i;
function isWeakNovelty(r: FlashpointReportIncident): boolean {
  const text = `${r.title ?? ""} ${r.summary ?? ""}`;
  // Unconditional: novelty / parody / "founder responds" items are
  // weak commentary even when the surrounding text mentions a real
  // protest. They must never lead the brief and must not appear in
  // Related Incidents. The user is explicit about this.
  return NOVELTY_RE.test(text);
}

// Weak operational filter. These are records the classifier accepts on
// surface keywords (protest, strike, rally) but which carry no live
// operational signal — stock-photo agency captions with no place/impact
// detail, sports / workplace media protests, withdrawn/suspended strikes,
// and retrospective legal-process stories. Excluded from prose builders
// and from Related Incidents. User-driven: see "Final tightening"
// brief — these are the recurring noise classes that survived the
// classifier pass.
const LICENSABLE_PHOTO_RE = /\b(licensable picture|reuters connect|getty images|epa[- ]efe|alamy|stock photo|file photo|photo caption|photo: ap|photo by)\b/i;
const SPORTS_LEAGUE_RE = /\b(french open|us open|wimbledon|australian open|grand slam|atp|wta|nba|nfl|mlb|ipl|epl|premier league|champions league|olympics?|fifa world cup|formula one|formula 1|f1|grand prix|moto[- ]?gp|tour de france|esports?|cricket world cup|rugby world cup)\b/i;
const SPORTS_PROTEST_VERB_RE = /\b(protest|boycott|walkout|media protest|prize money|players plan)\b/i;
const SUSPENDED_STRIKE_RE = /\b(strike|walkout|stoppage|shutdown|protest|march|rally)\b.{0,40}\b(suspend(ed|s)|call(ed)? off|cancell?ed|withdraws?|stood down|postpon(ed|es))\b/i;
const SUSPENDED_STRIKE_REV_RE = /\b(suspend(ed|s)|call(ed)? off|cancell?ed|withdraws?|postpon(ed|es))\b.{0,40}\b(strike|walkout|stoppage|shutdown|protest|march|rally|mobilisation)\b/i;
// SK martial-law legal-process records get auto-classified as
// "Curfew / emergency order" because the topic vocabulary still
// matches, but they describe trials, indictments, perjury sentences,
// historical anniversaries — not live public-order risk.
const MARTIAL_LAW_LEGAL_TRIGGER = /\b(perjury|trial|sentenc|indict|acquit|deputy chief|nis|spy chief|alleg|allegations|denies|deni(ed|al)|drone acquisition|probe|investigation|reborn|pro[- ]democracy|anniversary|thwart(ed|ing)|prosecutor|special counsel|hearing|verdict|appeal|ruling|conviction|witness|testimony|courthouse|rioters? get|suspended (term|sentence)s?)\b/i;
const MARTIAL_LAW_RE = /\bmartial law\b/i;
// Standalone court-verdict catcher for items the topic classifier
// already binned into civil unrest (Riot / public disorder, Curfew /
// emergency order) but which carry only a judicial-outcome narrative
// (sentencing, suspended terms, indictments). Filtered out unless a
// live public-order hook is also present.
const COURT_VERDICT_RE = /\b(suspended (term|sentence)s?|get suspended|sentenc(ed|ing)|acquitt(ed|al)|indict(ed|ment)|conviction|guilty plea|plea bargain|plead(s|ed)? guilty|found guilty|guilty of (riot|rioting)|appeal (filed|dismissed|granted))\b/i;
const LIVE_PUBLIC_ORDER_RE = /\b(protest(s|ers|ing)? today|rally today|crowd|crowds|demonstrators|protest(s)? (erupt|erupts|erupted|break|breaks|broke) out|(violence|unrest|clashes) (erupt|erupts|erupted|flare|flares|flared)|ongoing protest|tear[- ]?gas|water cannon|baton|stone[- ]?pelt|road closure|roadblock|blockad|curfew imposed|curfew extended|curfew lifted|troops deployed|martial law (imposed|declared|extended)|clash(es|ed)?|fatalit|injur(ed|ies)|mass arrest|detained at|arrested at|sit[- ]?in|march(ed|ing) on)\b/i;
// Retrospective accountability / legal-aftermath reporting about a PAST
// public-order event. These are the dominant Flashpoint noise class: a
// rights body recommending charges, an ex-official arrested or summoned
// over an old crackdown, a probe / commission of inquiry, a dispute over
// a death-toll report, "faces raps", "under lens". They carry the protest
// vocabulary (so the relevance gate keeps them) but describe legal process
// and political commentary, not a LIVE operational incident. The user is
// explicit: generic political/accountability commentary is not an incident
// unless there is a current security/movement/access/protest/unrest angle.
const RETRO_ACCOUNTABILITY_RE =
  /\b(urges?\s+(?:the\s+)?(?:un|government|state|authorities|court|police)?\s*to\s+(?:retract|charge|prosecute|act|probe|investigate)|to\s+retract\b|recommends?\s+(?:action|charges?|prosecution|a\s+probe|an?\s+(?:probe|investigation|inquiry|case))|face(?:s|d)?\s+(?:raps|charges|trial|prosecution|a\s+probe|an?\s+inquiry)|under\s+(?:lens|investigation|probe|scrutiny|the\s+scanner)|(?:arrested|detained|held|summoned|indicted|booked|charged)\s+(?:over|in\s+connection\s+with|in\s+a\s+case)|(?:case|complaint|fir|charges?)\s+(?:filed|registered|lodged|framed|pressed|laid)?\s*against|files?\s+(?:a\s+|an\s+)?(?:case|complaint|fir)\s+against|probe\s+(?:into|against|ordered|launched)|investigation\s+(?:into|against|ordered|launched)|commission\s+of\s+inquiry|fact[- ]finding\s+(?:team|mission|report|panel)|human\s+rights\s+commission|\bnhrc\b|rights\s+body|rights\s+commission|\bun\s+report\b|death\s+(?:toll|count)\s+(?:report|dispute|disputed|figure|inquiry|probe)|accountability\s+(?:for|over))\b/i;
// Anticipatory / negated non-events: an authority asking that a protest
// NOT be held ("government requests opposition not to stage protests",
// "police urge groups not to march") describes a request, not a street
// event. Drop unless the record also carries a live public-order hook
// (i.e. the protest went ahead despite the request).
const ANTICIPATORY_NEGATED_RE =
  /\b(request|requests|requested|urge|urges|urged|appeal|appeals|appealed|asks?|asked|warn|warns|warned|directs?|directed|told)\b.{0,40}\bnot to\b.{0,20}\b(stage|hold|call|launch|organis|organiz|join|attend)\w*\b.{0,15}\b(protest|demonstration|strike|march|rally|sit[- ]?in|agitation)/i;
// Post-event normalisation: a calm election / peaceful polling happening
// after an unrest cycle is the absence of a live incident, not an incident.
const AFTERMATH_NORMALISATION_RE =
  /\b(peaceful\s+(?:polling|poll|election|elections|vote|voting)|polling\s+(?:underway|begins|began|concludes|concluded|peacefully)|returns?\s+to\s+(?:normal|normalcy|calm)|calm\s+(?:returns?|restored|prevails))\b/i;
// Scheduled elections / votes are political calendar events, not unrest
// incidents. Drop unless the same record describes live disorder at the
// polls (clashes, curfews, roadblocks) — not mere electoral commentary.
const SCHEDULED_ELECTION_RE =
  /\b(presidential (?:vote|election)|general election|parliamentary election|by-?election|snap election|goes? to (?:the )?polls|heading to polls|voters? (?:head|go|cast) to (?:the )?polls|polls? (?:open|close|scheduled)|election day|ballot(?:ing)?)\b/i;
const ELECTION_UNREST_RE =
  /\b(election (?:violence|clash|riot|unrest)|violence (?:at|during|mar) polls|clash(?:es)? (?:at|near) polling|polling station (?:attack|clash|riot))\b/i;
// Analysis / trend essays that carry protest vocabulary but report no
// discrete street event ("From Protest to Power: …", "movement keeps heat
// on Modi"). Belt-and-suspenders with the relevance gate.
const ANALYSIS_COMMENTARY_RE =
  /\b(from protest to power|keeps (?:the )?heat on|keeps pressure on|student politics and campus violence)\b/i;
const MOVEMENT_TREND_RE =
  /\b(?:(?:protest|youth|gen z|opposition)\s+movement|protest movement)\b[^.!?]{0,50}\b(keeps|continues to|maintains|builds|turns up|turns the|still has|still puts)\b/i;
const COLON_FEATURE_RE =
  /^[^:]{10,100}:\s+[A-Z][^,]{2,},\s+[A-Z]/;
// Stock-market / equity "rally" homonyms — NOT a street protest.
const STOCK_MARKET_RALLY_RE =
  /\b(?:(?:stock|share|equity|chip(?:maker)?|semiconductor)s?\s+(?:rally|rallies|surge|rise|gain|jump|rebound)|(?:rally|rallies|surge|rise|gain|jump|rebound)s?\s+(?:as|on|after)\s+(?:foreign\s+)?(?:interest|inflow|buying|returns)|foreign interest returns|(?:kospi|kosdaq|nikkei|sensex|nifty|hang seng)\b|(?:samsung|sk hynix|hynix)\b[^.]{0,40}\b(?:rally|rallies|surge|rise|gain|jump|rebound|stock))\b/i;
// Ceremonial military / independence displays — not public-order incidents.
const CEREMONIAL_EVENT_RE =
  /\b(air demonstration|flypast|fly[- ]?past|flyover|fly[- ]?over|military parade|ceremonial (?:flight|display)|anniversary of (?:the )?independence|independence (?:day|anniversary)|\d+\s+(?:tni\s+)?aircraft|aircraft and helicopters for an)\b/i;
// Drug / smuggling arrests mis-tagged as roadblock or protest.
const DRUG_CRIME_RE =
  /\b(meth(?:amphetamine)?|narcotics?|cocaine|heroin|fentanyl|drugs?\s+(?:seized|found|recovered)|(?:held|caught|arrested)(?:\s+\w+){0,6}\s+with\s+\d+\s*(?:kg|kilos?|lb|pounds?) of|kg of meth|\d+\s*kg of|\d+kg of|drug (?:bust|seizure|smuggl)|smuggl\w*\s+(?:meth|drugs|narcotics))\b/i;
// Rocket / space launch failures — not civil unrest.
const ROCKET_SPACE_RE =
  /\b(rocket launch (?:failed|failure|anomaly)|long march\s*\d|space launch|satellite launch|flight anomaly|launch vehicle|missile test (?:failed|failure))\b/i;
// Foreign labour action carrying a stray APAC country tag because an APAC
// outlet syndicated it. The Icelandic "Eimskip" seafarers' dispute is the
// recurring case — it is mislabelled Philippines and pollutes that country
// count. Entity-anchored, not geography-anchored, so it survives the
// trailing-source strip.
const FOREIGN_ENTITY_MISLABEL_RE = /\b(eimskip)\b/i;
// Spammy SEO keyword-stuffed photo captions. Real headlines almost
// never carry 3+ commas, and they don't mix Devanagari / CJK script
// fragments with English keyword runs. Either pattern alone is a
// reliable spam signal in this corpus.
const SPAM_CAPTION_COMMAS_RE = /,\s*,|,\s+-\s+|(?:\b[A-Z]{2,5}\b[ ,]+){3,}/;
const NON_LATIN_SCRIPT_RE = /[\u0900-\u097F\u3040-\u30FF\u4E00-\u9FFF\u3400-\u4DBF\uAC00-\uD7AF]/;
// Unmistakable public-order terms that a legitimate multi-city strike /
// bandh headline carries while listing affected cities with commas
// ("Cab, auto strike ... Chakka jam in Capital, Noida, Gurugram and
// Ghaziabad"). When present, the comma-count spam branch must NOT fire —
// it was misclassifying real industrial action as SEO caption spam. Sports
// homonyms are already stripped earlier in isWeakOperational, so "strike"
// is trustworthy here.
const PUBLIC_ORDER_TITLE_RE = /\b(chakka jam|wheel[- ]?jam|bandh|hartal|gherao|strike|protest(s|ers?)?|walkout|stoppage|sit[- ]?in|picket|blockade|roadblock|shutter[- ]?down)\b/i;
function isSpamCaption(title: string): boolean {
  if (!title) return false;
  // Non-Latin script mixed with ASCII letters in the same title is a hard
  // spam signal (Devanagari/CJK keyword-stuffed video captions) and fires
  // regardless of public-order vocabulary.
  if (NON_LATIN_SCRIPT_RE.test(title) && /[A-Za-z]{3,}/.test(title)) return true;
  // Comma-spam branches catch SEO keyword-stuffed captions, but a real
  // multi-city strike/bandh headline lists cities with commas — don't drop
  // those when a genuine public-order keyword is present.
  if (PUBLIC_ORDER_TITLE_RE.test(title)) return false;
  if (SPAM_CAPTION_COMMAS_RE.test(title)) return true;
  // 3+ commas in title.
  const commas = (title.match(/,/g) ?? []).length;
  if (commas >= 3) return true;
  return false;
}

// Strip a trailing " - <Source Name>" suffix from a headline so
// geographic / topical pattern checks operate on the editorial title
// rather than the wire-attribution name (e.g. dropping a Greenland
// protest piece syndicated by "Bangladesh Sangbad Sangstha").
function titleWithoutSource(title: string): string {
  if (!title) return "";
  const idx = title.lastIndexOf(" - ");
  if (idx <= 0) return title;
  // Heuristic: a source suffix is short (<= 80 chars) and rarely
  // contains a comma. Otherwise, treat the whole thing as the title.
  const suffix = title.slice(idx + 3);
  if (suffix.length > 80 || /[,.]/.test(suffix)) return title;
  return title.slice(0, idx);
}
// `ukraine`/`russia` deliberately excluded: APAC solidarity protests
// ("Seoul rally against Russia's war", "Manila vigil for Ukraine") are real
// public-order events and must not be geo-dropped. `georgia` (the country)
// is retained for the EU-accession/independence-day homonym; the APAC hook
// below now includes major cities so an APAC-city solidarity headline still
// survives even when it names a non-APAC country as the cause.
const NON_APAC_FOCUS_RE = /\b(greenland|greenlanders|denmark|iceland|norway|sweden|finland|france|germany|spain|italy|portugal|switzerland|austria|belgium|netherlands|ireland|scotland|wales|england(?! batting)|georgia|georgian|tbilisi|argentina|brazil|chile|peru|colombia|mexico|venezuela|bolivia|bolivian|ecuador|paraguay|uruguay|guatemala|honduras|nicaragua|panama|canada|haiti|cuba|jamaica|nigeria|kenya|south africa|egypt|libya|sudan|ethiopia|morocco|tunisia)\b/i;
const APAC_HOOK_RE = /\b(pakistan|india|bangladesh|sri lanka|nepal|bhutan|maldives|afghanistan|china|hong kong|taiwan|south korea|north korea|japan|mongolia|philippines|indonesia|malaysia|thailand|vietnam|myanmar|singapore|cambodia|laos|brunei|timor[- ]leste|australia|new zealand|papua new guinea|fiji|solomon|vanuatu|tokyo|seoul|manila|jakarta|bangkok|new delhi|delhi|mumbai|kolkata|chennai|bengaluru|hyderabad|dhaka|kathmandu|colombo|karachi|lahore|islamabad|kuala lumpur|hanoi|ho chi minh|taipei|beijing|shanghai|yangon|phnom penh|kabul|sydney|melbourne|wellington|auckland)\b/i;
// Defence procurement / weapons-system news (missile offers, arms deals,
// fighter-jet / submarine acquisitions). The classifier keeps these on the
// word "strike" ("precision strike", "strike range") but they carry no
// public-order signal. Dropped unless a live public-order hook is present.
const MILITARY_PROCUREMENT_RE = /\b(brahmos|s-400|rafale|missile (system|deal|export|offer|sale|test|launch|range|programme|program)|arms (deal|export|sale|package|race)|defen[cs]e (deal|export|pact|procurement|acquisition|ministry|budget)|fighter (jet|aircraft)|submarine (deal|deployment|acquisition)|warship (deal|commission)|weapons? (export|sale|deal|system|programme|program)|precision[- ]strike (range|capabilit))\b/i;
// Legislative / parliamentary process (a bill passing, cabinet clearing a
// law). Wire copy often mentions "opposition protests" rhetorically, so the
// classifier files it as Protest, but it is not a street event. Dropped
// unless a live public-order hook (crowd, march, tear gas, road closure) is
// present in the same record.
const LEGISLATIVE_PROCESS_RE = /\b(passes? (a |the )?bill|bill (to|that|which|on|aims?|seeks?)|parliament (passes|approves|clears|debates?|votes?|tables?)|cabinet (approves|clears|okays?|nods?|backs?)|tables? (a |the )?bill|ordinance (issued|promulgated|passed)|legislation (passed|cleared|tabled|introduced|approved)|enacts? (a )?law|signed into law|upper house|lower house|national assembly (passes|approves|clears)|diet (passes|approves|enacts)|senate (passes|approves|clears)|amendment (passed|cleared|approved)|co[- ]payments?)\b/i;
// Sports reporting that trips the "strike / rally / march" keywords
// (a striker's goal, a tennis rally, a title march). Broader than the
// named-league filter above. Dropped unless a live public-order hook is
// present.
const SPORTS_CONTEXT_RE = /\b(football|soccer|cricket|rugby|hockey|tennis|basketball|baseball|golf|striker|goalkeeper|midfielder|free[- ]kick|penalty (kick|shoot[- ]?out)|equalis(er|e)|equaliz(er|e)|hat[- ]trick|grand slam|premier league|champions league|world cup|olympic|test match|t20|odi|\d+[- ]second strike|winning goal|scored? (the|a|his|her|twice|again)|rally\s?[12]\b|wrc\b|dirtfish|autosport|motorsport|moto\s?gp|grand prix|formula\s?1\b|\bf1\b|special stage|\bss\d+\b)\b/i;
// Diplomatic protest (a state lodging a formal complaint with an embassy /
// high commission / envoy) is a homonym of a street protest. "Lodge / file /
// register / issue a protest", "protest note", "note verbale", "démarche",
// "summons the ambassador" are diplomatic acts, not public-order incidents.
// (Real street action reads "protesters", "rally", "stage/hold a protest".)
// NOTE (narrowed): the verb-stem branch ("lodge/file/register/raise ... a
// protest") only fires when an explicit DIPLOMATIC OBJECT follows within the
// same sentence window (embassy / high commission / ambassador / envoy /
// consulate / chargé / foreign ministry / note verbale / démarche). Without
// that object the phrase is a real street protest ("students raise a protest
// over fees", "workers file a protest against layoffs") and must be KEPT.
const DIPLOMATIC_PROTEST_RE = /\b(?:lodg|fil|register|registr|convey|issu|rais|submit|deliver|hand(?:ed|s)? over)\w*\s+(?:a\s+|an\s+|its\s+|strong\s+|formal\s+|official\s+|diplomatic\s+|stern\s+|firm\s+)*protests?\b(?=[^.]{0,60}\b(?:embass(?:y|ies)|high commission|ambassador|envoy|consulate|charg[eé](?:\s+d['’]affaires)?|foreign ministry|ministry of (?:external|foreign) affairs|diplomatic (?:note|channel|protest)|note verbale|d[ée]marche)\b)|\b(protest note|note verbale|d[ée]marche)\b|\bsummon(?:s|ed)?\s+(?:the\s+)?(?:[a-z]+\s+){0,2}(ambassador|envoy|high commissioner|charg[eé])\b/i;
// State-to-state diplomatic protest over a foreign incident that names no
// embassy object ("Malaysia lodges strong protest after Israeli interception
// of Gaza flotilla"). The distinguishing signal is the diplomatic REGISTER:
// a government "lodges/conveys" a STRONG / formal / official / stern /
// strongly-worded protest (a démarche). The register adjective is REQUIRED —
// bare "residents lodged a protest at the collectorate" or "workers lodged a
// protest demanding wages" carries no such adjective and must be KEPT as a
// genuine domestic incident. Deliberately scoped to lodge/convey ONLY (the
// diplomatic verbs); file/register/raise are left to the narrow object-gated
// DIPLOMATIC_PROTEST_RE above. Still gated at the call site on no live
// public-order hook so a démarche that triggers street action stays.
const LODGE_DIPLOMATIC_PROTEST_RE = /\b(?:lodg|convey)\w*\s+(?:a\s+|an\s+|its\s+)?(?:strong|formal|official|diplomatic|stern|firm|strongly[- ]worded)\s+protests?\b/i;
// Head-of-state / diplomatic-visit reporting that only mentions a protest as
// historical background ("junta chief ... heads to India ... sparking a 2021
// protest movement"). The travel framing plus an absent live public-order
// hook marks it as foreign-policy commentary, not a current incident. The
// "with an eye on <power>" geopolitical framing is bound to a preceding
// head-of-state subject + travel verb (no standalone branch) so it cannot
// fire on unrelated street-protest records that merely mention a great power.
const DIPLOMATIC_VISIT_RE = /\b(president|prime minister|\bpm\b|premier|foreign minister|\bfm\b|junta chief|chancellor|monarch|crown prince|defen[cs]e minister|delegation|envoy)\b.{0,60}\b(heads? to|head to|visits?|arrives? in|to visit|pays? a\b.{0,20}\bvisit|state visit|official visit|bilateral (talks|meeting|summit))\b/i;
function isWeakOperational(r: FlashpointReportIncident): boolean {
  const text = `${r.title ?? ""} ${r.summary ?? ""}`;
  if (LICENSABLE_PHOTO_RE.test(text)) return true;
  // Diplomatic protest (démarche / note verbale / lodge a protest with an
  // embassy) and head-of-state visit framing — homonyms, not street events.
  if (DIPLOMATIC_PROTEST_RE.test(text) && !LIVE_PUBLIC_ORDER_RE.test(text)) return true;
  if (LODGE_DIPLOMATIC_PROTEST_RE.test(text) && !LIVE_PUBLIC_ORDER_RE.test(text)) return true;
  if (DIPLOMATIC_VISIT_RE.test(text) && !LIVE_PUBLIC_ORDER_RE.test(text)) return true;
  if (SPORTS_LEAGUE_RE.test(text) && SPORTS_PROTEST_VERB_RE.test(text)) return true;
  // Sports keyword noise ("striker", "rally", "title march") with no live
  // public-order signal.
  if (SPORTS_CONTEXT_RE.test(text) && !LIVE_PUBLIC_ORDER_RE.test(text)) return true;
  // Defence-procurement / weapons-system wire copy caught on "strike".
  if (MILITARY_PROCUREMENT_RE.test(text) && !LIVE_PUBLIC_ORDER_RE.test(text)) return true;
  // Legislative-process reporting ("passes bill") with no street event.
  if (LEGISLATIVE_PROCESS_RE.test(text) && !LIVE_PUBLIC_ORDER_RE.test(text)) return true;
  if (SUSPENDED_STRIKE_RE.test(text)) return true;
  if (SUSPENDED_STRIKE_REV_RE.test(text)) return true;
  // Martial-law legal-process: drop unless the same record carries a
  // live public-order hook. Bidirectional — "martial law" can precede
  // or follow the legal-process trigger word in the headline.
  if (MARTIAL_LAW_RE.test(text) && MARTIAL_LAW_LEGAL_TRIGGER.test(text) && !LIVE_PUBLIC_ORDER_RE.test(text)) return true;
  // Standalone court-verdict items (suspended terms, sentencings,
  // indictments) the classifier still keeps in civil-unrest because
  // of "rioters" / "courthouse" vocabulary — drop unless live public
  // order is present.
  if (COURT_VERDICT_RE.test(text) && !LIVE_PUBLIC_ORDER_RE.test(text)) return true;
  // Retrospective accountability / legal-aftermath about a PAST event
  // (rights-body charge recommendations, ex-officials arrested over an
  // old crackdown, probes, death-toll-report disputes). Drop unless the
  // same record describes a current live public-order event.
  if (RETRO_ACCOUNTABILITY_RE.test(text) && !LIVE_PUBLIC_ORDER_RE.test(text)) return true;
  // Anticipatory / negated non-events ("government requests opposition not
  // to stage protests") — a request, not a street event. Drop unless the
  // protest actually went ahead (live public-order hook present).
  if (ANTICIPATORY_NEGATED_RE.test(text) && !LIVE_PUBLIC_ORDER_RE.test(text)) return true;
  // Post-event normalisation (peaceful polling / calm restored) — the
  // absence of an incident, not an incident.
  if (AFTERMATH_NORMALISATION_RE.test(text)) return true;
  // Scheduled elections / votes without live public-order signal.
  if (SCHEDULED_ELECTION_RE.test(text) && !LIVE_PUBLIC_ORDER_RE.test(text) && !ELECTION_UNREST_RE.test(text)) return true;
  // Think-piece / trend analysis using protest vocabulary.
  if (ANALYSIS_COMMENTARY_RE.test(text) && !LIVE_PUBLIC_ORDER_RE.test(text)) return true;
  if (MOVEMENT_TREND_RE.test(text) && !LIVE_PUBLIC_ORDER_RE.test(text)) return true;
  if (COLON_FEATURE_RE.test(r.title ?? "") && !LIVE_PUBLIC_ORDER_RE.test(text)) return true;
  if (STOCK_MARKET_RALLY_RE.test(text) && !LIVE_PUBLIC_ORDER_RE.test(text)) return true;
  if (CEREMONIAL_EVENT_RE.test(text) && !LIVE_PUBLIC_ORDER_RE.test(text)) return true;
  // Drug / smuggling arrests are never public-order events — drop even when
  // the classifier or summary mis-tags "roadblock" (owner-flagged: meth seizure
  // in Thailand listed as Roadblock / access disruption).
  if (DRUG_CRIME_RE.test(text)) return true;
  if (ROCKET_SPACE_RE.test(text) && !LIVE_PUBLIC_ORDER_RE.test(text)) return true;
  // Foreign labour action mislabelled into an APAC country (Eimskip).
  if (FOREIGN_ENTITY_MISLABEL_RE.test(text)) return true;
  // SEO comma-spam / multi-script keyword-stuffed captions.
  if (isSpamCaption(r.title ?? "")) return true;
  // Non-APAC focus headlines syndicated by an APAC source. Strip the
  // " - <Source>" suffix from the title before testing. Match on the
  // editorial title only — summaries often repeat the source name
  // verbatim ("...Bangladesh Sangbad Sangstha (BSS)") and would
  // falsely satisfy the APAC hook.
  const editorialTitle = titleWithoutSource(r.title ?? "");
  if (NON_APAC_FOCUS_RE.test(editorialTitle) && !APAC_HOOK_RE.test(editorialTitle)) return true;
  return false;
}

// --- Future-protest extractor ----------------------------------------------
// Pulls forward-looking signals out of the file: dated protest calls,
// announced strikes, scheduled court hearings, named mobilisation dates.
const COVERAGE_COUNTRIES = ["Australia", "Papua New Guinea", "Indonesia", "Philippines", "Japan", "Nepal"] as const;
const COVERAGE_CITY_RE = /\b(sydney|melbourne|canberra|brisbane|port moresby|jayapura|manila|quezon city|tokyo|osaka|kathmandu|pokhara)\b/i;

// --- Dedupe helpers --------------------------------------------------------
// Google-News / wire titles append the publisher after a final ASCII " - " and
// some outlets inject " | Section | site.com" noise ("Indonesia Protest | Pro
// Sports | bdtonline.com - Bluefield Daily Telegraph"). That suffix is per-
// OUTLET, so the SAME wire syndicated across three outlets yields three
// different dedup keys and survives as duplicate cards. Strip it before the
// dedup signature so syndicated copies collapse. Used by the dedup helpers
// only; em-dashes (—) are left intact (they separate real clauses).
function stripMasthead(title: string): string {
  let t = (title ?? "").trim();
  // Blog-aggregator prefixes ("Business.Scoop » …").
  t = t.replace(/^[\w.]+\s*scoops?\s*[\u00bb\u203a>]\s*/i, "").trim();
  // Peel trailing outlet chains: "… - ABC News & Headlines - Australian Broadcasting Corporation".
  const OUTLET_TAIL_RE =
    /\s+[-\u2013|»\u203a]\s+(?:the\s+)?(?:[A-Z0-9][\w.'&-]*\s+){0,8}(?:news|times|post|herald|gazette|telegraph|tribune|journal|standard|observer|guardian|broadcast(?:ing)?|corporation|corp|scoops?|\.com|\.net|\.org|abc|bbc|reuters|afp)\b[^-]*$/i;
  for (let i = 0; i < 8; i++) {
    const next = t.replace(OUTLET_TAIL_RE, "").trim();
    if (next === t) break;
    t = next;
  }
  // Peel trailing " - <publisher>" / " | <publisher>" segments. Split on the
  // LAST space-padded ASCII " - " / " | " and treat the tail as a masthead when
  // it is short (<= 6 words); the tail may itself contain hyphens/dots
  // ("Journal-News.com", "bdtonline.com"). Keep a >= 2-word head so a real
  // clause is never consumed. em-dashes (—) are not delimiters here.
  for (let i = 0; i < 5; i++) {
    const m = t.match(/^(.*\S)\s+[-|»\u203a]\s+(.+)$/);
    if (!m) break;
    const head = m[1].trim();
    if (m[2].trim().split(/\s+/).length > 6) break;
    if (head.split(/\s+/).length < 2) break;
    t = head;
  }
  // Collapse any residual " | Section" noise an outlet injects mid-title down
  // to the lead headline segment.
  const pipe = t.indexOf(" | ");
  if (pipe > 0) {
    const lead = t.slice(0, pipe).trim();
    if (lead.split(/\s+/).length >= 2) t = lead;
  }
  const guillemet = t.indexOf(" » ");
  if (guillemet > 0) {
    const lead = t.slice(0, guillemet).trim();
    if (lead.split(/\s+/).length >= 2) t = lead;
  }
  return t;
}

// Reader-facing title: publisher masthead + video cruft removed, original case
// kept. Used at enrich time so every surface (preview tables, Related Incidents,
// PDF) renders the SAME clean headline and preview/PDF parity holds.
export function cleanDisplayTitle(title: string): string {
  return stripWireCruft(stripMasthead(title ?? ""));
}

function normaliseTitle(s: string): string {
  return cleanDisplayTitle(s)
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

// Shared "which of two syndicated copies survives" rule: higher severity
// first, then the more recent record. Used by every dedupe pass so the
// surviving row is consistent across title / signature / same-event collapse.
function sevDateBetter<T extends { date: Date; severity: string }>(a: T, b: T): boolean {
  return compareIncidentSignificance(
    { severity: a.severity, occurredAt: a.date.toISOString() },
    { severity: b.severity, occurredAt: b.date.toISOString() },
  ) <= 0;
}

// Tokens that must NOT anchor a same-event match. Generic mobilisation words
// are topic-wide (they say nothing about WHICH event), and casualty /
// reporting words vary outlet-to-outlet for the SAME event ("kills 19" vs
// "kills 26" vs "death toll rises to 25"). Excluding both stops a shared
// "protest"+actor from merging two DIFFERENT cities, while a shared place +
// concrete event noun (e.g. "negombo"+"prison"+"riot") still collapses
// syndicated copies of one event.
const SAME_EVENT_NON_ANCHOR = new Set([
  // generic mobilisation / topic-wide
  "protest", "protester", "protesters", "protests", "rally", "rallies",
  "march", "marches", "marching", "demonstration", "demonstrations",
  "demonstrator", "demonstrators", "strike", "strikes", "walkout", "walkouts",
  "picket", "boycott", "unrest", "movement", "activism", "activist",
  "activists", "gathering", "sit", "sitin", "clash", "clashe", "clashes",
  // casualty / reporting words (vary per outlet for one event)
  "kill", "kills", "killed", "killing", "dead", "death", "deaths", "die",
  "dies", "died", "toll", "wound", "wounds", "wounded", "injure", "injured",
  "injures", "injury", "injuries", "hurt", "casualty", "casualties",
  "fatality", "fatalities", "victim", "victims", "rise", "rises", "rose",
  "rising", "increase", "increases", "increased", "climb", "climbs",
  "following", "amid", "deadly", "least", "many", "several", "dozens",
  "hundreds", "thousands", "people", "person", "persons",
  // reporting cruft
  "says", "say", "said", "warn", "warns", "warned", "report", "reports",
  "reported", "update", "updates", "updated", "latest", "breaking", "live",
  "video", "watch", "news", "day", "days", "week", "weeks",
]);

// Generic editorial / governance / procedural vocabulary that recurs across the
// DIFFERENT ANGLES an outlet takes on ONE story ("Anatomy of the X riot",
// "Government moves to fix Y overcrowding", "Parliament debates Z"). These words
// name neither a place, an actor group, nor the specific grievance, so they must
// count as NEITHER event anchors (they would let unrelated same-country stories
// meet the shared-anchor threshold) NOR distinguishing subjects (they would
// falsely split copies of one event that merely differ in framing). Excluded
// from both. Do NOT add place names, actor groups (workers/students/inmates), or
// grievance nouns (fuel/pay/land) here — those are the real event discriminators.
const SAME_EVENT_GENERIC = new Set([
  // editorial / analysis framing an outlet layers over one story
  "anatomy", "lesson", "learnt", "learned", "explainer", "explained",
  "opinion", "editorial", "analysis", "timeline", "recap", "review",
  "comment", "commentary", "feature", "factbox", "roundup", "digest",
  "backstory", "background", "not",
  // governance / procedural response (institutions, not the protagonists)
  "government", "govt", "minister", "ministry", "parliament", "cabinet",
  "committee", "commission", "panel", "probe", "inquiry", "investigation",
  "authority", "authorities", "official", "officials", "opposition",
  "statement", "policy", "reform",
  // generic action verbs common to every angle
  "move", "moves", "address", "addresses", "tackle", "tackles", "fix",
  "fixes", "solve", "resolve", "handle", "call", "calls", "urge", "urges",
  "vow", "vows", "pledge", "pledges", "seek", "seeks", "plan", "plans",
  "order", "orders", "launch", "launches", "appoint", "appoints",
  "announce", "announces", "introduce", "consider",
  // abstract / process nouns
  "system", "overcrowding", "delay", "delays", "response", "measure",
  "measures", "step", "steps", "action", "actions", "aftermath", "cause",
  "causes", "blame", "responsibility", "resignation", "tribute", "control",
  "issue", "issues", "crisis", "situation", "problem", "problems",
  "condition", "conditions", "matter", "effort", "efforts", "attempt",
  "attempts", "bid", "scheme",
  // modals / generic connectives that survive the stop-word filter
  "should", "would", "could", "without", "still", "again",
  // state-response angle vocabulary. "Troops deployed to contain prison
  // unrest" and "Three dead in prison riots" are the SAME story seen from
  // the response side vs the casualty side; the response verbs/actors name
  // neither a place nor a grievance, so they must not anchor a match or
  // read as a distinguishing subject (client-flagged duplicate, Aug 2026).
  "troop", "troops", "soldier", "soldiers", "military", "army",
  "deploy", "deploys", "deployed", "deployment", "contain", "contains",
  "contained", "containing", "boost", "boosts", "boosted", "tighten",
  "tightens", "tightened", "security", "suppress", "suppresses",
  "suppressed", "growing", "grows", "spreads", "spreading", "erupt",
  "erupts", "erupted",
]);

function singulariseToken(t: string): string {
  if (t.length > 4 && t.endsWith("s") && !t.endsWith("ss")) return t.slice(0, -1);
  return t;
}

// Canonicalise clearly-synonymous EVENT-OUTCOME verbs so two syndicated
// rewrites of the same story that merely swap synonyms still fold in the fuzzy
// same-event pass. Deliberately tiny and outcome-specific: it maps the "a
// leader stepped down" family and the "the protest concluded" family to one
// stem each. These are the exact swaps that split copies of ONE event ("India's
// Protest Movement Ends After Minister Quits" vs "India's CJP says ending
// protest after minister resigns"). No place, actor or grievance noun is
// touched, so distinct events never merge on this alone (the >=2 shared-anchor
// + distinct-subject guards still apply).
const SAME_EVENT_SYNONYM: Record<string, string> = {
  quit: "resign", quits: "resign", quitting: "resign",
  resign: "resign", resigns: "resign", resigned: "resign", resigning: "resign",
  resignation: "resign", stepdown: "resign", ouster: "resign", ousted: "resign",
  end: "end", ends: "end", ended: "end", ending: "end", concludes: "end",
  concluded: "end", concluding: "end", conclusion: "end", wraps: "end",
  over: "end", halted: "end", "called-off": "end",
};
function canonicaliseToken(t: string): string {
  return SAME_EVENT_SYNONYM[t] ?? t;
}

// Distinctive place / concrete-event tokens that identify WHICH event a
// headline is about. Numbers and the non-anchor vocabulary above are dropped.
function anchorTokens(title: string): Set<string> {
  const out = new Set<string>();
  for (const raw of normaliseTitle(title).split(" ")) {
    if (!raw || raw.length < 3) continue;
    if (/^\d+$/.test(raw)) continue;
    if (TITLE_STOP.has(raw) || SAME_EVENT_NON_ANCHOR.has(raw) || SAME_EVENT_GENERIC.has(raw)) continue;
    const w = canonicaliseToken(singulariseToken(raw));
    if (w.length < 3 || SAME_EVENT_NON_ANCHOR.has(w) || SAME_EVENT_GENERIC.has(w)) continue;
    out.add(w);
  }
  return out;
}

// Concrete physical-incident nouns. They confirm a shared event TYPE (so they
// count toward the anchor-overlap threshold) but they recur across unrelated
// places, so they are NOT treated as the "subject" that says WHICH event it is
// — otherwise two different-city prison riots would look like one story.
const SAME_EVENT_TYPE_NOUN = new Set([
  "riot", "prison", "jail", "fire", "blaze", "blast", "explosion", "bomb",
  "bombing", "stampede", "siege", "arson", "shooting", "gunfight", "gunfire",
  "hostage", "crash", "derailment", "collapse", "flood", "quake", "earthquake",
  "cyclone", "typhoon", "landslide", "curfew", "lockdown", "blockade",
  "roadblock", "crackdown", "standoff", "violence", "attack", "raid", "unrest",
]);

// Subject tokens = the place / actor / org names that identify WHICH event a
// headline is about (anchors minus the recurring event-type nouns and the
// country-name tokens). Generic editorial / procedural words are already gone
// (excluded from anchors above). Country tokens are dropped here for the same
// reason they are excluded from the shared-anchor count: a country-only headline
// ("Sri Lanka prison riot") and a city-only headline ("Negombo prison riot") are
// the SAME event, so nationality must never read as a distinguishing subject.
function subjectTokens(anchors: Set<string>, countryToks: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const t of anchors) {
    if (SAME_EVENT_TYPE_NOUN.has(t)) continue;
    if (countryToks.has(t)) continue;
    out.add(t);
  }
  return out;
}

// True when each side names at least one subject the other never mentions —
// i.e. they are about DIFFERENT specific subjects (different city / actor) and
// must not be merged. A subset/superset pairing (one headline simply adds
// detail, e.g. "Sri Lanka prison riot" vs "Negombo ... Sri Lanka") is NOT
// distinct and is allowed to link.
function distinctSubjects(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) return false;
  let aExtra = false;
  let bExtra = false;
  for (const t of a) if (!b.has(t)) { aExtra = true; break; }
  for (const t of b) if (!a.has(t)) { bExtra = true; break; }
  return aExtra && bExtra;
}

const SAME_EVENT_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

// Tokens of the country NAME (e.g. "Sri Lanka" -> {sri, lanka}). A multi-word
// country name alone would otherwise satisfy the >= 2 shared-anchor threshold,
// letting two DIFFERENT same-country events merge on their shared nationality.
// These are excluded from the shared-anchor count so a link needs >= 2 real
// place / event anchors BEYOND the country name.
function countryNameTokens(country: string): Set<string> {
  const out = new Set<string>();
  for (const raw of normaliseTitle(country).split(" ")) {
    if (!raw || raw.length < 3) continue;
    out.add(singulariseToken(raw));
  }
  return out;
}

function sameCountryOrUnknown(a: string, b: string): boolean {
  const na = (a ?? "").trim().toLowerCase();
  const nb = (b ?? "").trim().toLowerCase();
  if (!na || !nb || na === "unknown" || nb === "unknown" || na === "—" || nb === "—") {
    return true;
  }
  return na === nb;
}

// Same-event single-linkage collapse. Catches syndicated copies of ONE event
// whose headlines differ too much for the exact title / topic-signature passes
// — e.g. "26 killed in Sri Lanka prison riot", "Sri Lanka prison riot kills
// 23, wounds more than 100", "Death toll in Negombo prisons riot increase to
// 25", "Inmates to be transferred following deadly Negombo Prison riot". Two
// rows link when, in the same country and within a short window, they share
// >= 2 anchor tokens AND do not name mutually-exclusive subjects (so different
// cities / actors stay apart). Transitivity via a bridging headline that names
// both framings ("Negombo ... Sri Lanka Clash") closes the cluster; the best
// row survives.
function clusterSameEvent<
  T extends { title: string; date: Date; severity: string; country?: string | null },
>(rows: T[]): T[] {
  const n = rows.length;
  if (n < 2) return rows;
  const anchors = rows.map((r) => anchorTokens(r.title));
  const countryToks = rows.map((r) => countryNameTokens(r.country ?? ""));
  const subjects = anchors.map((a, i) => subjectTokens(a, countryToks[i]));
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(rows[i].date.getTime() - rows[j].date.getTime()) > SAME_EVENT_WINDOW_MS) continue;
      if (!sameCountryOrUnknown(rows[i].country ?? "", rows[j].country ?? "")) continue;
      const na = (rows[i].country ?? "").trim().toLowerCase();
      const nb = (rows[j].country ?? "").trim().toLowerCase();
      const explicitSameCountry = !!na && !!nb && na !== "unknown" && na === nb;
      const facility = (s: Set<string>) =>
        s.has("prison") || s.has("jail") || s.has("airport");
      // Facility-class fold runs BEFORE the distinct-subject veto so
      // "Incheon Airport labour protest" and "Incheon Airport pay protest"
      // collapse even when the grievance wording differs.
      if (explicitSameCountry && facility(anchors[i]) && facility(anchors[j])) {
        parent[find(i)] = find(j);
        continue;
      }
      // Same named facility city when one headline says "Incheon" and the
      // other "Incheon Airport" — syndicated rewrites often drop "airport".
      if (
        explicitSameCountry &&
        anchors[i].has("incheon") &&
        anchors[j].has("incheon") &&
        (facility(anchors[i]) || facility(anchors[j]) || /\bincheon\b/i.test(`${rows[i].title} ${rows[j].title}`))
      ) {
        parent[find(i)] = find(j);
        continue;
      }
      if (distinctSubjects(subjects[i], subjects[j])) continue;
      const [small, big] = anchors[i].size <= anchors[j].size
        ? [anchors[i], anchors[j]] : [anchors[j], anchors[i]];
      let shared = 0;
      for (const t of small) {
        if (!big.has(t)) continue;
        if (countryToks[i].has(t) || countryToks[j].has(t)) continue;
        shared++;
      }
      if (shared >= 2) { parent[find(i)] = find(j); continue; }
    }
  }
  const best = new Map<number, T>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const prev = best.get(root);
    if (!prev || sevDateBetter(rows[i], prev)) best.set(root, rows[i]);
  }
  const seen = new Set<number>();
  const out: T[] = [];
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (seen.has(root)) continue;
    seen.add(root);
    out.push(best.get(root)!);
  }
  return out;
}

export function dedupeByTitle<T extends { title: string; date: Date; severity: string; country?: string | null }>(rows: T[]): T[] {
  const byTitle = new Map<string, T>();
  for (const r of rows) {
    const k = titleKey(r.title);
    if (!k) { byTitle.set(`__${Math.random()}`, r); continue; }
    const prev = byTitle.get(k);
    if (!prev || sevDateBetter(r, prev)) byTitle.set(k, r);
  }
  const bySig = new Map<string, T>();
  for (const r of byTitle.values()) {
    const k = topicSignature(r.title, r.date);
    const prev = bySig.get(k);
    if (!prev || sevDateBetter(r, prev)) bySig.set(k, r);
  }
  // Third pass: fuzzy same-event collapse for syndicated rewrites the exact
  // passes above cannot bridge (varying casualty counts / place-name framing).
  return clusterSameEvent(Array.from(bySig.values()));
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

// Issues that are out of scope for Flashpoint — these are crime /
// armed-group / public-safety classifications that the broader
// classifier may assign but that have no business shaping an
// activism / protests / civil-unrest brief.
const OUT_OF_SCOPE_ISSUES = new Set([
  "Armed robbery",
  "Armed group activity",
  "Crime / public safety",
  "Piracy / armed robbery",
]);
function isOutOfScopeIssue(r: { issue: string }): boolean {
  return OUT_OF_SCOPE_ISSUES.has(r.issue);
}

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
      // Resolve physical incident location from title, summary and location
      // text. The raw country tag can be source attribution and is not trusted
      // without corroboration.
      const country = deriveIncidentCountry(r) ?? LOCATION_NOT_IDENTIFIED;
      // Clean the rendered title (drop publisher masthead + "Watch:" / "VIDEO
      // BY" video cruft). Classification above runs on the ORIGINAL title.
      return { ...r, title: cleanDisplayTitle(r.title), country, date, issue, bucket: bucketFor(issue) };
    })
    .filter((r) => !isNaN(r.date.getTime()));
}

function sortByDateDesc<T extends { date: Date }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.date.getTime() - a.date.getTime());
}

// Incident tables surface the most operationally significant rows first,
// not merely the most recent — so a Philippines transport strike mentioned
// in Watch Next cannot sit below the cap while weaker items fill the table.
function sortRowsForTable(rows: EnrichedIncident[]): EnrichedIncident[] {
  return [...rows].sort((a, b) =>
    compareIncidentSignificance(
      { severity: a.severity, title: a.title, summary: a.summary, occurredAt: a.occurredAt },
      { severity: b.severity, title: b.title, summary: b.summary, occurredAt: b.occurredAt },
    ) || b.date.getTime() - a.date.getTime(),
  );
}

function countriesOf(rows: EnrichedIncident[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    const c = (r.country ?? "").trim();
    // An unresolved location is a data-quality state, not a country. Keep it
    // out of geographic rankings and prose rather than letting it appear as a
    // false regional leader.
    if (!c || c === LOCATION_NOT_IDENTIFIED) continue;
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
export type FlashpointRejectStage =
  | "off-topic"
  | "kinetic-only"
  | "court-only"
  | "out-of-scope-crime"
  | "duplicate"
  | "weak-novelty"
  | "weak-operational";

export interface FlashpointRejectedRecord {
  stage: FlashpointRejectStage;
  country: string;
  title: string;
  date: string;
}

export interface FlashpointSelection {
  /** The single clean, usable incident set the report renders from:
   *  merged flashpoint+protests buckets, in window, on-topic, with
   *  kinetic-only, court-only, out-of-scope (crime), novelty and
   *  weak-operational noise removed, and syndicated duplicates collapsed. */
  enriched: EnrichedIncident[];
  offTopicDropped: number;
  kineticDropped: number;
  courtDropped: number;
  outOfScopeCrimeDropped: number;
  dedupedDropped: number;
  weakNoveltyDropped: number;
  weakOperationalDropped: number;
  weakDropped: number;
  /** How many records were in the window+bucket before any filtering. */
  rawWindowCount: number;
  /** Every record dropped at any stage, with the reason — the proof set. */
  rejected: FlashpointRejectedRecord[];
}

/**
 * Single source of truth for "which incidents are usable in a Flashpoint /
 * Protests report". Used by BOTH the report dataset (Fast Facts, country
 * chart, reads, Related Incidents) AND the draft-prose seeder, so the
 * record count, the narrative and the table can never contradict each
 * other.
 */
export function selectFlashpointUsable(
  incidents: FlashpointReportIncident[],
  topic: string,
  issueDate: string,
): FlashpointSelection {
  // Flashpoint reports draw from BOTH `flashpoint` (live scraper) and
  // `protests` (legacy import) buckets — operationally the same bucket.
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
  const rejected: FlashpointRejectedRecord[] = [];
  const reject = (
    stage: FlashpointRejectStage,
    r: FlashpointReportIncident,
  ) => {
    rejected.push({
      stage,
      country: deriveIncidentCountry(r) ?? LOCATION_NOT_IDENTIFIED,
      title: r.title ?? "",
      date: (r.occurredAt ?? "").slice(0, 10),
    });
  };

  const onTopic: FlashpointReportIncident[] = [];
  for (const r of rawWindow) {
    if (passesRelevance(r)) onTopic.push(r);
    else reject("off-topic", r);
  }

  let kineticDropped = 0;
  let courtDropped = 0;
  const scoped: FlashpointReportIncident[] = [];
  for (const r of onTopic) {
    if (isKineticOnly(r)) { kineticDropped++; reject("kinetic-only", r); continue; }
    if (isCourtOnly(r)) { courtDropped++; reject("court-only", r); continue; }
    scoped.push(r);
  }

  // Flashpoint is activism, protests and civil unrest only — not crime.
  // Drop armed-robbery / armed-group / generic-crime classifications.
  const enrichedAll = sortByDateDesc(enrich(scoped));
  const enrichedInScope: EnrichedIncident[] = [];
  let outOfScopeCrimeDropped = 0;
  for (const r of enrichedAll) {
    if (isOutOfScopeIssue(r)) {
      outOfScopeCrimeDropped++;
      reject("out-of-scope-crime", r);
    } else enrichedInScope.push(r);
  }
  // Two-pass dedupe so syndicated rewrites of the same protest don't
  // dominate the operational read.
  const enrichedDeduped = dedupeByTitle(enrichedInScope);
  const keptIds = new Set(enrichedDeduped.map((r) => r.id));
  for (const r of enrichedInScope) if (!keptIds.has(r.id)) reject("duplicate", r);
  // Single usable set: also strip novelty and weak-operational noise
  // (sports "strikes", defence-procurement wire copy, legislative-process
  // items, suspended strikes, stock-photo captions). This is what every
  // surface counts and renders, so Fast Facts, prose and the Related
  // Incidents table all agree.
  const enriched: EnrichedIncident[] = [];
  let weakNoveltyDropped = 0;
  let weakOperationalDropped = 0;
  for (const r of enrichedDeduped) {
    if (isWeakNovelty(r)) {
      weakNoveltyDropped++;
      reject("weak-novelty", r);
      continue;
    }
    if (
      isWeakOperational(r) &&
      !(hasUpcomingSignal(r) && isScheduledOutsideReportingPeriod(r, topic, issueDate))
    ) {
      weakOperationalDropped++;
      reject("weak-operational", r);
      continue;
    }
    enriched.push(r);
  }

  return {
    enriched,
    offTopicDropped: rawWindow.length - onTopic.length,
    kineticDropped,
    courtDropped,
    outOfScopeCrimeDropped,
    dedupedDropped: enrichedInScope.length - enrichedDeduped.length,
    weakNoveltyDropped,
    weakOperationalDropped,
    weakDropped: weakNoveltyDropped + weakOperationalDropped,
    rawWindowCount: rawWindow.length,
    rejected,
  };
}

export function buildFlashpointReportDataset(
  incidents: FlashpointReportIncident[],
  topic: string,
  issueDate: string,
): FlashpointReportDataset {
  const win = resolveReportWindow(topic, issueDate);

  const {
    enriched: usableEnriched,
    offTopicDropped,
    kineticDropped,
    courtDropped,
    outOfScopeCrimeDropped,
    dedupedDropped,
    weakNoveltyDropped,
    weakOperationalDropped,
    rawWindowCount,
  } = selectFlashpointUsable(incidents, topic, issueDate);

  // Period totals use the stated EVENT date when the source text names one,
  // not the article publication date — future-dated announcements published
  // inside the window belong in the forecast only.
  const enriched = usableEnriched.filter((r) => isInReportingPeriod(r, win));

  // Bucketed views for the operational reads and tables. `enriched` is
  // already clean, so these are simple bucket splits ranked for table display.
  const activismRows = sortRowsForTable(enriched.filter((r) => r.bucket === "activism"));
  const unrestRows = sortRowsForTable(enriched.filter((r) => r.bucket === "unrest"));
  const forecastHeld = usableEnriched.length - enriched.length;
  const activismLeadPool = sortRowsForTable([
    ...activismRows,
    ...unrestRows.filter(
      (r) => hasConfirmedOperationalImpact(r) && !containedVenueNote(r),
    ),
    ...enriched.filter(
      (r) =>
        r.bucket === "other" &&
        hasConfirmedOperationalImpact(r) &&
        !containedVenueNote(r),
    ),
  ]);

  // Fast Facts. The single top-severity incident is computed ONCE over the
  // full usable set and shared with every prose builder (Exec Summary,
  // Forecast, Watch Next) so the Fast Facts card and the narrative can never
  // disagree about what "the most serious" event was.
  const topSeverity = topSeverityIncident(enriched);
  const hs = topSeverity
    ? { key: sevKey(topSeverity.severity), label: SEV_LABEL[sevKey(topSeverity.severity)] ?? topSeverity.severity }
    : { key: "", label: "—" };
  const countryCount = countriesOf(enriched);
  const countrySignificance = new Map<string, number>();
  for (const [country, rows] of Object.entries(
    enriched.reduce<Record<string, EnrichedIncident[]>>((groups, row) => {
      const country = (row.country ?? "").trim();
      if (!country || country === LOCATION_NOT_IDENTIFIED) return groups;
      (groups[country] ??= []).push(row);
      return groups;
    }, {}),
  )) {
    countrySignificance.set(country, aggregateIncidentSignificance(rows));
  }
  const rankedCountries = [...countryCount.keys()].sort(
    // COUNT first — must match countryRows / Regional View so Fast Facts
    // "Most Affected Country" never contradicts the chart (owner-flagged:
    // Sri Lanka named while Bangladesh had twice the incidents).
    (a, b) =>
      (countryCount.get(b) ?? 0) - (countryCount.get(a) ?? 0) ||
      (countrySignificance.get(b) ?? 0) - (countrySignificance.get(a) ?? 0) ||
      a.localeCompare(b),
  );
  const topCountry = rankedCountries[0] ?? "—";
  const topCountryN = countryCount.get(topCountry) ?? 0;
  const issueCount = new Map<string, number>();
  for (const r of enriched) issueCount.set(r.issue, (issueCount.get(r.issue) ?? 0) + 1);
  let topIssue = "—", topIssueN = 0;
  for (const [k, v] of issueCount) if (v > topIssueN) { topIssueN = v; topIssue = k; }
  const latest = enriched.length > 0
    ? format(
        dateMax(enriched.map((r) => effectiveEventDate(r, endOfReportDay(win.end)))),
        "dd MMM yyyy",
      )
    : "—";

  const screeningNote = buildScreeningNote({
    rawWindowCount,
    distinct: enriched.length,
    dedupedDropped,
    offTopicDropped,
    kineticDropped,
    courtDropped,
    outOfScopeCrimeDropped,
    weakNoveltyDropped,
    weakOperationalDropped,
    forecastHeld,
  });

  const fastFacts: KpiCard[] = [
    { label: "Reporting Period", value: win.shortLabel },
    {
      label: "Distinct Incidents",
      value: String(enriched.length),
      note: screeningNote,
    },
    {
      label: "Highest Severity",
      value: hs.label,
      severity: hs.key || undefined,
      note: hs.key
        ? "Peak incident rating — not the overall week posture"
        : undefined,
    },
    {
      label: "Top Issue Type",
      value: topIssue,
      note: topIssueN > 0 ? `${topIssueN} incident${topIssueN === 1 ? "" : "s"}` : undefined,
    },
    {
      label: "Most Affected Country",
      value: topCountry,
      note: topCountryN > 0 ? `${topCountryN} incident${topCountryN === 1 ? "" : "s"}` : undefined,
    },
    { label: "Latest Incident", value: latest },
  ];

  // Country bar rows (top 12 only, identified countries). Bar LENGTH is the
  // distinct-incident count; bar COLOUR is that country's highest severity
  // tier this window — so a low-volume but severe theatre reads as serious
  // rather than being buried beneath high-volume, low-severity activity.
  const countryTopSev = new Map<string, string>();
  for (const r of enriched) {
    const c = (r.country ?? "").trim();
    if (!c) continue;
    const k = sevKey(r.severity);
    if (
      incidentSeverityRank(r.severity) >
      incidentSeverityRank(countryTopSev.get(c) ?? "")
    ) {
      countryTopSev.set(c, k);
    }
  }
  const countryRows: BarRow[] = Array.from(countryCount.entries())
    .map(([label, value]) => {
      const sk = countryTopSev.get(label);
      return { label, value, color: (sk && SEV_HEX[sk]) || "#465bff" };
    })
    .sort(
      // COUNT first. The chart's bar length is the incident count and every
      // prose reference to this ranking says "busiest" / "most events", so the
      // order must be volume — a severity-weighted order made Nepal (5) rank
      // above Bangladesh (7), an owner-flagged defect. Severity still shows as
      // bar colour and breaks ties.
      (a, b) =>
        b.value - a.value ||
        (countrySignificance.get(b.label) ?? 0) -
          (countrySignificance.get(a.label) ?? 0) ||
        a.label.localeCompare(b.label),
    )
    .slice(0, 12);

  // --- Reads ---------------------------------------------------------------
  // Activism lead draws from activism rows plus confirmed street-level unrest,
  // but never prison / contained-facility events (those stay in civil-unrest read).
  const activismRead = buildActivismRead(activismRows, win.shortLabel, win.end, activismLeadPool);
  const civilUnrestRead = buildCivilUnrestRead(unrestRows, win.shortLabel, win.end, [...activismRows, ...unrestRows]);
  // Forward-looking items rendered as a structured Country / Signal /
  // Operational meaning table rather than a quoted paragraph dump.
  // Forecast draws from the full usable set (including future-dated rows
  // excluded from period totals) so announcements stay in the outlook.
  const futureRaw = extractFutureSignals(usableEnriched)
    .filter((r) => !isLowCredibility(r) && !isWeakNovelty(r) && !isWeakOperational(r));
  // Build forecast rows, then collapse any (country, signal) duplicate
  // so the same operational signal cannot appear twice (e.g. two
  // South Korea records that both reduce to "Union injunction ruling
  // — sectoral strike risk" must render once).
  const seenForecast = new Set<string>();
  const forecastDated: ForecastFutureRow[] = [];
  for (const r of dedupeByTitle(futureRaw)) {
    // An explicitly-dated event ON or BEFORE the issue date has already
    // happened — it is window material, not a forward-looking row.
    if (forecastDateHasPassed(r, win.end)) continue;
    const country = r.country?.trim() || "—";
    const signal = shortSignalLabel(r);
    const key = `${country.toLowerCase()}|${signal.toLowerCase()}`;
    if (seenForecast.has(key)) continue;
    seenForecast.add(key);
    const statedDate = explicitForecastDate(r);
    // Dateless announcements belong in Watch Next only — not in the
    // confirmed-upcoming table (owner-flagged: Thailand with no date in
    // a table labelled as confirmed schedule items).
    if (!statedDate) continue;
    forecastDated.push({
      country,
      signal,
      meaning: forecastMeaningFor(r),
      date: statedDate,
    });
  }
  const forecastFuture = forecastDated.slice(0, 6);
  const forecastRead = buildForecastRead({
    activismRows,
    unrestRows,
    countryRows,
    hasFutureTable: forecastFuture.length > 0,
    forecastLeadCountry: forecastFuture[0]?.country ?? null,
    forecastLeadSignal: forecastFuture[0]?.signal ?? null,
    forecastRows: forecastFuture,
    topSeverity,
    // Tie count over the SAME universe topSeverity was computed from (full
    // enriched set) so Exec Summary and Forecast can never disagree on how
    // many incidents share the top tier.
    topSeverityTie: topSeverityTieCount(enriched, topSeverity ?? null),
  });
  const regionalCountryRead = buildRegionalCountryRead({
    enriched,
    countryRows,
  });

  // Related Incidents — prioritise activism + unrest, drop "Other" / weak
  // buckets, and seed with the strongest political-mobilisation record so
  // the centre-of-gravity geography (Pakistan / PTI / Section 144) leads
  // ahead of generic sectoral entries. Rows already surfaced in the rendered
  // Activism / Civil Unrest tables are excluded so no incident appears in
  // two sections of the same report.
  const shownInTables = new Set<string | number>(
    [
      ...activismRows.slice(0, FLASHPOINT_TABLE_ROW_CAP),
      ...unrestRows.slice(0, FLASHPOINT_TABLE_ROW_CAP),
    ].map((r) => r.id),
  );
  const relatedIncidents = prioritiseRelated(enriched, shownInTables);

  // Auto-prose for the closing analyst sections.
  const autoCtx = {
    activismRows,
    unrestRows,
    countryRows,
    enriched,
    usableEnriched,
    topSeverity,
    windowEnd: win.end,
  };
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
  const autoPolestarView = buildPolestarView(autoCtx);

  // Data note. Mirrors shipping's compact note: surface filter counts so
  // the reader understands what scope was applied, without leaking
  // internal classifier vocabulary.
  const noteParts: string[] = [];
  if (kineticDropped > 0) {
    noteParts.push(`${kineticDropped} kinetic armed-conflict record${kineticDropped === 1 ? "" : "s"} without a public-order hook were excluded so this report stays focused on activism, protests and civil unrest.`);
  }
  if (courtDropped > 0) {
    noteParts.push(`${courtDropped} court-only legal-process record${courtDropped === 1 ? " was" : "s were"} excluded for lack of a civil-unrest hook.`);
  }
  if (dedupedDropped > 0) {
    noteParts.push(`${dedupedDropped} duplicate report${dedupedDropped === 1 ? "" : "s"} of the same stories ${dedupedDropped === 1 ? "was" : "were"} removed.`);
  }
  if (weakNoveltyDropped + weakOperationalDropped > 0) {
    noteParts.push(`${weakNoveltyDropped + weakOperationalDropped} low-signal record${weakNoveltyDropped + weakOperationalDropped === 1 ? " was" : "s were"} excluded — stories about past events (court cases, probes, arrests over earlier incidents), sports, procurement, legislative-process and stock-photo items that use protest or strike wording without any live event.`);
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

function hasConfirmedOperationalImpact(r: {
  title?: string | null;
  summary?: string | null;
}): boolean {
  const txt = `${r.title ?? ""} ${r.summary ?? ""}`;
  return LIVE_PUBLIC_ORDER_RE.test(txt) || ENFORCEMENT_RE.test(txt);
}

function significanceInput(
  r: EnrichedIncident,
  referenceEnd: Date,
): {
  severity: string;
  title: string;
  summary?: string | null;
  occurredAt: string;
  eventDate?: string;
} {
  const stated = normalizeStatedEventDate(r, referenceEnd);
  return {
    severity: r.severity,
    title: r.title,
    summary: r.summary,
    occurredAt: r.occurredAt,
    eventDate: stated ? stated.toISOString() : undefined,
  };
}

function isOperationalStreetLead(r: EnrichedIncident): boolean {
  if (isWeakOperational(r)) return false;
  return hasConfirmedOperationalImpact(r);
}

/** Moderate-or-higher with confirmed on-the-ground street/enforcement impact. */
function isElevatedOperationalLead(r: EnrichedIncident): boolean {
  return (SEV_RANK[sevKey(r.severity)] ?? 0) >= 3 && isOperationalStreetLead(r);
}

function leadCandidateTier(r: EnrichedIncident): number {
  const sev = SEV_RANK[sevKey(r.severity)] ?? 0;
  if (sev >= 3 && isOperationalStreetLead(r)) return 4;
  if (isOperationalStreetLead(r)) return 3;
  if (sev >= 3) return 2;
  return 1;
}

function pickLead(
  rows: EnrichedIncident[],
  windowEnd: Date,
  opts?: { activism?: boolean },
): EnrichedIncident | null {
  // Strict lead: credible AND not novelty/parody AND has an actual
  // mobilisation signal in the TITLE or summary, then pick the highest
  // severity among those — not the first by date. This keeps weak
  // commentary / court-process items off the lead line when a stronger
  // HIGH/EXTREME protest record sits in the file.
  const STRONG_LEAD_RE = /\b(protest(?:s|ers?|ing)?|demonstrat(?:ion|ions|ors?)|rall(?:y|ies)|march(?:es)?|sit[- ]?ins?|strikes?|walkouts?|stoppages?|shutdowns?|riots?|crackdowns?|curfews?|tear[- ]?gas|water cannon|baton|arrest(?:s|ed)?|detentions?|roadblocks?|blockades?|section\s*144|assembly ban|mobilisation|mobilization)\b/i;
  const leadText = (r: EnrichedIncident) => `${r.title ?? ""} ${r.summary ?? ""}`;
  // A future ANNOUNCEMENT ("students to protest nationwide on 13 August")
  // is a forecast-table item, never the "main event" of the week that
  // already happened — an owner-flagged defect. Excluded from the lead pool
  // unless nothing else qualifies.
  const ANNOUNCEMENT_RE =
    /\b(?:to\s+(?:protest|strike|rally|march|walk\s?out)|will\s+(?:protest|strike|rally|march)|set\s+for|scheduled\s+(?:for|on)|plans?\s+(?:to\s+)?(?:protest|strike|rally|march)|announces?\s+(?:protest|strike|rally|march))\b/i;
  const credibleAll = rows.filter((r) => !isLowCredibility(r) && !isWeakNovelty(r));
  const refEnd = endOfReportDay(windowEnd);
  const occurred = credibleAll.filter((r) => {
    if (ANNOUNCEMENT_RE.test(r.title ?? "")) return false;
    const stated = normalizeStatedEventDate(r, refEnd);
    if (stated && stated.getTime() > refEnd.getTime()) return false;
    if (stated && stated.getTime() <= refEnd.getTime() && hasUpcomingSignal(r)) return false;
    return true;
  });
  const credible = occurred.length > 0 ? occurred : credibleAll;
  const strong = credible.filter((r) => STRONG_LEAD_RE.test(leadText(r)));
  const compareLead = (a: EnrichedIncident, b: EnrichedIncident) => {
    const tierA = leadCandidateTier(a);
    const tierB = leadCandidateTier(b);
    if (tierB !== tierA) return tierB - tierA;
    return compareIncidentSignificance(significanceInput(a, refEnd), significanceInput(b, refEnd));
  };
  const sortBySignificance = (arr: EnrichedIncident[]) => [...arr].sort(compareLead);
  // Activism read: confirmed Moderate+ street/enforcement events must lead
  // over Low grievance-only marches even when the latter match title cues
  // more cleanly (owner-flagged PDF-2 defect: Sri Lanka civic march over
  // Jharkhand tear-gas dispersal).
  if (opts?.activism) {
    const elevatedOperational = credible.filter((r) => isElevatedOperationalLead(r));
    if (elevatedOperational.length > 0) {
      const nonReaction = elevatedOperational.filter((r) => !isReactionLed(r.title ?? ""));
      return sortBySignificance(nonReaction.length > 0 ? nonReaction : elevatedOperational)[0];
    }
  }
  // High-severity leads must describe live street activity or enforcement,
  // not a bare call / analysis piece (owner-flagged: Klang protest rated
  // High with no account of what happened on the ground).
  const operationalStrong = strong.filter((r) => {
    if (isWeakOperational(r)) return false;
    const txt = leadText(r);
    const sev = SEV_RANK[sevKey(r.severity)] ?? 0;
    if (sev >= 3 && !LIVE_PUBLIC_ORDER_RE.test(txt) && !ENFORCEMENT_RE.test(txt)) return false;
    return true;
  });
  const leadStrong = operationalStrong.length > 0 ? operationalStrong : strong;
  if (leadStrong.length > 0) {
    // Reaction-led advocacy headlines ("demands justice for six slain") report
    // a mobilisation ABOUT a prior death — they must not lead over a fresh
    // protest/disruption record at the same severity (owner-flagged defect:
    // High Malaysian memorial protest declared main event while barely
    // explaining the protest itself).
    const nonReaction = leadStrong.filter((r) => !isReactionLed(r.title ?? ""));
    const leadPool = nonReaction.length > 0 ? nonReaction : leadStrong;
    const bestStrong = sortBySignificance(leadPool)[0];
    const elevatedOutsideStrong = credible.filter(
      (r) => isElevatedOperationalLead(r) && !leadPool.includes(r),
    );
    if (elevatedOutsideStrong.length > 0) {
      const bestElevated = sortBySignificance(elevatedOutsideStrong)[0];
      if (compareLead(bestStrong, bestElevated) > 0) return bestElevated;
    }
    const political = leadPool.filter((r) => POLITICAL_MOBILISATION_RE.test(leadText(r)));
    if (political.length > 0) {
      const bestPol = sortBySignificance(political)[0];
      const polSev = SEV_RANK[sevKey(bestPol.severity)] ?? 0;
      const strongSev = SEV_RANK[sevKey(bestStrong.severity)] ?? 0;
      if (
        polSev > strongSev ||
        (polSev === strongSev &&
          hasConfirmedOperationalImpact(bestPol) &&
          !hasConfirmedOperationalImpact(bestStrong))
      ) {
        return bestPol;
      }
    }
    return bestStrong;
  }
  if (strong.length > 0) {
    return sortBySignificance(strong)[0];
  }
  if (credible.length > 0) return sortBySignificance(credible)[0];
  const safe = rows.filter((r) => !isWeakNovelty(r));
  return safe[0] ?? rows[0] ?? null;
}

// Recency gate. When the most recent in-scope incident is several days
// behind the window end (report Issue Date), the present-tense "live
// activity" framing in the reads below is misleading. We prepend an
// explicit residual-concern note so prose can never read as current
// when the file has gone quiet. Returns "" when activity is fresh.
function stalenessPrefix(rows: EnrichedIncident[], windowEnd: Date): string {
  if (rows.length === 0) return "";
  const latest = dateMax(rows.map((r) => r.date));
  const daysOld = differenceInCalendarDays(windowEnd, latest);
  if (daysOld < 4) return "";
  return `The last reported incident was ${daysOld} days ago. No fresh activity is recorded since then. Treat this as residual concern unless new mobilisation, planned action, or unresolved disruption is confirmed.`;
}

function buildActivismRead(
  rows: EnrichedIncident[],
  windowLabel: string,
  windowEnd: Date,
  leadPool?: EnrichedIncident[],
): string {
  if (rows.length === 0) {
    return `Little protest, strike, student or sit-in activity was reported across ${windowLabel}. Treat the quiet stretch as a gap in reporting rather than a lasting easing: protest activity in these countries tends to come in bursts, with quiet weeks often followed by a sharp escalation around a policy decision or anniversary.\n\nKeep tracking opposition political calendars, union notices, student-body statements and trade groups (chemists, transporters, lawyers, traders) — these are the earliest signs that activity will pick up again rather than stay quiet.`;
  }
  const lead = pickLead(leadPool ?? rows, windowEnd, { activism: true });
  // Driver fingerprinting drives prose shape rather than a generic
  // "mix breaks down as protest (N)" line. Reads as judgement, not
  // counting.
  const text = (r: EnrichedIncident) => `${r.title ?? ""} ${r.summary ?? ""}`;
  const political = rows.filter((r) => /\b(pti|imran|tehreek|ttap|opposition|movement|countrywide protest|section\s*144|assembly ban)\b/i.test(text(r)));
  const sectoral = rows.filter((r) => /\b(chemist|pharmacist|trader|transporter|lawyer|union|chamber|federation|sectoral|wage|salary|pay|metro bus|pension)\b/i.test(text(r)));
  const student = rows.filter((r) => /\b(student|university|campus|college|faculty|vc|exam[- ]board)\b/i.test(text(r)));
  const drivers: string[] = [];
  if (political.length > 0) drivers.push("opposition party protests");
  if (sectoral.length > 0) drivers.push("union and trade-group action");
  if (student.length > 0) drivers.push("student and campus activism");
  const headline = lead
    ? (() => {
        const where = (lead.country ?? "").trim();
        const label = SEV_LABEL[sevKey(lead.severity)] ?? lead.severity ?? "Moderate";
        const txt = `${lead.title ?? ""} ${lead.summary ?? ""}`;
        const live = LIVE_PUBLIC_ORDER_RE.test(txt) || ENFORCEMENT_RE.test(txt);
        const detail = live
          ? ""
          : " Reports describe the grievance or call rather than turnout, routes or police action on the day — treat the severity as provisional.";
        const reaction = lead && isReactionLed(lead.title ?? "")
          ? " That rating reflects the underlying incident being protested rather than disruption from the protest itself."
          : "";
        return `The main protest event across ${windowLabel} was ${shortSignalLabel(lead)}${where ? ` in ${where}` : ""}, rated ${label} severity.${reaction}${detail}`;
      })()
    : `No single protest event stood out across ${windowLabel}, but organising activity continued.`;
  const driverLine = drivers.length > 0
    ? `Most of the reported events came from ${joinList(drivers)}.`
    : `The reported events are routine local organising rather than any single campaign.`;
  const operational = `The locations named in the incidents are mainly city-centre commercial districts, court complexes, party and ministry offices and the main roads nearby. Where protests fall on staff routes or near sites, movement and access are the first things affected.`;
  const stale = stalenessPrefix(rows, windowEnd);
  const body = `${headline}\n\n${driverLine}\n\n${operational}`;
  return stale ? `${stale}\n\n${body}` : body;
}

function buildCivilUnrestRead(rows: EnrichedIncident[], windowLabel: string, windowEnd: Date, allRows?: EnrichedIncident[]): string {
  if (rows.length === 0) {
    return `Little riot, clash, crackdown, curfew or security-force activity was reported across ${windowLabel}. A quiet stretch for civil unrest alongside continuing protest activity usually means the authorities have held back from mass arrests or curfew orders — useful, but it can reverse within days if a protest crosses a policy line.\n\nKeep tracking police statements, local government orders, internet-shutdown notices and any move to call in the military. These tend to come ahead of curfews and visible street-level enforcement.`;
  }
  const lead = pickLead(rows, windowEnd);
  const text = (r: EnrichedIncident) => `${r.title ?? ""} ${r.summary ?? ""}`;
  // Posture claims scan the WHOLE usable file, not just the unrest bucket —
  // an arrest reported on an activism-bucketed row still falsifies "no
  // arrests reported" (owner-flagged defect).
  const postureRows = allRows ?? rows;
  const hasCurfew = postureRows.some((r) => /\b(curfew|section\s*144|assembly ban|lockdown imposed|state of emergency|martial law)\b/i.test(text(r)));
  const hasCrackdown = hasEnforcementSignal(postureRows);
  const hasRiotClash = postureRows.some((r) => /\b(riot|clash|public disorder|looting|stone[- ]?pelt)\b/i.test(text(r)));
  const postureBits: string[] = [];
  if (hasCurfew) postureBits.push("statutory restrictions are already in play");
  if (hasCrackdown) postureBits.push("police have already used force or made arrests at demonstrations");
  if (hasRiotClash) postureBits.push("street-level disorder is on the record");
  const containedNote = lead ? containedVenueNote(lead) : null;
  const headline = lead
    ? `The most serious civil-unrest event across ${windowLabel} was ${shortSignalLabel(lead)}${(lead.country ?? "").trim() ? ` in ${(lead.country ?? "").trim()}` : ""}.${containedNote ? ` ${containedNote}` : ""}`
    : `Civil unrest across ${windowLabel} was limited, with no single standout event.`;
  const postureLine = postureBits.length > 0
    ? `The police response is the main thing to watch: ${joinList(postureBits)}.`
    : `Reports this week do not mention curfews, mass arrests or crackdowns. The police response so far looks measured rather than escalating.`;
  const operational = `For businesses, what the police do — arrests, crackdowns, curfews — matters more than how many protests there are, because that is where roads close and buildings become hard to reach. If enforcement is concentrated in one city or district, plan for road closures and blocked access on the day.`;
  const stale = stalenessPrefix(rows, windowEnd);
  const body = `${headline}\n\n${postureLine}\n\n${operational}`;
  return stale ? `${stale}\n\n${body}` : body;
}

function buildForecastRead(opts: {
  activismRows: EnrichedIncident[];
  unrestRows: EnrichedIncident[];
  countryRows: BarRow[];
  hasFutureTable: boolean;
  forecastLeadCountry?: string | null;
  forecastLeadSignal?: string | null;
  forecastRows?: ForecastFutureRow[];
  topSeverity?: EnrichedIncident | null;
  // Count of incidents sharing the top severity tier, computed over the SAME
  // universe as topSeverity (full enriched set) so this section can never
  // disagree with the Exec Summary's tie count.
  topSeverityTie?: number;
}): string {
  const { activismRows, unrestRows, countryRows, hasFutureTable } = opts;
  const forecastLeadCountry = (opts.forecastLeadCountry ?? "").trim();
  const forecastLeadSignal = (opts.forecastLeadSignal ?? "").trim();
  const lead = countryRows[0];
  const total = activismRows.length + unrestRows.length;
  // The structured forward-looking table is rendered above this prose
  // by the exporter when at least one credible future-dated record is
  // present. Prose then carries trajectory commentary only.
  const futureBlock = hasFutureTable
    ? (() => {
        const rows = opts.forecastRows ?? [];
        const datedN = rows.filter((r) => !!r.date).length;
        if (datedN > 0 && datedN === rows.length) {
          return `Confirmed upcoming events with stated dates are listed in the table above and are the first dates to plan around. The outlook below builds on that schedule.`;
        }
        if (datedN > 0) {
          return `Upcoming signals are listed in the table above. Rows with a date are confirmed schedule items; rows marked "—" have no stated date yet. The outlook below builds on that mix.`;
        }
        return `Upcoming signals without confirmed dates are listed in the table above. Treat them as items to monitor rather than fixed calendar dates. The outlook below builds on those signals.`;
      })()
    : `No confirmed upcoming protest calls, strike notices or scheduled hearings have been reported. The outlook below is therefore an assessment of likely direction from current activity, not a list of scheduled events.`;
  const activismShare = total > 0 ? activismRows.length / total : 0;
  const unrestShare = total > 0 ? unrestRows.length / total : 0;
  const lines: string[] = [futureBlock];
  const datedMarches = (opts.forecastRows ?? []).filter(
    (r) => /civic protest march/i.test(r.signal) && !!r.date,
  );
  if (total === 0) {
    if (datedMarches.length > 1) {
      lines.push(
        `Civic protest marches with confirmed dates are set in ${joinList(datedMarches.map((m) => m.country))} — confirm turnout and access impact in each host city before the date.`,
      );
    }
    lines.push(`The near-term outlook is for continued quiet, with little fresh protest or civil-unrest activity on the current record. That could change if a named movement announces a fresh protest schedule.`);
    lines.push(
      `This outlook is based on one reporting period and on confirmed announcements only, so treat it as a starting point rather than a firm prediction.`,
    );
    return lines.join("\n\n");
  }
  const allRows = [...activismRows, ...unrestRows];
  // The ONE shared top-severity incident (same as Fast Facts / Exec Summary),
  // falling back to a local computation only when the caller cannot supply it.
  const sevInc = opts.topSeverity !== undefined ? opts.topSeverity : topSeverityIncident(allRows);
  const sevHs = sevInc
    ? { key: sevKey(sevInc.severity), label: SEV_LABEL[sevKey(sevInc.severity)] ?? sevInc.severity }
    : highestSeverity(allRows);
  const sevCountry = (sevInc?.country ?? "").trim();
  // A severity lead is only worth calling out when it is genuinely
  // elevated (Moderate or higher). A "highest" that is still Low is not
  // an escalation and must not be dressed up as one.
  const sevOutranksLead =
    !!lead && !!sevInc && !!sevCountry && sevCountry !== lead.label &&
    (SEV_RANK[sevKey(sevInc.severity)] ?? 0) >= 3;
  // The forward-looking TABLE is ranked by confirmed future-dated
  // signals, so its lead country can differ from the volume chart's
  // leader. That divergence is exactly what reads as a contradiction to
  // a client ("why does the forecast highlight X when the chart leads
  // with Y?"), so reconcile it explicitly whenever it occurs.
  const tableLeadDiffers =
    !!lead && !!forecastLeadCountry && forecastLeadCountry !== lead.label;
  if (lead && sevOutranksLead) {
    // Volume lead and an elevated severity lead are different countries.
    // Only tie the severity lead to the forward-looking table when the
    // table actually exists AND its lead row is that same country;
    // otherwise the table claim would be false.
    const sevLeadsTable =
      hasFutureTable && !!forecastLeadCountry && forecastLeadCountry === sevCountry;
    const tableClause = sevLeadsTable
      ? `, which is why it leads the forward-looking table even though it is not the busiest country`
      : ``;
    // Tie-aware: with several incidents at the top tier, no single event may
    // be called "the most serious" (owner-flagged defect).
    const tieN = opts.topSeverityTie ?? topSeverityTieCount(allRows, sevInc);
    const seriousClause = tieN > 1
      ? `but the most serious incidents — ${tieN} rated ${sevHs.label} — include ${shortSignalLabel(sevInc)} in ${sevCountry}${tableClause}`
      : `but the most serious single incident was in ${sevCountry}: ${shortSignalLabel(sevInc)}, rated ${sevHs.label}${tableClause}`;
    const watchClause = tieN > 1
      ? `watch the ${sevHs.label}-rated incidents, starting with ${sevCountry}, for how they develop`
      : `watch ${sevCountry} for how that incident develops`;
    lines.push(
      `${lead.label} had the most events this week, ${seriousClause}. Expect frequent, mostly lower-level disruption in ${lead.label}, and ${watchClause}.`,
    );
  } else if (lead && tableLeadDiffers) {
    // Volume leader and forecast-table leader differ, but on count not
    // severity. Explain the table is a scheduling signal, not a ranking.
    const sig = forecastLeadSignal ? ` (${forecastLeadSignal})` : "";
    lines.push(
      `The upcoming-events table and the country breakdown point in slightly different directions. ${lead.label} shows the most activity in the window. The table highlights ${forecastLeadCountry}${sig} only because it has the clearest confirmed upcoming event — a fixed calendar date to plan around, not a sign that ${forecastLeadCountry} outweighs ${lead.label} on volume or severity.`,
    );
  } else if (lead) {
    lines.push(
      `On the current record, ${lead.label} carries the most protest and civil-unrest activity and is the country most likely to see it continue.`,
    );
  } else {
    lines.push(
      `Activity is spread across the region on the current record, with no single country standing out.`,
    );
  }
  if (activismShare >= 0.6) {
    lines.push(
      `Most of this week's events were protests and organised action rather than open disorder. Where gatherings take place in commercial districts or on main roads, expect localised road closures and slower staff travel rather than wider disruption.`,
    );
  } else if (unrestShare >= 0.6) {
    lines.push(
      `Most of this week's events involved civil unrest and police enforcement rather than fresh organising. That kind of activity is more disruptive where it happens near staff routes and business sites.`,
    );
  } else {
    lines.push(
      `Protest activity and civil unrest are roughly balanced across the window.`,
    );
  }
  // When several confirmed civic protest marches sit in the forward table,
  // summarise them as one cross-country line instead of leaving the reader
  // to stitch the per-row detail together.
  // "Confirmed" is reserved for rows with an explicitly STATED future date.
  // A dateless announcement is unconfirmed and must not be called confirmed
  // here while Watch Next calls the same item unconfirmed (owner-flagged
  // contradiction).
  const marches = datedMarches;
  if (marches.length > 1) {
    lines.push(
      `Civic protest marches with confirmed dates are set in ${joinList(marches.map((m) => m.country))} — confirm turnout and access impact in each host city before the date.`,
    );
  }
  lines.push(
    `This outlook is based on one reporting period and on confirmed announcements only, so treat it as a starting point rather than a firm prediction.`,
  );
  return lines.join("\n\n");
}

function buildRegionalCountryRead(opts: {
  enriched: EnrichedIncident[];
  countryRows: BarRow[];
}): string {
  const { enriched, countryRows } = opts;
  if (enriched.length === 0) {
    return `No activity could be tied to a specific country this week, so there is no geographic picture to show. Treat one quiet week as a single data point rather than a lasting shift.`;
  }
  if (countryRows.length === 0) {
    return `Few events could be tied to a specific country this week, even where there is clearly activity happening. That usually reflects gaps in reporting rather than a real absence of street-level activity.`;
  }
  const lead = countryRows[0];
  // APAC sub-region spread leads. The reader sees the regional
  // footprint first, then the country-level concentration. This is
  // deliberately different from a "Pakistan dominates" lede, which
  // under-reads the cycle even when Pakistan is the largest single
  // bucket.
  const spread = subregionSpread(countryRows);
  // Name each region once and each leading country once. The old form
  // repeated "(led by X)" after every region, which read as boilerplate
  // when three or four regions were active — an owner-flagged defect.
  // Name the next-busiest countries by VOLUME (same order as the chart),
  // not one leader per sub-region — an owner-flagged defect had Nepal and
  // South Korea ranked above the Philippines in the chart while the headline
  // named Bangladesh, Japan and the Philippines as "busiest elsewhere".
  const otherBusy = countryRows.slice(1, 4).map((r) => r.label);
  const headline = spread.regions.length >= 2
    ? `Activity this week is spread across ${joinList(spread.regions)}. ${lead.label} recorded the most events${otherBusy.length > 0 ? `, followed by ${joinList(otherBusy)}` : ""}. The incidents are separate and driven by different local issues rather than a shared regional campaign, so businesses with a presence in several APAC capitals should plan around each country's own protest calendar rather than a single regional trend.`
    : `This week activity centres on ${lead.label}, with the wider APAC region quieter than usual. Treat that as a feature of a quiet week rather than a lasting shift.`;
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
  // Turn a raw issue LABEL into a grammatical driver phrase. The labels are
  // singular display strings ("Protest", "Other operational incident"), so a
  // bare lower-cased join produced ungrammatical output ("driven by protest
  // alongside other operational incident") — a client-flagged defect. Map the
  // known labels to natural phrases and fall back to "<label> activity".
  const issuePhrase = (label: string): string => {
    const l = label.toLowerCase();
    const MAP: Record<string, string> = {
      "protest": "protest activity",
      "strike / labour action": "strike and labour action",
      "student activism": "student activism",
      "crackdown": "police crackdowns",
      "curfew / emergency order": "curfew and emergency orders",
      "roadblock / access disruption": "roadblocks and access disruption",
      "riot / clash": "riots and clashes",
      "other operational incident": "other operational incidents",
    };
    if (MAP[l]) return MAP[l];
    return /activity|action|unrest|incidents$/.test(l) ? l : `${l} activity`;
  };
  const driverFor = (rows: EnrichedIncident[]): string => {
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.issue, (counts.get(r.issue) ?? 0) + 1);
    const ranked = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    if (ranked.length === 0) return "a mix of protest and civil-unrest activity";
    if (ranked.length === 1) return issuePhrase(ranked[0][0]);
    return `${issuePhrase(ranked[0][0])} and ${issuePhrase(ranked[1][0])}`;
  };
  // Describe the mix using ONLY what this country's own records show — the
  // activism/unrest split actually present, not a template forecast.
  const formFor = (rows: EnrichedIncident[]): string => {
    const a = rows.filter((r) => r.bucket === "activism").length;
    const u = rows.filter((r) => r.bucket === "unrest").length;
    if (a > 0 && u > 0) return "a mix of protests and civil unrest";
    if (u > a) return "civil unrest and enforcement";
    return "protests and organised action";
  };
  // Pull the LOCATIONS actually named in this country's own records rather
  // than asserting generic districts. Only report places that appear in the
  // incident set; if none are named, say so plainly instead of inventing them.
  const lociFor = (rows: EnrichedIncident[], country: string): string => {
    const seen: string[] = [];
    const seenLower = new Set<string>();
    for (const r of rows) {
      const loc = (r.location ?? "").trim();
      if (!loc) continue;
      // Strictly this country's own places: a mis-attributed record can
      // carry a foreign city (e.g. Kathmandu on an India-labelled row) —
      // never list it under this country's heading.
      if (locationForeignToCountry(loc, country)) continue;
      const key = loc.toLowerCase();
      if (seenLower.has(key)) continue;
      seenLower.add(key);
      seen.push(loc);
      if (seen.length >= 3) break;
    }
    if (seen.length === 0) return "";
    return joinList(seen);
  };
  const topThree = countryRows.slice(0, 3);
  const RANK_LABEL = ["The busiest country", "The second-busiest country", "The third-busiest country"];
  const countryParas: string[] = [];
  topThree.forEach((cr, idx) => {
    const rows = byCountry.get(cr.label) ?? [];
    if (rows.length === 0) return;
    const n = rows.length;
    const countLabel = `${n} incident${n === 1 ? "" : "s"}`;
    const loci = lociFor(rows, cr.label);
    const lociClause = loci ? ` Locations named in the records: ${loci}.` : "";
    countryParas.push(
      `${cr.label} — ${RANK_LABEL[idx] ?? "A leading country"} this week (${countLabel}), driven by ${driverFor(rows)}, mostly ${formFor(rows)}.${lociClause}`,
    );
  });
  const reach = countryRows.length > 3
    ? `Other APAC countries saw less activity this week and appear in the country chart above.`
    : `Full breakdown in the chart above.`;
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
  const ACTION_RE = /\b(protest(?:s|ers?|ing)?|demonstrat(?:ion|ions|ors?)|rall(?:y|ies)|march(?:es)?|sit[- ]?ins?|strikes?|walkouts?|stoppages?|shutdowns?|riots?|crackdowns?|curfews?|tear[- ]?gas|water cannon|baton|arrest(?:s|ed)?|detentions?|roadblocks?|blockades?|section\s*144|assembly ban|clash|fatalit)\b/i;
  const candidates = rows
    .filter((r) => r.bucket === "activism" || r.bucket === "unrest")
    .filter((r) => !isLowCredibility(r) && !isWeakNovelty(r))
    .filter((r) => POLITICAL_MOBILISATION_RE.test(`${r.title ?? ""} ${r.summary ?? ""}`))
    .filter((r) => ACTION_RE.test(`${r.title ?? ""} ${r.summary ?? ""}`));
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) =>
    compareIncidentSignificance(
      { severity: a.severity, title: a.title, summary: a.summary, occurredAt: a.occurredAt },
      { severity: b.severity, title: b.title, summary: b.summary, occurredAt: b.occurredAt },
    ),
  )[0];
}

function prioritiseRelated(
  rows: EnrichedIncident[],
  excludeIds: Set<string | number> = new Set(),
): EnrichedIncident[] {
  // Hard-exclude armed-conflict / crime / robbery, novelty/parody and
  // weak-operational items. Then rank what remains by operational
  // usefulness (severity > action verbs > credibility > recency) and
  // round-robin across countries so the table reflects the regional
  // spread of the file rather than a Pakistan-only lead.
  const ACTION_RE = /\b(protest(?:s|ers?|ing)?|demonstrat(?:ion|ions|ors?)|rall(?:y|ies)|march(?:es)?|sit[- ]?ins?|strikes?|walkouts?|stoppages?|shutdowns?|riots?|crackdowns?|curfews?|tear[- ]?gas|water cannon|baton|arrest(?:s|ed)?|detentions?|roadblocks?|blockades?|section\s*144|assembly ban|clash|fatalit)\b/i;
  const eligible = rows.filter((r) => {
    if (excludeIds.has(r.id)) return false;
    if (r.issue === "Armed robbery" || r.issue === "Crime / public safety" || r.issue === "Armed group activity") return false;
    if (isWeakNovelty(r)) return false;
    if (isWeakOperational(r)) return false;
    return r.bucket === "activism" || r.bucket === "unrest";
  });
  const score = (r: EnrichedIncident): number => {
    const significance = aggregateIncidentSignificance([
      { severity: r.severity, title: r.title, summary: r.summary, occurredAt: r.occurredAt },
    ]);
    const action = ACTION_RE.test(`${r.title ?? ""} ${r.summary ?? ""}`) ? 1 : 0;
    const cred = isLowCredibility(r) ? 0 : 1;
    return significance + action * 50 + cred * 10;
  };
  const ranked = dedupeByTitle([...eligible].sort((a, b) => {
    const ds = score(b) - score(a);
    if (ds !== 0) return ds;
    return b.date.getTime() - a.date.getTime();
  }));
  const CAP = FLASHPOINT_RELATED_ROW_CAP;
  // Seed the lead row with the strongest political-mobilisation record
  // so the centre-of-gravity geography opens the table.
  const politicalSeed = pickPoliticalSeed(rows.filter((r) => !excludeIds.has(r.id)));
  const out: EnrichedIncident[] = [];
  const taken = new Set<string | number>();
  if (politicalSeed && !isWeakOperational(politicalSeed)) {
    out.push(politicalSeed);
    taken.add(politicalSeed.id);
  }
  // First pass: pick the single best record per country (round-robin)
  // walking down the ranked list. This forces regional diversity —
  // Bangladesh, Philippines, South Korea, India, etc. all get a seat
  // before any country gets a second.
  const seenCountry = new Set<string>();
  if (politicalSeed) seenCountry.add((politicalSeed.country ?? "").trim().toLowerCase());
  for (const r of ranked) {
    if (out.length >= CAP) break;
    if (taken.has(r.id)) continue;
    const c = (r.country ?? "").trim().toLowerCase();
    if (c && seenCountry.has(c)) continue;
    out.push(r);
    taken.add(r.id);
    if (c) seenCountry.add(c);
  }
  // Second pass: fill any remaining slots from the global ranking
  // regardless of country, so a strong second Pakistan record can still
  // appear after every country has had one seat.
  for (const r of ranked) {
    if (out.length >= CAP) break;
    if (taken.has(r.id)) continue;
    out.push(r);
    taken.add(r.id);
  }
  // Guarantee the top-severity qualifying record is present so Fast
  // Facts (Highest Severity) and Related Incidents cannot contradict.
  const top = eligible.reduce<EnrichedIncident | null>((best, r) => {
    if (!best) return r;
    return compareIncidentSignificance(
      { severity: r.severity, title: r.title, summary: r.summary, occurredAt: r.occurredAt },
      { severity: best.severity, title: best.title, summary: best.summary, occurredAt: best.occurredAt },
    ) < 0
      ? r
      : best;
  }, null);
  const finalRows =
    top && !out.some((r) => r.id === top.id)
      ? [out[0], top, ...out.slice(1).filter((r) => r.id !== top.id)].slice(0, CAP)
      : out.slice(0, CAP);
  // Render-ready summaries: strip scraped wire boilerplate ("The post X
  // appeared first on OnlineKhabar", "[…] Read more") so raw article cruft
  // never reaches the client (owner-flagged defect).
  return finalRows.map((r) => ({ ...r, summary: cleanRelatedSummary(r.summary) }));
}

// Strip wire/CMS boilerplate from a scraped summary and cap it at a clean
// sentence boundary. Never fabricates — only removes cruft.
function cleanRelatedSummary(s: string | null | undefined): string | null {
  if (!s) return s ?? null;
  let t = s.replace(/\s+/g, " ").trim();
  t = t.replace(/\[\s*(…|\.\.\.)\s*\]/g, " ").trim();
  t = t.replace(/\bThe post .{0,120}?appeared first on .{0,80}$/i, "").trim();
  t = t.replace(/\b(Read (the )?(full (story|article)|more)|Continue reading|Click here to read).{0,80}$/i, "").trim();
  t = t.replace(/\s+/g, " ").trim();
  if (t.length > 320) {
    const cut = t.slice(0, 320);
    const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
    if (end > 120) {
      t = cut.slice(0, end + 1);
    } else {
      const lastSpace = cut.lastIndexOf(" ");
      t = lastSpace > 80 ? `${cut.slice(0, lastSpace)}…` : `${cut.trim()}…`;
    }
  }
  return t || null;
}

interface AutoCtx {
  activismRows: EnrichedIncident[];
  unrestRows: EnrichedIncident[];
  countryRows: BarRow[];
  enriched: EnrichedIncident[];
  /** Full usable set before period-date filtering — feeds forecast / Watch Next. */
  usableEnriched: EnrichedIncident[];
  // The one shared top-severity incident (computed over the full usable set
  // in buildFlashpointReportDataset). Every "most serious" reference in the
  // prose MUST use this — never recompute over a subset — so the narrative
  // always matches the Fast Facts Highest Severity card.
  topSeverity: EnrichedIncident | null;
  // Report window end (issue date). Forward-looking sections use it to drop
  // explicitly-dated announcements that have already passed.
  windowEnd: Date;
}

// Overall week posture — uses the approved five-tier severity vocabulary
// (Insignificant / Low / Moderate / High / Extreme), distinct from the peak
// incident severity shown on the Fast Facts card. Contained prison unrest
// does not elevate the whole-week posture to High on its own.
function overallPostureLabel(ctx: {
  activismRows: EnrichedIncident[];
  unrestRows: EnrichedIncident[];
}): string {
  const all = [...ctx.activismRows, ...ctx.unrestRows];
  if (all.length === 0) return "Low";
  const highStreet = all.filter((r) => {
    if ((SEV_RANK[sevKey(r.severity)] ?? 0) < 4) return false;
    return !containedVenueNote(r);
  }).length;
  const moderateCount = all.filter((r) => (SEV_RANK[sevKey(r.severity)] ?? 0) === 3).length;
  const hasEnforcement = hasEnforcementSignal(all);
  if (highStreet >= 2 || (highStreet >= 1 && hasEnforcement && moderateCount >= 4)) return "High";
  if (highStreet >= 1 || hasEnforcement || moderateCount >= 3 || all.length >= 12) return "Moderate";
  return "Low";
}

function sortBySignificance(rows: EnrichedIncident[]): EnrichedIncident[] {
  return [...rows].sort((a, b) =>
    compareIncidentSignificance(
      { severity: a.severity, title: a.title, summary: a.summary, occurredAt: a.occurredAt },
      { severity: b.severity, title: b.title, summary: b.summary, occurredAt: b.occurredAt },
    ),
  );
}

function extractCityLabel(r: EnrichedIncident): string {
  const loc = (r.location ?? "").trim();
  if (loc) return loc.split(/[,;]/)[0].trim();
  const t = r.title ?? "";
  const m = t.match(/\b(?:in|at|near)\s+([A-Z][A-Za-z'(). -]{2,40})\b/);
  return m?.[1]?.trim() ?? "";
}

/** One operational What Matters paragraph keyed off a specific incident. */
function whatMattersParagraphFor(r: EnrichedIncident): string | null {
  const text = `${r.title ?? ""} ${r.summary ?? ""}`;
  const country = (r.country ?? "").trim();
  if (/\b(pakistan|transporter|goods transport)\b/i.test(text) && /\bstrike\b/i.test(text)) {
    return `In Pakistan, the transporters' strike has direct implications for freight timing, deliveries and onward distribution.`;
  }
  if (/\b(yongsan|metro|subway)\b/i.test(text)) {
    return `In South Korea, the skipped stop at Yongsan shows that even limited protests can create short-notice public-transport changes in central Seoul.`;
  }
  if (/\bincheon\b/i.test(text) && /\b(airport|protest|labou?r)\b/i.test(text)) {
    return `Protest activity at Incheon Airport raises the chance of access friction around a critical transport hub.`;
  }
  if (/\bhyundai\b/i.test(text) && /\bstrike\b/i.test(text)) {
    return `The Hyundai partial strike adds industrial pressure, even though the reporting does not specify wider public disorder around production sites.`;
  }
  if (/\b(tear gas|baton)\b/i.test(text) && /\b(india|jharkhand)\b/i.test(text)) {
    return `In India, the Jharkhand protests matter because police dispersal raised the chance of sudden road disruption and access constraints around protest sites.`;
  }
  if (/\bkarnataka\b/i.test(text) && /\b(shutdown|strike|protest)\b/i.test(text)) {
    const dateM = text.match(/\b(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec))\b/i);
    return `The planned Karnataka shutdown adds a separate risk of day-long movement restrictions${dateM ? ` on ${dateM[1]}` : ""}.`;
  }
  if (
    (country === "New Zealand" || /\b(auckland|wellington|christchurch)\b/i.test(text)) &&
    /\b(protest|march|rally|demonstration)\b/i.test(text)
  ) {
    return `New Zealand's reported events were Low severity and largely planned, but demonstrations in central Wellington, Auckland and Christchurch can still affect traffic, venue access and staff movement in the immediate area at set times.`;
  }
  if (containedVenueNote(r) && (SEV_RANK[sevKey(r.severity)] ?? 0) >= 3) {
    const c = country || "the reported country";
    return `The ${c} prison riot was ${SEV_LABEL[sevKey(r.severity)] ?? "High"} severity because of the deaths and injuries reported, but the operational meaning is different from a street protest. The immediate concern there is not broad public disorder but the potential for heightened security controls or official sensitivity around prison-related developments.`;
  }
  const city = extractCityLabel(r);
  if ((SEV_RANK[sevKey(r.severity)] ?? 0) >= 3 && (country || city)) {
    const where = city && country ? `${city}, ${country}` : country || city;
    return `${shortSignalLabel(r)} in ${where} (${SEV_LABEL[sevKey(r.severity)] ?? "High"} severity) is among the operational items to track for access and movement impacts.`;
  }
  return null;
}

function extractNamedHubs(all: EnrichedIncident[], enriched: EnrichedIncident[]): string[] {
  const hubs = new Set<string>();
  const scan = [...all, ...extractFutureSignals(enriched)];
  for (const r of scan) {
    const text = `${r.title ?? ""} ${r.summary ?? ""} ${r.location ?? ""}`;
    if (/\bincheon\b/i.test(text) && /\bairport\b/i.test(text)) hubs.add("Incheon Airport");
    if (/\bauckland\b/i.test(text)) hubs.add("central Auckland");
    if (/\bchristchurch\b/i.test(text)) hubs.add("Christchurch");
    if (/\bwellington\b/i.test(text)) hubs.add("Wellington");
    if (/\bseoul\b/i.test(text)) hubs.add("Seoul");
    if (/\btokyo\b/i.test(text)) hubs.add("Tokyo");
    if (/\b(campus|university)\b/i.test(text)) {
      const city = extractCityLabel(r);
      if (city) hubs.add(city);
    }
  }
  return [...hubs];
}

function buildWhatMatters(ctx: AutoCtx): string {
  const all = [...ctx.activismRows, ...ctx.unrestRows];
  if (all.length === 0) {
    return `What stands out this week is the absence of fresh protest and civil-unrest activity rather than any single event. Treat that as a single quiet reporting period rather than a lasting easing.`;
  }
  const text = (r: EnrichedIncident) => `${r.title ?? ""} ${r.summary ?? ""}`;
  const hasStrike = all.some((r) => /\b(strike|walkout|transport|transporter)\b/i.test(text(r)));
  const hasEnforcement = hasEnforcementSignal(all);
  const lines: string[] = [];
  lines.push(
    hasStrike && hasEnforcement
      ? `The practical risk this week was disruption to movement rather than sustained unrest.`
      : hasEnforcement
        ? `The practical risk this week was enforcement-driven access disruption rather than sustained unrest.`
        : `The practical risk this week was localised protest activity rather than a regional campaign.`,
  );
  const seen = new Set<string>();
  for (const r of sortBySignificance(all)) {
    const para = whatMattersParagraphFor(r);
    if (!para || seen.has(para)) continue;
    seen.add(para);
    lines.push(para);
    if (lines.length >= 5) break;
  }
  const hubs = extractNamedHubs(all, ctx.enriched);
  if (hubs.length > 0) {
    lines.push(
      `Airport, campus and city-centre locations need closer attention where demonstrations are scheduled. ${joinList(hubs)} all feature in either active or imminent protest reporting.`,
    );
  }
  return lines.join("\n\n");
}

function buildImplications(ctx: AutoCtx): string {
  const all = [...ctx.activismRows, ...ctx.unrestRows];
  const topCountries = ctx.countryRows.slice(0, 3).map((r) => r.label);
  const text = (r: EnrichedIncident) => `${r.title ?? ""} ${r.summary ?? ""}`;
  const bullets: string[] = [];

  if (all.some((r) => (r.country ?? "").includes("Pakistan") && /\b(transporter|transport|strike|freight|supply)\b/i.test(text(r)))) {
    bullets.push(`Review freight and delivery schedules linked to Pakistan for delay risk.`);
  }
  if (all.some((r) => /\b(tear gas|baton|youth protest|jharkhand)\b/i.test(text(r)))) {
    bullets.push(`Avoid non-essential movements near protest sites in Jharkhand and during any rapid police action.`);
  }
  const karnataka = all.find((r) => /\bkarnataka\b/i.test(text(r)));
  if (karnataka) {
    const dateM = text(karnataka).match(/\b(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December|Aug))\b/i);
    bullets.push(`Reconfirm movement plans in Karnataka for the ${dateM?.[1] ?? "scheduled"} shutdown period.`);
  }
  if (all.some((r) => /\b(yongsan|seoul metro|metro skip)\b/i.test(text(r)))) {
    bullets.push(`Check Seoul Metro service changes around central protest locations, including Yongsan.`);
  }
  if (all.some((r) => /\bincheon\b/i.test(text(r)) && /\b(airport|protest|labou?r)\b/i.test(text(r)))) {
    bullets.push(`Confirm access arrangements at Incheon Airport during any follow-on advocacy activity.`);
  }
  const nzCities = new Set<string>();
  for (const r of all) {
    if ((r.country ?? "") !== "New Zealand" && !/\b(auckland|wellington|christchurch)\b/i.test(text(r))) continue;
    for (const c of ["Auckland", "Christchurch", "Wellington"]) {
      if (new RegExp(`\\b${c}\\b`, "i").test(text(r))) nzCities.add(c);
    }
  }
  if (nzCities.size > 0) {
    bullets.push(`Update travel plans in ${joinList([...nzCities])} around scheduled demonstrations.`);
  }
  if (all.some((r) => (r.country ?? "").includes("Philippines") && /\b(strike|transport)\b/i.test(text(r)))) {
    bullets.push(`Verify local transport availability in the Philippines during strike-related service disruption.`);
  }
  if (all.some((r) => containedVenueNote(r))) {
    const contained = all.find((r) => containedVenueNote(r));
    const c = (contained?.country ?? "").trim() || "the affected country";
    bullets.push(`Monitor official security measures in ${c} without treating prison unrest as wider street disorder.`);
  }

  const hasCurfew = all.some((r) => /\b(curfew|section\s*144|assembly ban|lockdown|state of emergency|martial law)\b/i.test(text(r)));
  if (hasCurfew) {
    bullets.push(`Curfew or emergency orders appear in this week's records: treat any fresh order in a city of operation as a trigger to review site access and staff movement for the day.`);
  }
  const campusLoci: string[] = [];
  const campusSeen = new Set<string>();
  for (const r of all) {
    if (!/\b(student|university|campus|college|faculty)\b/i.test(text(r))) continue;
    const loc = (r.location ?? "").trim() || extractCityLabel(r);
    if (!loc) continue;
    const country = (r.country ?? "").trim();
    if (country && locationForeignToCountry(loc, country)) continue;
    const key = loc.toLowerCase();
    if (campusSeen.has(key)) continue;
    campusSeen.add(key);
    campusLoci.push(loc);
    if (campusLoci.length >= 3) break;
  }
  if (campusLoci.length > 0) {
    bullets.push(`Student or campus activity appears in this week's records: brief sites near ${joinList(campusLoci)} on possible knock-on disruption.`);
  }

  if (bullets.length < 3 && topCountries.length > 0) {
    bullets.push(`Review staff movement and journey plans in ${joinList(topCountries)} against the incidents reported this week.`);
    bullets.push(`Confirm alternative routes for staff and deliveries around the locations named in this week's records.`);
  }
  if (bullets.length === 0) {
    bullets.push(`Keep staff and customer communications ready so updates can go out quickly on a disrupted day.`);
  }
  return bullets.slice(0, 7).map((b) => `- ${b}`).join("\n");
}

// Build Watch Next from actual future-looking signals in the file
// rather than generic risk-flag boilerplate. If no future-dated items
// are present, say so plainly and fall back to indicator vocabulary
// keyed off the current cycle's enforcement signals.
function buildWatchNextFromSignals(ctx: AutoCtx): string {
  const all = [...ctx.activismRows, ...ctx.unrestRows];
  // Same passed-date gate as the forecast table: an announcement explicitly
  // dated on/before the issue date has already happened and must not be
  // listed as "upcoming" here while the forecast table (correctly) drops it.
  const futureRaw = extractFutureSignals(ctx.usableEnriched)
    .filter((r) => !isLowCredibility(r) && !isWeakNovelty(r))
    .filter((r) => !forecastDateHasPassed(r, ctx.windowEnd));
  // Collapse (country, signal) duplicates so the same operational
  // signal cannot appear twice (e.g. two South Korea records both
  // reducing to "Union injunction ruling — sectoral strike risk").
  // Mirrors the forecast-table dedupe used in buildFlashpointReportDataset.
  const seen = new Set<string>();
  const future: typeof futureRaw = [];
  for (const r of futureRaw) {
    const country = (r.country ?? "").trim() || "—";
    const signal = shortSignalLabel(r);
    const key = `${country.toLowerCase()}|${signal.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    future.push(r);
    if (future.length >= 6) break;
  }
  // Watch Next leads with any confirmed future-dated signals, then ALWAYS
  // tops up with cycle-specific and standing operational triggers so the
  // section is never a single thin line when only one future item exists
  // (the previous behaviour, which the client flagged as weak).
  const lead = ctx.countryRows[0];
  // The ONE shared top-severity incident — same object the Fast Facts card
  // and Exec Summary use, never recomputed over a subset.
  const sevInc = ctx.topSeverity;
  const sevCountry = (sevInc?.country ?? "").trim();
  const sevElevated = (SEV_RANK[sevKey(sevInc?.severity)] ?? 0) >= 3;

  // Watch Next lists only NAMED, dated or specifically-reported items — the
  // confirmed future-dated signals in the file, plus follow-through on the
  // single most serious incident actually reported. No generic standing
  // triggers or invented windows: if nothing is scheduled, the section says so.
  void lead;
  const bullets: string[] = [];
  for (const r of future) {
    const where = r.country ? `${r.country} — ` : "";
    const stated = explicitForecastDate(r);
    // Align with the forecast table: dated announcements are schedule items;
    // dateless ones stay monitor-only.
    const status = stated ? "upcoming, date confirmed" : "upcoming, unconfirmed";
    bullets.push(`${where}${shortSignalLabel(r)}: ${status} — ${operationalMeaningFor(r)}`);
  }
  // Never describe a forecast/announcement item as "the most serious
  // incident reported this week" — the follow-through line only fires when
  // the top-severity record is an incident that has actually occurred, not
  // one of the future-dated signals above.
  // The suppression universe must match the universe topSeverity was
  // computed over (full enriched set), not just the activism/unrest subset.
  const futureSignalIds = new Set(extractFutureSignals(ctx.enriched).map((r) => r.id));
  if (sevInc && sevCountry && sevElevated && !futureSignalIds.has(sevInc.id)) {
    bullets.push(
      `${sevCountry} — follow-through after ${shortSignalLabel(sevInc)}, the most serious incident reported this week: watch for further developments in the days that follow.`,
    );
  }
  // De-dupe on the leading clause so a future signal and the severity
  // follow-through about the same country/theme do not both appear.
  const out: string[] = [];
  const seenLine = new Set<string>();
  for (const b of bullets) {
    const k = b.slice(0, 40).toLowerCase();
    if (seenLine.has(k)) continue;
    seenLine.add(k);
    out.push(b);
    if (out.length >= 6) break;
  }
  if (out.length === 0) {
    return `No confirmed upcoming protest calls, strike notices or scheduled hearings were reported this week. There are no dated items to plan around; keep monitoring for fresh announcements.`;
  }
  return out.map((b) => `- ${b}`).join("\n");
}



// Some serious incidents happen inside a closed facility (a prison riot, a
// detention-centre clash). Rule: keep contained incidents in context — a
// serious event inside a prison is not evidence of wider public disorder and
// must never be written up as a broader threat to business operations.
function containedVenueNote(r: EnrichedIncident): string | null {
  const t = `${r.title ?? ""} ${r.summary ?? ""}`;
  // A rally OUTSIDE a jail (e.g. outside Adiala) is street protest, not a
  // contained event — never hedge those.
  if (/\b(outside|near|in front of|at the gates?)\b[^.]{0,30}\b(prison|jail|detention)/i.test(t)) return null;
  // Require an explicit in-facility unrest cue, not just the facility noun:
  // "prison riot", "jail unrest", "inmates clash" — not transfers, court
  // items or policy stories that merely mention a prison.
  const inFacility =
    /\b(prison|jail|detention centre|detention center|correctional|remand)s?\b[^.]{0,25}\b(riot|riots|unrest|mutiny|clash|clashes|uprising|violence)\b/i.test(t) ||
    /\b(riot|riots|unrest|mutiny|uprising)\b[^.]{0,25}\b(prison|jail|inmate)/i.test(t) ||
    /\binmates?\b[^.]{0,30}\b(riot|clash|killed|dead|injured)\b/i.test(t);
  if (inFacility) {
    return `This happened inside a prison rather than on the streets, so it does not point to wider public disorder or a broader risk to business operations.`;
  }
  return null;
}

function buildPolestarView(ctx: AutoCtx): string {
  const all = [...ctx.activismRows, ...ctx.unrestRows];
  const posture = overallPostureLabel(ctx);
  const activeCountries = ctx.countryRows.slice(0, 6).map((r) => r.label);
  const countryLine =
    activeCountries.length > 0
      ? joinList(activeCountries)
      : "the affected APAC cities named in this week's records";

  const text = (r: EnrichedIncident) => `${r.title ?? ""} ${r.summary ?? ""}`;
  const hasPakistanStrike = all.some(
    (r) => (r.country ?? "").includes("Pakistan") && /\b(strike|transporter|transport)\b/i.test(text(r)),
  );
  const others = activeCountries.filter((c) => c !== "Pakistan");
  const disruptionLead = hasPakistanStrike
    ? others.length > 0
      ? `strike action affects transport networks or supply movement, especially in Pakistan, and around live or scheduled protest locations in ${joinList(others)}`
      : `strike action affects transport networks or supply movement, especially in Pakistan`
    : `gatherings and transport disruption affect staff routes in ${countryLine}`;

  return [
    `Risk level: ${posture}.`,
    `Disruption is most likely where ${disruptionLead}. The most useful immediate step is to keep movement plans flexible, validate transport availability close to departure, and track scheduled protest dates and routes closely rather than treating the window as one of broad regional unrest.`,
  ].join("\n");
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
  topSeverity: EnrichedIncident | null;
}
function buildAutoExecutiveSummary(ctx: ExecCtx): string {
  const total = ctx.enriched.length;
  const windowLabel = ctx.windowLabel;
  if (total === 0) {
    return `This briefing covers the activism, protest and civil-unrest picture across APAC for ${windowLabel}. Little was reported this week. Treat the quiet as a single reporting period rather than a lasting easing.`;
  }
  const lead = ctx.countryRows[0];
  const spread = subregionSpread(ctx.countryRows);
  const text = (r: EnrichedIncident) => `${r.title ?? ""} ${r.summary ?? ""}`;
  const hs = highestSeverity(ctx.enriched);
  const political = [...ctx.activismRows, ...ctx.unrestRows].some((r) => /\b(pti|imran|tehreek|ttap|opposition|movement|countrywide protest|section\s*144|assembly ban)\b/i.test(text(r)));
  const sectoral = [...ctx.activismRows, ...ctx.unrestRows].some((r) => /\b(chemist|pharmacist|trader|transporter|lawyer|union|chamber|federation|sectoral|samsung)\b/i.test(text(r)));
  const hasEnforcement = hasEnforcementSignal([...ctx.activismRows, ...ctx.unrestRows]);

  const driverBits: string[] = [];
  if (political) driverBits.push("opposition party protests");
  if (sectoral) driverBits.push("union and trade-group action");
  if (hasEnforcement) driverBits.push("police enforcement");
  const driverLine = driverBits.length > 1
    ? `The main drivers are ${joinList(driverBits)}.`
    : driverBits.length === 1
      ? `The main driver is ${driverBits[0]}.`
      : `No single campaign is driving the week's activity.`;

  const geoLine = spread.regions.length >= 2 && lead
    ? `Activity is regional rather than confined to one country: it spans ${joinList(spread.regions)}, with ${lead.label} seeing the most.`
    : lead
      ? `Activity is concentrated in ${lead.label} this week, with the wider APAC region quieter than usual.`
      : `Few events could be tied to a specific country this week — read the picture from the type of activity rather than where it is happening.`;

  const severityLine = hs.key === "high" || hs.key === "extreme"
    ? `The most serious incidents are protest and public-order events, not armed conflict. The main business risk is disruption to staff travel and site access rather than direct violence.`
    : hs.key
      ? `The most serious incidents sit in the low-to-middle range. The main business risk is disruption to staff travel and site access, not physical safety.`
      : `Few incidents carry a severity grade this week, so judge the week by the type of activity reported.`;
  void hs;

  // Sharp operational opener: lead with the judgement, then name the
  // volume lead and the severity lead explicitly (and reconcile them
  // when they diverge) so the summary reads as a decision, not a recap.
  const allRows = [...ctx.activismRows, ...ctx.unrestRows];
  void allRows;
  // The ONE shared top-severity incident — identical to the Fast Facts card.
  const sevInc = ctx.topSeverity;
  const sevCountry = (sevInc?.country ?? "").trim();
  const sevElevated = (SEV_RANK[sevKey(sevInc?.severity)] ?? 0) >= 3;
  const volClause = lead
    ? `${lead.label} sees the most activity`
    : `no single country stands out`;
  // Only name a separate severity lead when it is genuinely elevated
  // (Moderate+) and in a different country; otherwise just report the
  // ceiling. A "highest" that is still Low is not an escalation.
  const tieN = topSeverityTieCount(ctx.enriched, sevInc);
  const sevClause = sevInc && sevCountry && lead && sevCountry !== lead.label && sevElevated
    ? tieN > 1
      ? `, while the most serious incidents — ${tieN} rated ${hs.label} — include ${shortSignalLabel(sevInc)} in ${sevCountry}`
      : `, while the most serious single incident was in ${sevCountry} — ${shortSignalLabel(sevInc)}, rated ${hs.label}`
    : hs.key
      ? tieN > 1
        ? `, with ${tieN} incidents rated ${hs.label} at the top of the range`
        : `, with the most serious incident rated ${hs.label}`
      : ``;
  const opener = `This week ${volClause}${sevClause}. ${driverLine}`;
  const posture = overallPostureLabel(ctx);
  const peakHs = hs.label;
  const postureLine = peakHs && peakHs !== "—" && posture.toLowerCase() !== peakHs.toLowerCase()
    ? `Overall protest posture this week is ${posture}, even though individual incidents reached ${peakHs}.`
    : peakHs && peakHs !== "—"
      ? `Overall protest posture this week is ${posture}, in line with the peak incident rating of ${peakHs}.`
      : `Overall protest posture this week is ${posture}.`;

  const closing = hasEnforcement
    ? `Bottom line: police are already making arrests or breaking up some of these protests, so plan for disruption in the coming week rather than assuming it stays quiet. Detailed activism, civil-unrest, forecast and country sections follow.`
    : `Bottom line: these are organised protests with no police crackdowns reported so far. Detailed activism, civil-unrest, forecast and country sections follow.`;

  return `${opener}\n\n${postureLine} ${geoLine} ${severityLine}\n\n${closing}`;
}

export const FLASHPOINT_SEV_LABEL = SEV_LABEL;

// --- Dataset self-validation -------------------------------------------------
// Structural consistency checks over a built dataset. Returns a list of
// human-readable errors (empty = valid). Exercised by the jest suite so a
// regression in any of the invariants below fails CI instead of shipping:
//   1. The Fast Facts "Highest Severity" card equals the severity of the
//      single top-severity incident in the usable set (the same incident the
//      prose references as "the most serious").
//   2. Per-country location lists never name a known city that belongs to a
//      different country.
//   3. Related Incidents never repeats a row already surfaced in the rendered
//      Activism / Civil Unrest tables.
// Abstract analyst-speak the client has explicitly banned from Flashpoint
// prose (Aug 2026). Checked over every auto-generated section by
// validateFlashpointReportDataset, and mirrored as instructions in the AI
// prose prompt (api-server reportProse.ts). Keep the two lists aligned.
export const FLASHPOINT_BANNED_PROSE_RE: RegExp[] = [
  /\bthe week reads as\b/i,
  /\b(record|picture|period|window|activity) reads as\b/i,
  /\breads this period as\b/i,
  /\bpractical weight\b/i,
  /\bpicture is led by\b/i,
  /\bactivity is being driven by\b/i,
  /\breadings sit side by side\b/i,
  /\bon the reported record\b/i,
  /\bweighted towards\b/i,
  /\boperating posture\b/i,
  /\bthe sharper case\b/i,
  /\bareas the business uses\b/i,
  /\bsectoral chamber\b/i,
  /\bnamed opposition mobilisation\b/i,
  /\bvisible state enforcement\b/i,
  /\bvenue-access friction\b/i,
  /\bexposure is spread\b/i,
  /\bcarries the most events\b/i,
  /\bon the record alongside\b/i,
  /\bis being shaped by\b/i,
  /\btopic-signature dedupe\b/i,
  /\bbackground organising\b/i,
  /\brisk level is elevated\b/i,
  /\bthe risk level is elevated\b/i,
];

export function validateFlashpointReportDataset(ds: FlashpointReportDataset): string[] {
  const errors: string[] = [];

  // 1. Fast Facts severity == actual highest severity in the usable set.
  const card = ds.fastFacts.find((k) => k.label === "Highest Severity");
  const top = topSeverityIncident(ds.enriched);
  const expected = top ? (SEV_LABEL[sevKey(top.severity)] ?? top.severity) : "—";
  if (card && card.value !== expected) {
    errors.push(
      `Fast Facts severity "${card.value}" != actual highest "${expected}"`,
    );
  }

  // 1b. Most Affected Country must match the volume leader on the chart.
  const countryCard = ds.fastFacts.find((k) => k.label === "Most Affected Country");
  const chartLead = ds.countryRows[0]?.label;
  if (countryCard && chartLead && countryCard.value !== chartLead) {
    errors.push(
      `Fast Facts country "${countryCard.value}" != chart leader "${chartLead}"`,
    );
  }

  // 2. No foreign city under another country's heading in the regional read.
  const countries = new Set<string>();
  for (const r of ds.enriched) {
    const c = (r.country ?? "").trim();
    if (c) countries.add(c);
  }
  for (const country of countries) {
    const para = ds.regionalCountryRead
      .split("\n\n")
      .find((p) => p.startsWith(`${country} —`));
    if (!para) continue;
    const m = para.match(/Locations named in the records: (.+?)\.$/);
    if (!m) continue;
    const listed = m[1].split(/,\s*|\s+and\s+/).map((s) => s.trim()).filter(Boolean);
    const bad = listed.filter((loc) => locationForeignToCountry(loc, country));
    if (bad.length > 0) {
      errors.push(
        `${country} location list contains cities not tied to that country: ${bad.join(", ")}`,
      );
    }
  }

  // 3. Related Incidents must not repeat rows already shown in the tables.
  const shown = new Set<string | number>(
    [
      ...ds.activismRows.slice(0, FLASHPOINT_TABLE_ROW_CAP),
      ...ds.unrestRows.slice(0, FLASHPOINT_TABLE_ROW_CAP),
    ].map((r) => r.id),
  );
  const dupes = ds.relatedIncidents.filter((r) => shown.has(r.id));
  if (dupes.length > 0) {
    errors.push(
      `Related Incidents repeats already-shown incidents: ${dupes.map((r) => r.id).join(", ")}`,
    );
  }

  // 4. Prose quality gate. Client-mandated (Aug 2026): no abstract
  //    analyst-speak, no article headlines pasted into sentences, no
  //    paragraph duplicated across sections.
  const proseSections: Array<[string, string]> = [
    ["Executive Summary", ds.autoExecutiveSummary],
    ["Activism read", ds.activismRead],
    ["Civil Unrest read", ds.civilUnrestRead],
    ["Forecast read", ds.forecastRead],
    ["Regional/Country read", ds.regionalCountryRead],
    ["What Matters", ds.autoWhatMatters],
    ["Implications", ds.autoImplications],
    ["Watch Next", ds.autoWatchNext],
    ["Polestar View", ds.autoPolestarView],
  ];
  for (const [name, text] of proseSections) {
    for (const re of FLASHPOINT_BANNED_PROSE_RE) {
      const m = text.match(re);
      if (m) errors.push(`${name} contains banned phrasing "${m[0]}"`);
    }
    // A double-quoted span of 25+ chars is almost always a pasted headline.
    const q = text.match(/"([^"]{25,})"/);
    if (q) errors.push(`${name} pastes a quoted headline into prose: "${q[1].slice(0, 60)}..."`);
  }
  // No paragraph may appear verbatim in two different sections.
  const seenPara = new Map<string, string>();
  for (const [name, text] of proseSections) {
    for (const p of text.split("\n\n").map((s) => s.trim()).filter((s) => s.length >= 60)) {
      const priorSection = seenPara.get(p);
      if (priorSection && priorSection !== name) {
        errors.push(`Paragraph duplicated across "${priorSection}" and "${name}": "${p.slice(0, 60)}..."`);
      } else if (!priorSection) {
        seenPara.set(p, name);
      }
    }
  }

  return errors;
}
