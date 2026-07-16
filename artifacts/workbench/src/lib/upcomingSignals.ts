// Shared "advance warning" detection authority.
//
// This module is the SINGLE source of truth for turning an incident whose text
// ANNOUNCES a future protest / strike / march into a forward-looking "upcoming
// activity" signal. It is consumed by three surfaces which must never drift:
//   1. the live Protests & Civil Unrest monitor (Reported Upcoming Activity),
//   2. the weekly Flashpoint report (Forecast: Next 7-14 Days + Watch Next),
//   3. the Indonesia country brief (Outlook section).
//
// STRICT NO-FABRICATION:
//   * We do NOT parse or guess the actual future date of the event — free-text
//     (English / Bahasa) dates are not reliably extractable, so surfaces present
//     the ANNOUNCEMENT date + source, never an invented calendar date.
//   * The detection is precision-first: a wrong "upcoming protest" shown to a
//     client is worse than an empty panel. A future cue only qualifies when it
//     is bound to a protest object (or a political-legal trigger); bare temporal
//     phrases ("next week", "to begin talks") are rejected unless a protest
//     object co-occurs; already-completed events and sports/diplomacy homonyms
//     are excluded.

// Minimal structural contract the detection + labelling need. EnrichedIncident
// (flashpoint report) and the monitor's resolved incidents both satisfy it.
export interface UpcomingSignalInput {
  title?: string | null;
  summary?: string | null;
  country?: string | null;
}

// Self-sufficient future cues: the cue itself names a protest / political-legal
// object, so it qualifies on its own (e.g. "planned strike", "call for a
// rally", "scheduled hearing").
// NOTE: bare "strike on|rally on|march on" alternatives were deliberately
// REMOVED — they false-positive on kinetic strikes ("drone strike on convoy")
// and market moves ("shares rally on rate-cut hopes"). Genuinely scheduled
// marches/rallies ("farmers to march on parliament on Friday") still qualify
// via the temporal+object path, keeping detection precision-first.
const FUTURE_STRONG_RE =
  /\b(planned (protest|strike|rally|march|blockade|mobilisation|mobilization|walkout|shutdown)|announced (protest|strike|rally|march|mobilisation|mobilization)|to (protest|march|rally)|(to|will) (stage|hold|launch|begin|commence|call)(?: (?:a|an|the))? (protest|sit[- ]in|march|rally|strike|walkout|demonstration|blockade|shutdown|boycott|mobilisation|mobilization)|will (protest|march|rally|strike|walkout|demonstrate)|call(ed|s)? for (a )?(protest|strike|rally|march|sit[- ]in|shutdown|boycott|walkout)|union calls|students? to (protest|march|rally)|scheduled (hearing|sitting|vote|session)|court date|anniversary (protest|march|rally)|upcoming (protest|strike|rally|march|hearing|vote))\b/i;

// Bare temporal / open-ended cues that carry NO protest object of their own.
// They only qualify when a protest object co-occurs elsewhere in the text, so
// "Malaysia to begin talks with Kongsberg" and "set for the final" are rejected.
const FUTURE_TEMPORAL_RE =
  /\b(next week|next month|tomorrow|tonight|this (weekend|friday|saturday|sunday|monday|tuesday|wednesday|thursday)|on (monday|tuesday|wednesday|thursday|friday|saturday|sunday)|set for|to (begin|commence))\b/i;

// A protest / civil-unrest object noun. Presence lets a bare temporal cue count
// and suppresses the sports/diplomacy homonym veto.
const PROTEST_OBJECT_RE =
  /\b(protest(s|ers?|ing)?|rally|rallies|march(es|ing)?|demonstrat(e|es|ion|ions|ors?)|strikes?|walk[- ]?outs?|shut[- ]?downs?|blockade|roadblock|sit[- ]?in|picket|vigil|boycott|mobilis|mobiliz|riot|unrest|clash(es)?|crackdown|curfew|assembly ban|section\s*144|hartal|bandh|stoppage|dharna|gherao|agitation)\b/i;

