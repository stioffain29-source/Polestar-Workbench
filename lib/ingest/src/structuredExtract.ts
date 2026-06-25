// Theatre-agnostic structured extraction core for the per-incident country
// briefs (Papua New Guinea, West Papua, ...).
//
// The category rulebook + business-impact lines + the occurred-vs-reported date
// parser are GENERIC security classifications — they carry no theatre-specific
// geography. Only the city -> province gazetteer is theatre-specific, so each
// theatre module (pngExtract.ts, westPapuaExtract.ts) supplies its own
// gazetteer and wraps the shared functions here. This keeps the two briefs from
// drifting: a change to how a robbery / road closure / protest is categorised
// applies to every theatre at once.
//
// Additive and theatre-scoped at the call site: these helpers run ONLY for rows
// the flashpoint country resolver attributes to a structured-brief theatre, so
// the derived attributes never leak into other countries. The columns they
// populate (province / category / business_impact / incident_date) are
// nullable; every consumer falls back to location / topic / occurredAt when
// they are absent.

import { hasWord } from "./text";

export type IncidentCategory =
  | "Terrorism / militancy"
  | "Armed robbery / hold-up"
  | "Tribal / communal violence"
  | "Homicide / violent crime"
  | "Theft / break-in"
  | "Civil unrest / protest"
  | "Labour action"
  | "Policing operation"
  | "Community policing"
  | "Intelligence / training"
  | "Corrections / detention"
  | "Aviation / airport"
  | "Maritime / port"
  | "Road / highway"
  | "Natural hazard"
  | "Fire"
  | "Environmental / haze"
  | "Power / utilities"
  | "Telecoms / connectivity"
  | "Government stability"
  | "Other security";

