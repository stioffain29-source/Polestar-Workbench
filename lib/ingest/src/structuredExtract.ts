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
  | "Explosive remnants of war / accidental explosion"
  | "Environmental / haze"
  | "Power / utilities"
  | "Telecoms / connectivity"
  | "Government stability"
  | "Other security";

// Ordered most-specific-first. The first regex to match wins.
const CATEGORY_RULES: Array<{ re: RegExp; category: IncidentCategory; impact: string }> = [
  {
    // Explosive remnants of war (ERW) / accidental legacy-ordnance explosions.
    // Placed BEFORE terrorism so a Bahasa "Ledakan Bom Sisa Perang Dunia II"
    // (an 80-year-old munition detonating) classifies here, NOT as terrorism
    // (the terrorism rule below owns "ledakan bom"). Requires a HERITAGE /
    // wartime cue CO-OCCURRING with explosion / ordnance vocab (within ~40
    // chars, either order) so a present-day bombing or a WWII-memorial protest
    // is NOT caught — only the legacy-ordnance class. A casualty-bearing ERW
    // detonation is a real, if localised, security-relevant event.
    re: /(?:\b(?:world war (?:ii|2|two)|wwii|ww2|second world war|wartime|perang dunia|sisa perang|peninggalan (?:perang|jepang|belanda|sekutu)|historic ordnance|legacy ordnance)\b[\s\S]{0,40}\b(?:bomb|ordnance|munition|ammunition|shell|grenade|mortar|explo\w*|blast|unexploded|uxo|ledakan|bom|amunisi|mortir|granat|peluru|meledak)\b)|(?:\b(?:bomb|ordnance|munition|ammunition|shell|grenade|mortar|explo\w*|blast|unexploded|uxo|ledakan|bom|amunisi|mortir|granat|peluru|meledak)\b[\s\S]{0,40}\b(?:world war (?:ii|2|two)|wwii|ww2|second world war|wartime|perang dunia|sisa perang|peninggalan (?:perang|jepang|belanda|sekutu)|historic ordnance|legacy ordnance)\b)|\b(?:bom|amunisi|mortir|ranjau) (?:sisa|peninggalan)(?: perang)?\b|\bunexploded ordnance\b|\bwartime (?:bomb|ordnance|munition|ammunition|shell)\b/i,
    category: "Explosive remnants of war / accidental explosion",
    impact:
      "Casualty risk from legacy wartime ordnance; keep the area cordoned, avoid disturbing suspected munitions and defer works near the site until it is cleared.",
  },
  {
    // Bilingual (English + Bahasa Indonesia). Placed after ERW so a lethal
    // terror event ("bom bunuh diri tewaskan ...") classifies as terrorism, not
    // as a generic homicide. PNG/WP English text rarely carries this vocab, so
    // the existing Pacific-brief classification is unaffected.
    re: /\b(terroris\w*|terror (?:attack|cell|plot|suspect|network)|suicide bomb\w*|bomb blast|car bomb|truck bomb|letter bomb|pipe bomb|improvised explosive(?: device)?|roadside bomb|jihadist|extremist (?:attack|cell|network)|teroris\w*|bom bunuh diri|ledakan bom|serangan bom|bom rakitan|densus 88|jaringan teroris)\b/i,
    category: "Terrorism / militancy",
    impact: "Terrorism-related security threat; review physical security, access control and emergency procedures at exposed sites.",
  },
  {
    // Extended with the armed-robbery vocab the Pacific briefs were missing:
    // vehicle/truck/PMV/cargo hijackings (base rule only had "carjack"), the
    // "at gunpoint" armed signal, and cash-in-transit / cash-van targets — the
    // classic PNG cash-van hold-ups and highway truck hijacks that used to fall
    // into "Other security". Hijack is transport-BOUND (never a bare "hijack")
    // so a metaphorical "hijacked the debate" cannot false-hit. All tokens are
    // English, so the shared Indonesia/Jakarta rulebook is unaffected.
    re: /\b(armed robber(?:y|s)?|hold[- ]?up|carjack(?:ing|ed)?|(?:truck|lorry|vehicle|car|bus|pmv|coaster|convoy|cargo|van|taxi)[ -]hijack(?:ed|ing|ings)?|at gunpoint|cash[- ]?in[- ]?transit|cash van|stick[- ]?up|heist|raskol|rascal gang|gang robbery|armed hold[- ]?up|begal|pembegalan|perampokan bersenjata|rampok bersenjata)\b/i,
    category: "Armed robbery / hold-up",
    impact: "Direct threat to staff, cash-in-transit and premises in the affected area; review movement and security cover.",
  },
  {
    re: /\b(tribal (?:fight|clash|war|warfare|violence|conflict)|payback (?:killing|attack)|inter[- ]?clan|clan (?:fight|war|clash)|communal (?:violence|clash)|tawuran|bentrok(?:an)? antar\w*|bentrok warga|konflik komunal|perang suku)\b/i,
    category: "Tribal / communal violence",
    impact: "Road closures, supply-chain disruption and personnel-movement risk across the affected district.",
  },
  {
    // Extended with the crime vocab the Pacific briefs were missing: the noun
    // "killing(s)" / "kills" (the base rule only had the verb "killed"), sexual
    // and gender-based violence, and the PNG-specific sorcery-accusation-related
    // violence (SARV / sanguma). Gang-crime terms are MULTI-WORD-bound
    // ("gang violence|attack|rampage", "criminal gang") — never the bare token
    // "gang", which is Bahasa for "alley" and would false-hit the shared
    // Indonesia/Jakarta rulebook. "sorcery ... laws" / bare "glassman" are
    // deliberately NOT matched so a sorcery-law explainer stays out of crime.
    // "ambush(ed)" is a violent-attack signal (PMV/cash-van ambushes, security
    // forces ambushed) — English-only, so the Indonesia/Jakarta rulebook (which
    // uses "penyergapan") is unaffected.
    re: /\b(murder(?:ed|s)?|homicide|manslaughter|massacre|shot dead|stabb(?:ed|ing)|gunned down|beaten to death|found dead|fatalit(?:y|ies)|killed|killing(?:s)?|kills|shooting|opened fire|ambush(?:ed|es|ing)?|rape(?:d|s)?|sexual (?:assault|violence|abuse)|gender[- ]based violence|gbv|domestic violence|sorcery[ -](?:accusation[ -])?related violence|sorcery accusation|sarv|sanguma|gang (?:violence|attack|rampage)|criminal gang|pembunuhan|penembakan|penikaman|ditembak(?: mati| tewas)?|ditikam|tewas dibunuh|dibunuh|mutilasi|pengeroyokan)\b/i,
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
    // Also catches NON-bomb gas/industrial explosions (gas-cylinder, fuel-depot,
    // factory/pipeline blasts). The terrorism rule above runs first, so a bomb
    // blast / IED stays Terrorism; only qualified gas/industrial phrases resolve
    // here — a bare "explosion" is deliberately NOT matched (could be a bombing).
    re: /\b(wildfire|bush ?fire|forest fire|blaze|inferno|conflagration|kebakaran|karhutla|kobaran api|fire (?:broke out|breaks out|gutted|guts|razed|engulf\w*|destroyed|rips? through|tore through|ravaged)|gas (?:explosion|blast)|gas cylinder (?:explosion|blast)|tabung gas meledak|ledakan gas|fuel (?:tank|depot|station) (?:explosion|blast|fire)|pipeline (?:explosion|blast)|factory (?:explosion|blast)|pabrik meledak|kilang meledak|boiler (?:explosion|blast)|transformer (?:explosion|blast))\b/i,
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
    // NEW (bilingual). NON-violent land / agrarian / eviction tension. Placed
    // AFTER the violent rules (tribal/communal, homicide, armed robbery) so a
    // fatal or armed land clash keeps its violent classification, and AFTER the
    // transport rule so a land-dispute roadblock stays Road/highway; only a pure
    // land/eviction dispute resolves here. Mapped to the existing communal enum
    // (no new enum member); for the operating-risk variant it displays as
    // "Community tension / land dispute".
    re: /\b(land (?:dispute|conflict|grab|grabbing|row|feud|rights protest)|customary land|agrarian (?:conflict|dispute)|forced eviction|evict(?:ion|ions|ed)|sengketa (?:lahan|tanah|agraria)|konflik (?:lahan|agraria|tanah)|perampasan (?:lahan|tanah)|penggusuran|gusur paksa|mafia tanah)\b/i,
    category: "Tribal / communal violence",
    impact: "Community tension over land or resources; potential for localised blockades, disruption and personnel-movement risk in the affected area.",
  },
  {
    re: /\b(protest|demonstration|rally|march|riot|unrest|looting|roadblock|road block|strike|walkout|stoppage|picket|public disorder|demonstrasi|unjuk rasa|kerusuhan|\brusuh\b|bentrok(?:an)?|aksi (?:massa|demo|unjuk rasa)|\bdemo\b|penjarahan|blokade(?: jalan)?|kericuhan|\bricuh\b)\b/i,
    category: "Civil unrest / protest",
    impact: "Potential road blockages, business closures and movement restrictions in the affected area.",
  },
  {
    // NEW (bilingual). Corruption / graft / regulatory-integrity events. Placed
    // AFTER civil unrest (so "demo tolak korupsi" / an anti-corruption rally
    // stays a protest) but BEFORE theft and policing (so "KPK arrests official
    // for graft" resolves here, not as a generic policing/theft item). Mapped to
    // the existing Government stability enum; the operating-risk variant displays
    // it as "Regulatory / corruption / governance".
    re: /\b(corrupt(?:ion)?|graft|bribe(?:ry|s)?|bribed|kickback|embezzl\w*|misappropriat\w*|money laundering|slush fund|korupsi|suap|menyuap|gratifikasi|pungli|pungutan liar|pencucian uang|\bkpk\b|tipikor|operasi tangkap tangan)\b/i,
    category: "Government stability",
    impact: "Governance and integrity risk; monitor for regulatory, procurement and local-authority follow-on.",
  },
  {
    re: /\b(theft|stolen|burglary|break[- ]?in|looting|robbery|robbed|pencurian|pembobolan|\bmaling\b|jambret|penjambretan|pencopetan|\bcuranmor\b|pencurian kendaraan)\b/i,
    category: "Theft / break-in",
    impact: "Property and asset-security risk; review premises security in the affected area.",
  },
  {
    // NEW (bilingual). Vehicle road-collision cues the transport rule above
    // misses: the bare Bahasa root "tabrak" (and menabrak/ditabrak/tabrak
    // lari/beruntun) in a VEHICLE context. Placed AFTER the crime rules (armed
    // robbery, homicide, theft) so a robbery/theft that merely uses "tabrak" as
    // a method ("begal ... pepet dan tabrak", "pencurian ... ditabrak pikap")
    // keeps its crime classification; only a primary vehicle collision resolves
    // here. A collision with no crime context is a road-safety / traffic event,
    // not crime. The narrower ACCIDENT_ONLY_RE reroute below deliberately does
    // NOT list bare "tabrak", so these stay a transport-disruption row rather
    // than rerouting to Natural hazard.
    re: /\b(tabrak lari|tabrak beruntun|(?:mobil|motor|truk|truck|bus|pikap|pick-?up|angkot|angkutan|kendaraan|sepeda motor|ojol|ojek|kereta|minibus|bajaj|metromini|transjakarta|ambulans|sopir|pemotor|pengendara)[^.\n]{0,30}?(?:tabrak|menabrak|ditabrak|nabrak)|(?:menabrak|ditabrak|nabrak|tabrak)[^.\n]{0,30}?(?:mobil|motor|truk|bus|pikap|kaca|gedung|pohon|tiang|pembatas|trotoar|pejalan|orang|warga|pengendara|pemotor))\b/i,
    category: "Road / highway",
    impact: "Overland freight and personnel-movement disruption on the affected corridor.",
  },
  {
    re: /\b(police (?:operation|raid|swoop|patrol|deployment|crackdown)|joint (?:operation|patrol|task ?force)|raid(?:ed|s)?|swoop|manhunt|arrest(?:ed|s)?|detain(?:ed|ee|ees)?|apprehend\w*|wanted (?:man|men|criminal|suspect|fugitive)|penggerebekan|digerebek|razia|penangkapan|ditangkap|diamankan polisi|\bburon\b)\b/i,
    category: "Policing operation",
    impact: "Localised disruption and checkpoints; short-term access constraints possible.",
  },
];