// Already-happened markers — an account of a past event is not forewarning.
const PAST_EVENT_RE =
  /\b(yesterday|last (week|month|night|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|has ended|had ended|ended|ends|concluded|wrapped up|dispersed|gathered|took place|was held|were held|over the weekend)\b/i;

// Sports / competition homonyms ("team-mates rally", "faces ex-world champ",
// "set for the semis"). Treated as noise UNLESS a genuine protest object is
// present, so "final protest rally" is kept while "cup final" is dropped.
const SPORTS_HOMONYM_RE =
  /\b(match|matches|champ|champions?|championship|vs\.?|versus|team[- ]?mates?|cup|league|semi[- ]?finals?|quarter[- ]?finals?|semis|fixtures?|kick[- ]?off|goals?|scorers?|strikers?|coach|tournament|medal|olympics?|world cup|test series|innings|wicket)\b/i;

// Natural-hazard bulletins (volcano seismicity, earthquakes, typhoons, floods)
// are covered by the apac_local hazard layer but are NOT civil-unrest
// forewarning. They leak into this detector two ways: "volcanic UNREST" matches
// the PROTEST_OBJECT_RE `unrest` token, and "typhoon WILL STRIKE" matches the
// FUTURE_STRONG_RE `will strike` alternative. Both then combine with an
// announcement day-of-week ("on Monday") to read as an upcoming protest.
const NATURAL_HAZARD_RE =
  /\b(volcan(o|oes|ic)|seismic|eruptions?|erupt(s|ed|ing)?|phreatic|phivolcs|magma|lava|ashfall|earthquakes?|quakes?|tremors?|aftershocks?|magnitude[- ]?\d|richter|tsunami|typhoons?|cyclones?|hurricanes?|storm surge|landslides?|mudslides?|floodwaters?|flooding)\b/i;

// Unambiguous civil-unrest ACTIONS. Deliberately EXCLUDES the bare word
// "unrest" (also geological "volcanic unrest") and bare "strike" (collides with
// kinetic / hazard "will strike"), so it can gate the hazard veto without
// dropping a genuine hazard-triggered protest ("march over flood relief").
const PROTEST_ACTION_RE =
  /\b(protest(s|ers?|ing)?|rally|rallies|march(es|ing)?|demonstrat(e|es|ion|ions|ors?)|walk[- ]?outs?|sit[- ]?in|picket|vigil|boycott|blockade|roadblock|hartal|bandh|dharna|gherao|agitation|strikers?|workers? strike|labou?r strike|general strike)\b/i;

// Does this incident announce upcoming protest activity worth warning on?
export function hasUpcomingSignal(input: UpcomingSignalInput): boolean {
  const text = `${input.title ?? ""} ${input.summary ?? ""}`;
  // Reject natural-hazard bulletins unless a genuine protest ACTION co-occurs
  // (which keeps hazard-triggered protests while dropping pure geology/weather).
  if (NATURAL_HAZARD_RE.test(text) && !PROTEST_ACTION_RE.test(text)) return false;
  const object = PROTEST_OBJECT_RE.test(text);
  const strong = FUTURE_STRONG_RE.test(text);
  const temporal = FUTURE_TEMPORAL_RE.test(text);
  // Must carry a self-sufficient future cue, or a bare temporal cue bound to a
  // protest object.
  if (!strong && !(temporal && object)) return false;
  // Reject already-completed events.
  if (PAST_EVENT_RE.test(text)) return false;
  // Reject sports/competition homonyms when no protest object anchors it.
  if (!object && SPORTS_HOMONYM_RE.test(text)) return false;
  return true;
}

// Filter a list of incidents down to those announcing upcoming activity. Generic
// so callers keep their own row type (EnrichedIncident, resolved monitor rows).
export function extractFutureSignals<T extends UpcomingSignalInput>(rows: T[]): T[] {
  return rows.filter((r) => hasUpcomingSignal(r));
}

// Detect a city / location cue in the text so signal labels can carry
// "Country (City)" rather than country alone. Restricted to the recurring APAC
// capitals and major commercial cities the workbench actually covers.
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
export function detectCity(r: UpcomingSignalInput): string | null {
  const text = `${r.title ?? ""} ${r.summary ?? ""}`;
  for (const [rx, name] of CITY_LOOKUP) {
    if (rx.test(text)) return name;
  }
  return null;
}

// Clean, content-based signal labels for Watch Next and the Forecast table.
// Labels must read as actor + trigger + form — never bare "Protest
// mobilisation". Adds city in parens when detectable so the reader sees country
// + city + actor + expected effect across the row (effect column comes from
// forecastMeaningFor).
export function shortSignalLabel(r: UpcomingSignalInput): string {
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
  // Last-resort: clean clip on a word boundary, no ellipsis. Final guard: never
  // return a bare "Protest mobilisation" — fall back to a generic but
  // trigger-aware label instead.
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

// Forecast-table operational meaning — short, decision-grade phrase keyed off
// content. Kept distinct from the Watch Next bullet line.
export function forecastMeaningFor(r: UpcomingSignalInput): string {
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

export function operationalMeaningFor(r: UpcomingSignalInput): string {
  const text = `${r.title ?? ""} ${r.summary ?? ""}`.toLowerCase();
  if (/\b(strike|walkout|stoppage|shutdown)\b/.test(text)) return "supply-chain friction and sectoral closures 24-72h ahead.";
  if (/\b(rally|march|protest|demonstration|sit[- ]?in)\b/.test(text)) return "road closures and venue-access friction; brief drivers in advance.";
  if (/\b(hearing|court|trial|bail|indict)\b/.test(text)) return "adverse ruling triggers same-day rallies near the court complex.";
  if (/\b(blockade|roadblock|highway|motorway)\b/.test(text)) return "validate against logistics corridor; pre-position alternative routings.";
  if (/\b(curfew|section\s*144|lockdown|assembly ban)\b/.test(text)) return "trigger WFH and close public-facing sites in the affected area.";
  return "treat as leading indicator; confirm inside 24-48h.";
}

// A rendered forewarning row. `announcedAt` is the ANNOUNCEMENT / report date
// (NOT a fabricated event date).
export interface UpcomingSignalRow {
  country: string;
  signal: string;
  meaning: string;
  announcedAt: string;
  sourceUrl?: string | null;
  title: string;
}

export interface UpcomingSignalSource extends UpcomingSignalInput {
  occurredAt: string;
  sourceUrl?: string | null;
}

// Announcement-date formatter shared by every surface so the date reads
// identically (UTC, avoiding the timezone day-roll bug) as "DD Mon YYYY".
const SIGNAL_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
export function formatAnnouncedDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${String(d.getUTCDate()).padStart(2, "0")} ${SIGNAL_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// ONE bullet-line formatter for the Indonesia brief (screen + PDF), so the
// preview and the PDF can never disagree. Reads "<signal>: <meaning> (reported
// <date>)." — the date is the ANNOUNCEMENT date, never a fabricated event date.
export function upcomingSignalLine(r: UpcomingSignalRow): string {
  return `${r.signal}: ${r.meaning} (reported ${formatAnnouncedDate(r.announcedAt)}).`;
}

// Build the deduped, capped forewarning rows shared by the live monitor and the
// Indonesia brief. Scans only a recent announcement window (default 7 days) so
// a wide date range cannot resurrect long-stale "upcoming" items — an
// announcement older than a week almost always describes an event that has
// already passed, which is wrong under an "upcoming activity" heading. Rows are
// collapsed on (country, signal) exactly as the flashpoint report does.
export function buildUpcomingSignalRows(
  rows: UpcomingSignalSource[],
  opts: { now?: Date; windowDays?: number; cap?: number } = {},
): UpcomingSignalRow[] {
  const now = opts.now ?? new Date();
  const windowDays = opts.windowDays ?? 7;
  const cap = opts.cap ?? 8;
  const nowMs = now.getTime();
  const cutoff = nowMs - windowDays * 86_400_000;
  // Allow a small forward slack for clock/timezone skew on the announcement
  // timestamp, but never surface far-future stamps.
  const upper = nowMs + 2 * 86_400_000;
  const candidates = rows
    .filter((r) => {
      const t = Date.parse(r.occurredAt);
      return !Number.isNaN(t) && t >= cutoff && t <= upper;
    })
    .filter((r) => hasUpcomingSignal(r))
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
  const seen = new Set<string>();
  const out: UpcomingSignalRow[] = [];
  for (const r of candidates) {
    const country = (r.country ?? "").trim() || "—";
    const signal = shortSignalLabel(r);
    const key = `${country.toLowerCase()}|${signal.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      country,
      signal,
      meaning: forecastMeaningFor(r),
      announcedAt: r.occurredAt,
      sourceUrl: r.sourceUrl ?? null,
      title: (r.title ?? "").trim(),
    });
    if (out.length >= cap) break;
  }
  return out;
}