// Ordered most-specific-first. The first regex to match wins.
const CATEGORY_RULES: Array<{ re: RegExp; category: IncidentCategory; impact: string }> = [
  {
    // Bilingual (English + Bahasa Indonesia). Placed first so a lethal terror
    // event ("bom bunuh diri tewaskan ...") classifies as terrorism, not as a
    // generic homicide. PNG/WP English text rarely carries this vocab, so the
    // existing Pacific-brief classification is unaffected.
    re: /\b(terroris\w*|terror (?:attack|cell|plot|suspect|network)|suicide bomb\w*|bomb blast|car bomb|truck bomb|letter bomb|pipe bomb|improvised explosive(?: device)?|roadside bomb|jihadist|extremist (?:attack|cell|network)|teroris\w*|bom bunuh diri|ledakan bom|serangan bom|bom rakitan|densus 88|jaringan teroris)\b/i,
    category: "Terrorism / militancy",
    impact: "Terrorism-related security threat; review physical security, access control and emergency procedures at exposed sites.",
  },
  {
    re: /\b(armed robbery|hold[- ]?up|carjack(?:ing|ed)?|stick[- ]?up|heist|raskol|rascal gang|gang robbery|armed hold[- ]?up|begal|pembegalan|perampokan bersenjata|rampok bersenjata)\b/i,
    category: "Armed robbery / hold-up",
    impact: "Direct threat to staff, cash-in-transit and premises in the affected area; review movement and security cover.",
  },
  {
    re: /\b(tribal (?:fight|clash|war|warfare|violence|conflict)|payback (?:killing|attack)|inter[- ]?clan|clan (?:fight|war|clash)|communal (?:violence|clash)|tawuran|bentrok(?:an)? antar\w*|bentrok warga|konflik komunal|perang suku)\b/i,
    category: "Tribal / communal violence",
    impact: "Road closures, supply-chain disruption and personnel-movement risk across the affected district.",
  },
  {
    re: /\b(murder(?:ed|s)?|homicide|manslaughter|massacre|shot dead|stabb(?:ed|ing)|gunned down|beaten to death|found dead|fatalit(?:y|ies)|killed|shooting|opened fire|pembunuhan|penembakan|penikaman|ditembak(?: mati| tewas)?|ditikam|tewas dibunuh|dibunuh|mutilasi|pengeroyokan)\b/i,
    category: "Homicide / violent crime",
    impact: "Heightened personal-security risk locally; review after-hours exposure and movement protocols.",
  },
  {
    re: /\b(community polic\w*|neighbou?rhood watch|police (?:partnership|community)|safe (?:city|community)|crime[- ]?prevention (?:launch|program|programme|initiative))\b/i,
    category: "Community policing",
    impact: "Net positive for the local security posture; limited direct operational impact.",
  },
  {
    re: /\b(intelligence (?:training|unit|sharing|gathering|course|workshop|capabilit\w*)|police training|capacity[- ]?building|train(?:ing|ed) (?:of |for )?(?:officers|police|recruits|personnel))\b/i,
    category: "Intelligence / training",
    impact: "Security capacity-building; no direct operational disruption expected.",
  },
  {
    re: /\b(correctional (?:service|institution|facility|officers?)|warders?|prison (?:break|escape|riot|unrest|officers?|inmates?)|jail ?break|inmates? escape|cell block|lapas|rutan|narapidana|\bnapi\b|sipir|napi (?:kabur|melarikan))\b/i,
    category: "Corrections / detention",
    impact: "Localised security-force activity; limited direct commercial impact unless escapees are at large.",
  },
  {
    re: /\b(airport|airstrip|airfield|runway|aviation|air ?services|flights?|aircraft|bandara|pesawat|penerbangan|pesawat (?:jatuh|tergelincir)|maskapai)\b/i,
    category: "Aviation / airport",
    impact: "Possible flight-schedule and airport-access disruption affecting travel and air freight.",
  },
  {
    re: /\b(wharf|jetty|port (?:closure|shut|disrupt\w*|congestion|operations?|security)|harbou?r|shipping|maritime|vessel|ferry|pelabuhan|kapal(?: tenggelam| karam| nelayan)?|perahu|feri|kecelakaan kapal)\b/i,
    category: "Maritime / port",
    impact: "Possible cargo-handling and port-access disruption affecting sea freight.",
  },
  {
    re: /\b(highway|road (?:closed|cut|block\w*|landslip|landslide|washed|sealed)|bridge (?:collapse|washed|down|out)|landslip|landslide blocks?|kecelakaan lalu lintas|kecelakaan (?:bus|maut|beruntun)|tabrakan(?: beruntun)?|jalan tol|jalan (?:amblas|putus|tertutup))\b/i,
    category: "Road / highway",
    impact: "Overland freight and personnel-movement disruption on the affected corridor.",
  },
  {
    // NEW (bilingual). Placed AFTER Road/highway so "road blocked by landslide"
    // stays a transport-disruption row; a bare "landslide" / Bahasa hazard term
    // resolves here. English-only PNG/WP text uses these terms only for genuine
    // natural-hazard events, so Pacific briefs gain accuracy, not noise.
    re: /\b(flood(?:s|ing|ed|waters)?|flash flood|inundat\w*|banjir(?: bandang)?|landslide|mudslide|tanah longsor|longsor|earthquake|quake|tremor|gempa(?: bumi)?|tsunami|volcan(?:o|ic|oes)|erupt(?:ion|ed|s|ing)?|gunung (?:meletus|berapi)|letusan|lahar|cyclone|typhoon|tornado|puting beliung|angin (?:kencang|topan)|tanah bergerak)\b/i,
    category: "Natural hazard",
    impact: "Disruption to access, infrastructure and operations from the natural hazard; check site safety, continuity and staff welfare.",
  },
  {
    // NEW (bilingual). Bound to fire-event phrases / "blaze" / Bahasa kebakaran,
    // never the bare word "fire" — the homicide rule above owns "opened fire".
    re: /\b(wildfire|bush ?fire|forest fire|blaze|inferno|conflagration|kebakaran|karhutla|kobaran api|fire (?:broke out|breaks out|gutted|guts|razed|engulf\w*|destroyed|rips? through|tore through|ravaged))\b/i,
    category: "Fire",
    impact: "Property damage and possible business interruption from fire; verify site safety and continuity arrangements.",
  },
  {
    // NEW (bilingual). Air-quality / pollution / spill context.
    re: /\b(haze|smog|air pollution|air quality|toxic (?:waste|spill|smoke|fumes)|oil spill|chemical spill|hazardous waste|kabut asap|polusi udara|pencemaran(?: udara| lingkungan| air)?|limbah (?:beracun|industri|b3)|tumpahan minyak)\b/i,
    category: "Environmental / haze",
    impact: "Environmental and public-health disruption; monitor air-quality advisories and outdoor-work exposure.",
  },
  {
    re: /\b(power (?:outage|blackout|cut|failure|shortage|rationing|crisis)|electricity (?:outage|blackout|cut|crisis)|grid (?:failure|down)|png power|fuel (?:shortage|crisis|outage|ran out|rationing|supply)|pemadaman(?: listrik| bergilir)?|mati lampu|krisis listrik|byar pet)\b/i,
    category: "Power / utilities",
    impact: "Operational disruption from power/fuel interruption; check site continuity and backup supply.",
  },
  {
    re: /\b(telecom\w*|telecommunication\w*|internet (?:outage|down|disrupt\w*|cut)|network (?:outage|down|disrupt\w*)|mobile (?:network|service) (?:down|outage|disrupt\w*)|digicel|connectivity|gangguan (?:internet|jaringan)|jaringan (?:down|terganggu)|akses internet)\b/i,
    category: "Telecoms / connectivity",
    impact: "Connectivity disruption; verify communications redundancy at affected sites.",
  },
  {
    re: /\b(vote of no confidence|government (?:shutdown|instability|stability|crisis|standoff)|political (?:crisis|instability|standoff)|public servants? strike|cabinet (?:reshuffle|crisis)|parliament\w* (?:standoff|deadlock|impasse)|krisis politik|mosi tidak percaya|pemakzulan|reshuffle kabinet|krisis pemerintahan|impeach\w*)\b/i,
    category: "Government stability",
    impact: "Political-risk signal; monitor for downstream policy and security effects.",
  },
  {
    // NEW (bilingual). Placed BEFORE civil unrest so an explicit labour action
    // ("mogok kerja buruh") buckets here; a generic protest still falls through
    // to civil unrest below. "public servants strike" stays Government stability
    // (matched above), so this does not poach political-sector strikes.
    re: /\b(mogok kerja|aksi (?:buruh|mogok)|unjuk rasa buruh|demo buruh|serikat (?:buruh|pekerja)|\bburuh\b|upah minimum|pemutusan hubungan kerja|\bphk\b|labou?r (?:strike|union|dispute|action|protest)|workers'? (?:strike|protest|rally)|trade union|industrial action|general strike|mass layoffs?|laid off|retrenchment)\b/i,
    category: "Labour action",
    impact: "Industrial action with potential operational and supply-chain disruption; review workforce and continuity contingencies.",
  },
  {
    re: /\b(protest|demonstration|rally|march|riot|unrest|looting|roadblock|road block|strike|walkout|stoppage|picket|public disorder|demonstrasi|unjuk rasa|kerusuhan|\brusuh\b|bentrok(?:an)?|aksi (?:massa|demo|unjuk rasa)|\bdemo\b|penjarahan|blokade(?: jalan)?|kericuhan|\bricuh\b)\b/i,
    category: "Civil unrest / protest",
    impact: "Potential road blockages, business closures and movement restrictions in the affected area.",
  },
  {
    re: /\b(theft|stolen|burglary|break[- ]?in|looting|robbery|robbed|pencurian|pembobolan|\bmaling\b|jambret|penjambretan|pencopetan|\bcuranmor\b|pencurian kendaraan)\b/i,
    category: "Theft / break-in",
    impact: "Property and asset-security risk; review premises security in the affected area.",
  },
  {
    re: /\b(police (?:operation|raid|swoop|patrol|deployment|crackdown)|joint (?:operation|patrol|task ?force)|raid(?:ed|s)?|swoop|manhunt|arrest(?:ed|s)?|detain(?:ed|ee|ees)?|apprehend\w*|wanted (?:man|men|criminal|suspect|fugitive)|penggerebekan|digerebek|razia|penangkapan|ditangkap|diamankan polisi|\bburon\b)\b/i,
    category: "Policing operation",
    impact: "Localised disruption and checkpoints; short-term access constraints possible.",
  },
];

export const OTHER_SECURITY_IMPACT =
  "Security-relevant development; monitor for operational follow-on in the affected area.";

// ---------------------------------------------------------------------------
// City / suburb / locality -> province gazetteer
// ---------------------------------------------------------------------------
// A compiled gazetteer pre-sorts its keys longest-first so a suburb / multi-
// word locality wins over a bare token ("west taraka" over "taraka", "mount
// hagen" over "hagen"). Each theatre module compiles its gazetteer once.
export interface CompiledGazetteer {
  map: Record<string, string>;
  keys: string[];
}

export function compileGazetteer(map: Record<string, string>): CompiledGazetteer {
  return { map, keys: Object.keys(map).sort((a, b) => b.length - a.length) };
}

/**
 * Resolve a province from an explicit location string (if known) or by scanning
 * the incident text for a known locality. Returns null when nothing matches, so
 * the report falls back to the location/country label.
 */
export function deriveProvince(
  location: string | null | undefined,
  text: string,
  gazetteer: CompiledGazetteer,
): string | null {
  const loc = (location ?? "").trim().toLowerCase();
  if (loc && gazetteer.map[loc]) return gazetteer.map[loc];
  const hay = `${location ?? ""} ${text}`;
  for (const key of gazetteer.keys) {
    if (hasWord(hay, key)) return gazetteer.map[key];
  }
  return null;
}

// Localities that should display as an acronym rather than title-case.
const LOCALITY_ACRONYMS = new Set(["ncd", "png", "opm"]);

function formatLocality(key: string): string {
  return key
    .split(/[\s-]+/)
    .map((w) =>
      LOCALITY_ACRONYMS.has(w)
        ? w.toUpperCase()
        : w.charAt(0).toUpperCase() + w.slice(1),
    )
    .join(" ");
}

/**
 * Resolve the matched gazetteer LOCALITY (city / suburb / regency) as a display
 * string, mirroring {@link deriveProvince}'s matching (explicit location first,
 * then longest-first word-boundary scan of the text). Returns null when nothing
 * matches. Purely additive: only fills a locality when a known place name
 * literally appears, so it never fabricates a location.
 */
export function deriveLocality(
  location: string | null | undefined,
  text: string,
  gazetteer: CompiledGazetteer,
): string | null {
  const loc = (location ?? "").trim().toLowerCase();
  if (loc && gazetteer.map[loc]) return formatLocality(loc);
  const hay = `${location ?? ""} ${text}`;
  for (const key of gazetteer.keys) {
    if (hasWord(hay, key)) return formatLocality(key);
  }
  return null;
}

export interface StructuredExtraction {
  province: string | null;
  category: IncidentCategory;
  businessImpact: string;
}

/**
 * Derive the per-item structured attributes from the incident text. Province is
 * resolved from the supplied theatre gazetteer; category + business impact come
 * from the shared category rulebook above.
 */
export function extractStructuredItem(
  title: string,
  summary: string,
  location: string | null | undefined,
  gazetteer: CompiledGazetteer,
): StructuredExtraction {
  const text = `${title} ${summary}`;
  const province = deriveProvince(location, text, gazetteer);
  let category: IncidentCategory = "Other security";
  let businessImpact = OTHER_SECURITY_IMPACT;
  for (const rule of CATEGORY_RULES) {
    if (rule.re.test(text)) {
      category = rule.category;
      businessImpact = rule.impact;
      break;
    }
  }
  return { province, category, businessImpact };
}

// ---------------------------------------------------------------------------
// Occurred-vs-reported date parser (generic)
// ---------------------------------------------------------------------------
const MONTHS: Record<string, number> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

const MONTH_ALT =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";

// "26 May", "26th of May 2025", "on 9 June"
const DMY_RE = new RegExp(
  String.raw`\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(${MONTH_ALT})\b(?:[,\s]+(\d{4}))?`,
  "gi",
);
// "May 26", "June 9, 2025"
const MDY_RE = new RegExp(
  String.raw`\b(${MONTH_ALT})\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:[,\s]+(\d{4}))?`,
  "gi",
);

function monthIndex(token: string): number | undefined {
  return MONTHS[token.toLowerCase()];
}

/**
 * Parse an explicit incident-occurrence date from the article text, distinct
 * from the publication date. Returns a Date only when the text names a date
 * that is clearly EARLIER than the publication date (more than two days before)
 * and within the previous ~200 days — the signal that an item "reported this
 * week occurred earlier". Returns null when no such earlier date is stated, in
 * which case consumers treat occurredAt (the publication date) as the incident
 * date.
 */
export function deriveIncidentDate(text: string, pubDate: Date): Date | null {
  const pubMs = pubDate.getTime();
  const minMs = pubMs - 200 * 24 * 60 * 60 * 1000;
  const distinctMs = pubMs - 2 * 24 * 60 * 60 * 1000;
  const pubYear = pubDate.getUTCFullYear();
  const candidates: number[] = [];

  const collect = (day: number, month: number | undefined, yearStr: string | undefined) => {
    if (month === undefined || !day || day < 1 || day > 31) return;
    let year = yearStr ? Number(yearStr) : pubYear;
    let d = Date.UTC(year, month, day);
    // No explicit year and the date lands after publication -> it belongs to
    // the previous year (a December event reported in January).
    if (!yearStr && d > pubMs) d = Date.UTC(year - 1, month, day);
    if (d >= minMs && d <= distinctMs) candidates.push(d);
  };

  let m: RegExpExecArray | null;
  DMY_RE.lastIndex = 0;
  while ((m = DMY_RE.exec(text)) !== null) {
    collect(Number(m[1]), monthIndex(m[2]), m[3]);
  }
  MDY_RE.lastIndex = 0;
  while ((m = MDY_RE.exec(text)) !== null) {
    collect(Number(m[2]), monthIndex(m[1]), m[3]);
  }

  if (candidates.length === 0) return null;
  // Earliest distinct earlier date wins (the event, not a later follow-up ref).
  return new Date(Math.min(...candidates));
}
