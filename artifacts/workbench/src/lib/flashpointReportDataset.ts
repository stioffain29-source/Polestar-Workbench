import { format, parseISO, max as dateMax, differenceInCalendarDays } from "date-fns";
import { resolveReportWindow, filterIncidentsToWindow } from "./reportWindow";
import { isTopicRelevant } from "./topicRelevance";
import { classifyIncidentType } from "./incidentClassifier";
import { stripWireCruft } from "./incidentTitle";
import {
  extractFutureSignals,
  shortSignalLabel,
  forecastMeaningFor,
  operationalMeaningFor,
} from "./upcomingSignals";

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
// Brand five-tier severity ramp — mirrors SEV_COLOR in pdfChrome.ts. Kept
// local so this dataset stays free of the jsPDF/@assets import chain that
// pdfChrome pulls in (which would break the jest/tsx callers of this file).
// If a tier colour changes there, change it here in lockstep.
// A33232 = Extreme only, 1B6B7A = Insignificant only.
const SEV_HEX: Record<string, string> = {
  insignificant: "#1B6B7A", low: "#6FB872", moderate: "#E67E22", high: "#C0392B", extreme: "#A33232",
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

// The single highest-severity incident in a set (ties resolved by first
// seen). Used to separate the SEVERITY lead (escalation ceiling) from
// the VOLUME lead (record count) so the prose can reconcile the two
// instead of letting the country chart and forecast table contradict.
function topSeverityIncident(rows: EnrichedIncident[]): EnrichedIncident | null {
  let best: EnrichedIncident | null = null;
  let rank = 0;
  for (const r of rows) {
    const v = SEV_RANK[sevKey(r.severity)] ?? 0;
    if (v > rank) { rank = v; best = r; }
  }
  return best;
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
];

export function isGenericFlashpointProse(text: string | null | undefined): boolean {
  const t = (text ?? "").toLowerCase();
  if (!t) return false;
  return GENERIC_FLASHPOINT_PROSE.some((sig) => t.includes(sig));
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
  // Peel trailing " - <publisher>" / " | <publisher>" segments. Split on the
  // LAST space-padded ASCII " - " / " | " and treat the tail as a masthead when
  // it is short (<= 6 words); the tail may itself contain hyphens/dots
  // ("Journal-News.com", "bdtonline.com"). Keep a >= 2-word head so a real
  // clause is never consumed. em-dashes (—) are not delimiters here.
  for (let i = 0; i < 5; i++) {
    const m = t.match(/^(.*\S)\s+[-|]\s+(.+)$/);
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
  const sa = SEV_RANK[sevKey(a.severity)] ?? 0;
  const sb = SEV_RANK[sevKey(b.severity)] ?? 0;
  if (sa !== sb) return sa > sb;
  return a.date.getTime() >= b.date.getTime();
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
      if (distinctSubjects(subjects[i], subjects[j])) continue;
      const [small, big] = anchors[i].size <= anchors[j].size
        ? [anchors[i], anchors[j]] : [anchors[j], anchors[i]];
      let shared = 0;
      for (const t of small) {
        if (!big.has(t)) continue;
        if (countryToks[i].has(t) || countryToks[j].has(t)) continue;
        shared++;
      }
      if (shared >= 2) parent[find(i)] = find(j);
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
      // Normalise multi-country strings down to the primary country so
      // combined labels like "Pakistan; India" never reach the chart.
      const country = primaryCountry(r.country);
      // Clean the rendered title (drop publisher masthead + "Watch:" / "VIDEO
      // BY" video cruft). Classification above runs on the ORIGINAL title.
      return { ...r, title: cleanDisplayTitle(r.title), country, date, issue, bucket: bucketFor(issue) };
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
  kineticDropped: number;
  courtDropped: number;
  dedupedDropped: number;
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
      country: primaryCountry(r.country) || "—",
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
  for (const r of enrichedAll) {
    if (isOutOfScopeIssue(r)) reject("out-of-scope-crime", r);
    else enrichedInScope.push(r);
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
  for (const r of enrichedDeduped) {
    if (isWeakNovelty(r)) { reject("weak-novelty", r); continue; }
    if (isWeakOperational(r)) { reject("weak-operational", r); continue; }
    enriched.push(r);
  }

  return {
    enriched,
    kineticDropped,
    courtDropped,
    dedupedDropped: enrichedInScope.length - enrichedDeduped.length,
    weakDropped: enrichedDeduped.length - enriched.length,
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

  const { enriched, kineticDropped, courtDropped, dedupedDropped, weakDropped } =
    selectFlashpointUsable(incidents, topic, issueDate);

  // Bucketed views for the operational reads and tables. `enriched` is
  // already clean, so these are simple bucket splits.
  const activismRows = enriched.filter((r) => r.bucket === "activism");
  const unrestRows = enriched.filter((r) => r.bucket === "unrest");

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
      label: "Incidents In Window",
      value: String(enriched.length),
    },
    {
      label: "Highest Severity",
      value: hs.label,
      severity: hs.key || undefined,
      note: hs.key ? "Highest rating this week" : undefined,
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
    if ((SEV_RANK[k] ?? 0) > (SEV_RANK[countryTopSev.get(c) ?? ""] ?? 0)) {
      countryTopSev.set(c, k);
    }
  }
  const countryRows: BarRow[] = Array.from(countryCount.entries())
    .map(([label, value]) => {
      const sk = countryTopSev.get(label);
      return { label, value, color: (sk && SEV_HEX[sk]) || "#465bff" };
    })
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);

  // --- Reads ---------------------------------------------------------------
  const activismRead = buildActivismRead(activismRows, win.shortLabel, win.end);
  const civilUnrestRead = buildCivilUnrestRead(unrestRows, win.shortLabel, win.end);
  // Forward-looking items rendered as a structured Country / Signal /
  // Operational meaning table rather than a quoted paragraph dump.
  const futureRaw = extractFutureSignals([...activismRows, ...unrestRows])
    .filter((r) => !isLowCredibility(r) && !isWeakNovelty(r) && !isWeakOperational(r));
  // Build forecast rows, then collapse any (country, signal) duplicate
  // so the same operational signal cannot appear twice (e.g. two
  // South Korea records that both reduce to "Union injunction ruling
  // — sectoral strike risk" must render once).
  const seenForecast = new Set<string>();
  const forecastFuture: ForecastFutureRow[] = [];
  for (const r of dedupeByTitle(futureRaw)) {
    const country = r.country?.trim() || "—";
    const signal = shortSignalLabel(r);
    const key = `${country.toLowerCase()}|${signal.toLowerCase()}`;
    if (seenForecast.has(key)) continue;
    seenForecast.add(key);
    forecastFuture.push({ country, signal, meaning: forecastMeaningFor(r) });
    if (forecastFuture.length >= 6) break;
  }
  const forecastRead = buildForecastRead({
    activismRows,
    unrestRows,
    countryRows,
    hasFutureTable: forecastFuture.length > 0,
    forecastLeadCountry: forecastFuture[0]?.country ?? null,
    forecastLeadSignal: forecastFuture[0]?.signal ?? null,
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
    noteParts.push(`${dedupedDropped} syndicated duplicate${dedupedDropped === 1 ? " was" : "s were"} collapsed via two-pass title and topic-signature dedupe.`);
  }
  if (weakDropped > 0) {
    noteParts.push(`${weakDropped} low-signal record${weakDropped === 1 ? " was" : "s were"} excluded — retrospective accountability and legal-aftermath reporting (charge recommendations, probes, arrests over past events), post-event normalisation, sports, defence-procurement, legislative-process and stock-photo items that carry the protest or strike keywords but no live public-order signal.`);
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

function buildActivismRead(rows: EnrichedIncident[], windowLabel: string, windowEnd: Date): string {
  if (rows.length === 0) {
    return `Little protest, strike, student or sit-in activity was reported across ${windowLabel}. Treat the quiet stretch as a gap in reporting rather than a lasting easing: protest activity in these countries tends to come in bursts, with quiet weeks often followed by a sharp escalation around a policy decision or anniversary.\n\nKeep tracking opposition political calendars, union notices, student-body statements and trade groups (chemists, transporters, lawyers, traders) — these are the earliest signs that activity will pick up again rather than stay quiet.`;
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
    ? `Across ${windowLabel} the activism picture is led by "${lead.title}", which falls in the ${SEV_LABEL[sevKey(lead.severity)] ?? lead.severity ?? "moderate"} severity band.`
    : `Across ${windowLabel} no single event stands out, though the underlying organising activity is clearly continuing.`;
  const driverLine = drivers.length > 0
    ? `Activity is being driven by ${joinList(drivers)}.`
    : `Activity is running on steady background organising rather than any single named driver.`;
  const operational = `The locations named in the incidents are mainly city-centre commercial districts, court complexes, party and ministry offices and the main roads nearby. Where protests fall on staff routes or near sites, movement and access are the first things affected.`;
  const stale = stalenessPrefix(rows, windowEnd);
  const body = `${headline}\n\n${driverLine}\n\n${operational}`;
  return stale ? `${stale}\n\n${body}` : body;
}

function buildCivilUnrestRead(rows: EnrichedIncident[], windowLabel: string, windowEnd: Date): string {
  if (rows.length === 0) {
    return `Little riot, clash, crackdown, curfew or security-force activity was reported across ${windowLabel}. A quiet stretch for civil unrest alongside continuing protest activity usually means the authorities have held back from mass arrests or curfew orders — useful, but it can reverse within days if a protest crosses a policy line.\n\nKeep tracking police statements, local government orders, internet-shutdown notices and any move to call in the military. These tend to come ahead of curfews and visible street-level enforcement.`;
  }
  const lead = pickLead(rows);
  const text = (r: EnrichedIncident) => `${r.title ?? ""} ${r.summary ?? ""}`;
  const hasCurfew = rows.some((r) => /\b(curfew|section\s*144|assembly ban|lockdown imposed|state of emergency|martial law)\b/i.test(text(r)));
  const hasCrackdown = rows.some((r) => /\b(crackdown|baton|tear[- ]?gas|water cannon|mass arrest|detention of (protesters|activists|students)|raid on (party|movement|opposition))\b/i.test(text(r)));
  const hasRiotClash = rows.some((r) => /\b(riot|clash|public disorder|looting|stone[- ]?pelt)\b/i.test(text(r)));
  const postureBits: string[] = [];
  if (hasCurfew) postureBits.push("statutory restrictions are already in play");
  if (hasCrackdown) postureBits.push("police have already used force or made arrests at demonstrations");
  if (hasRiotClash) postureBits.push("street-level disorder is on the record");
  const headline = lead
    ? `The civil-unrest picture across ${windowLabel} centres on "${lead.title}", the most significant event reported.`
    : `The civil-unrest picture across ${windowLabel} sits behind the protest activity rather than ahead of it, with no single standout event.`;
  const postureLine = postureBits.length > 0
    ? `How the authorities are responding is the key point in these records: ${joinList(postureBits)}.`
    : `On the reported record the authorities' response reads as measured rather than escalating — no curfews, mass arrests or crackdowns are among the incidents.`;
  const operational = `For businesses, the enforcement steps in the record — crackdowns and any curfew orders — matter more than the raw number of protests, because they mark where staff movement and venue access are most exposed. Where enforcement is concentrated in one city or district, road closures and venue-access restrictions on the day are a realistic possibility to plan for.`;
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
    ? `Confirmed upcoming events are listed in the table above and are the first dates to plan around. The outlook below builds on that schedule.`
    : `No confirmed upcoming protest calls, strike notices or scheduled hearings have been reported. The outlook below is therefore an assessment of likely direction from current activity, not a list of scheduled events.`;
  const activismShare = total > 0 ? activismRows.length / total : 0;
  const unrestShare = total > 0 ? unrestRows.length / total : 0;
  const lines: string[] = [futureBlock];
  if (total === 0) {
    lines.push(`The near-term outlook is for continued quiet, with little fresh protest or civil-unrest activity on the current record. That could change if a named movement announces a fresh protest schedule.`);
    return lines.join("\n\n");
  }
  const allRows = [...activismRows, ...unrestRows];
  const sevInc = topSeverityIncident(allRows);
  const sevHs = highestSeverity(allRows);
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
    lines.push(
      `Two different readings sit side by side here. By volume, ${lead.label} shows the most activity in the window. On severity, the sharper case is ${sevCountry}, where ${shortSignalLabel(sevInc)} was rated ${sevHs.label}${tableClause}. More events is not the same as more serious ones: watch ${lead.label} for the frequency of disruption and ${sevCountry} for its severity.`,
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
      `The window is weighted towards protests and organised action rather than open disorder. Where those gatherings fall on commercial districts or main roads, localised disruption is the realistic exposure to plan for.`,
    );
  } else if (unrestShare >= 0.6) {
    lines.push(
      `The window is weighted towards civil unrest and enforcement rather than fresh organising, which is the more disruptive of the two profiles where it lands on staff routes and sites.`,
    );
  } else {
    lines.push(
      `Protest activity and civil unrest are roughly balanced across the window.`,
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
  const regionList = spread.regions
    .map((r) => {
      const arr = spread.byRegion.get(r) ?? [];
      const top = arr[0];
      return top ? `${r} (led by ${top.label})` : r;
    });
  const headline = spread.regions.length >= 2
    ? `This week activity spans ${joinList(regionList)}. The incidents are separate and driven by different local issues rather than a shared regional campaign; ${lead.label} recorded the most events, but businesses with a presence in several APAC capitals should plan around each country's own protest calendar rather than a single regional trend.`
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
  const lociFor = (rows: EnrichedIncident[]): string => {
    const seen: string[] = [];
    const seenLower = new Set<string>();
    for (const r of rows) {
      const loc = (r.location ?? "").trim();
      if (!loc) continue;
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
    const loci = lociFor(rows);
    const lociClause = loci ? ` Locations named in the records: ${loci}.` : "";
    countryParas.push(
      `${cr.label} — ${RANK_LABEL[idx] ?? "A leading country"} this week (${countLabel}), driven by ${driverFor(rows)}, mostly ${formFor(rows)}.${lociClause}`,
    );
  });
  const reach = countryRows.length > 3
    ? `Other APAC countries saw less activity this week and appear in the country chart below.`
    : `Full breakdown in the chart below.`;
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
  // Hard-exclude armed-conflict / crime / robbery, novelty/parody and
  // weak-operational items. Then rank what remains by operational
  // usefulness (severity > action verbs > credibility > recency) and
  // round-robin across countries so the table reflects the regional
  // spread of the file rather than a Pakistan-only lead.
  const ACTION_RE = /\b(protest|demonstration|rally|march|sit[- ]?in|strike|walkout|stoppage|shutdown|riot|crackdown|curfew|tear[- ]?gas|water cannon|baton|arrest|detention|roadblock|blockade|section\s*144|assembly ban|clash|fatalit)\b/i;
  const eligible = rows.filter((r) => {
    if (r.issue === "Armed robbery" || r.issue === "Crime / public safety" || r.issue === "Armed group activity") return false;
    if (isWeakNovelty(r)) return false;
    if (isWeakOperational(r)) return false;
    return r.bucket === "activism" || r.bucket === "unrest";
  });
  const score = (r: EnrichedIncident): number => {
    const sev = SEV_RANK[sevKey(r.severity)] ?? 0;
    const action = ACTION_RE.test(`${r.title ?? ""} ${r.summary ?? ""}`) ? 1 : 0;
    const cred = isLowCredibility(r) ? 0 : 1;
    return sev * 1000 + action * 50 + cred * 10;
  };
  const ranked = dedupeByTitle([...eligible].sort((a, b) => {
    const ds = score(b) - score(a);
    if (ds !== 0) return ds;
    return b.date.getTime() - a.date.getTime();
  }));
  const CAP = FLASHPOINT_RELATED_ROW_CAP;
  // Seed the lead row with the strongest political-mobilisation record
  // so the centre-of-gravity geography opens the table.
  const politicalSeed = pickPoliticalSeed(rows);
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
    const sb = SEV_RANK[sevKey(best.severity)] ?? 0;
    const sr = SEV_RANK[sevKey(r.severity)] ?? 0;
    return sr > sb ? r : best;
  }, null);
  if (top && !out.some((r) => r.id === top.id)) {
    return [out[0], top, ...out.slice(1).filter((r) => r.id !== top.id)].slice(0, CAP);
  }
  return out.slice(0, CAP);
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
    return `What stands out this week is the absence of fresh protest and civil-unrest activity rather than any single event. Treat that as a single quiet reporting period rather than a lasting easing.`;
  }
  const lines: string[] = [];
  const spread = subregionSpread(ctx.countryRows);
  if (spread.regions.length >= 2 && lead) {
    lines.push(
      `What matters most this week is that activity is spread across ${joinList(spread.regions)} rather than concentrated in a single capital. ${lead.label} carries the most events, but the exposure is spread across several countries.`,
    );
  } else if (lead) {
    lines.push(
      `What matters most this week is how concentrated activity is in ${lead.label}, which carries the bulk of the reported events.`,
    );
  } else {
    lines.push(
      `Activity is spread across the region this week, with no single country standing out.`,
    );
  }
  if (ctx.activismRows.length > 0 && ctx.unrestRows.length > 0) {
    lines.push(
      `Protests and civil unrest appear side by side in the window: organised action alongside enforcement steps on the record.`,
    );
  } else if (ctx.activismRows.length > 0) {
    lines.push(
      `The window leans towards protests and organised action rather than civil unrest; no curfews or crackdowns are among the records.`,
    );
  } else {
    lines.push(
      `The window leans towards civil unrest and enforcement rather than fresh organising.`,
    );
  }
  return lines.join("\n\n");
}

function buildImplications(ctx: AutoCtx): string {
  const lead = ctx.countryRows[0];
  const spread = subregionSpread(ctx.countryRows);
  const where = spread.regions.length >= 2
    ? `${lead ? lead.label : "the busiest area"} and the wider ${joinList(spread.regions)} region`
    : (lead ? lead.label : "the affected areas");
  const text = (r: EnrichedIncident) => `${r.title ?? ""} ${r.summary ?? ""}`;
  const all = [...ctx.activismRows, ...ctx.unrestRows];
  const hasSectoral = all.some((r) => /\b(chemist|pharmacist|trader|transporter|lawyer|union|federation|sectoral|samsung|walkout)\b/i.test(text(r)));
  const hasCurfew = all.some((r) => /\b(curfew|section\s*144|assembly ban|lockdown|state of emergency|martial law)\b/i.test(text(r)));
  const hasCampus = all.some((r) => /\b(student|university|campus|college|faculty)\b/i.test(text(r)));
  const bullets: string[] = [
    `Review staff movement and journey plans across ${where} against the incidents reported this week.`,
    `Confirm alternative routes for staff and deliveries around the locations named in this week's records.`,
    `Keep staff and customer communications ready so updates can go out quickly on a disrupted day.`,
  ];
  if (hasCurfew) {
    bullets.push(`Curfew or emergency orders appear in this week's records: treat any fresh order in a city of operation as a trigger to review site access and staff movement for the day.`);
  }
  if (hasSectoral) {
    bullets.push(`Trade-group or union action appears in this week's records: check whether any named walkout affects your suppliers or distribution and plan around the announced dates.`);
  }
  if (hasCampus) {
    bullets.push(`Student or campus activity appears in this week's records: brief sites near the named campuses on possible knock-on disruption.`);
  }
  return bullets.map((b) => `- ${b}`).join("\n");
}

// Build Watch Next from actual future-looking signals in the file
// rather than generic risk-flag boilerplate. If no future-dated items
// are present, say so plainly and fall back to indicator vocabulary
// keyed off the current cycle's enforcement signals.
function buildWatchNextFromSignals(ctx: AutoCtx): string {
  const all = [...ctx.activismRows, ...ctx.unrestRows];
  const futureRaw = extractFutureSignals(all)
    .filter((r) => !isLowCredibility(r) && !isWeakNovelty(r));
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
  const sevInc = topSeverityIncident(all);
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
    bullets.push(`${where}${shortSignalLabel(r)}: ${operationalMeaningFor(r)}`);
  }
  if (sevInc && sevCountry && sevElevated) {
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



function buildPolestarView(ctx: AutoCtx): string {
  const text = (r: EnrichedIncident) => `${r.title ?? ""} ${r.summary ?? ""}`;
  const sectoral = ctx.activismRows.filter((r) => /\b(chemist|pharmacist|trader|transporter|lawyer|union|chamber|federation|sectoral|samsung)\b/i.test(text(r))).length;
  const student = ctx.activismRows.filter((r) => /\b(student|university|campus|college|faculty)\b/i.test(text(r))).length;
  const named = ctx.activismRows.filter((r) => /\b(pti|imran|tehreek|ttap|opposition|movement)\b/i.test(text(r))).length;
  const hasEnforcement = ctx.unrestRows.some((r) => /\b(curfew|tear[- ]?gas|baton|water cannon|arrest|detention|section\s*144|crackdown|lockdown|martial law)\b/i.test(text(r)));
  const mobVectors = [named > 0, sectoral > 0, student > 0].filter(Boolean).length;

  // Polestar's view is a single directional judgement — a read on the balance
  // of the week, not a repeat of the What Matters, Implications or Watch Next
  // sections. It deliberately stops after the verdict so it does not restate
  // the same disruption points those sections already make.
  let verdict: string;
  if (mobVectors >= 2 && hasEnforcement) {
    verdict = `Polestar's view: several separate organising efforts are running alongside enforcement steps in the records — a mobilised week rather than a quiet one.`;
  } else if (mobVectors >= 2) {
    verdict = `Polestar's view: the picture is broadly mobilised but not escalating on the record. Several organising efforts are active; no visible enforcement is among the incidents.`;
  } else if (hasEnforcement) {
    verdict = `Polestar's view: enforcement is the leading feature of the week, appearing in the records ahead of fresh organising.`;
  } else if (mobVectors >= 1) {
    verdict = `Polestar's view: activity is live but contained — organising under way with no enforcement response on the record.`;
  } else {
    verdict = `Polestar's view: a quiet week on the record rather than a lasting shift.`;
  }

  return verdict;
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
    return `This briefing covers the activism, protest and civil-unrest picture across APAC for ${windowLabel}. Little was reported this week. Treat the quiet as a single reporting period rather than a lasting easing.`;
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
    ? `Activity is being shaped by ${joinList(driverBits)}.`
    : `Activity is running on steady background organising rather than any single named driver.`;

  const geoLine = spread.regions.length >= 2 && lead
    ? `Activity is regional rather than confined to one country: it spans ${joinList(spread.regions)}, with ${lead.label} seeing the most.`
    : lead
      ? `Activity is concentrated in ${lead.label} this week, with the wider APAC region quieter than usual.`
      : `Few events could be tied to a specific country this week — read the picture from the type of activity rather than where it is happening.`;

  const severityLine = hs.key === "high" || hs.key === "extreme"
    ? `The most serious incidents sit toward the upper end of the protest and public-order range rather than the armed-conflict tail (which sits out of scope for Flashpoint), which keeps the focus squarely on protest disruption rather than armed violence.`
    : hs.key
      ? `The most serious incidents sit in the lower-to-middle protest and public-order range, with no armed-conflict reporting (out of scope for Flashpoint). That keeps the focus on disruption rather than direct physical-safety risk.`
      : `Few incidents carry a severity grade this week; read the picture from the type of activity rather than a top-line severity number.`;
  void hs;

  // Sharp operational opener: lead with the judgement, then name the
  // volume lead and the severity lead explicitly (and reconcile them
  // when they diverge) so the summary reads as a decision, not a recap.
  const allRows = [...ctx.activismRows, ...ctx.unrestRows];
  const sevInc = topSeverityIncident(allRows);
  const sevCountry = (sevInc?.country ?? "").trim();
  const sevElevated = (SEV_RANK[sevKey(sevInc?.severity)] ?? 0) >= 3;
  const volClause = lead
    ? `${lead.label} sees the most activity`
    : `no single country stands out`;
  // Only name a separate severity lead when it is genuinely elevated
  // (Moderate+) and in a different country; otherwise just report the
  // ceiling. A "highest" that is still Low is not an escalation.
  const sevClause = sevInc && sevCountry && lead && sevCountry !== lead.label && sevElevated
    ? `, while the sharpest single escalation is in ${sevCountry} — ${shortSignalLabel(sevInc)}, rated ${hs.label}`
    : hs.key
      ? `, with the most serious reaching ${hs.label} on the protest and public-order range`
      : ``;
  const opener = `The week's picture: ${volClause}${sevClause}. ${driverLine}`;

  const closing = hasEnforcement
    ? `Bottom line: enforcement is on the record alongside organising, so the coming period is one to plan around rather than treat as quiet. Detailed activism, civil-unrest, forecast and country sections follow.`
    : `Bottom line: activity is organising-led on the current record, with no enforcement among the incidents. Detailed activism, civil-unrest, forecast and country sections follow.`;

  return `${opener}\n\n${geoLine} ${severityLine}\n\n${closing}`;
}

export const FLASHPOINT_SEV_LABEL = SEV_LABEL;