export const OTHER_SECURITY_IMPACT =
  "Security-relevant development; monitor for operational follow-on in the affected area.";

// Accident / natural-hazard reclassification guard (bilingual). The homicide
// rule above owns the bare casualty tokens ("killed", "kills", "found dead",
// "fatality"), so a flood, a snakebite or a bus crash that happens to state a
// death count is otherwise mis-filed as violent crime. This guard runs AFTER the
// rulebook and, when an item was classified as Homicide / violent crime PURELY
// on a casualty word, reroutes it to Natural hazard IF the text names an
// accidental or natural-hazard cause AND carries no explicit-violence token.
// Deliberate killings (shootings, stabbings, bombings, ambushes, assaults) keep
// their violent classification because DELIBERATE_VIOLENCE_RE vetoes the reroute.
const ACCIDENT_HAZARD_RE =
  /\b(snake ?bite|bitten by (?:a )?snake|crocodile attack|shark attack|elephant attack|mauled|drown(?:ed|ing|s)?|swept away|struck by lightning|lightning (?:strike|kill\w*)|electrocut(?:ed|ion)|road accident|traffic accident|road crash|car crash|bus crash|truck crash|motorcycle crash|motorbike crash|vehicle (?:crash|collision|overturn\w*)|head[- ]on collision|pile[- ]?up|overturned (?:bus|truck|vehicle|lorry|minibus)|plunged into (?:a )?(?:ravine|river|gorge)|flood(?:s|ing|ed|waters)?|flash flood|landslide|mudslide|earthquake|quake|tremor|tsunami|volcan(?:o|ic|oes)|erupt(?:ion|ed|s|ing)?|lahar|cyclone|typhoon|tornado|kecelakaan (?:lalu lintas|maut|beruntun|kerja|tunggal|bus)|tabrakan(?: beruntun)?|tenggelam|hanyut|tersambar petir|banjir(?: bandang)?|tanah longsor|longsor|gempa(?: bumi)?)\b/i;
