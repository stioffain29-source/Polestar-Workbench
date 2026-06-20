// Shared shipping derivations used by the Shipping page and the
// Shipping report PDF exporter. Single source of truth so the dashboard
// and the report never disagree.

export type ChokepointKey =
  | "Strait of Hormuz"
  | "Gulf of Oman"
  | "Arabian / Persian Gulf"
  | "Red Sea"
  | "Bab el-Mandeb"
  | "Gulf of Aden"
  | "Singapore Strait"
  | "Malacca Strait";

export const CHOKEPOINTS: ChokepointKey[] = [
  "Strait of Hormuz",
  "Gulf of Oman",
  "Arabian / Persian Gulf",
  "Red Sea",
  "Bab el-Mandeb",
  "Gulf of Aden",
  "Singapore Strait",
  "Malacca Strait",
];

// Operational-context test for Hormuz. A bare "Hormuz" reference (FAO food
// price commentary, Wood Mackenzie supply-shock note, "permanent toll" policy
// proposals, etc) must NOT count as a Strait of Hormuz chokepoint record.
// We require the text to also contain an operational maritime term once the
// Hormuz phrase itself is removed — otherwise a self-referential mention
// like "Strait of Hormuz closure could trigger food crisis" would pass on
// the word "strait" alone.
const HORMUZ_TOKEN_RE = /\b(strait of hormuz|hormuz strait|hormuz)\b/i;
const HORMUZ_STRIP_RE = /\b(strait of hormuz|hormuz strait|hormuz)\b/gi;
const HORMUZ_OPS_RE = /\b(vessels?|tankers?|ships?|transits?|chokepoints?|attacks?|seizures?|seized|ukmto|routes?|shipping|maritime|ports?|gulf of oman|drones?|missiles?|hijack(ed|ing)?|boarding|carriers?|dhows?|bulk carriers?|container ships?|crude carriers?|vlccs?|vlgcs?|aframax|coast guard|navy|escorts?|warships?|gunfire|fired (upon|at|on)|under fire|projectiles?|strikes?|struck|hit)\b/i;
function matchesHormuz(text: string): boolean {
  if (!HORMUZ_TOKEN_RE.test(text)) return false;
  const stripped = text.replace(HORMUZ_STRIP_RE, " ");
  return HORMUZ_OPS_RE.test(stripped);
}

// Each rule is either a plain regex or a custom matcher. Hormuz uses the
// matcher above; everything else stays on a simple regex.
type CpRule = { key: ChokepointKey; match: (text: string) => boolean };
const CHOKEPOINT_RULES: CpRule[] = [
  { key: "Strait of Hormuz", match: matchesHormuz },
  { key: "Gulf of Oman", match: (t) => /\bgulf of oman\b/i.test(t) },
  { key: "Bab el-Mandeb", match: (t) => /\bbab[- ]?(el|al)[- ]?mande[bn]\b/i.test(t) },
  { key: "Red Sea", match: (t) => /\bred sea\b/i.test(t) },
  { key: "Gulf of Aden", match: (t) => /\bgulf of aden\b/i.test(t) },
  // Singapore Strait requires the "strait" qualifier — a bare "Singapore"
  // reference (port congestion, bunkering market) is NOT the chokepoint.
  { key: "Singapore Strait", match: (t) => /\b(strait of singapore|singapore strait)\b/i.test(t) },
  { key: "Malacca Strait", match: (t) => /\b(strait of malacca|malacca strait|malacca)\b/i.test(t) },
  { key: "Arabian / Persian Gulf", match: (t) => /\b(arabian gulf|persian gulf)\b/i.test(t) },
];

export interface MaritimeRecordLike {
  title: string;
  summary?: string | null;
  location?: string | null;
  source?: string | null;
  sourceUrl?: string | null;
}

// ---------------------------------------------------------------------------
// Shared noise / low-credibility filters
//
// Centralised here so the Shipping page and the Shipping report PDF apply
// the same exclusion vocabulary to Latest Significant Incident, Vessel
// Attacks, Piracy, Hormuz Chokepoint Status, Naval / security posture and
// Chokepoint Watch. Previously these regexes lived only inside the PDF
// dataset builder, which meant the on-screen monitor surfaced repatriation /
// crew-return / social-media records that the PDF correctly suppressed.
// ---------------------------------------------------------------------------

