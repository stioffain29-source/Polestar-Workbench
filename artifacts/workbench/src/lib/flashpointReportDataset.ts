import { format, parseISO, max as dateMax, differenceInCalendarDays } from "date-fns";
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

function normaliseTitle(s: string): string {
  return stripMasthead(s ?? "")
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

export function dedupeByTitle<T extends { title: string; date: Date; severity: string }>(rows: T[]): T[] {
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
      label: "Records In Window",
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
  void buildWatchNext;
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
    ? `Activity is being driven by ${joinList(drivers)} — several separate organising efforts that are harder for authorities to contain than a single-issue wave and that historically turn into rolling road action within 24-72 hours of an announced date.`
    : `Activity is running on steady background organising rather than any single named driver, which usually points to a quiet stretch rather than a lasting easing.`;
  const operational = `Operationally, the pressure points to watch are city-centre commercial districts, court complexes, party headquarters, ministry quarters and the main intercity arteries. Staff movement, last-mile logistics and customer-facing footfall are the surfaces that feel the effect first; supply-chain friction from sectoral walkouts tracks one news cycle behind.`;
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
  if (hasCrackdown) postureBits.push("visible enforcement has crossed the threshold of measured policing");
  if (hasRiotClash) postureBits.push("street-level disorder is on the record");
  const headline = lead
    ? `The civil-unrest picture across ${windowLabel} centres on "${lead.title}", the most significant event reported.`
    : `The civil-unrest picture across ${windowLabel} sits behind the protest activity rather than ahead of it, with no single standout event.`;
  const postureLine = postureBits.length > 0
    ? `How the authorities are responding is the key point right now: ${joinList(postureBits)}. That shortens the time from an announced rally to violence from days to hours and raises the chance that the next protest date draws a tougher response rather than measured policing.`
    : `The authorities' response looks measured rather than escalating — no curfews, mass arrests or visible crackdowns have been reported. That can change within days once a high-profile incident or political trigger occurs.`;
  const operational = `For businesses, the takeaway is that crackdowns, curfew orders and internet shutdowns matter more than the headline number of protests: they show where staff movement, commercial operations and venue access can be disrupted at short notice. Where enforcement clusters around a single city or district, expect rolling road closures, patchy connectivity and same-day venue access restrictions.`;
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
    ? `Confirmed upcoming events are listed in the table above and are the first things to plan around for the next 7-14 days. The outlook below builds on that schedule.`
    : `No confirmed upcoming protest calls, strike notices or scheduled hearings have been reported. The outlook below is therefore an assessment of the likely direction based on current activity rather than a list of scheduled events.`;
  const activismShare = total > 0 ? activismRows.length / total : 0;
  const unrestShare = total > 0 ? unrestRows.length / total : 0;
  const lines: string[] = [futureBlock];
  if (total === 0) {
    lines.push(`The outlook for the next 7-14 days is for continued quiet, with little fresh protest or civil-unrest activity expected for now. The risk increases if a policy trigger occurs (a court ruling, a fuel-price decision, an election-calendar event) or a named opposition movement announces a fresh protest schedule. The risk eases if political calendars stay quiet and trade groups hold back.`);
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
      `Two different stories sit side by side here and should be read together. By volume, ${lead.label} sees the most activity and is the most likely source of repeated, lower-level disruption. For seriousness, the sharper concern is ${sevCountry}, where ${shortSignalLabel(sevInc)} rated ${sevHs.label} — less frequent but with more potential to escalate${tableClause}. More events is not the same as more dangerous ones: plan for widespread disruption across ${lead.label} and for sharper escalation in ${sevCountry}.`,
    );
  } else if (lead && tableLeadDiffers) {
    // Volume leader and forecast-table leader differ, but on count not
    // severity. Explain the table is a scheduling signal, not a ranking.
    const sig = forecastLeadSignal ? ` (${forecastLeadSignal})` : "";
    lines.push(
      `The upcoming-events table and the country breakdown point in slightly different directions. ${lead.label} sees the most activity this week and remains the most likely source of repeated disruption. The outlook highlights ${forecastLeadCountry}${sig} only because it has the clearest confirmed upcoming event — something to plan around for the next 7-14 days, not a sign that ${forecastLeadCountry} outweighs ${lead.label} on volume or seriousness. Plan for sustained, widespread disruption in ${lead.label} and treat the ${forecastLeadCountry} item as a fixed calendar date to act on.`,
    );
  } else if (lead) {
    lines.push(
      `Over the next 7-14 days, ${lead.label} is likely to remain the main source of protest and civil-unrest activity at the current pace, with the highest concentration of events. Nearby cities and university campuses are possible secondary flashpoints.`,
    );
  } else {
    lines.push(
      `Over the next 7-14 days, activity is likely to stay spread out at the current pace, with no single country standing out. Watch for a coordinated opposition or trade-group call that could sharpen the picture within days.`,
    );
  }
  if (activismShare >= 0.6) {
    lines.push(
      `Protest activity dominates at the moment, so the most likely escalation path is from announced rallies and trade-group walkouts into intermittent road closures and city-centre disruption. Risk increases if security forces respond with mass arrests, tear gas or curfew orders; risk eases if organisers stand down voluntarily or political talks open.`,
    );
  } else if (unrestShare >= 0.6) {
    lines.push(
      `Civil unrest dominates at the moment, which usually means the authorities' response is already running ahead of fresh organising. The most likely path is for visible enforcement — curfews, mass arrests, security operations — to continue. Risk eases if curfews are lifted and protest leaders are released; risk increases if a death or a high-profile arrest triggers a fresh round of street protests.`,
    );
  } else {
    lines.push(
      `Protest activity and civil unrest are roughly balanced, the typical pattern when announced rallies are routinely met with police orders and selective arrests. The next 7-14 days are likely to keep that rhythm. Watch for a policy trigger or court decision that tips the balance one way or the other.`,
    );
  }
  lines.push(
    `A note of caution: a quiet stretch is not a lasting easing in these countries. A single political event can bring activity flooding back within 48 hours, so treat this outlook as a starting point rather than a firm prediction.`,
  );
  return lines.join("\n\n");
}