// Narrow accident-only cues (a crash / collision / capsize — NOT a road closure
// or a bare landslide). Used to reroute a Road/highway classification to Natural
// hazard for genuine ACCIDENTS while leaving road closures/landslips as
// transport disruption.
const ACCIDENT_ONLY_RE =
  /\b(road accident|traffic accident|road crash|car crash|bus crash|truck crash|motorcycle crash|motorbike crash|vehicle (?:crash|collision|overturn\w*)|head[- ]on collision|pile[- ]?up|overturned (?:bus|truck|vehicle|lorry|minibus)|plunged into (?:a )?(?:ravine|river|gorge)|kecelakaan (?:lalu lintas|maut|beruntun|kerja|tunggal|bus)|tabrakan(?: beruntun)?)\b/i;
const DELIBERATE_VIOLENCE_RE =
  /\b(murder\w*|homicide|manslaughter|massacre|shot(?: dead)?|stabb\w*|gunned down|beaten to death|shooting|opened fire|ambush\w*|rape\w*|assault\w*|assassinat\w*|bomb\w*|dibunuh|penembakan|ditembak|penikaman|ditikam|pengeroyokan)\b/i;

const NATURAL_HAZARD_IMPACT =
  "Disruption to access, infrastructure and operations from the hazard or accident; check site safety, continuity and staff welfare.";

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
  // Accident / hazard reroute: a flood, snakebite or vehicle accident that only
  // states a death count is classified as Homicide / violent crime by the bare
  // casualty tokens above. Reroute it to Natural hazard when an accidental or
  // natural-hazard cause is named and no explicit-violence token is present.
  const rerouteBroad =
    (category === "Homicide / violent crime" || category === "Other security") &&
    ACCIDENT_HAZARD_RE.test(text);
  // A Road/highway ACCIDENT (crash/collision/capsize) is a safety hazard, not a
  // transport-closure disruption; a bare road closure or landslip stays transport.
  const rerouteRoadAccident =
    category === "Road / highway" && ACCIDENT_ONLY_RE.test(text);
  if ((rerouteBroad || rerouteRoadAccident) && !DELIBERATE_VIOLENCE_RE.test(text)) {
    category = "Natural hazard";
    businessImpact = NATURAL_HAZARD_IMPACT;
  }
  return { province, category, businessImpact };
}