// Social-media surfaces (handle-style titles, social source domains).
export const SOCIAL_HANDLE_TITLE_RE = /^\s*[@#]/;
export const SOCIAL_SOURCE_RE = /\b(twitter|x\.com|t\.co|instagram|tiktok|facebook|threads|youtube|reddit|telegram|t\.me|mastodon|truth\s*social|weibo|social\s*media)\b/i;

// Repatriation, crew-welfare, hostage-return and human-interest follow-ups.
// These are downstream of the maritime security picture, not operational
// drivers of it — they must never classify as vessel attack, seizure,
// confirmed kinetic incident or latest significant incident.
export const HUMAN_INTEREST_RE = /(\brepatriat|\bseafarer welfare|\bcrew welfare|\bmemorial|\bfuneral|\brescued (and )?(repatriated|returned home)|\bbrought home\b|\breunion\b|\bwidow|\bmother of\b|\bfamily of\b|\btribute to\b|\binterview with\b|\bopinion piece\b|\bop[- ]ed\b|\baboard us-?seized vessels?\b|\bcrew (members? )?(released|freed|safe|safely|returned|repatriated|sent home|flown home|brought home)|\bdetained crew (returned|released|repatriated)|\b(transfers?|transferred|transferring|hands? over|handed over|handover of|hand[- ]?over of|returns?|returned|returning|releases?|released|releasing|delivers?|delivered|delivering|flies? home|flown home) (the )?crew\b|\bcrew (of [^.,]{1,80} )?(transferred|handed over|repatriated|released|freed|returned|sent home|flown home|brought home))/i;

// Speculative / unverified strike-claim language. Suppressed from the
// hostile classifiers and from analyst-narrative surfaces.
export const SPECULATIVE_CLAIM_RE = /(\bunconfirmed|\bunverified|\balleged|\ballegedly|\breportedly|\bclaim(s|ed)\b[^.]{0,40}\b(strike|attack|hit|missile|drone|target|targeted|fired|sank|downed|shot down|launched)|\bclaim(s|ed) to have\b|\bclaim(s|ed) responsibility|\brumou?red|\bpurportedly|\bmay have (been )?(struck|hit|attacked|targeted)|\bappears to have been|\b(says|said) it (hit|struck|targeted|attacked|launched|downed))/i;

// Pure commentary, explainer and analysis-piece headlines with no
// operational anchor. Also catches "what happens next" / "here's what it
// means" / "why it matters" explainer framing, which is commentary about an
// event rather than a report of the event itself.
export const GENERIC_COMMENTARY_RE = /\b(explained|explainer|what (you )?(need to )?know|what to know|what (happens|happened|comes|could happen|that means|this means|it means|to expect)\b|what'?s next|here'?s what|why it matters|why it could|how (it|this) (could|will|might) (affect|hit|impact)|how [^.]{0,70}\b(complements?|complementing|underpins?|underpinning|reshapes?|reshaping|drives?|shapes?|shaping|fuels?|explains?|redefines?|transforms?)\b[^.]{0,50}\b(architecture|landscape|dynamics|ecosystem|paradigm|calculus|playbook|framework|geometry|topology|order)\b|five things|10 things|in charts|guide to|primer|deep dive|long read|backgrounder|analysis: |opinion: |commentary: |viewpoint: |q&a|qa with|interview: |podcast|listicle)\b/i;

// Political rhetoric / threat language about closing or sealing a waterway.
// Iranian "vows to shut the Strait of Hormuz" / "says Hormuz will stay
// closed" statements are rhetoric, threat or claim-pending-confirmation —
// NOT a confirmed operational closure. They must never be counted as a
// verified chokepoint disruption or quoted as a hard incident.
//
// Precision over recall by design: a genuine reported closure ("Suez closed
// after grounding") or a real blockage with a recovery outlook ("blocked by
// vessel, could reopen in days") carries NEITHER an intent verb adjacent to a
// close word NOR a future-modal-then-close phrase, so it is never suppressed.
// We require BOTH a waterway AND one of three tight close-intent shapes.
const WATERWAY_RE = /\b(strait|hormuz|bab[\s-]?el[\s-]?mandeb|red sea|suez|malacca|chokepoint|waterway|sea ?lane)\b/i;
// "vows to shut", "threatens to close the strait", "pledges to seal"
const THREAT_VERB_CLOSE_RE = /\b(vow|vows|vowed|threaten|threatens|threatened|pledge|pledges|pledged|promise|promises|promised|warn|warns|warned)\b(?:\s+\S+){0,6}?\s+(clos|shut|seal|blockad|block|chok)\w*/i;
// "closure threatens", "blockade looms", "shutdown feared"
const CLOSE_THREAT_NOUN_RE = /\b(closure|blockade|shutdown|sealing|closing)\b(?:\s+\S+){0,4}?\s+(threat|threaten|loom|fear|risk|warn)\w*/i;
// "will stay closed", "could close", "set to shut" — modal then close word
const FUTURE_CLOSE_RE = /\b(will|would|could|may|might|set to|poised to|going to|plans? to|prepares? to|moves? to|threatens? to|vows? to)\b(?:\s+\S+){0,4}?\s+(clos|shut|seal|blockad|block|chok)\w*/i;

// A concrete physical-incident cause means the closure is a REAL operational
// event, even when phrased with a future duration ("Suez will remain closed
// for three days after grounding"). These markers exempt the record from the
// rhetoric filter so genuine confirmed closures are never suppressed.
const CONFIRMED_PHYSICAL_CAUSE_RE = /\b(ran aground|aground|grounding|grounded|refloat\w*|salvag\w*|collision|collided|allision|capsiz\w*|sank|sunk|sinking|wreck\w*|fire|blaze|explosion|blast|debris|engine failure|breakdown|oil spill)\b/i;

/**
 * True when the text is a political closure threat / rhetoric / claim about a
 * waterway rather than a report of a confirmed closure. Requires a waterway
 * AND an intent-or-future close shape; a concrete physical-incident cause
 * exempts it so factual closures (incl. future-duration ones) are not caught.
 */
export function isRhetoricalClosureThreat(text: string): boolean {
  if (!WATERWAY_RE.test(text)) return false;
  if (CONFIRMED_PHYSICAL_CAUSE_RE.test(text)) return false;
  return (
    THREAT_VERB_CLOSE_RE.test(text) ||
    CLOSE_THREAT_NOUN_RE.test(text) ||
    FUTURE_CLOSE_RE.test(text)
  );
}

// Media-packaging headlines: video reels, photo galleries, live blogs and
// "Latest AP News Video" wire packaging. These are presentation wrappers,
// not operational incident reports, so they must not surface as incidents.
export const MEDIA_PACKAGING_RE = /(\bnews video\b|\bap (news )?video\b|\bvideo:|\bwatch:|\bwatch live\b|\blive blog\b|\bliveblog\b|\blive updates?\b|\bin pictures\b|\bphoto gallery\b|\bslideshow\b|\bphotos:|\bwebcam\b|\braw video\b|\bcaught on camera\b)/i;

// Capability, procurement, sea-trial and exercise news (e.g. a navy's new
// minehunting drone, a frigate commissioning, a joint naval drill). This is
// capability / advisory context, not a live operational incident, so it must
// not be selected as the Latest Significant Incident. Applied narrowly to
// that headline pick rather than dropped wholesale from the file.
// NOTE: deliberately omits a bare "launched new" / "to order" fragment —
// those match real operational reporting ("group launched new attacks",
// "ordered to evacuate"). Capability nouns are required instead.
export const CAPABILITY_PROCUREMENT_RE = /\b(minehunt\w*|mine[\s-]?hunting|mine[\s-]?countermeasures?|unveil\w*|to (buy|procure|acquire)|procure\w*|test[\s-]?fir\w*|sea trials?|christen\w*|commission(s|ed|ing)?|new (drone|warship|frigate|destroyer|corvette|patrol (boat|vessel)|submarine|minehunter|minesweeper|capability|technology)|takes delivery of|delivery of (new|its)|maiden (voyage|deployment)|naval exercise|joint (naval )?(drill|exercise|patrol)|war ?games?)\b/i;

// Pure freight-market index / rate-tracker commentary with no operational
// anchor. Drewry WCI, Baltic indices, container freight rate weekly updates.
export const FREIGHT_MARKET_INDEX_RE = /\b(drewry|world container index|\bwci\b|baltic (dry|exchange|capesize|panamax|supramax|handysize) index|\bbdi\b|\bbci\b|\bbpi\b|harpex|shanghai containerized freight index|\bscfi\b|ningbo containerized freight index|\bncfi\b|container (rate|rates|spot rate|spot rates|index) (rise|rises|risen|rose|edged|jump|jumped|fall|fell|drop|dropped|slide|slid|surge|surged|hold|holds|holding|steady|stable|flat|softer|firmer)|freight (rate|rates) (rise|rises|risen|rose|edged|jump|jumped|fall|fell|drop|dropped|slide|slid|surge|surged|hold|holds|holding|steady|stable|flat|softer|firmer)|spot rates? (rise|rises|risen|rose|edged|jump|jumped|fall|fell|drop|dropped|slide|slid|surge|surged|hold|holds|holding|steady|stable|flat|softer|firmer))\b/i;

/**
 * Returns true if a shipping record should be treated as low-credibility or
 * human-interest noise. Records flagged here are kept in the underlying
 * dataset but excluded from analyst-narrative surfaces (Latest Significant,
 * Chokepoint operational read, Hormuz indicators, Vessel / Piracy tables).
 */
export function isLowCredibilityShippingRecord(i: MaritimeRecordLike): boolean {
  if (SOCIAL_HANDLE_TITLE_RE.test(i.title ?? "")) return true;
  const src = `${i.source ?? ""} ${i.sourceUrl ?? ""}`;
  if (SOCIAL_SOURCE_RE.test(src)) return true;
  const text = `${i.title ?? ""} ${i.summary ?? ""}`;
  if (HUMAN_INTEREST_RE.test(text)) return true;
  if (SPECULATIVE_CLAIM_RE.test(text)) return true;
  if (GENERIC_COMMENTARY_RE.test(text)) return true;
  if (isRhetoricalClosureThreat(text)) return true;
  if (MEDIA_PACKAGING_RE.test(text)) return true;
  return false;
}

/**
 * Capability / procurement / exercise context (a navy's new minehunting
 * drone, a frigate commissioning, a joint drill). Kept in the file but
 * excluded from the Latest Significant Incident pick so a capability story
 * cannot stand in for a live operational incident.
 */
export function isCapabilityContext(i: MaritimeRecordLike): boolean {
  return CAPABILITY_PROCUREMENT_RE.test(`${i.title ?? ""} ${i.summary ?? ""}`);
}

function blob(i: MaritimeRecordLike): string {
  return `${i.title ?? ""} ${i.summary ?? ""} ${i.location ?? ""}`;
}

/**
 * Return every chokepoint mentioned by the record. A single attack in the
 * Strait of Hormuz can legitimately surface under both Hormuz and the wider
 * Persian/Arabian Gulf row, so we do not stop at the first hit.
 */
export function detectChokepoints(i: MaritimeRecordLike): ChokepointKey[] {
  const text = blob(i);
  const hits: ChokepointKey[] = [];
  for (const r of CHOKEPOINT_RULES) {
    if (r.match(text)) hits.push(r.key);
  }
  return hits;
}

/**
 * Convenience — first chokepoint match, used when picking a single label.
 */
export function detectChokepoint(i: MaritimeRecordLike): ChokepointKey | null {
  return detectChokepoints(i)[0] ?? null;
}

// ---------------------------------------------------------------------------
// Piracy and Armed Robbery
//
// Captures piracy, armed robbery at sea, boarding, attempted boarding,
// suspicious approach, small craft approach, hijacking, crew threat and
// theft from a vessel at anchorage. Land cargo theft is excluded — that
// remains under Cargo Watch.
// ---------------------------------------------------------------------------

export type PiracyAct =
  | "Hijacking"
  | "Armed robbery"
  | "Piracy"
  | "Boarding"
  | "Attempted boarding"
  | "Suspicious approach"
  | "Small craft approach"
  | "Crew threat"
  | "Theft from vessel at anchorage";

// Hard exclusion — clear land/warehouse cargo theft must not be labelled
// piracy. Cargo Watch remains the home for those records.
const LAND_CARGO_RE =
  /\b(warehouse|depot|truck|lorry|convoy|highway|road|yard|parking|shipping container yard|distribution centre|distribution center)\b/i;

// Statistical roundups and multi-period retrospectives are not discrete piracy
// EVENTS even though they quote "armed robbery"/"piracy". ReCAAP's annual /
// half-yearly / quarterly tallies and "N-year record" or trend headlines
// ("incidents reported in 2025", "cases surged in the first half of 2025")
// must never seed the Piracy & Armed Robbery table as if each were a single
// boarding. Weekly incident bulletins ("Two incidents of armed robbery 24
// February – 2 March") and discrete reports carry no period-tally framing, so
// they are unaffected.
const PIRACY_STAT_RE =
  /\b(half[- ]?yearly|annual report|quarterly report|in (the )?first (three|six|nine) months|first half of \d{4}|jan(uary)?[-–\s]*(sep|sept|september|jun|june)|\d{2}[- ]year (record|high)|highest (in|since)|record (high|number)|(reported|recorded) in \d{4}|(incidents|cases) (have )?(surge|surged|spike|spiked|doubled|tripled|risen|rose|fell|fallen|jumped|climbed))\b/i;

const PIRACY_RULES: Array<{ type: PiracyAct; pattern: RegExp }> = [
  { type: "Hijacking", pattern: /\b(hijack(ed|ing)?)\b/i },
  { type: "Attempted boarding", pattern: /\battempted boarding\b/i },
  { type: "Armed robbery", pattern: /\b(armed robbery (against|at sea|on board|in port|at anchorage)?|robbery (against|at sea) (a |the )?(ship|vessel|tanker)|robbery on board)\b/i },
  { type: "Piracy", pattern: /\b(piracy|pirat(e|es))\b/i },
  { type: "Boarding", pattern: /\b(boarded by (pirates|robbers|armed (men|gang|gunmen))|pirates? boarded|robbers? boarded|armed (men|gang|gunmen) boarded)\b/i },
  { type: "Suspicious approach", pattern: /\bsuspicious approach\b/i },
  { type: "Small craft approach", pattern: /\b(small craft approach|approached by (a )?skiffs?|skiff (sighted|approach))\b/i },
  { type: "Crew threat", pattern: /\b(crew (kidnap|abduct|threat|held hostage|taken hostage|injured by (pirates|robbers))|hostage taking at sea)\b/i },
  { type: "Theft from vessel at anchorage", pattern: /\b(theft from vessel|petty theft .{0,15}(anchorage|vessel|ship)|theft .{0,15}anchorage|stores theft .{0,15}(vessel|ship))\b/i },
];

/**
 * Classify a record as a piracy/armed-robbery type, or return null if it is
 * not a piracy event. Land cargo theft is always rejected.
 */
export function classifyPiracy(i: MaritimeRecordLike): PiracyAct | null {
  const text = blob(i);
  if (LAND_CARGO_RE.test(text) && !/\b(at sea|at anchorage|on board|vessel|ship|tanker|dhow|crew)\b/i.test(text)) {
    return null;
  }
  // Repatriation / crew-return / human-interest follow-ups are not piracy
  // events even when the text mentions a previous hijacking or seizure.
  if (HUMAN_INTEREST_RE.test(text)) return null;
  // Period tallies / trend retrospectives are not discrete events.
  if (PIRACY_STAT_RE.test(text)) return null;
  for (const r of PIRACY_RULES) {
    if (r.pattern.test(text)) return r.type;
  }
  return null;
}

export const PIRACY_ACTS: PiracyAct[] = [
  "Hijacking",
  "Armed robbery",
  "Piracy",
  "Boarding",
  "Attempted boarding",
  "Suspicious approach",
  "Small craft approach",
  "Crew threat",
  "Theft from vessel at anchorage",
];

// ---------------------------------------------------------------------------
// Region classification (APAC + Middle East only)
// ---------------------------------------------------------------------------

export const MIDDLE_EAST = new Set([
  "Saudi Arabia","UAE","United Arab Emirates","Oman","Qatar","Bahrain","Kuwait",
  "Jordan","Iraq","Yemen","Israel","Lebanon","Syria","Turkey","Turkiye","Türkiye",
  "Iran",
]);

export const APAC = new Set([
  "Singapore","Malaysia","Indonesia","Thailand","Vietnam","Philippines","Cambodia","Laos","Myanmar",
  "India","Pakistan","Bangladesh","Sri Lanka","China","Taiwan","South Korea","Japan",
  "Australia","New Zealand","Papua New Guinea","West Papua",
]);

export type Region = "Middle East" | "APAC" | "Out of scope" | "Country not identified";

export function classifyRegion(country: string | null | undefined): Region {
  if (!country) return "Country not identified";
  const first = country.split(/[;,]/)[0].trim();
  if (!first) return "Country not identified";
  if (/^unknown$/i.test(first)) return "Country not identified";
  if (MIDDLE_EAST.has(first)) return "Middle East";
  if (APAC.has(first)) return "APAC";
  return "Out of scope";
}

export const REGION_COLOR: Record<Region, string> = {
  "Middle East": "#0b0a3d",
  "APAC": "#465bff",
  "Country not identified": "#7A8FA6",
  "Out of scope": "#B8C2CC",
};

// ---------------------------------------------------------------------------
// Issue Type classification — 10-label vocabulary used by the Shipping page
// and the Shipping report. Order matters (most-specific first).
// ---------------------------------------------------------------------------

export const ISSUE_RULES: Array<{ label: string; pattern: RegExp }> = [
  { label: "Piracy / armed robbery", pattern: /\b(piracy|pirat(e|es)|armed robbery (against|at sea|on board|in port|at anchorage)|robbery (against|at sea) (a |the )?(ship|vessel|tanker)|robbery on board|attempted boarding|boarded by (pirates|robbers|armed (men|gang|gunmen))|pirates? boarded|robbers? boarded|armed (men|gang|gunmen) boarded|suspicious approach|small craft approach|approached by (a )?skiffs?|skiff (sighted|approach)|crew (kidnap|abduct|held hostage|taken hostage)|theft from vessel|petty theft .{0,15}(anchorage|vessel|ship)|theft .{0,15}anchorage)\b/i },
  { label: "Vessel seizure", pattern: /\b(vessel seiz|ship seiz|tanker seiz|seized .{0,30}(ship|tanker|vessel|dhow|carrier|cargo)|seizure of .{0,20}(ship|tanker|vessel|dhow|carrier)|hijack(ed)?|commandeered|detained .{0,20}(vessel|tanker|ship|crew|cargo)|stopped in iranian waters|bulk carrier stopped|us[- ]seized vessels?|iran seized|seized two .{0,20}ships?|seized .{0,5}foreign|forced (sale|transfer))\b/i },
  { label: "Vessel attack", pattern: /\b(vessel attack|tanker attack|ship attack|attack(ed|s)? .{0,30}(ship|tanker|vessel|carrier|dhow|cargo|bulk carrier|container ship)|attack(ed)? by (multiple )?(small (craft|boats?)|skiffs?|iranian)|attack on (a |the )?(ship|tanker|vessel|carrier|dhow|cargo|hmm)|missile .{0,20}(ship|tanker|vessel|carrier|hmm|cargo)|drone .{0,20}(ship|tanker|vessel|carrier|cargo)|fired (upon|at|on)|fired on by|tanker (fired upon|hit|struck|set ablaze|ablaze|on fire)|(ship|vessel|carrier|cargo ship|bulk carrier|container ship|tanker) .{0,20}(hit|struck|set ablaze|ablaze|on fire|catches fire|caught fire|attacked|ablaze)|hit by (gunfire|projectile|projectiles|unknown projectile|unknown projectiles|small craft)|three (vessels|ships|container ships) (hit|targeted|attacked)|gunfire (hit|near|in|in strait)|fire (aboard|on board|aboard a|aboard the|breaks out on|happened at|extinguished on)|fire breaks out on .{0,20}vessels?|external strike|came under fire|comes under fire|targeted by .{0,30}(vessel|ship|iranian|missile|drone)|skiff attack|houthi attack|iranian (attack|strike|vessel)|repel(led)? drone|targeted .{0,20}iranian|ship attack debris|attack debris|near miss|warning shot|narrowly (missed|avoided)|missile (fell|landed) near|drone (fell|landed) near|intercepted near|missile alert)\b/i },
  { label: "Maritime advisory", pattern: /\b(ukmto (reports?|warns?|warning|advisory|alert|issues warning|says)|ukmto:|naval (advisory|patrol|escort|operation|protection)|coast guard advisory|imo advisory|maritime (warning|advisory|alert|security (crisis|threat))|nav warning|notice to mariners|navy assists|under (u\.s\.|us|american) (military )?(protection|escort)|project freedom|operation freedom|us warship escort|escort (foreign|mission)|escorted to|escorted by|pentagon statement|force protection|navy (assists|monitors))\b/i },
  { label: "Chokepoint risk", pattern: /\b(strait of hormuz|hormuz strait|bab[- ]el[- ]mandeb|suez canal|panama canal|malacca|lombok strait|singapore strait|gibraltar|chokepoint|transit risk|transit volume|tanker traffic|patrol zones?|red sea (route|risk|transit)|gulf of oman|persian gulf|arabian gulf|hormuz (closure|transit|risk|exit|won't go back|shut)|clears strait)\b/i },
  { label: "Route diversion", pattern: /\b(reroute|re[- ]routing|diverted?|diverting|divert(ed)? (away|around)|cape of good hope|avoiding (hormuz|red sea|gulf|strait)|vessel delay|transit delay|schedule disruption|shipping delay|delivery delay|delayed (shipment|cargo)|adrift|collision|grounded|crew (repatriated|safe|evacuated|stranded)|vessel (stranded|passed through|relocate|repositioning)|first .{0,30}transits?|traffic shifts? away|ghost tanker|bypassed .{0,20}sanctions|slipped past|moving .{0,20}barrels|ship-to-ship transfers?|sanctions enforcement|sanctions dragnet|sanctions threats?|breaks through sanctions)\b/i },
  { label: "Port disruption", pattern: /\b(port (workers? )?strike|dock(workers?| strike)|stevedore strike|labour (dispute|stoppage|action)|union (walkout|strike)|port (closure|closed|shutdown|halted|suspended|disruption|congestion)|terminal (closed|shut|congestion)|congestion at (the )?port|berth (closure|delay|congestion)|harbou?r (closure|disruption)|panama canal congestion|canal congestion|maintenance work .{0,20}(canal|port)|port of darwin|port incident|incident at .{0,20}port)\b/i },
  { label: "Insurance / freight pressure", pattern: /\b(war risk (premium|insurance|zone)|insurance (premium|surcharge|cost)|freight rate|bunker surcharge|p&i club|hull premium|baltic (dry|exchange) index|world container index|new contex|container ship time charter|spot rate(s)?|charter rate|charter assessment|aframax prices|tanker prices|vlcc (market|prices?|freight)|vlgc (freight )?rates?|tankers?: vlcc|freight (rates? (rising|recovery|up|down|surge|soaring)|recovery|soaring)|rates soaring|shipping rates (have )?(shot up|rose|rising|surge)|cheap spot rates|peak season|ws[0-9]+|tce down|tce up|mediterranean\/east index)\b/i },
  { label: "Commercial shipping disruption", pattern: /\b(cargo (delay|disruption|halt|backlog|movement|flows?)|container (backlog|delay|handling)|supply chain disruption|liner service (suspension|cancell)|service suspension|sailing cancelled|blank sailing|export (halt|suspension)|import (halt|disruption)|market share|orderbook|newbuild|newbuilding|new entrant|charter (acquisition|deal|purchase|locks?|fix(ed|es)?)|locks first|fleet (acquisition|renewal|deal|strategy|exposure)|m&a|merger|joint venture|company of the year|banned from (australia|port)|unpaid crew wages|earnings|quarterly|annual report|first[- ]quarter|q1 (results?|performance)|volume growth|cooperation deal|logistics push|legal action|relocate headquarters|biomethanol|long[- ]term charter|long[- ]term deal|product tanker|crude carrier|vlcc (newbuild|owner|charter|trading|sanctions|supertanker))\b/i },
];

export const ISSUE_PALETTE = ["#0b0a3d", "#465bff", "#363636", "#7A8FA6", "#B8C2CC", "#6FB872", "#E67E22", "#C0392B", "#0b0a3d", "#465bff"];

// ---------------------------------------------------------------------------
// Vessel Incident classification (strict hostile-only)
// ---------------------------------------------------------------------------

export type VesselIncidentType = "Attack" | "Near miss" | "Seized" | "Threat";

// Commercial / market / finance / regulatory noise. Records whose text matches
// any of these are excluded outright.
export const COMMERCIAL_RE =
  /\b(orderbook|newbuild|newbuilds|charter (rate|assessment|index)|time charter|freight rate|spot rate|baltic dry|world container index|earnings|profit|results|acquisition|fleet renewal|partnership|deal|merger|joint venture|sold|sale of|orders?\b|quarterly|annual report|lng (application|approval|terminal application)|payment dispute|invoice|tariff dispute|port congestion|berth congestion|container backlog|shipping finance|bond issu|equity raise|ipo)\b/i;

// Diplomatic follow-up / investigations / commentary referencing a previous
// vessel attack are NOT new hostile incidents.
export const DIPLOMATIC_FOLLOWUP_RE =
  /\b(diplomatic (offensive|response|push|protest|demarche) .{0,60}(vessel|tanker|ship|attack|seizure|hijack)|probe (into|of) .{0,40}(vessel|tanker|ship|attack|seizure|hijack)|additional probe .{0,40}(vessel|tanker|ship|attack|seizure|hijack)|investigation (into|of|update) .{0,40}(vessel|tanker|ship|attack|seizure|hijack)|discussions? (regarding|about|on) .{0,40}(vessel|tanker|ship|attack|seizure|hijack)|talks (about|regarding|on) .{0,40}(vessel|tanker|ship|attack|seizure|hijack)|actor behind .{0,40}(attack|vessel|tanker|seizure|hijack)|condemn(s|ed|ation) .{0,40}(attack|vessel|tanker|seizure|hijack)|aftermath of .{0,40}(attack|vessel|tanker|seizure|hijack)|foreign ministry .{0,60}(vessel|tanker|attack|seizure|hijack)|statement (on|about|regarding) .{0,40}(vessel|tanker|attack|seizure|hijack)|response to .{0,40}(vessel|tanker|attack|seizure|hijack)|recent (vessel|tanker|ship) attack|previous (attack|incident|seizure|hijack)|will take .{0,30}(diplomatic|response) .{0,40}(vessel|tanker|attack|seizure|hijack)|to conduct .{0,30}(probe|investigation) .{0,40}(vessel|tanker|attack|seizure|hijack))\b/i;

const VESSEL_RULES: Array<{ type: VesselIncidentType; pattern: RegExp }> = [
  { type: "Seized", pattern: /\b(seized|seizure|boarded by|hijack(ed)?|detained .*(vessel|ship|tanker|crew)|commandeered|vessel (taken|captured))\b/i },
  { type: "Near miss", pattern: /\b(near miss|narrowly (missed|avoided)|warning shot|missile (fell|landed) near|drone (fell|landed) near|missed (a |the )?(vessel|tanker|ship)|intercepted near|shot down near (a |the )?(vessel|tanker|ship))\b/i },
  { type: "Attack", pattern: /\b(attack(ed)? (on |by )?(a |the )?(ship|tanker|vessel|carrier|dhow)|vessel attack|tanker attack|missile (hit|struck|targeted) (a |the )?(ship|tanker|vessel|carrier)|drone (hit|struck|targeted) (a |the )?(ship|tanker|vessel|carrier)|ship hit|tanker hit|vessel (hit|on fire|ablaze|struck)|small craft attack|skiff attack|houthi attack|terrorist attack on (a |the )?(vessel|ship|tanker)|fired (upon|at) (a |the )?(vessel|ship|tanker))\b/i },
  { type: "Threat", pattern: /\b(ukmto (advisory|warning|alert|incident)|maritime (advisory|warning|threat) (to|against) shipping|threat to (shipping|vessel|tanker|ship)|hostile (act|activity) (toward|against) (a |the )?(vessel|ship|tanker)|suspicious approach (to|by) (vessel|ship|tanker)|approached by (small craft|skiffs?))\b/i },
];

export function classifyVesselIncident(i: MaritimeRecordLike): VesselIncidentType | null {
  const text = `${i.title ?? ""} ${i.summary ?? ""}`;
  if (COMMERCIAL_RE.test(text)) return null;
  if (DIPLOMATIC_FOLLOWUP_RE.test(text)) return null;
  // Repatriation, crew-return and human-interest follow-ups are NEVER
  // hostile vessel incidents — they are downstream of the maritime security
  // picture, not operational drivers of it. This is the single change that
  // also clears the Hormuz kinetic gate (which defers to this classifier)
  // and the Vessel Attacks / Seizures KPI.
  if (HUMAN_INTEREST_RE.test(text)) return null;
  // Speculative / unverified strike-claim language is not a confirmed
  // hostile incident either; let it fall to the issue classifier as
  // commentary instead.
  if (SPECULATIVE_CLAIM_RE.test(text)) return null;
  for (const r of VESSEL_RULES) if (r.pattern.test(text)) return r.type;
  return null;
}

export const VESSEL_ACCENT: Record<VesselIncidentType, string> = {
  Attack: "#C0392B",
  "Near miss": "#E67E22",
  Seized: "#0b0a3d",
  Threat: "#7A8FA6",
};

// ---------------------------------------------------------------------------
// Issue Type (10-label) classifier. Uses the strict vessel classifier above
// for the Vessel attack / Vessel seizure labels so the issue chart aligns
// with the Vessel Attacks carousel.
// ---------------------------------------------------------------------------

export function classifyIssue(i: MaritimeRecordLike): string {
  const text = `${i.title ?? ""} ${i.summary ?? ""}`;
  if (ISSUE_RULES[0].pattern.test(text)) return ISSUE_RULES[0].label;
  const v = classifyVesselIncident(i);
  if (v === "Attack" || v === "Near miss") return "Vessel attack";
  if (v === "Seized") return "Vessel seizure";
  for (let k = 3; k < ISSUE_RULES.length; k++) {
    if (ISSUE_RULES[k].pattern.test(text)) return ISSUE_RULES[k].label;
  }
  return "Unclassified maritime record";
}

// ---------------------------------------------------------------------------
// Confirmed-operational gate
//
// The incident surfaces (Related Incidents table, Latest Significant
// Incident, chokepoint operational counts) must show ONLY events that have
// actually occurred to a vessel, crew, port or waterway. Claims, threats,
// planning/intent language, predictions, diplomacy and advisory/escort
// posture are NOT confirmed incidents and must never be presented as
// confirmed disruption — they belong to threat / rhetoric / advisory watch.
//
// This is a POSITIVE gate (include only if confirmed), the inverse of the
// noise denylist. A bare "Iran blocks Strait of Hormuz", "plans blockade",
// "full closure", "blockade escalates tensions" or "transits are rising"
// headline carries no concrete operational action, so it is excluded by
// default rather than having to be matched by a suppression rule.
// ---------------------------------------------------------------------------

// Planning / intent / prediction / diplomacy language: the event has NOT
// occurred. "Iran plans blockade", "weighs closing Hormuz", "vows to seal",
// "threatens closure", "predicts oil will flow", "warns of closure",
// "escalates tensions". A concrete physical cause (grounding, collision,
// fire) overrides this — that is a real event phrased with an outlook.
export const PLANNING_INTENT_RE = /\b(plans?|planning|prepares?|preparing|considers?|considering|weighs?|weighing|mulls?|mulling|vows?|vowed|pledges?|pledged|threatens?|threatened|warns? of|warning of|predicts?|predicted|forecasts?|forecasting|expected to|set to|poised to|risks? of|fears? of|escalat\w+ tensions?|tensions? (rise|rising|mount\w*|flare\w*|escalat\w*)|war of words)\b/i;

// Concrete port / route / physical-disruption events that have actually
// happened: a port closure or strike in effect, a canal blocked by a hull,
// a grounding/collision/fire/sinking, vessels rerouted or diverted. These
// are operational incidents even though they are not vessel attacks or
// piracy. Intent and threat words are deliberately absent here.
const CONFIRMED_PORT_ROUTE_RE = /\b(port (closed|closure|shut|shutdown|halted|suspended|congestion)|port strike|terminal (closed|shut|congestion)|berth (closed|closure|blocked)|(dock|stevedore|port)\s?workers?'? strike|dockworkers?'? strike|labou?r (strike|stoppage|walkout)|union (strike|walkout)|reroute|re[- ]?rout(ed|ing)|diverted|diverting|cape of good hope|ran aground|aground|grounding|grounded|refloat\w*|salvag\w*|collision|collided|allision|capsiz\w*|sank|sunk|sinking|wreck\w*|oil spill|canal (blocked|blockage|closed)|vessel (stranded|adrift|disabled)|broke down|engine failure|breakdown)\b/i;

// Concrete CONFIRMED causes that override the planning/intent veto: a real
// event phrased with a forward-looking clause ("port closed after strike,
// expected to reopen") is still a confirmed incident. This is the physical
// causes PLUS in-effect port/terminal/berth closures, dock/labour strikes,
// canal blockages and disabled vessels — but deliberately NOT the weak,
// prediction-prone route terms (reroute / diverted / cape of good hope /
// congestion), so pure claims ("plans blockade", "predicts oil will flow")
// keep returning false.
const CONFIRMED_INCIDENT_CAUSE_RE = /\b(ran aground|aground|grounding|grounded|refloat\w*|salvag\w*|collision|collided|allision|capsiz\w*|sank|sunk|sinking|wreck\w*|fire|blaze|explosion|blast|debris|engine failure|breakdown|oil spill|port (closed|closure|shut|shutdown|halted|suspended)|port strike|terminal (closed|shut)|berth (closed|closure|blocked)|(dock|stevedore|port)\s?workers?'? strike|dockworkers?'? strike|labou?r (strike|stoppage|walkout)|union (strike|walkout)|canal (blocked|blockage|closed)|vessel (stranded|adrift|disabled))\b/i;

/**
 * True only when a record reports a CONFIRMED operational shipping event —
 * an attack, seizure, piracy/armed-robbery act, or a concrete port/route/
 * physical disruption that has actually occurred. Claims, threats, planning,
 * predictions, diplomacy, advisory/escort posture and pure chokepoint
 * commentary all return false, so they cannot be presented as incidents.
 */
export function isConfirmedOperationalIncident(i: MaritimeRecordLike): boolean {
  // Never confirmed if it is noise, human-interest, speculative claim,
  // rhetoric, media packaging, or capability/procurement context.
  if (isLowCredibilityShippingRecord(i)) return false;
  if (isCapabilityContext(i)) return false;
  // Concrete hostile events — the strict classifiers already reject
  // commentary, diplomatic follow-up, speculative claims and human-interest,
  // so a match here is a real attack / seizure / piracy act.
  if (classifyPiracy(i)) return true;
  const v = classifyVesselIncident(i);
  if (v === "Attack" || v === "Near miss" || v === "Seized") return true;
  // Port / route / physical-disruption events. An advisory "Threat" vessel
  // type, a bare chokepoint mention, or an escort/transit story falls
  // through to here and is rejected unless a concrete disruption is present.
  const text = `${i.title ?? ""} ${i.summary ?? ""}`;
  if (isRhetoricalClosureThreat(text)) return false;
  if (PLANNING_INTENT_RE.test(text) && !CONFIRMED_INCIDENT_CAUSE_RE.test(text)) {
    return false;
  }
  return CONFIRMED_PORT_ROUTE_RE.test(text);
}

// Daily Intelligence Summary buckets — must match the 10-label vocabulary.
export const TRANSIT_ISSUES = new Set<string>([
  "Chokepoint risk",
  "Route diversion",
  "Maritime advisory",
]);
export const COMMERCIAL_ISSUES = new Set<string>([
  "Port disruption",
  "Commercial shipping disruption",
  "Insurance / freight pressure",
]);