function buildRegionalCountryRead(opts: {
  enriched: EnrichedIncident[];
  countryRows: BarRow[];
}): string {
  const { enriched, countryRows } = opts;
  if (enriched.length === 0) {
    return `No activity could be tied to a specific country this week, so there is no geographic picture to show. Across these countries a fully quiet week is unusual rather than reassuring: opposition political calendars, trade groups and student bodies usually bring activity back quickly once a policy trigger or anniversary occurs.\n\nFor businesses on the ground, the practical takeaway is that readiness around the usual city-centre commercial districts, transport hubs and government precincts should not be wound down on the strength of one quiet week.`;
  }
  if (countryRows.length === 0) {
    return `Few events could be tied to a specific country this week, even where there is clearly activity happening. That usually reflects gaps in reporting rather than a real absence of street-level activity.\n\nBusinesses with a presence in the usual hotspots should keep crisis-communication contact lists and staff-movement plans ready until the coming weeks either confirm or reverse the apparent quiet.`;
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
    ? `This week activity spans ${joinList(regionList)}. It is genuinely regional rather than confined to any single sub-region; ${lead.label} sees the most activity but is not the whole story, and businesses with a presence across several APAC capitals should treat this as a coordinated rather than localised picture.`
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
  const driverFor = (rows: EnrichedIncident[]): string => {
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.issue, (counts.get(r.issue) ?? 0) + 1);
    const ranked = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    if (ranked.length === 0) return "a mix of protest and civil-unrest activity";
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
  const RANK_LABEL = ["The busiest area", "The second-busiest area", "The third-busiest area"];
  const countryParas: string[] = [];
  topThree.forEach((cr, idx) => {
    const rows = byCountry.get(cr.label) ?? [];
    if (rows.length === 0) return;
    countryParas.push(
      `${cr.label} — ${RANK_LABEL[idx] ?? "A leading area"} this week, driven by ${driverFor(rows)}. Likely form: ${formFor(rows)}; main areas affected: ${lociFor(rows)}.`,
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
  const CAP = 6;
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
    return `What stands out this week is the absence of fresh protest and civil-unrest activity rather than any single event. That is a gap in reporting, not a lasting easing — these countries have rarely stayed quiet for long, and the next political trigger usually brings activity back within a week.\n\nFor businesses on the ground, the practical implication is that readiness around city-centre commercial districts, transport hubs and staff movement should not be wound down on the strength of one quiet week.`;
  }
  const lines: string[] = [];
  const spread = subregionSpread(ctx.countryRows);
  if (spread.regions.length >= 2 && lead) {
    lines.push(
      `What matters most this week is that activity is spread across ${joinList(spread.regions)} rather than concentrated in a single capital. That kind of spread is harder to police, harder to predict and routinely turns into rolling, short-notice disruption across several countries in the same week. ${lead.label} sets the pace but is not the whole picture.`,
    );
  } else if (lead) {
    lines.push(
      `What matters most this week is how concentrated activity is in ${lead.label}, which historically turns into rolling road closures, patchy connectivity and short-notice pressure on staff movement around known flashpoints.`,
    );
  } else {
    lines.push(
      `Activity is spread out this week, which usually reflects a broad political mood rather than a single flashpoint. A named opposition call or a single policy trigger tends to pull activity back to one or two cities within days.`,
    );
  }
  if (ctx.activismRows.length > 0 && ctx.unrestRows.length > 0) {
    lines.push(
      `Protest activity and civil unrest running side by side is the classic pattern when announced rallies are routinely met with police orders, selective arrests and tear gas. The bigger risk sits in what follows: curfews, internet shutdowns and mass arrests usually come after a single high-profile incident rather than building slowly.`,
    );
  } else if (ctx.activismRows.length > 0) {
    lines.push(
      `Activity this week leans toward protests rather than civil unrest, which usually means the authorities have held back from visible enforcement. That can change within days if a rally crosses a policy line.`,
    );
  } else {
    lines.push(
      `Activity this week leans toward civil unrest rather than fresh protests, which usually means the authorities' response is running ahead of new organising. Expect visible enforcement to continue until the political trigger eases.`,
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
    bullets.push(`Wire procurement, distribution and customer-service into the security early-warning feed — the trade-group and union walkouts already reported routinely run 24-72 hours ahead of supply-chain friction.`);
  }
  if (hasCampus) {
    bullets.push(`Brief campus-adjacent sites on student-mobilisation patterns — campus action seeds wider city-centre protests within a week and is an early sign of a sustained run.`);
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

  const bullets: string[] = [];
  for (const r of future) {
    const where = r.country ? `${r.country} — ` : "";
    bullets.push(`${where}${shortSignalLabel(r)}: ${operationalMeaningFor(r)}`);
  }
  if (lead) {
    bullets.push(
      `${lead.label} — the next dated opposition, trade-group or court call. As the busiest area this week, a fresh trigger here turns fastest into road closures and venue-access problems.`,
    );
  }
  if (sevInc && sevCountry && sevElevated && (!lead || sevCountry !== lead.label)) {
    bullets.push(
      `${sevCountry} — follow-through after ${shortSignalLabel(sevInc)}, the most serious incident reported: watch for retaliatory protests, further arrests or injuries within 48 hours.`,
    );
  }
  bullets.push(
    `Union or chamber strike notices: supply-chain friction 24-72 hours ahead of any visible street activity.`,
    `Section 144 / curfew orders or assembly bans in a city of operation: trigger WFH and close public-facing sites the same day.`,
    `Court hearings or detention rulings on political figures: an adverse decision converts into same-day rallies near the court complex.`,
    `Student-union or campus mobilisation calls: an early sign that activity is building into a sustained rather than one-off run.`,
  );
  // De-dupe on the leading clause so a future signal and a standing
  // bullet about the same theme do not both appear.
  const out: string[] = [];
  const seenLine = new Set<string>();
  for (const b of bullets) {
    const k = b.slice(0, 40).toLowerCase();
    if (seenLine.has(k)) continue;
    seenLine.add(k);
    out.push(b);
    if (out.length >= 6) break;
  }
  return out.map((b) => `- ${b}`).join("\n");
}

// Detect a city / location cue in the text so forecast labels can
// carry "Country (City)" rather than country alone. Restricted to the
// recurring APAC capitals and major commercial cities the brief
// actually covers.
const CITY_LOOKUP: Array<[RegExp, string]> = [
  [/\bislamabad\b/i, "Islamabad"],
  [/\brawalpindi\b/i, "Rawalpindi"],
  [/\blahore\b/i, "Lahore"],
  [/\bkarachi\b/i, "Karachi"],
  [/\bpeshawar\b/i, "Peshawar"],
  [/\bquetta\b/i, "Quetta"],
  [/\badiala\b/i, "Rawalpindi"],
  [/\bdhaka\b/i, "Dhaka"],
  [/\bchittagong\b/i, "Chittagong"],
  [/\bnew delhi\b|\bdelhi\b/i, "Delhi"],
  [/\bmumbai\b/i, "Mumbai"],
  [/\bkolkata\b/i, "Kolkata"],
  [/\bchennai\b/i, "Chennai"],
  [/\bbengaluru\b|\bbangalore\b/i, "Bengaluru"],
  [/\bmanila\b|\bquezon city\b/i, "Manila"],
  [/\bcebu\b/i, "Cebu"],
  [/\bseoul\b/i, "Seoul"],
  [/\bbusan\b/i, "Busan"],
  [/\btokyo\b/i, "Tokyo"],
  [/\bosaka\b/i, "Osaka"],
  [/\bjakarta\b/i, "Jakarta"],
  [/\bbangkok\b/i, "Bangkok"],
  [/\bkuala lumpur\b/i, "Kuala Lumpur"],
  [/\bhanoi\b/i, "Hanoi"],
  [/\bho chi minh\b/i, "Ho Chi Minh City"],
  [/\bkathmandu\b/i, "Kathmandu"],
  [/\bcolombo\b/i, "Colombo"],
  [/\bport moresby\b/i, "Port Moresby"],
  [/\bsydney\b/i, "Sydney"],
  [/\bmelbourne\b/i, "Melbourne"],
  [/\bcanberra\b/i, "Canberra"],
  [/\btaipei\b/i, "Taipei"],
];
function detectCity(r: EnrichedIncident): string | null {
  const text = `${r.title ?? ""} ${r.summary ?? ""}`;
  for (const [rx, name] of CITY_LOOKUP) {
    if (rx.test(text)) return name;
  }
  return null;
}

// Clean, content-based signal labels for Watch Next and the Forecast
// table. Labels must read as actor + trigger + form — never bare
// "Protest mobilisation". Adds city in parens when detectable so the
// reader sees country + city + actor + expected effect across the
// row (effect column comes from forecastMeaningFor).
function shortSignalLabel(r: EnrichedIncident): string {
  const text = `${r.title ?? ""} ${r.summary ?? ""}`.toLowerCase();
  const city = detectCity(r);
  const withCity = (label: string): string => (city ? `${label} (${city})` : label);
  if (/\b(pti|imran|adiala|tehreek|ttap)\b/.test(text)) {
    if (/\bsection\s*144\b|\bdefy/.test(text)) return withCity("PTI protest defying Section 144");
    if (/release|imprisonment|bail|adiala/.test(text)) return withCity("PTI mobilisation for Imran's release");
    if (/case|court|cjp|hearing|trial/.test(text)) return withCity("PTI court-hearing pressure");
    if (/countrywide|nationwide|across.*cities/.test(text)) return "PTI countrywide protest call";
    return withCity("PTI street mobilisation");
  }
  if (/\bsection\s*144\b|assembly ban|curfew/.test(text)) return withCity("Section 144 / curfew order");
  if (/\b(chemist|pharmacist)s?\b/.test(text)) return withCity("Chemists' strike notice over e-pharmacy rules");
  if (/(union|labour|labor).*(injunct|strike|walkout)|injunct.*(union|strike|labour|labor)/.test(text)) return withCity("Union injunction ruling — sectoral strike risk");
  if (/\b(metro bus|salaries|salary|pay|wages?|unpaid)\b/.test(text)) return withCity("Sectoral pay protest by transport / public-sector staff");
  if (/\b(student union|student body|students?)\b.{0,40}\b(protest|march|rally|walkout|strike)\b/.test(text)) return withCity("Student-body mobilisation");
  if (/\b(teacher|faculty|vc|university|campus)\b/.test(text)) return withCity("Faculty / campus protest");
  if (/\b(dowry|kin|family|relatives).*(protest|sit|demand)|protest.*(family|kin)/.test(text)) return withCity("Family-led sit-in at official premises");
  if (/\b(petroleum|fuel|levy|tariff|tax|price)\b/.test(text)) return withCity("Fuel / levy political challenge");
  if (/\bblockade|roadblock|highway|motorway|sit[- ]?in\b/.test(text)) return withCity("Road blockade / sit-in");
  if (/\bstrike|walkout|stoppage|shutdown\b/.test(text)) return withCity("Sectoral strike notice");
  if (/\brally|march|protest|demonstration\b/.test(text)) {
    // Pull the trigger keyword instead of a bare "Protest mobilisation".
    const trig =
      /\b(rape|murder|killing|femicide|gender violence|gbv)\b/i.test(text) ? "gender-violence protest"
      : /\bpalestin|gaza|israel|sumud\b/i.test(text) ? "Palestine solidarity protest"
      : /\banti[- ]?india\b/i.test(text) ? "anti-India protest"
      : /\bdefence spending|parliament|budget|funds\b/i.test(text) ? "policy / budget protest"
      : /\b(election|vote|electoral|poll)\b/i.test(text) ? "electoral protest"
      : /\b(opposition|movement)\b/i.test(text) ? "opposition street action"
      : /\b(union|labour|labor|workers?)\b/i.test(text) ? "labour-led protest march"
      : "civic protest march";
    return withCity(trig.charAt(0).toUpperCase() + trig.slice(1));
  }
  // Last-resort: clean clip on a word boundary, no ellipsis. Final
  // guard: never return a bare "Protest mobilisation" — fall back to
  // a generic but trigger-aware label instead.
  const t = (r.title ?? "").trim();
  const candidate = t.length <= 48
    ? t
    : (() => {
        const slice = t.slice(0, 48);
        const cut = slice.lastIndexOf(" ");
        return cut > 20 ? slice.slice(0, cut).trim() : slice.trim();
      })();
  if (/^\s*protest mobilisation\s*$/i.test(candidate)) {
    return withCity("Civic protest march");
  }
  return candidate;
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
  const where = lead ? lead.label : "the affected areas";
  const intro = `The following signs tend to come ahead of street-level escalation in ${where} and are worth tracking daily over the coming week. Each points to a specific, practical consequence rather than a generic risk flag.`;
  const items: string[] = [
    `Protest calls and mobilisation dates from opposition parties, named movements and civil-society coalitions. A dated, location-specific call is the single best lead indicator for road closures, transport disruption and crowd action around the targeted venue.`,
    `Union strike notices — federation-level call-outs, sectoral chamber announcements (chemists, transporters, traders, lawyers) and confirmed walkout dates. Treat these as 24-72 hour warnings of supply-chain disruption, branch closures and customer-service degradation before any street activity is visible.`,
    `Court hearings and detention triggers — bail rulings, indictments, contempt findings and high-profile transfers involving political figures, activists or movement leaders. Adverse rulings convert into same-day rallies and route closures around court complexes.`,
    `Police permit refusals or assembly bans for announced rallies. A refusal rarely cancels the protest — it converts an organised event into a dispersed, harder-to-police one and raises the probability of clashes, baton charges and tear-gas dispersal at the venue.`,
    `Section 144 / curfew orders or their geographical expansion. A fresh imposition in a city of operation is the trigger for immediate work-from-home declaration, suspension of non-essential staff movement and customer-facing site closure.`,
    `Arrests, injuries and any confirmed deaths in a protest or unrest context. These are the clearest sign that activity will build rather than ease — expect retaliatory protests, sympathy strikes in nearby sectors and a tougher response from authorities within 48 hours.`,
    `Roadblocks and transport disruption — confirmed motorway closures, rail stoppages, port-access blockades and airport-route disruption. Validate these against named routes the business uses and convert into live driver advisories rather than passive monitoring.`,
    `Campus mobilisation — student-union calls, occupations, walkouts and university closure notices. Campus action routinely seeds wider city-centre protests within a week and is an early sign of a sustained rather than one-off run.`,
    `Online calls moving to street action — verified hashtags, telegram channels or WhatsApp mobilisation that name a date and location. The transition from digital organising to a confirmed venue is where social-media noise becomes operationally relevant.`,
  ];
  if (ctx.unrestRows.length > 0) {
    items.push(
      `Visible enforcement steps already under way — internet-shutdown notices, mass-arrest reports and any move to call in the military. These show the authorities' response has gone beyond measured policing, and the coming week is likely to be harder, not softer.`,
    );
  } else {
    items.push(
      `Triggers that historically turn a quiet stretch into a sharp one — fuel-price decisions, currency moves, election-calendar shifts, security-force deaths or a major court ruling. Treat any of these as accelerants and step up monitoring immediately.`,
    );
  }
  return `${intro}\n\n${items.map((l) => `\u2022 ${l}`).join("\n\n")}`;
}

function buildPolestarView(ctx: AutoCtx): string {
  const text = (r: EnrichedIncident) => `${r.title ?? ""} ${r.summary ?? ""}`;
  const sectoral = ctx.activismRows.filter((r) => /\b(chemist|pharmacist|trader|transporter|lawyer|union|chamber|federation|sectoral|samsung)\b/i.test(text(r))).length;
  const student = ctx.activismRows.filter((r) => /\b(student|university|campus|college|faculty)\b/i.test(text(r))).length;
  const named = ctx.activismRows.filter((r) => /\b(pti|imran|tehreek|ttap|opposition|movement)\b/i.test(text(r))).length;
  const hasEnforcement = ctx.unrestRows.some((r) => /\b(curfew|tear[- ]?gas|baton|water cannon|arrest|detention|section\s*144|crackdown|lockdown|martial law)\b/i.test(text(r)));
  const mobVectors = [named > 0, sectoral > 0, student > 0].filter(Boolean).length;

  // 1. Directional verdict. One sharp sentence up top.
  let verdict: string;
  if (mobVectors >= 2 && hasEnforcement) {
    verdict = `Polestar's view: activity is building, not easing. Several separate organising efforts are running alongside visible enforcement by the authorities, and the coming week should be planned for further short-notice disruption rather than a return to quiet.`;
  } else if (mobVectors >= 2) {
    verdict = `Polestar's view: the picture is broadly mobilised but not yet escalating. Several organising efforts are active; the authorities' response has stayed below visible enforcement so far.`;
  } else if (hasEnforcement) {
    verdict = `Polestar's view: enforcement is leading the way. Visible action by the authorities is already happening ahead of fresh organising, which usually points to a contained but sustained crackdown rather than a one-off response.`;
  } else if (mobVectors >= 1) {
    verdict = `Polestar's view: activity is live but contained. There is organising under way without a tough enforcement response yet — a stable picture that historically tips on a single political trigger.`;
  } else {
    verdict = `Polestar's view: this is a quiet week, not a lasting easing. The organising infrastructure across these countries remains intact and can reactivate on a single political trigger.`;
  }

  // 2. Business disruption risk judgement.
  const disruption = `Business disruption risk is moderate-to-elevated: short-notice transport disruption on protest days, closures of public-facing sites driven by Section 144 / curfew orders, and supply-chain friction from trade-group walkouts. The main remaining risk is a trigger — an adverse court ruling, a fuel-price decision, a security-force death — that tips this into sustained unrest.`;

  return [verdict, disruption].join("\n\n");
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
    return `This briefing covers the activism, protest and civil-unrest picture across APAC for ${windowLabel}. Little was reported this week. Treat the quiet as a gap in reporting rather than a lasting easing — the organising infrastructure across these countries remains intact and activity typically returns within days once a policy trigger or anniversary occurs.`;
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
  const opener = `The picture this week is one to plan around for short-notice protest disruption, not a return to quiet: ${volClause}${sevClause}. ${driverLine}`;

  const closing = hasEnforcement
    ? `Bottom line for the next 7-14 days: plan for further short-notice disruption around known flashpoints rather than a return to quiet. Detailed activism, civil-unrest, forecast and country sections follow.`
    : `Bottom line for the next 7-14 days: the time from an announced protest to street-level disruption stays short — historically 24-72 hours once a policy trigger occurs. Detailed activism, civil-unrest, forecast and country sections follow.`;

  return `${opener}\n\n${geoLine} ${severityLine}\n\n${closing}`;
}

export const FLASHPOINT_SEV_LABEL = SEV_LABEL;