// ---------------------------------------------------------------------------
// Occurred-vs-reported date parser (generic)
// ---------------------------------------------------------------------------
const MONTHS: Record<string, number> = {
  jan: 0, january: 0, januari: 0,
  feb: 1, february: 1, februari: 1,
  mar: 2, march: 2, maret: 2,
  apr: 3, april: 3,
  may: 4, mei: 4,
  jun: 5, june: 5, juni: 5,
  jul: 6, july: 6, juli: 6,
  aug: 7, august: 7, agustus: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9, oktober: 9,
  nov: 10, november: 10, nopember: 10,
  dec: 11, december: 11, desember: 11,
};

// English + Bahasa Indonesia month names. Bahasa dates ("17 Juli 2026") are
// day-month-year, so DMY_RE below carries them; every alternative here has a
// matching key in MONTHS above.
const MONTH_ALT =
  "jan(?:uary|uari)?|feb(?:ruary|ruari)?|mar(?:ch|et)?|apr(?:il)?|may|mei|jun(?:e|i)?|jul(?:y|i)?|aug(?:ust)?|agustus|sep(?:t(?:ember)?)?|oct(?:ober)?|oktober|nov(?:ember)?|nopember|dec(?:ember)?|desember";

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
 * that is clearly EARLIER than the publication date (at least one day before)
 * and within the previous ~200 days — the signal that an item "reported this
 * week occurred earlier". Returns null when no such earlier date is stated, in
 * which case consumers treat occurredAt (the publication date) as the incident
 * date.
 */
export function deriveIncidentDate(text: string, pubDate: Date): Date | null {
  const pubMs = pubDate.getTime();
  const minMs = pubMs - 200 * 24 * 60 * 60 * 1000;
  const distinctMs = pubMs - 1 * 24 * 60 * 60 * 1000;
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

/**
 * Detect a re-syndicated STALE event: an explicit, fully-qualified calendar date
 * (day + month + explicit 4-digit year) literally present in the article
 * text/title that is substantially OLDER than the feed's reported/publish date.
 * Returns the oldest such stale date, or null when none is found.
 *
 * Strict no-fabrication: acts ONLY on an explicit day-month-YEAR date literally
 * present in the text. A bare year, a month-only reference, or any date without
 * an explicit year is ignored — so a recent item that merely mentions a past
 * year in passing is never flagged. The default threshold (180 days) is
 * deliberately large so genuine recent follow-ups are unaffected; the whole
 * point is to catch old mass-casualty news re-published with a fresh feed date
 * (a ~2.5-year gap), not to second-guess ordinary recency.
 */
export function detectStaleEventDate(
  text: string,
  reportedDate: Date,
  thresholdDays = 180,
): Date | null {
  const reportedMs = reportedDate.getTime();
  const staleBeforeMs = reportedMs - thresholdDays * 24 * 60 * 60 * 1000;
  const candidates: number[] = [];

  const collect = (day: number, month: number | undefined, yearStr: string | undefined) => {
    // Require an EXPLICIT 4-digit year — never infer one. This is what keeps
    // the guard from acting on a guessed date.
    if (month === undefined || !yearStr) return;
    if (!day || day < 1 || day > 31) return;
    const year = Number(yearStr);
    if (year < 1990 || year > 2100) return;
    const d = Date.UTC(year, month, day);
    if (d < staleBeforeMs) candidates.push(d);
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
  return new Date(Math.min(...candidates));
}

/**
 * Known stale re-syndications that carry NO explicit in-text date, so
 * `detectStaleEventDate` cannot flag them. These are old mass-casualty events
 * that aggregators re-publish under a fresh feed date, resurfacing as bogus
 * "current" incidents. Strict no-fabrication: each entry is a specific, real
 * past event whose correctly-dated original is already tracked separately, so
 * skipping the re-syndication removes a duplicate — it never invents anything.
 * Match is a case-insensitive substring so masthead-stripped and raw titles
 * both hit.
 */
const KNOWN_STALE_SYNDICATION_SIGNATURES = [
  // Feb-2024 Enga/Wapenamanda highlands massacre (~64 killed). The Guardian's
  // correctly-dated 2024-02-18 coverage is tracked separately; aggregators
  // (e.g. The Eastleigh Voice) re-post it with a fresh 2026 feed date.
  "64 killed in papua new guinea tribal violence",
];

export function isKnownStaleSyndication(text: string): boolean {
  const hay = text.toLowerCase();
  return KNOWN_STALE_SYNDICATION_SIGNATURES.some((sig) => hay.includes(sig));
}
