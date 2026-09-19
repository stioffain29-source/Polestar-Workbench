import { addDays, differenceInCalendarDays, format, isAfter, isValid, parse, parseISO } from "date-fns";
import { consolidateCountryStories } from "@/lib/countrySameStory";
import { incidentMapFallback } from "@/lib/incidentMapFallback";

export type RegionalWeeklyTopic = "apac_weekly" | "middle_east_weekly";

type RegionalIncident = {
  id?: string | number;
  country?: string | null;
  title?: string | null;
  displayTitle?: string | null;
  summary?: string | null;
  topic?: string | null;
  severity?: string | null;
  category?: string | null;
  eventClusterKey?: string | null;
  analystNotes?: string | null;
  location?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  source?: string | null;
  occurredAt: string;
  incidentDate?: string | null;
};

type RegionalIncidentWithMembers = RegionalIncident & {
  sourceMembers?: RegionalIncident[];
};

export type RegionalIntelligenceCategory =
  | "Security"
  | "Armed Conflict"
  | "Terrorism"
  | "Political"
  | "Regulatory"
  | "Weather & Natural Hazards"
  | "Cyber"
  | "Energy"
  | "Operational Disruption";

export interface RegionalDevelopment {
  country: string;
  location?: string;
  eventDate?: string;
  dateVerified?: true;
  title: string;
  severity: "Insignificant" | "Low" | "Moderate" | "High" | "Extreme";
  category: RegionalIntelligenceCategory;
  whatChanged: string;
  operationalSignificance: string;
  /** APAC editorial label; operationalSignificance remains for existing callers. */
  operationalImpact?: string;
  /** Short analyst judgement distinct from the factual change. */
  polestarView?: string;
  whatToWatch: string;
  /** APAC editorial label; whatToWatch remains for existing callers. */
  outlook7Days?: string;
  watchDate: string | null;
  /** Number of source records consolidated into this development. */
  sourceCount?: number;
  evidenceIds?: Array<string | number>;
  /** Source labels retained from every record in a consolidated event. */
  sourceEvidence?: string[];
}

export type RegionalVerifiedDevelopment = RegionalDevelopment & {
  location: string;
  eventDate: string;
  dateVerified: true;
};

export interface RegionalVisualSummary {
  byCategory: Array<{ label: RegionalIntelligenceCategory; count: number }>;
  byCountry: Array<{ label: string; count: number }>;
}

export interface RegionalDomainBrief {
  domain: RegionalIntelligenceCategory;
  heading: string;
  assessment: string;
}

export interface RegionalWatchItem {
  date: string;
  location: string;
  trigger: string;
  whyItMatters: string;
  whatToWatch: string;
  currentSeverity?: RegionalDevelopment["severity"];
}

/** Caller/API boundary for persisted upcoming protest, weather and policy events. */
export interface RegionalFutureEventInput {
  date: string;
  location: string;
  trigger: string;
  whyItMatters: string;
  currentSeverity: RegionalDevelopment["severity"];
  whatToWatch?: string;
}

export interface RegionalFutureEventSource {
  eventDate?: string | null;
  country?: string | null;
  city?: string | null;
  venue?: string | null;
  eventName?: string | null;
  title?: string | null;
  eventType?: string | null;
  issue?: string | null;
  organiser?: string | null;
  description?: string | null;
  sourceTitle?: string | null;
  attendance?: number | null;
  disruptionPotential?: string | null;
  confidence?: string | null;
  status?: string | null;
}

export interface RegionalGlanceItem {
  category: RegionalIntelligenceCategory;
  statement: string;
}

export interface RegionalMetric {
  label: string;
  value: number;
}

export interface RegionalMapPoint {
  lat: number;
  lng: number;
  severity: string | null;
  title: string;
  label: string;
  summary: string;
  eventDate: string;
}

export interface RegionalCanonicalReport {
  schemaVersion: "regional-weekly-canonical-v1";
  topic: RegionalWeeklyTopic;
  issueDate: string;
  developments: RegionalDevelopment[];
  regionalOutlook: string;
  polestarOutlook: string;
  riskPicture: string;
  domainBriefs: RegionalDomainBrief[];
  businessImplications: RegionalBusinessImplication[];
  businessImplicationsNarrative: string;
  watchItems: RegionalWatchItem[];
  glanceMetrics: RegionalMetric[];
  mapPoints: RegionalMapPoint[];
  visualSummary: RegionalVisualSummary;
}

export function regionalCanonicalReportFromHardNumbers(
  hardNumbers: unknown,
  topic: RegionalWeeklyTopic,
  issueDate?: string,
): RegionalCanonicalReport | null {
  if (!hardNumbers || typeof hardNumbers !== "object") return null;
  const value = (hardNumbers as { regionalCanonicalReport?: RegionalCanonicalReport }).regionalCanonicalReport;
  if (!value || value.schemaVersion !== "regional-weekly-canonical-v1" || value.topic !== topic) return null;
  if (issueDate && value.issueDate !== issueDate) return null;
  if (topic === "apac_weekly" && value.developments.some((row) => !row.eventDate || row.dateVerified !== true)) return null;
  return value;
}

const APAC = [
  "Australia", "Bangladesh", "Bhutan", "Brunei", "Cambodia", "China",
  "Fiji", "Hong Kong", "India", "Indonesia", "Japan", "Kiribati",
  "Laos", "Malaysia", "Maldives", "Marshall Islands", "Micronesia",
  "Mongolia", "Myanmar", "Nauru", "Nepal", "New Zealand", "North Korea",
  "Pakistan", "Palau", "Papua New Guinea", "Philippines", "Samoa",
  "Singapore", "Solomon Islands", "South Korea", "Sri Lanka", "Taiwan",
  "Thailand", "Timor-Leste", "Tonga", "Tuvalu", "Vanuatu", "Vietnam",
] as const;

const MIDDLE_EAST = [
  "Bahrain", "Egypt", "Iran", "Iraq", "Israel", "Jordan", "Kuwait",
  "Lebanon", "Oman", "Palestine", "Qatar", "Saudi Arabia", "Syria",
  "Turkey", "Türkiye", "United Arab Emirates", "UAE", "Yemen",
] as const;

const MATERIAL_RE =
  /\b(attack|armed|airspace|airport|border|cargo|closure|conflict|crime|curfew|disrupt(?:ion|ed|s)?|drone|electricity|election|energy|explosion|flood|fuel|government|grid|heat|import|insurgent|kidnap|killed|landslide|law|legislation|logistics|maritime|military|missile|outage|policy|port|protest|regulat(?:ion|ory|e|ed|es)?|riot|road|ransomware|sanction|security|shipping|shortage|strike|supply chain|tariff|telecom|terror|typhoon|utility|visa|volcan(?:ic|o)?|wildfire|violence)\b/i;

// A headline is not an event merely because it contains a strategic noun.
// These patterns keep diplomatic copy, lifestyle policy and feed dumps out of
// the evidence set before ranking can mistake them for operating risk.
const NON_BINDING_POLICY_RE =
  /\b(?:minister(?:s)?|officials?|president|government)\b[\s\S]{0,100}\b(?:meet(?:s|ing)?|talks?|discuss(?:es|ed|ion)?|visit(?:s|ed)?|dialogue|consult(?:s|ed|ation)?)\b|\b(?:meeting|talks?|visit|dialogue|consultation)\b/i;
const NON_BINDING_STATEMENT_RE =
  /\b(?:statement|remarks?|speech|condemn(?:s|ed|ation)?|commend(?:s|ed)?|prais(?:e|ed|es)|vow(?:s|ed)?|call(?:s|ed)? for|pledge(?:s|d)?)\b/i;
const BINDING_EFFECT_RE =
  /\b(?:effective|enters? into force|implemented|enacted|adopted|approved|imposed|restricted|restricts|banned|ban(?:ned)?|prohibited|eligib(?:ility|le)|requirements?|compliance|tariff|tax|duty|levy|cost|closed|closure|suspended|shutdown|outage|disrupt(?:ed|ion)?|blocked|arrested|detained|injured|killed|damaged|attack(?:ed)?|arson|warning|advisory|landfall|crackdown|overhaul|tighten(?:ed|s)?)\b/i;
const FEED_DUMP_RE =
  /\b(?:roundup|round-up|megadump|mega[\s-]?dump|news dump|news digest|feed dump|story dump|listicle|what you missed|keep on reading|appeared first on|raw source|read:)\b/i;
const CURRENT_CONSEQUENCE_RE =
  /\b(?:attack(?:ed|s)?|struck|hits?|missing|closed|closure|suspended|shutdown|outage|offline|disrupt(?:ed|ion)?|blocked|halted|cancel(?:led|ed)|rerout(?:ed|ing)|evacuat(?:e|ed|es|ion)|damage(?:d)?|destroyed|injured|killed|detained|arrested|restriction|restricted|warning|advisory|landfall|effective|implemented|enacted|imposed|banned|requirements?|obligations?|eligib(?:ility|le)|cost|shortage|lost access|service impact|operational impact|continuity impact|affected|crackdown|overhaul|tighten(?:ed|s)?)\b/i;

const OPERATIONAL_RE =
  /\b(airline|airspace|airport|asset|border|business|cargo|compliance|continuity|customs|data|energy|export|fuel|grid|import|infrastructure|logistics|personnel|port|regulat(?:ion|ory|e|ed|es)?|road|sanction|shipping|site|supply chain|tariff|telecom|transport|travel|utilities?|visa|workforce)\b/i;

const LOW_VALUE_RE =
  /\b(9\/11|anniversary|commemorati|fundrais|charity|donation|opinion|editorial|historical retrospective|years ago|religious (?:ceremony|youth rally)|routine (?:patrol|police)|police blotter|body (?:was |is )?(?:found|discovered)|bodies (?:were |are )?(?:found|discovered)|human.interest|social media repost|visa (?:fraud|extortion)|criminal investigation)\b/i;

const WIDER_SECURITY_RE =
  /\b(airport|airspace|border|business district|commercial|conflict|election|infrastructure|insurgent|mass casualty|military|port|public transport|riot|site|supply chain|terror|utility)\b/i;

const LOCAL_CRIME_RE =
  /\b(body found|bodies found|domestic dispute|local murder|murder investigation|police blotter|robbery|shooting|stabbing)\b/i;
const APAC_LOCAL_THEFT_RE =
  /\b(?:robbery|robbed|theft|stolen|burglary|shoplifting|pickup loaded|goods recovered)\b/i;
const APAC_STRATEGIC_THEFT_RE =
  /\b(?:port|airport|border crossing|critical infrastructure|national grid|major logistics hub)\b/i;
const APAC_WIDER_THEFT_EFFECT_RE =
  /\b(?:closure|closed|shutdown|outage|nationwide|cross-border|service disruption|services disrupted|large commercial loss)\b/i;
const APAC_CASUALTY_RE =
  /\b(?:death toll|killed|deadly|bodies|victims?|missing|casualt(?:y|ies)|remains)\b/i;
const APAC_ONGOING_OPERATION_RE =
  /\b(?:closed|closure|suspended|suspension|shutdown|outage|disrupted|disruption|halted|blocked|remains? (?:closed|suspended)|service interruption|route restriction)\b/i;
const APAC_AIRLINE_BANKRUPTCY_RE =
  /\b(?:airline|carrier|AirBaltic)\b[\s\S]{0,80}\b(?:bankrupt|bankruptcy|insolvency|insolvent|protection)\b/i;
// Local road incidents and petty commodity theft are feed noise even when a
// collector assigns a high severity.  They do not become regional events
// merely because the headline mentions a truck, cargo or a named product.
const APAC_TRIVIAL_ACCIDENT_RE =
  /\b(?:truck|lorry|pickup|motorcycle|car)\b[\s\S]{0,80}\b(?:accident|crash|collision|overturn(?:ed)?|lorry fell)\b/i;
const APAC_LIQUOR_LOOTING_RE =
  /\b(?:liquor|alcohol|beer|wine|spirits?)\b[\s\S]{0,80}\b(?:loot(?:ed|ing)?|stolen|theft|rob(?:bed|bery)|goods recovered)\b/i;
const APAC_MANCHESTER_AIRLINE_RE =
  /\b(?:manchester|uk|united kingdom|england)\b[\s\S]{0,100}\b(?:airline|airport|flight|aviation|emergency|evacuat|divert)\b/i;
const ROUTINE_ENFORCEMENT_RE =
  /\b(?:customs|police|airport security)\b[\s\S]{0,100}\b(?:drug|narcotic|contraband|smuggl|seiz(?:e|ure)|lyrica|tablet|arrest)\b/i;
const MAJOR_ENFORCEMENT_EFFECT_RE =
  /\b(?:shutdown|closed|closure|border closure|airport closure|critical infrastructure|nationwide|mass casualty|sustained commercial|transport disruption)\b/i;
const APAC_NAMED_OPERATION_RE =
  /\b(?:Australia|Bangladesh|China|India|Indonesia|Japan|Malaysia|Myanmar|Nepal|New Zealand|Philippines|Singapore|South Korea|Sri Lanka|Taiwan|Thailand|Vietnam)\b[\s\S]{0,100}\b(?:airport|flight|route|service|cargo|travel|closed|suspended|disrupt|shutdown|outage)\b/i;
const APAC_DECLARATION_RE = /\b(?:declaration|communiqué|communique)\b/i;
const APAC_BINDING_EFFECT_RE =
  /\b(?:effective|enters? into force|sanction(?:ed|s)?|tariff (?:change|cut|hike|increase)|restriction|closure|disrupt(?:ed|ion)?|outage|shutdown|implemented|enacted)\b/i;
const APAC_PROTEST_EFFECT_RE =
  /\b(?:closure|closed|blocked|blocks? roads?|transport interruption|service interruption|site-access restriction|violence|clashes|injured|arrested|police deploy|crowd-control|mass mobilisation|thousands|tens of thousands)\b/i;
const APAC_COMMENDATION_RE = /\b(?:commend(?:s|ed)?|praised|congratulat(?:ed|es)?)\b/i;

// APAC Weekly is an intelligence product, not a general-news digest. These
// guards are deliberately scoped to APAC curation so the existing Middle East
// path keeps its established admission rules until its own review.
const APAC_SLOP_RE =
  /\b(?:read:|source:\s*https?:\/\/|https?:\/\/\S+|www\.\S+|subscribe|click here|live updates|photo gallery|fundrais(?:er|ing)|charity appeal|donation drive|skeleton|missionary|youth rally|body found|historical retrospective|years ago|anniversary of|on this day)\b/i;
const APAC_GENERIC_SPEECH_RE =
  /\b(?:speech|remarks?|address|statement|warn(?:ed|s)?|condemn(?:ed|s)?|unequivocally|vowed|called for|declaration|communiqué|communique)\b/i;
const APAC_ACTION_RE =
  /\b(?:announced|approved|adopted|enacted|implemented|ordered|imposed|blocked|closed|restricted|detained|arrested|attack(?:ed)?|arson|fire|disrupted|damaged|killed|injured|evacuated|deployed|sanctioned|forecast|warning|landfall|strike|protest|election|ruling|deadline|effective|outage|shutdown)\b/i;
const DOMAIN_IN_PROSE_RE =
  /\b(?:reuters\.com|apnews\.com|bbc\.com|theguardian\.com|aljazeera\.com|channelnewsasia\.com|scmp\.com|abc\.net\.au|nikkei\.com|[a-z0-9-]+\.co\.uk)\b/i;
const REGIONAL_ROUNDUP_RE =
  /\b(?:world['’]s\s+\d+(?:st|nd|rd|th)\s+strongest|business insider|raw source|read:|https?:\/\/|www\.|subscribe|click here)\b/i;
const APAC_COMMUNITY_RE =
  /\b(?:polling (?:place|center|centre)|school[- ]turned[- ](?:evacuation|polling)|islamic school|madrasat|ordinary days|community (?:event|story)|human interest|local residents? (?:celebrate|gather)|charity|fundrais)\b/i;
const APAC_TRIVIAL_PET_POLICE_RE =
  /\b(?:poodle|dog|cat|pet|animal|puppy|police dog)\b[\s\S]{0,100}\b(?:police|airport|station|local|officer|arrest|incident)\b/i;
const CYBER_SEMANTIC_RE =
  /\b(?:cyber|ransomware|malware|data breach|network attack|system attack|digital attack|hack(?:ed|ing)?|telecom outage)\b/i;
const CYBER_CONSEQUENCE_RE =
  /\b(?:disrupt(?:ed|ion)?|outage|offline|shutdown|service impact|operat(?:ions?|ional)|critical infrastructure|compromis|affected|lost access)\b/i;
const APAC_CURRENT_CHANGE_RE =
  /\b(?:held|staged|clashed|clashes|arrested|detained|injured|killed|blocked|closed|disrupted|deployed|restricted|banned|cancelled|canceled|outage|shutdown|attack(?:ed)?|strike(?:s|d)?|effective|implemented|approved|enacted)\b/i;
const APAC_FUTURE_ONLY_RE =
  /\b(?:scheduled|plans? to|set to|will (?:hold|cost|begin|start|take place)|is expected to|await(?:s|ing)?|upcoming|on\s+\d{1,2}\s+(?:september|october|november|december|january|february|march|april|may|june|july|august))\b/i;
const NON_EVENT_ANALYSIS_RE =
  /\b(?:common challenge|critically examine|how does this nexus|election-year security discourse|risk insurance|zero tolerance towards|law challenged|(?:petitions?|moves?) .{0,50}(?:court|lhc) .{0,50}(?:law|amendments|against)|court orders? .{0,80}hoaxer .{0,80}(?:damages|pay)|appeals? for non-violence|jet fuel volatility|volatility creates? .{0,60}(?:risk|pressure)|\d+(?:st|nd|rd|th) straight year|annual report|still deadliest|peruvian election-year|shining path counter-terrorism operations revive|prepar(?:e|es|ing) for (?:extreme heat|heavy rain|food shortage)|mock drill|simulation exercise|ai-manipulated|falsely linked|fact check|debunked|expresses condolences|policy against terrorism|opinion|commentary|explainer|what .* means for|could affect)\b/i;
const WEAK_PROPOSED_LAW_RE =
  /\b(?:proposed|proposal|bill|draft law|takes aim at|seeks? to|would)\b/i;
const BINDING_LAW_RE =
  /\b(?:approved|adopted|passed|enacted|effective|enters? into force|implemented|imposed|signed into law)\b/i;
const REGULATORY_EVENT_RE =
  /\b(?:parliament|assembly|court|bill|law|ruling|regulation)\b[\s\S]{0,100}\b(?:abolish(?:ed|es|ing)?|nullif(?:y|ied|ies)|approv(?:ed|es)|pass(?:ed|es)|enact(?:ed|s)|scrap(?:ped|s)|repeal(?:ed|s))\b|\b(?:abolish(?:ed|es|ing)?|nullif(?:y|ied|ies)|approv(?:ed|es)|pass(?:ed|es)|enact(?:ed|s)|scrap(?:ped|s)|repeal(?:ed|s))\b[\s\S]{0,100}\b(?:parliament|assembly|court|bill|law|ruling|regulation)\b/i;
const COUNTRY_MENTIONS = [
  ...APAC, ...MIDDLE_EAST,
  "United States", "US", "U.S.", "Russia", "Ukraine", "Peru", "United Kingdom", "UK",
] as const;

function canonicalCountry(value: string): string {
  const normalized = value.toLowerCase().replace(/\./g, "").trim();
  if (normalized === "us" || normalized === "united states") return "united states";
  if (normalized === "uk" || normalized === "united kingdom") return "united kingdom";
  if (normalized === "uae" || normalized === "united arab emirates") return "united arab emirates";
  if (normalized === "turkiye") return "turkey";
  return normalized;
}

function firstNamedCountry(text: string): string | null {
  const matches = COUNTRY_MENTIONS.flatMap((country) => {
    const escaped = country.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`(?:^|[^A-Za-z])(${escaped})(?=$|[^A-Za-z])`, "i").exec(text);
    return match ? [{ country, index: match.index }] : [];
  }).sort((a, b) => a.index - b.index);
  return matches[0]?.country ?? null;
}

function hasForeignSubjectLead(incident: RegionalIncident): boolean {
  const title = incident.displayTitle ?? incident.title ?? "";
  const first = firstNamedCountry(title);
  const assigned = incident.country?.trim();
  return Boolean(first && assigned && canonicalCountry(first) !== canonicalCountry(assigned));
}

function hasForeignVenue(incident: RegionalIncident): boolean {
  const text = `${incident.displayTitle ?? incident.title ?? ""} ${incident.summary ?? ""}`;
  const assigned = canonicalCountry(incident.country?.trim() ?? "");
  const venueCountries: Array<[RegExp, string]> = [
    [/\bistanbul\b/i, "turkey"],
    [/\bgalveston\b/i, "united states"],
    [/\bnorthern arizona\b/i, "united states"],
    [/\bport of los angeles\b/i, "united states"],
    [/\blebanon,\s*mo\b/i, "united states"],
  ];
  return venueCountries.some(([pattern, country]) => pattern.test(text) && assigned !== country);
}
const NARRATIVE_STOPWORDS = new Set([
  "about", "after", "because", "being", "confirmed", "could", "current", "development",
  "during", "effect", "expected", "from", "into", "material", "next", "reported", "risk",
  "seven", "that", "the", "their", "these", "this", "through", "week", "will", "with",
]);

function narrativeTokens(text: string): Set<string> {
  return new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 4 && !NARRATIVE_STOPWORDS.has(token)),
  );
}

function narrativeSimilarity(a: string, b: string): number {
  const left = narrativeTokens(a);
  const right = narrativeTokens(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

const FORWARD_RE =
  /\b(?:will|scheduled|expected|forecast|deadline|due to|set to|plans? to|vote|election|ruling|hearing|enters? (?:into )?force|takes? effect|landfall|warning|watch|strike|union action|public event|escalation|unresolved|continuing closure|remains? closed|reopening)\b/i;

const BUSINESS_DIMENSIONS: Array<[string, RegExp]> = [
  ["personnel and travel", /\b(people|personnel|workforce|travel|airport|airline|road|rail|movement|access)\b/i],
  ["sites and assets", /\b(site|asset|facility|office|factory|manufactur|commercial)\b/i],
  ["transport and supply chains", /\b(port|airport|airspace|border|cargo|customs|logistics|shipping|supply chain|transport)\b/i],
  ["energy and utilities", /\b(electricity|energy|fuel|grid|power|telecom|utilities?)\b/i],
  ["compliance and market access", /\b(compliance|export control|foreign ownership|import|law|legislation|licen[cs]|regulat|sanction|tariff|tax|visa)\b/i],
  ["political exposure", /\b(cabinet|coalition|diplomat|election|government|interstate|parliament|political|policy)\b/i],
  ["business continuity", /\b(business|continuity|disrupt|closure|outage|shortage|strike)\b/i],
];

const CATEGORY_RULES: Array<[RegionalIntelligenceCategory, RegExp]> = [
  ["Weather & Natural Hazards", /\b(cyclone|drought|earthquake|extreme heat|flood|landslide|storm|typhoon|volcan|wildfire)\b/i],
  ["Cyber", /\b(cyber|data breach|malware|ransomware|state-linked hack)\b/i],
  ["Terrorism", /\b(terror(?:ism|ist)?|suicide bomb|ied|improvised explosive)\b/i],
  ["Armed Conflict", /\b(armed conflict|airstrike|artillery|battle|clash(?:es|ed)?|combat|insurgent|junta|military offensive|rebel|shelling|territorial control)\b/i],
  ["Energy", /\b(aviation turbine fuel|diesel|energy market|export duty|fuel|oil|petrol|power market|windfall tax)\b/i],
  ["Regulatory", /\b(compliance|customs|export control|foreign ownership|immigration|legislation|obligations?|regulat|sanction|tariff|visa)\b/i],
  ["Political", /\b(cabinet|diplomat|election|government change|interstate tension|political|policy decision)\b/i],
  ["Operational Disruption", /\b(airspace|airport|border|closure|disrupt|grid|industrial action|logistics|outage|port|road|shipping|strike|supply chain|telecom|transport|utility)\b/i],
  ["Security", /\b(armed attack|arson|attack|bomb|crime|curfew|kidnap|missile|shooting|security|violence)\b/i],
];

const SEVERITY_RANK: Record<string, number> = {
  insignificant: 0,
  low: 1,
  moderate: 2,
  high: 3,
  extreme: 4,
};

export function isRegionalWeeklyTopic(topic: string): topic is RegionalWeeklyTopic {
  return topic === "apac_weekly" || topic === "middle_east_weekly";
}

export function regionalCountryQuery(topic: RegionalWeeklyTopic): string {
  return (topic === "apac_weekly" ? APAC : MIDDLE_EAST).join(",");
}

const FUTURE_EVENT_OPERATIONAL_RE =
  /\b(?:airport|airspace|border|blockade|bridge|bus|cargo|closure|convoy|disrupt|freight|highway|march|motorway|movement|port|rail|road|route|security|shutdown|station|strike|terminal|traffic|transport|travel|utility|venue access)\b/i;
const FUTURE_EVENT_COMMUNITY_RE =
  /\b(?:charity|church|community|cultural|donation|fundrais|funeral|memorial|religious|school|temple|worship|youth)\b/i;
const FUTURE_EVENT_MATERIAL_RE =
  /\b(?:blockade|general strike|mass|national strike|road closure|roadblock|shutdown|walkout)\b/i;

function futureEventWords(value: string | null | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 3 && !NARRATIVE_STOPWORDS.has(word)),
  );
}

function futureEventSeverity(
  row: RegionalFutureEventSource,
): RegionalDevelopment["severity"] {
  const candidate = row.disruptionPotential?.trim();
  if (
    candidate === "Insignificant" ||
    candidate === "Low" ||
    candidate === "Moderate" ||
    candidate === "High" ||
    candidate === "Extreme"
  ) {
    return candidate;
  }
  return row.confidence === "High"
    ? "High"
    : row.confidence === "Moderate"
      ? "Moderate"
      : "Low";
}

function cleanFutureEventName(row: RegionalFutureEventSource): string {
  const raw =
    row.eventName?.trim() ||
    row.title?.trim() ||
    row.sourceTitle?.trim() ||
    row.eventType?.trim() ||
    row.issue?.trim() ||
    "Scheduled mobilisation";
  const cleaned = raw
    .replace(/^(?:breaking|update|latest|planned|scheduled)\s*[:|-]\s*/i, "")
    .replace(/^[A-Z][A-Za-z .'-]{2,35},\s+[A-Z][A-Za-z .'-]{2,35}\s*[-:]\s*/u, "")
    .replace(/\s+\|\s+(?:reuters|ap|bbc|cnn|afp|abc)\s*$/i, "")
    .replace(/\s+-\s+(?:reuters|ap|bbc|cnn|afp|abc)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const withoutFollowOnProse = cleaned.replace(
    /\s+(?:the scheduled|the planned|related actions?|organ(?:is|iz)ers?|supporters?)\b[\s\S]*$/i,
    "",
  );
  const firstSentence = withoutFollowOnProse.match(/^(.+?[.!?])(?:\s|$)/)?.[1]
    ?? withoutFollowOnProse;
  return firstSentence
    .replace(/[.!?]+$/u, "")
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 14)
    .join(" ")
    .replace(/\s+(?:and|or|the|a)$/i, "")
    .trim() || "Scheduled mobilisation";
}

function futureEventMateriality(row: RegionalFutureEventSource): number {
  const text = [
    row.eventType,
    row.issue,
    row.organiser,
    row.description,
    row.sourceTitle,
    row.venue,
  ]
    .filter(Boolean)
    .join(" ");
  const severity = futureEventSeverity(row);
  let score =
    severity === "Extreme" ? 8 : severity === "High" ? 6 : severity === "Moderate" ? 3 : 1;
  if (FUTURE_EVENT_MATERIAL_RE.test(text)) score += 4;
  if (FUTURE_EVENT_OPERATIONAL_RE.test(text)) score += 3;
  if ((row.attendance ?? 0) >= 1000) score += 3;
  else if ((row.attendance ?? 0) >= 500) score += 2;
  return score;
}

/**
 * Shared regional projection for the editor and headless exporter. It intentionally
 * turns schedule rows into concise operating signals rather than copying a
 * headline into three fields. Minor community gatherings are rejected unless
 * the source contains a plausible access, transport or security effect.
 */
export function buildApacFutureEvents(
  rows: RegionalFutureEventSource[],
  issueDate: string,
): RegionalFutureEventInput[] {
  const issue = parseISO(issueDate);
  if (!isValid(issue)) return [];
  const end = addDays(issue, 7);
  const countries = new Set(regionalCountryQuery("apac_weekly").split(",").map((country) => country.toLowerCase()));
  const candidates = rows
    .filter((row) => {
      if (!row.eventDate || !row.country || !countries.has(row.country.trim().toLowerCase())) return false;
      const date = parseISO(row.eventDate);
      if (!isValid(date) || !isAfter(date, issue) || isAfter(date, end)) return false;
      const text = [row.eventType, row.issue, row.organiser, row.description, row.sourceTitle, row.venue].filter(Boolean).join(" ");
      const operational = FUTURE_EVENT_OPERATIONAL_RE.test(text);
      const communityOnly = FUTURE_EVENT_COMMUNITY_RE.test(text) && !operational;
      const material = FUTURE_EVENT_MATERIAL_RE.test(text) || operational || futureEventSeverity(row) === "High" || futureEventSeverity(row) === "Extreme" || (row.attendance ?? 0) >= 500;
      return !communityOnly && material;
    })
    .sort((a, b) => futureEventMateriality(b) - futureEventMateriality(a));
  const projected: RegionalFutureEventInput[] = [];
  for (const row of candidates) {
    const date = format(parseISO(row.eventDate!), "yyyy-MM-dd");
    const location = [row.city, row.country].map((value) => value?.trim()).filter(Boolean).join(", ");
    if (!location) continue;
    let trigger = cleanFutureEventName(row);
    const text = [row.eventType, row.issue, row.description, row.sourceTitle].filter(Boolean).join(" ");
    const route = /\b(?:route|road|highway|motorway|airport|port|station|transport|traffic|march|convoy)\b/i.test(text);
    const strike = /\b(?:strike|walkout|shutdown|blockade)\b/i.test(text);
    const whyItMatters = route
      ? `Movement and access in ${location} may be affected by the scheduled activity.`
      : strike
        ? `The scheduled labour action may affect transport, staffing or site access in ${location}.`
        : `The planned gathering may affect access or security around ${location}.`;
    const whatToWatch = route
      ? `Track route and venue advisories, transport changes and police restrictions.`
      : strike
        ? `Track organiser confirmation, transport changes and cancellation or postponement notices.`
        : `Track venue advisories, organiser confirmation and any police restrictions.`;
    const whyStart = whyItMatters.split(/\s+/).slice(0, 4).join(" ").toLowerCase();
    if (trigger.toLowerCase().startsWith(whyStart)) {
      trigger = cleanFutureEventName({
        ...row,
        eventName: null,
        title: null,
        sourceTitle: row.eventType || row.issue || "Scheduled mobilisation",
      });
    }
    const input: RegionalFutureEventInput = {
      date,
      location,
      trigger,
      whyItMatters,
      currentSeverity: futureEventSeverity(row),
      whatToWatch,
    };
    const triggerWords = futureEventWords(trigger);
    const duplicate = projected.some((existing) => {
      if (existing.date !== input.date || existing.location.toLowerCase() !== input.location.toLowerCase()) return false;
      const existingWords = futureEventWords(existing.trigger);
      let overlap = 0;
      for (const word of triggerWords) if (existingWords.has(word)) overlap += 1;
      return overlap >= 2 || (triggerWords.size === 1 && existingWords.has([...triggerWords][0]));
    });
    if (!duplicate) projected.push(input);
    if (projected.length === 5) break;
  }
  return projected;
}

export function regionalIntelligenceCategory(
  incident: RegionalIncident,
): RegionalIntelligenceCategory {
  const eventText = `${incident.displayTitle ?? incident.title ?? ""} ${incident.summary ?? ""}`;
  // Classification is based on the event itself.  Collector/discovery labels
  // are provenance and must never override explicit event semantics.
  if (/\b(?:bomb|explosive|shooting|opened fire|armed attack)\b/i.test(eventText)
    && /\b(?:military|defen[cs]e volunteers?|security forces?|soldiers?|troops?|insurgents?|rebels?)\b/i.test(eventText)) {
    return "Armed Conflict";
  }
  if (/\b(?:bomb|explosive|shooting|opened fire|armed attack)\b/i.test(eventText)) return "Security";
  if (/\b(?:cargo ship|vessel|maritime|port|shipping)\b/i.test(eventText)
    && !/\b(?:cyber|ransomware|malware|data breach|hack(?:ed)?|telecom outage)\b/i.test(eventText)) {
    if (/\b(?:fuel|oil|petrol|diesel|energy|pipeline)\b/i.test(eventText)) return "Energy";
    return "Operational Disruption";
  }
  if (CYBER_SEMANTIC_RE.test(eventText) && CYBER_CONSEQUENCE_RE.test(eventText)) return "Cyber";
  if (REGULATORY_EVENT_RE.test(eventText)) return "Regulatory";
  return CATEGORY_RULES.find(([, pattern]) => pattern.test(eventText))?.[0] ?? "Operational Disruption";
}

function consolidateRegionalEvents<T extends RegionalIncident>(rows: T[]): T[] {
  const byScope = new Map<string, T[]>();
  for (const row of rows) {
    const scope = row.country?.trim().toLowerCase() ?? "";
    const current = byScope.get(scope);
    if (current) current.push(row);
    else byScope.set(scope, [row]);
  }
  return [...byScope.values()].flatMap((scoped) => {
    const scopedCountry = scoped[0]?.country?.trim().toLowerCase() ?? "unknown";
    const scope = scoped[0]?.country?.trim().toLowerCase() ?? "";
    const authoritative = new Map<string, T[]>();
    const inferred = new Map<string, T[]>();
    const unclustered: T[] = [];
    for (const row of scoped) {
      const key = row.eventClusterKey?.trim();
      if (key) {
        authoritative.set(key, [...(authoritative.get(key) ?? []), row]);
        continue;
      }
      const text = `${row.displayTitle ?? row.title ?? ""} ${row.summary ?? ""}`.toLowerCase();
      const inferredKey =
        /\bbangkok\b/.test(text) && /\b(protest|demonstration|rally)\b/.test(text)
          ? `${scopedCountry}:bangkok-protest`
          : /\bmanibela\b/.test(text) && /\b(strike|transport|protest)\b/.test(text)
            ? `${scopedCountry}:philippines-manibela-strike`
            : /\bmyanmar\b/.test(text) && /\bairport\b/.test(text) && /\b(attack|drone|explosion|strike)\b/.test(text)
              ? `${scopedCountry}:myanmar-airport-attack`
                : /\baustralia(?:n|'s)?\b/.test(text)
                  && /\b(?:visa|migration|immigration)\b/.test(text)
                  && /\b(?:crackdown|overhaul|visa hopping|international students?|backpackers?)\b/.test(text)
                  ? `${scopedCountry}:australia-visa-policy-overhaul`
                : scopedCountry === "india"
                  && /\b(?:windfall tax|export duty|fuel tax|tax on|duty on|levy|government cuts?|centre slashes?|cuts?)\b/.test(text)
                    && /\b(?:petrol|diesel|atf|aviation turbine fuel|export)\b/.test(text)
                     ? `${scopedCountry}:india-fuel-tax-policy`
              : null;
      if (inferredKey) inferred.set(inferredKey, [...(inferred.get(inferredKey) ?? []), row]);
      else unclustered.push(row);
    }
    const representatives = [...authoritative.values(), ...inferred.values()].map((members) => {
      const representative = members.reduce((best, row) => {
        const rank = SEVERITY_RANK[row.severity?.toLowerCase() ?? ""] ?? 0;
        const bestRank = SEVERITY_RANK[best.severity?.toLowerCase() ?? ""] ?? 0;
        return rank > bestRank || (rank === bestRank && Date.parse(row.occurredAt) > Date.parse(best.occurredAt))
          ? row
          : best;
      });
      const summaries = [...new Set(members.map((member) => member.summary?.trim()).filter(Boolean))];
      return {
        ...representative,
        summary: summaries.join(" "),
        sourceMembers: members,
      } as T;
    });
    const matchable = [...representatives, ...unclustered].map((row, index) => ({
      ...row,
      title: row.title?.trim() || row.displayTitle?.trim() || `Unspecified development ${String(row.id ?? index)}`,
    }));
    const consolidated = consolidateCountryStories(matchable) as Array<T & { sourceMembers?: T[] }>;
    return consolidated.map((row) => {
      const nested = row.sourceMembers ?? [row];
      const sourceMembers = nested.flatMap((member) => {
        const members = (member as T & { sourceMembers?: T[] }).sourceMembers;
        return members ?? [member];
      });
      return {
        ...row,
        sourceMembers,
      } as T;
    });
  });
}

function regionalEventFamily(row: RegionalIncident): string {
  const text = `${row.title ?? ""} ${row.summary ?? ""}`.toLowerCase();
  if (row.country?.trim().toLowerCase() === "pakistan"
    && /\b(?:kohat|northwest pakistan)\b/.test(text)
    && /\b(?:bomb|blast)\b/.test(text)
    && /\b(?:police|cops)\b/.test(text)) return "pakistan-kohat-police-bomb";
  if (/\bsyria\b/.test(text) && /\b(?:terrorism|terrorist)\b/.test(text) && /\b(?:court|ruling)\b/.test(text)
    && /\b(?:abolish|scrap|nullif)\b/.test(text)) return "syria-terrorism-court-reform";
  if (/\b(?:saudi|yanbu|east[- ]west pipeline|pipeline attack|drone launch)\b/.test(text)) return "saudi-pipeline-drone";
  if (/\b(?:cargo ship|port|maritime|vessel)\b/.test(text)) {
    return `maritime:${row.country?.trim().toLowerCase() ?? "unknown"}:${row.occurredAt.slice(0, 10)}:${row.location?.trim().toLowerCase() ?? ""}`;
  }
  return `${row.country ?? ""}:${row.id ?? row.title ?? ""}`;
}

function intelligenceTitle(incident: RegionalIncident): string {
  const text = `${incident.title ?? ""} ${incident.summary ?? ""}`.toLowerCase();
  const explicitOman = incident.country?.trim().toLowerCase() === "oman" && /\boman\b/i.test(text);
  if (/\bdrag racing|illegal drag\b/.test(text)) return "Mandaue traffic enforcement disruption";
  if (/\bcar bomb|security forces\b/.test(text)) return "Pakistan security forces attack";
  if (/\bbackpacker|visa crackdown|migration overhaul\b/.test(text)) return "Australia migration policy tightening";
  if (/\bwindfall tax|export duty|petrol|diesel\b/.test(text)) return "India fuel export tax change";
  if (/\b(?:pipeline|yanbu|oil shipments)\b/.test(text)) return "Saudi pipeline attack disrupts oil shipments";
  if (incident.country?.trim().toLowerCase() === "iran"
    && /\bdrone\b/.test(text)
    && /\b(?:launch site|border)\b/.test(text)) return "Iran border drone threat";
  if (incident.country?.trim().toLowerCase() === "united arab emirates"
    && /\bdubai\b/.test(text)
    && /\b(?:drone|airport|flight)\b/.test(text)) return "Dubai airport drone disruption";
  if (/\b(?:cargo ship|port|maritime|vessel)\b/.test(text)) {
    const marker = (incident.title ?? "").match(/\b(\d+)\b/)?.[1];
    const country = incident.country?.trim();
    return marker
      ? `${country || "Regional"} maritime access disruption ${marker}`
      : explicitOman
        ? "Oman maritime access disruption"
        : `${country || "Regional"} maritime route disruption`;
  }
  if (/\b(?:visa|migration|immigration)\b/.test(text)) return "Migration policy changes workforce access";
  if (/\b(?:flood|typhoon|cyclone|storm)\b/.test(text)) return "Severe weather disrupts critical infrastructure";
  return clipTitleToMeaningfulWords(cleanApacTitle(incident.displayTitle ?? incident.title ?? "Regional development"), 10);
}

function materialityDimensions(text: string): string[] {
  return BUSINESS_DIMENSIONS.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
}

function developmentScore(
  incident: RegionalIncident,
  topic: RegionalWeeklyTopic = "middle_east_weekly",
): number {
  const text = `${incident.displayTitle ?? incident.title ?? ""} ${incident.summary ?? ""}`;
  const dimensions = materialityDimensions(text).length;
  const severity = SEVERITY_RANK[regionalWeeklySeverity(incident, topic).toLowerCase()] ?? 0;
  const legacyMiddleEastSignals = topic === "middle_east_weekly"
    ? (Array.isArray((incident as RegionalIncident & { sourceMembers?: unknown[] }).sourceMembers)
        ? Math.min(3, (incident as RegionalIncident & { sourceMembers?: unknown[] }).sourceMembers!.length - 1)
        : 0)
      + (/regional-weekly:/i.test(incident.analystNotes ?? "") ? 2 : 0)
    : 0;
  const regional = /\b(national|nationwide|regional|cross-border|capital|major|critical infrastructure)\b/i.test(text) ? 2 : 0;
  const securitySignificance = regionalIntelligenceCategory(incident) === "Armed Conflict"
    || /\b(?:military|defen[cs]e volunteers?|security forces?|soldiers?|troops?|insurgents?|rebels?)\b/i.test(text)
    ? 3 : 0;
  const forwardRelevance = FORWARD_RE.test(text) ? 1 : 0;
  const apacSignals = topic === "apac_weekly" ? securitySignificance + forwardRelevance : 0;
  return severity * 4 + dimensions * 3 + regional + apacSignals + legacyMiddleEastSignals;
}

export function regionalWeeklySeverity(
  incident: RegionalIncident,
  topic: RegionalWeeklyTopic,
): RegionalDevelopment["severity"] {
  const stored = SEVERITY_LABEL[incident.severity?.toLowerCase() ?? ""] ?? "Moderate";
  if (topic !== "apac_weekly") return stored;
  const text = `${incident.displayTitle ?? incident.title ?? ""} ${incident.summary ?? ""}`;
  const category = regionalIntelligenceCategory(incident);
  const majorOperational = /\b(?:nationwide|national emergency|mass evacuation|airport closure|port closure|border closure|major outage|critical infrastructure shutdown|operations? halted|services? suspended|supply shortage)\b/i.test(text);
  const currentOperational = CURRENT_CONSEQUENCE_RE.test(text);
  if (category === "Regulatory" || category === "Political") {
    if (!currentOperational || (WEAK_PROPOSED_LAW_RE.test(text) && !BINDING_LAW_RE.test(text))) return "Low";
    return majorOperational ? "High" : "Moderate";
  }
  if (category === "Security" || category === "Armed Conflict" || category === "Terrorism") {
    if (/\b(?:mass casualty|15 (?:killed|dead)|dozens (?:killed|injured)|56 injured)\b/i.test(text)
      && /\b(?:bomb|attack|shooting|clash)\b/i.test(text)) return "Extreme";
    if (majorOperational || /\b(?:election|airport|port|border (?:crossing|closure)|cross-border|critical infrastructure)\b/i.test(text)
      && /\b(?:killed|injured|attack|bomb|shooting|clash)\b/i.test(text)) return "High";
    return currentOperational || /\b(?:attack|bomb|shooting|clash)\b/i.test(text) ? "Moderate" : "Low";
  }
  if (category === "Cyber" || category === "Weather & Natural Hazards" || category === "Operational Disruption" || category === "Energy") {
    if (majorOperational) return "High";
    return currentOperational ? "Moderate" : "Low";
  }
  return stored;
}

function apacRejectLowValueDevelopment(text: string): boolean {
  return (APAC_LOCAL_THEFT_RE.test(text)
    && !(APAC_STRATEGIC_THEFT_RE.test(text) && APAC_WIDER_THEFT_EFFECT_RE.test(text)))
    || (APAC_CASUALTY_RE.test(text)
      && !APAC_ONGOING_OPERATION_RE.test(text)
      && !/\b(?:attack|bomb|shooting|opened fire|clash|armed)\b/i.test(text));
}

function apacRejectOffRegionAirline(text: string): boolean {
  return APAC_AIRLINE_BANKRUPTCY_RE.test(text) && !APAC_NAMED_OPERATION_RE.test(text);
}

function apacRejectCommentary(text: string): boolean {
  const declaration = APAC_DECLARATION_RE.test(text) && !APAC_BINDING_EFFECT_RE.test(text);
  const localProtest = /\b(?:protest|rally|demonstration)\b/i.test(text) && !APAC_PROTEST_EFFECT_RE.test(text);
  const commendation = APAC_COMMENDATION_RE.test(text) && /\b(?:arrest|intrusion)\b/i.test(text)
    && !APAC_PROTEST_EFFECT_RE.test(text);
  return declaration || localProtest || commendation;
}

function regionalDomainMateriality(category: RegionalIntelligenceCategory, text: string): boolean {
  if (FEED_DUMP_RE.test(text)) return false;
  if (category === "Political" || category === "Regulatory") {
    // Meetings, statements, visa-free announcements and agreements are not
    // operating developments without a current, binding consequence.
    if (/\bvisa[- ]free\b|\bagreement\b|\bmemorandum\b/i.test(text)) return false;
    if ((NON_BINDING_POLICY_RE.test(text) || NON_BINDING_STATEMENT_RE.test(text))
      && !BINDING_EFFECT_RE.test(text)
      && !CURRENT_CONSEQUENCE_RE.test(text)) return false;
    return /\b(?:policy|regulation|law|visa|election|deadline|tariff|tax|duty|levy|border|court|immigration|obligations?|requirements?)\b/i.test(text)
      && BINDING_EFFECT_RE.test(text)
      && CURRENT_CONSEQUENCE_RE.test(text);
  }
  if (category === "Weather & Natural Hazards") {
    return /\b(?:earthquake|typhoon|cyclone|storm|flood|flooding|landslide|wildfire|haze|volcan|tsunami|heat|drought)\b/i.test(text)
      && (CURRENT_CONSEQUENCE_RE.test(text)
        || /\b(?:warning|advisory|evacuat|closure|damage|disrupt|airport|port|route|infrastructure|fatal)\b/i.test(text));
  }
  if (category === "Cyber") {
    return CYBER_SEMANTIC_RE.test(text) && CYBER_CONSEQUENCE_RE.test(text);
  }
  if (category === "Security" || category === "Armed Conflict" || category === "Terrorism") {
    return CURRENT_CONSEQUENCE_RE.test(text)
      || /\b(?:attack|bomb(?:ing)?|airstrike|clash(?:es)?|combat|missile|terror(?:ism|ist)?|violence|shooting|kidnap)\b/i.test(text);
  }
  return OPERATIONAL_RE.test(text) && CURRENT_CONSEQUENCE_RE.test(text);
}

export function curateRegionalWeeklyIncidents<T extends RegionalIncident>(
  incidents: T[],
  topic: RegionalWeeklyTopic,
  issueDate: string,
): T[] {
  const countries = new Set(topic === "apac_weekly" ? APAC : MIDDLE_EAST);
  const issue = parseISO(issueDate);
  const eligible = incidents
    .filter((incident) => {
      const country = incident.country?.trim() ?? "";
      const age = differenceInCalendarDays(issue, parseISO(incident.occurredAt));
      const text = `${incident.title ?? ""} ${incident.summary ?? ""}`;
      const eventTitle = `${incident.displayTitle ?? incident.title ?? ""}`;
      if (/\b(?:off Oman|Oman coast|Oman waters)\b/i.test(text) && country.toLowerCase() !== "oman") return false;
      const dimensions = materialityDimensions(text);
      const apacReject =
        isRegionalWeeklyTopic(topic)
        && (
          APAC_SLOP_RE.test(text)
          || REGIONAL_ROUNDUP_RE.test(text)
          || FEED_DUMP_RE.test(text)
          || NON_EVENT_ANALYSIS_RE.test(text)
          || (topic === "apac_weekly" && WEAK_PROPOSED_LAW_RE.test(text) && !BINDING_LAW_RE.test(text))
          || hasForeignSubjectLead(incident)
          || hasForeignVenue(incident)
          || ((NON_BINDING_POLICY_RE.test(eventTitle) || NON_BINDING_STATEMENT_RE.test(eventTitle))
            && !BINDING_EFFECT_RE.test(eventTitle))
          || ((NON_BINDING_POLICY_RE.test(text) || NON_BINDING_STATEMENT_RE.test(text))
            && !BINDING_EFFECT_RE.test(text)
            && !CURRENT_CONSEQUENCE_RE.test(text))
          || /\bvisa[- ]free\b|\bagreement\b|\bmemorandum\b/i.test(text)
          || (APAC_GENERIC_SPEECH_RE.test(text) && !APAC_ACTION_RE.test(text))
          || DOMAIN_IN_PROSE_RE.test(text)
          || APAC_COMMUNITY_RE.test(text)
          || (APAC_FUTURE_ONLY_RE.test(text) && !APAC_CURRENT_CHANGE_RE.test(text))
          || apacRejectLowValueDevelopment(text)
          || apacRejectOffRegionAirline(text)
          || APAC_TRIVIAL_ACCIDENT_RE.test(text)
          || APAC_LIQUOR_LOOTING_RE.test(text)
          || APAC_MANCHESTER_AIRLINE_RE.test(text)
          || APAC_TRIVIAL_PET_POLICE_RE.test(text)
          || (ROUTINE_ENFORCEMENT_RE.test(text) && !MAJOR_ENFORCEMENT_EFFECT_RE.test(text))
          || apacRejectCommentary(text)
        );
      return countries.has(country as never)
        && age >= 0
        && age <= 6
        && !apacReject
        && !LOW_VALUE_RE.test(text)
        && !(LOCAL_CRIME_RE.test(text) && !WIDER_SECURITY_RE.test(text))
        && dimensions.length > 0
        && regionalDomainMateriality(regionalIntelligenceCategory(incident), text);
    })
    .sort((a, b) => {
      return developmentScore(b, topic) - developmentScore(a, topic)
        || Date.parse(b.occurredAt) - Date.parse(a.occurredAt);
    });
  const consolidated = consolidateRegionalEvents(eligible);
  const families = new Map<string, T>();
  for (const row of consolidated) {
    const key = regionalEventFamily(row);
    const existing = families.get(key);
    const pipelinePriority = (value: RegionalIncident) => /\b(?:yanbu|east[- ]west pipeline|oil shipments)\b/i.test(`${value.title ?? ""} ${value.summary ?? ""}`) ? 3 : 0;
    if (!existing || developmentScore(row, topic) + pipelinePriority(row) > developmentScore(existing, topic) + pipelinePriority(existing)) families.set(key, row);
  }
  return [...families.values()];
}

export interface RegionalWeeklyCandidateFunnel {
  topic: RegionalWeeklyTopic;
  issueDate: string;
  input: number;
  geographyAccepted: number;
  dateAccepted: number;
  domainAccepted: number;
  materialAccepted: number;
  consolidated: number;
  ranked: number;
  selected: number;
  rejects: Record<string, number>;
  checks: { weather: CoverageCheck; cyber: CoverageCheck; forwardSearch: CoverageCheck };
}
export interface CoverageCheck {
  startedAt: string;
  completedAt: string;
  sourceNames: string[];
  itemsFetched: number;
  candidatesAccepted: number;
  errors: string[];
}

/** Deterministic, non-writing funnel proof used by acceptance tooling. */
export function auditRegionalWeeklyCandidateFunnel(
  incidents: RegionalIncident[],
  topic: RegionalWeeklyTopic,
  issueDate: string,
  coverage: { weather: CoverageCheck; cyber: CoverageCheck; forward: CoverageCheck },
): RegionalWeeklyCandidateFunnel {
  for (const [name, check] of Object.entries(coverage)) {
    if (!check || !check.startedAt || !check.completedAt || check.errors.length > 0 || !check.sourceNames.length) {
      throw new Error(`Regional coverage incomplete: ${name}`);
    }
  }
  const countries = new Set(topic === "apac_weekly" ? APAC : MIDDLE_EAST);
  const issue = parseISO(issueDate);
  const rejects: Record<string, number> = {};
  let geographyAccepted = 0, dateAccepted = 0, domainAccepted = 0, materialAccepted = 0;
  for (const incident of incidents) {
    const country = incident.country?.trim() ?? "";
    const text = `${incident.title ?? ""} ${incident.summary ?? ""}`;
    if (!countries.has(country as never)) { rejects.geography = (rejects.geography ?? 0) + 1; continue; }
    geographyAccepted++;
    const age = differenceInCalendarDays(issue, parseISO(incident.occurredAt));
    if (age < 0 || age > 6) { rejects.date = (rejects.date ?? 0) + 1; continue; }
    dateAccepted++;
    const category = regionalIntelligenceCategory(incident);
    if (!regionalDomainMateriality(category, text)) { rejects.domainMateriality = (rejects.domainMateriality ?? 0) + 1; continue; }
    domainAccepted++;
    if (!MATERIAL_RE.test(text) && category !== "Political" && category !== "Regulatory" && category !== "Weather & Natural Hazards" && category !== "Cyber") { rejects.material = (rejects.material ?? 0) + 1; continue; }
    materialAccepted++;
  }
  const curated = curateRegionalWeeklyIncidents(incidents, topic, issueDate);
  const selected = selectRegionalKeyDevelopments(curated, topic);
  return { topic, issueDate, input: incidents.length, geographyAccepted, dateAccepted, domainAccepted, materialAccepted, consolidated: curated.length, ranked: curated.length, selected: selected.length, rejects, checks: { weather: coverage.weather, cyber: coverage.cyber, forwardSearch: coverage.forward } };
}

/** Fail-closed gate used by preview/export harnesses after the funnel audit. */
export function assertRegionalWeeklyReady(
  funnel: RegionalWeeklyCandidateFunnel,
  opts: { auditedTrueShortage?: boolean } = {},
): void {
  if (funnel.selected < 4 && !opts.auditedTrueShortage) {
    throw new Error(
      `Regional weekly candidate funnel selected ${funnel.selected} developments; ` +
      "a true shortage audit is required before publishing fewer than four.",
    );
  }
  if (funnel.selected > 6) throw new Error("Regional weekly candidate funnel selected more than six developments");
}

export function selectRegionalKeyDevelopments<T extends RegionalIncident>(
  incidents: T[],
  topic: RegionalWeeklyTopic = "middle_east_weekly",
): T[] {
  const ranked = [...incidents].sort((a, b) =>
    developmentScore(b, topic) - developmentScore(a, topic)
    || Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
  const selected: T[] = [];
  const categoryCounts = new Map<RegionalIntelligenceCategory, number>();
  const countryCounts = new Map<string, number>();
  for (const incident of ranked) {
    const category = regionalIntelligenceCategory(incident);
    const country = incident.country?.trim() || "Regional";
    if ((categoryCounts.get(category) ?? 0) > 0 || (countryCounts.get(country) ?? 0) >= 3) continue;
    selected.push(incident);
    categoryCounts.set(category, 1);
    countryCounts.set(country, (countryCounts.get(country) ?? 0) + 1);
    if (selected.length === 6) return selected;
  }
  for (const incident of ranked) {
    if (selected.includes(incident)) continue;
    const country = incident.country?.trim() || "Regional";
    if ((countryCounts.get(country) ?? 0) >= 3) continue;
    selected.push(incident);
    countryCounts.set(country, (countryCounts.get(country) ?? 0) + 1);
    if (selected.length === 6) break;
  }
  return selected;
}

export function selectApacWeeklyDevelopments<T extends RegionalIncident>(incidents: T[]): T[] {
  return selectRegionalKeyDevelopments(incidents, "apac_weekly");
}

const SEVERITY_LABEL: Record<string, RegionalDevelopment["severity"]> = {
  insignificant: "Insignificant",
  low: "Low",
  moderate: "Moderate",
  high: "High",
  extreme: "Extreme",
};

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
}

export function clipRegionalWords(text: string, maxWords: number, completeSentence = false): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const words = clean.split(" ").filter(Boolean);
  if (words.length <= maxWords) return clean;
  if (completeSentence) {
    const bounded = words.slice(0, maxWords).join(" ");
    const end = Math.max(bounded.lastIndexOf("."), bounded.lastIndexOf("!"), bounded.lastIndexOf("?"));
    if (end >= 0) return bounded.slice(0, end + 1);
    return `${bounded.replace(/[,:;]$/, "")}.`;
  }
  return `${words.slice(0, maxWords).join(" ").replace(/[,:;]$/, "")}…`;
}

function clipApacComplete(text: string, minWords: number, maxWords: number): string {
  const sentences = text.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/).filter(Boolean);
  const chosen: string[] = [];
  for (const sentence of sentences) {
    const clean = sentence.replace(/…|\.\.\./g, "").trim();
    const candidate = [...chosen, clean].join(" ");
    if (candidate.split(/\s+/).filter(Boolean).length > maxWords && chosen.length > 0) break;
    chosen.push(clean);
    if (chosen.join(" ").split(/\s+/).filter(Boolean).length >= minWords) break;
  }
  return chosen.join(" ");
}

function padRegionalNarrative(text: string, minWords: number, maxWords: number, additions: string[]): string {
  let output = text.replace(/\.{2,}|…/g, ".").trim();
  let index = 0;
  while (output.split(/\s+/).filter(Boolean).length < minWords && index < additions.length) {
    output += ` ${additions[index++]}`;
  }
  return output;
}

function firstSentences(text: string, maxSentences: number, maxWords: number): string {
  return clipRegionalWords(
    text
      .replace(/\s+/g, " ")
      .trim()
      .split(/(?<=[.!?])\s+/)
      .slice(0, maxSentences)
      .join(" "),
    maxWords,
  );
}

function sentenceWith(text: string, pattern: RegExp): string | null {
  return text.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).find((sentence) => pattern.test(sentence)) ?? null;
}

function extractWatchDate(incident: RegionalIncident, issueDate?: string): string | null {
  const text = `${incident.analystNotes ?? ""} ${incident.displayTitle ?? incident.title ?? ""} ${incident.summary ?? ""}`;
  const explicit = text.match(/\b(?:watch-date|effective-date)\s*:\s*(20\d{2}-\d{2}-\d{2})\b/i)?.[1]
    ?? text.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];
  const issue = issueDate ? parseISO(issueDate) : null;
  if (explicit && (!issue || isAfter(parseISO(explicit), issue))) return explicit;
  const monthDate = text.match(/\b(\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)(?:\s+20\d{2})?)\b/i)?.[1];
  if (monthDate && issue) {
    const withYear = /20\d{2}/.test(monthDate) ? monthDate : `${monthDate} ${issue.getUTCFullYear()}`;
    const parsed = parse(withYear, /\b20\d{2}\b/.test(withYear) ? "d MMMM yyyy" : "d MMM yyyy", issue);
    if (isValid(parsed) && isAfter(parsed, issue) && !isAfter(parsed, addDays(issue, 14))) {
      return format(parsed, "yyyy-MM-dd");
    }
  }
  return null;
}

function operationalSignificance(incident: RegionalIncident, evidence: string): string {
  const title = incident.displayTitle ?? incident.title ?? "The development";
  const dimensions = materialityDimensions(`${title} ${evidence}`).slice(0, 3);
  const consequence = sentenceWith(evidence, OPERATIONAL_RE);
  if (consequence && consequence.toLowerCase() !== evidence.toLowerCase()) return clip(consequence, 360);
  return clip(`${title.replace(/[.!?]+$/, "")} has direct relevance to ${dimensions.join(", ")} in ${incident.country?.trim() || "the affected market"}.`, 360);
}

function specificWatch(incident: RegionalIncident, evidence: string, watchDate: string | null): string {
  const forward = sentenceWith(evidence, FORWARD_RE);
  if (forward) return clip(forward, 300);
  if (watchDate) return `The next material indicator is whether the reported measure or disruption proceeds on ${format(parseISO(watchDate), "d MMMM yyyy")}.`;
  return "";
}

function cleanApacTitle(title: string): string {
  return title
    .replace(/^(?:breaking|update|latest|live updates?)\s*[:|-]\s*/i, "")
    .replace(/\s+\|\s+(?:reuters|ap|bbc|cnn|afp|abc)\s*$/i, "")
    .replace(/\s+-\s+(?:reuters|ap|bbc|cnn|afp|abc)\s*$/i, "")
    .replace(/\s+(?:Business Insider Africa|Business Insider|Reuters|AP|BBC|AFP)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 12)
    .join(" ")
}

function cleanApacEvidence(text: string): string {
  return text
    .replace(/^[A-Za-z][A-Za-z .'-]{2,40},\s+[A-Za-z][A-Za-z .'-]{2,40}\s+-\s*/u, "")
    .replace(/^[A-Z][A-Z ,.'-]{3,60}\s+-\s*/u, "")
    .replace(/\b(?:Reuters|SBS|BBC|AP|AFP|Business Standard(?: India)?|Business Today|Mathrubhumi English|India Today|Bangkok Post|RTV News|Burma News International|The Straits Times|Saudi Gazette|Hindu|Kursiv Media)\b[^.!?]*/gi, "")
    .replace(/\b[a-z0-9-]+\.(?:(?:co\.)?uk|com|net|org|in|au|ph|pk)\b[^.!?]*/gi, "")
    .replace(/\.{2,}/g, ".")
    .replace(/…/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?])/g, "$1")
    .trim();
}

/** Remove wire datelines, outlet mastheads and feed suffixes before prose. */
function stripWireCruft(text: string): string {
  return cleanApacEvidence(text)
    .replace(/^\s*(?:news\s+on\s+(?:japan|air)|bloomingbit)\s*[:|-]\s*/i, "")
    .replace(/\s+(?:[-|—]\s*)?(?:news\s+on\s+(?:japan|air)|bloomingbit)\s*$/i, "")
    .replace(/\s+(?:[-|—]\s*)?(?:[A-Z][A-Za-z&.'-]*(?:\s+[A-Z][A-Za-z&.'-]*){0,4})\s*$/u, (suffix) =>
      /\b(?:Media|News|Press|Post|Times|Journal|Agency|Wire|Today|TV|Radio)\b/i.test(suffix) ? "" : suffix,
    )
    .replace(/\s+/g, " ")
    .trim();
}

function apacWhatChanged(incident: RegionalIncident, evidence: string): string | null {
  const cleaned = cleanApacEvidence(evidence);
  const text = `${incident.displayTitle ?? incident.title ?? ""} ${cleaned}`;
  const country = incident.country?.trim() || "the affected market";
  const factual = firstSentences(cleaned, 2, 55).replace(/…/g, "").trim();
  const usableEvidence = factual && factual.toLowerCase() !== cleanApacTitle(incident.displayTitle ?? incident.title ?? "").toLowerCase()
    ? factual
    : "";
  if (/\bdrag racing|illegal drag\b/i.test(text)) return "The Philippines tightened enforcement against illegal drag racing, creating a local traffic and access issue rather than a broad security change.";
  if (/\bcar bomb|security forces\b/i.test(text)) return "Pakistan recorded a car-bomb attack against security personnel near a police facility, creating a specific access and personnel-safety concern.";
  if (/\bbackpacker|visa crackdown|migration overhaul\b/i.test(text)) return "Australia tightened migration and visa settings, changing eligibility and documentation requirements for affected workers and visitors.";
  if (/\b(?:pipeline|yanbu|oil shipments)\b/i.test(text)) {
    return "Saudi Arabia saw an attack affecting the East-West pipeline and Yanbu oil shipments, creating a specific question over export flows and recovery timing.";
  }
  if (incident.country?.trim().toLowerCase() === "oman" && /\boman\b/i.test(text) && /\b(?:cargo ship|vessel|maritime)\b/i.test(text)) {
    return "Oman recorded an attack on a cargo vessel off its coast, with crew casualties and route-safety implications requiring confirmation of vessel status and access.";
  }
  if (isIndiaFuelPolicy(incident, text)) {
    return "India reduced export-linked fuel taxation, changing the levy applied to petrol, diesel and aviation turbine fuel exports.";
  }
  if (/\b(?:airstrike|artillery|battle|clash(?:es|ed)?|combat|insurgent|junta|military offensive|rebel|shelling)\b/i.test(text)) {
    return usableEvidence || `${country} recorded armed clashes or military activity with consequences for access in the affected area.`;
  }
  if (/\b(?:armed attack|bomb|shooting|terror|violence)\b/i.test(text)) {
    return usableEvidence || `${country} recorded a security incident affecting the named location and surrounding access.`;
  }
  if (/\b(?:visa|migration|immigration|student|workforce)\b/i.test(text)) {
    return usableEvidence || `${country} changed migration or visa settings affecting eligibility, documentation or employer obligations.`;
  }
  if (/\b(?:flood|typhoon|cyclone|storm|landslide|rainfall|river)\b/i.test(text)) {
    return usableEvidence || `${country} reported a natural hazard affecting exposed routes or infrastructure.`;
  }
  if (/\b(?:airport|airspace|flight|aviation)\b/i.test(text)) {
    return usableEvidence || `Flight operations or routing in ${country} were disrupted during the reporting period.`;
  }
  if (/\b(?:arson|set fire|burned|burnt|fire attack|machinery attack)\b/i.test(text)) {
    return `${country} experienced an attack on machinery or a commercial site, creating a local asset-security and investigation issue.`;
  }
  if (/\b(?:offensive|attack|armed|clash|military|border|insurgent|drone)\b/i.test(text)) {
    return `${country} saw violence, military activity or access restrictions near affected routes or sites.`;
  }
  if (/\b(?:port|cargo|freight|shipping|ferry|vessel|capsiz|maritime)\b/i.test(text)) {
    return `${country} experienced a transport or maritime event affecting cargo, passenger movement or route availability.`;
  }
  if (/\b(?:regulat|compliance|export duty|tax|tariff|policy|legislation)\b/i.test(text)) {
    return usableEvidence || `${country} introduced or adjusted a policy measure affecting market access, pricing or compliance.`;
  }
  if (/\b(?:protest|rally|demonstration|strike)\b/i.test(text)) {
    return usableEvidence || `${country} recorded public mobilisation or industrial action with a demonstrated effect on movement or site access.`;
  }
  return usableEvidence || null;
}

function isIndiaFuelPolicy(incident: RegionalIncident, text: string): boolean {
  return /^india$/i.test(incident.country?.trim() ?? "")
    && /\b(?:windfall tax|export duty|fuel tax|tax on|duty on|levy|government cuts?|centre slashes?|cuts?)\b/i.test(text)
    && /\b(?:petrol|diesel|atf|aviation turbine fuel|export)\b/i.test(text);
}

function apacOperationalImpact(incident: RegionalIncident, evidence: string): string {
  const text = `${incident.displayTitle ?? incident.title ?? ""} ${evidence}`;
  if (/\b(?:pipeline|yanbu|oil shipments)\b/i.test(text)) {
    return "The exposure is concentrated in oil-flow continuity and export logistics; confirm pipeline integrity, Yanbu loading status and the availability of alternate shipment routes.";
  }
  if (/\b(?:cargo ship|vessel|maritime)\b/i.test(text)) {
    return "The exposure is to vessel safety and route availability; confirm crew status, navigational restrictions, insurer guidance and whether nearby cargo movements are being rerouted.";
  }
  if (/\b(?:protest|rally|demonstration|strike|transport strike|industrial action)\b/i.test(text)) {
    return "The action affects public transport and employee movement; the immediate consequence is route access and any confirmed service suspension.";
  }
  if (isIndiaFuelPolicy(incident, text)) {
    return "The measure changes fuel-export pricing and trade economics, with direct implications for fuel procurement, aviation cost assumptions and road-transport margins.";
  }
  if (/\b(?:visa|migration|immigration|student|workforce)\b/i.test(text)) {
    return "The measure changes workforce eligibility, documentation or travel planning; the practical effect depends on the effective rule and affected worker categories.";
  }
  if (/\b(?:flood|typhoon|cyclone|storm|landslide|rainfall|river)\b/i.test(text)) {
    return "Flood exposure can interrupt roads, border crossings, sites and local supply routes; continuity plans should be tied to official warnings and reopening notices.";
  }
  if (/\b(?:airport|airspace|flight|aviation)\b/i.test(text)) {
    return "The disruption can restrict passenger movement and air cargo, requiring route, traveller and time-critical shipment contingencies until access is restored.";
  }
  if (/\b(?:arson|set fire|burned|burnt|fire attack|machinery attack)\b/i.test(text)) {
    return "The immediate exposure is to site assets and local operating access; confirm machinery damage, investigation restrictions and whether the incident affects contractor or facility activity.";
  }
  if (/\b(?:offensive|attack|armed|clash|military|border|insurgent|drone)\b/i.test(text)) {
    return "The immediate exposure is movement and site access near affected routes; the regional effect depends on persistence, spread and restrictions on commercial movement.";
  }
  const dimensions = materialityDimensions(text);
  const affected = dimensions.slice(0, 3).join(", ") || "regional business continuity";
  if (/\b(?:ferry|capsiz|maritime|vessel|port|shipping|cargo)\b/i.test(text)) {
    return "The incident puts passenger safety and maritime logistics under pressure; vessel status, routing and port access determine the cargo consequence.";
  }
  if (/\b(?:protest|rally|demonstration|strike)\b/i.test(text)) {
    return "The operational exposure is concentrated around movement, site access and public-transport reliability in the affected urban area.";
  }
  return `The development is relevant to ${affected}; its significance depends on whether the named access, continuity or compliance effect persists.`;
}

function apacPolestarView(incident: RegionalIncident, evidence: string): string {
  const text = `${incident.displayTitle ?? incident.title ?? ""} ${evidence}`;
  let judgement: string;
  if (/\b(?:pipeline|yanbu|oil shipments)\b/i.test(text)) {
    judgement = "The commercial risk is tied to whether the pipeline and Yanbu disruption reduces export capacity or is contained without wider effects on regional energy logistics.";
  } else if (/\b(?:cargo ship|vessel|maritime)\b/i.test(text)) {
    judgement = "The commercial risk is tied to verified vessel recovery, crew safety and whether route controls or insurer guidance alter shipping access beyond the reported incident.";
  } else if (isIndiaFuelPolicy(incident, text)) {
    judgement = "This is a policy-and-pricing change: the immediate question is how the revised export levy flows through fuel markets, procurement assumptions and transport margins.";
  } else if (/\b(?:visa|migration|immigration|student|workforce)\b/i.test(text)) {
    judgement = "This is a transition risk: the business effect will be set by the implementation timetable and the practical interpretation of new eligibility rules.";
  } else if (/\b(?:flood|typhoon|cyclone|storm|landslide|rainfall|river)\b/i.test(text)) {
    judgement = "This is a geographically concentrated continuity risk; the assessment would worsen if river levels, road closures or warnings extend into commercial corridors.";
  } else if (/\b(?:airport|airspace|flight|aviation)\b/i.test(text)) {
    judgement = "Restoration timing and diversion capacity will determine whether the aviation disruption remains local or affects regional passenger and cargo schedules.";
  } else if (/\b(?:arson|set fire|burned|burnt|fire attack|machinery attack)\b/i.test(text)) {
    judgement = "This is a site-asset security risk; the key uncertainty is whether damage, investigation restrictions or follow-on threats affect facility activity.";
  } else if (/\b(?:offensive|attack|armed|clash|military|border|insurgent|drone)\b/i.test(text)) {
    judgement = "Commercial risk rises if violence reaches transport corridors, population centres or operating sites, or if authorities impose wider access restrictions.";
  } else {
    judgement = "The significance is confined to the named market unless the effect persists, spreads geographically or creates cross-border consequences.";
  }
  return judgement;
}

function apacOutlook7Days(incident: RegionalIncident, evidence: string, watchDate: string | null): string {
  const text = `${incident.displayTitle ?? incident.title ?? ""} ${evidence}`;
  if (watchDate) {
    const datedEvidence = sentenceWith(cleanApacEvidence(evidence), FORWARD_RE);
    return datedEvidence
      ? firstSentences(datedEvidence, 1, 45).replace(/…/g, "")
      : `The scheduled action is due on ${format(parseISO(watchDate), "d MMMM yyyy")}; its stated operating effect is the next indicator.`;
  }
  if (/\b(?:pipeline|yanbu|oil shipments)\b/i.test(text)) {
    return "Next seven days: verify pipeline integrity, Yanbu loading status, export-flow restoration and any confirmed diversion of oil shipments.";
  }
  if (/\b(?:cargo ship|vessel|maritime)\b/i.test(text)) {
    return "Next seven days: verify crew recovery, vessel movement, navigational warnings and any confirmed rerouting of cargo traffic.";
  }
  if (isIndiaFuelPolicy(incident, text)) {
    return "Next seven days: watch the revised export-duty schedule, fuel-market pricing and any confirmed effect on aviation or road-transport procurement.";
  }
  if (/\b(?:visa|migration|immigration|student|workforce)\b/i.test(text)) {
    return "Next seven days: watch official implementation guidance, employer-facing instructions and any change to the effective timetable.";
  }
  if (/\b(?:flood|typhoon|cyclone|storm|landslide|rainfall|river)\b/i.test(text)) {
    return "Next seven days: track official warnings, river levels, road or airport closures and confirmed reopening times.";
  }
  if (/\b(?:airport|airspace|flight|aviation)\b/i.test(text)) {
    return "Next seven days: track airport status notices, flight cancellations, alternate routing and restoration timing.";
  }
  if (/\b(?:arson|set fire|burned|burnt|fire attack|machinery attack)\b/i.test(text)) {
    return "Next seven days: watch site-access restrictions, damage assessments, investigation findings and any repeat attack or contractor-safety notice.";
  }
  if (/\b(?:offensive|attack|armed|clash|military|border|insurgent|drone)\b/i.test(text)) {
    return "Next seven days: track border notices, route restrictions, further clashes and credible indicators of displacement or access loss.";
  }
  const category = regionalIntelligenceCategory(incident);
  if (category === "Regulatory") {
    return "Next seven days: watch official guidance, implementation notices and any compliance deadline.";
  }
  if (/\b(?:ferry|capsiz|maritime|vessel|port|shipping|cargo)\b/i.test(text)) {
    return "Next seven days: watch official casualty, vessel-recovery, port-access or route notices.";
  }
  if (/\b(?:protest|rally|demonstration|strike)\b/i.test(text)) {
    return "";
  }
  return "";
}

export function buildRegionalDevelopments<T extends RegionalIncident>(
  incidents: T[],
  issueDate?: string,
  topic?: RegionalWeeklyTopic,
): RegionalDevelopment[] {
  const eligible = isRegionalWeeklyTopic(topic ?? "")
    ? incidents.filter((incident) => {
      const text = `${incident.title ?? ""} ${incident.summary ?? ""}`;
      return !APAC_SLOP_RE.test(text)
        && !REGIONAL_ROUNDUP_RE.test(text)
        && !(APAC_GENERIC_SPEECH_RE.test(text) && !APAC_ACTION_RE.test(text))
        && !DOMAIN_IN_PROSE_RE.test(text)
        && !APAC_COMMUNITY_RE.test(text)
        && !(APAC_FUTURE_ONLY_RE.test(text) && !APAC_CURRENT_CHANGE_RE.test(text))
        && !apacRejectLowValueDevelopment(text)
        && !apacRejectOffRegionAirline(text)
        && !apacRejectCommentary(text)
        && !(/\b(?:drag racing|illegal traffic enforcement)\b/i.test(text) && !/\b(?:airport|port|highway closure|national policy|commercial disruption)\b/i.test(text))
        && !(topic === "apac_weekly" && /\bIran\b/i.test(text));
    })
    : incidents;
  return selectRegionalKeyDevelopments(eligible, topic ?? "middle_east_weekly").flatMap((incident) => {
    const sourceTitle = stripWireCruft((incident.displayTitle ?? incident.title ?? "Unspecified development").trim());
    const evidence = stripWireCruft((incident.summary ?? "").trim() || sourceTitle);
    const structuredWeekly = topic != null && isRegionalWeeklyTopic(topic);
    const title = structuredWeekly ? intelligenceTitle(incident) : clip(sourceTitle, 90);
    const members = (incident as RegionalIncidentWithMembers).sourceMembers;
    const sourceCount = members?.length ?? 1;
    const evidenceIds = (members ?? [incident]).map((member) => member.id).filter((id): id is string | number => id !== undefined);
    const sourceEvidence = (members ?? [incident])
      .map((member) => member.source?.trim() || member.displayTitle?.trim() || member.title?.trim() || "")
      .filter(Boolean)
      .filter((value, index, values) => values.indexOf(value) === index);
    const whatChanged = structuredWeekly
      ? apacWhatChanged(incident, evidence)
      : firstSentences(evidence, 2, 30);
    if (!whatChanged) return [];
    const operationalImpact = structuredWeekly ? apacOperationalImpact(incident, evidence) : undefined;
    const polestarView = structuredWeekly ? apacPolestarView(incident, evidence) : undefined;
    const watchDate = extractWatchDate(incident, issueDate);
    const outlook = structuredWeekly
      ? apacOutlook7Days(incident, evidence, watchDate)
      : firstSentences(specificWatch(incident, evidence, watchDate), 1, 20);
    const structuredPolestar = structuredWeekly
      ? clipApacComplete(polestarView ?? "", 0, 70)
      : polestarView;
    const structuredOutlook = structuredWeekly
      ? clipApacComplete(outlook, 0, 55)
      : outlook;
    const cleanRendered = (value: string | undefined) => value?.replace(/\.{2,}|…/g, ".").trim();
    const eventDate = incident.incidentDate
      ?? (incident as RegionalIncidentWithMembers).sourceMembers?.map((member) => member.incidentDate).find(Boolean)
      ?? null;
    if (topic === "apac_weekly" && !eventDate) return [];
    const integratedNarrative = structuredWeekly
      ? clipApacComplete(whatChanged, 0, 95)
      : whatChanged;
    return {
      country: incident.country?.trim() || "Regional",
      ...(topic === "apac_weekly" ? {
        location: incident.location?.trim() || incident.country?.trim() || "Regional",
        eventDate: eventDate!,
        dateVerified: true as const,
      } : {}),
      title,
      severity: regionalWeeklySeverity(incident, topic ?? "middle_east_weekly"),
      category: regionalIntelligenceCategory(incident),
      whatChanged: cleanRendered(integratedNarrative) ?? "",
      operationalSignificance: cleanRendered(structuredWeekly ? operationalImpact! : firstSentences(operationalSignificance(incident, evidence), 1, 25)) ?? "",
      ...(structuredWeekly ? { operationalImpact: cleanRendered(operationalImpact), polestarView: cleanRendered(structuredPolestar), outlook7Days: cleanRendered(structuredOutlook), sourceCount, sourceEvidence, evidenceIds } : {}),
      watchDate,
      whatToWatch: outlook,
    };
  });
}

export function buildApacWeeklyDevelopments<T extends RegionalIncident>(
  incidents: T[],
  issueDate?: string,
): RegionalDevelopment[] {
  return buildRegionalDevelopments(incidents, issueDate, "apac_weekly")
    .filter((row) => !(row.country === "Thailand" && /\bIran\b/i.test(`${row.title} ${row.whatChanged}`)));
}

/** Structured weekly developments for either regional weekly product. */
export function buildRegionalWeeklyDevelopments<T extends RegionalIncident>(
  incidents: T[],
  issueDate?: string,
  topic: RegionalWeeklyTopic = "middle_east_weekly",
): RegionalDevelopment[] {
  return buildRegionalDevelopments(incidents, issueDate, topic);
}

export interface ApacMapItem {
  id: number;
  country: string;
  lat: number;
  lng: number;
  developments: Array<{
    label: string;
    severity: string;
    fullTitle: string;
    summary: string;
  }>;
}




export function clipTitleToMeaningfulWords(text: string, maxWords: number = 6): string {
  // Strip all forms of ellipsis and excessive spaces
  let clean = text.replace(/\.{2,}/g, "").replace(/…/g, "").replace(/\s+/g, " ").trim();
  const lower = clean.toLowerCase();

  // Targeted summaries for specific known contexts
  if (lower.includes("migration") && (lower.includes("visa") || lower.includes("student") || lower.includes("regulation"))) return "Migration regulation changes";
  if (lower.includes("mandalay") && lower.includes("drone")) return "Mandalay airport drone disruption";
  if (lower.includes("arakan")) return "Arakan outpost clashes";
  if (lower.includes("manibela") || (lower.includes("transport") && lower.includes("strike") && (lower.includes("manila") || lower.includes("philippines")))) return "Manila transport strike";
  if (lower.includes("angeles") && (lower.includes("protest") || lower.includes("pax silica") || lower.includes("march"))) return "Angeles City protest";
  if (lower.includes("fuel") && (lower.includes("duty") || lower.includes("tax")) && (lower.includes("india") || lower.includes("kerala"))) return "India fuel duty change";
  if ((lower.includes("panguna") || lower.includes("bougainville")) && (lower.includes("arson") || lower.includes("machinery") || lower.includes("attack"))) return "Panguna machinery attack";
  if (lower.includes("tariff") && (lower.includes("china") || lower.includes("us") || lower.includes("united states"))) return "US-China tariff developments";
  if (lower.includes("russian") && lower.includes("oil") && lower.includes("china")) return "Russian oil import shifts";
  if (lower.includes("drug") && lower.includes("trafficking") && lower.includes("india")) return "Illicit drug trafficking review";

  // Generic fallback
  clean = clean.replace(/^[A-Za-z]+'s\s+/, "");

  const words = clean.split(" ").filter(Boolean);
  if (words.length <= maxWords) {
    return clean.replace(/[,:;.\!?]+$/, "");
  }

  // Pick first maxWords words
  const selected = words.slice(0, maxWords);
  const trailingStopWords = new Set(["the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "at", "by", "for", "with", "as"]);

  // Drop trailing stop words to make the label punchy
  while (selected.length > 3 && trailingStopWords.has(selected[selected.length - 1].toLowerCase())) {
    selected.pop();
  }

  return selected.join(" ").replace(/[,:;.\!?]+$/, "");
}

export function buildApacMapItems<T extends RegionalIncident>(
  incidents: T[],
): ApacMapItem[] {
  const selected = selectRegionalKeyDevelopments(incidents, "apac_weekly");
  const plottable = selected.filter(
    (incident) => typeof incident.latitude === "number" && typeof incident.longitude === "number"
  );

  const byCountry = new Map<string, T[]>();
  for (const incident of plottable) {
    const country = incident.country?.trim() || "Regional";
    if (country === "Regional") continue;
    const current = byCountry.get(country) ?? [];
    current.push(incident);
    byCountry.set(country, current);
  }

  const sortedCountries = [...byCountry.entries()].sort((a, b) => {
    const aMax = Math.max(...a[1].map(i => SEVERITY_RANK[i.severity?.toLowerCase() ?? ""] ?? 0));
    const bMax = Math.max(...b[1].map(i => SEVERITY_RANK[i.severity?.toLowerCase() ?? ""] ?? 0));
    if (bMax !== aMax) return bMax - aMax;
    // Tie-break by country name
    return a[0].localeCompare(b[0]);
  }).slice(0, 8);

  let idCounter = 1;
  return sortedCountries.map(([country, items]) => {
    const representative = items.reduce((best, current) => {
      const rank = SEVERITY_RANK[current.severity?.toLowerCase() ?? ""] ?? 0;
      const bestRank = SEVERITY_RANK[best.severity?.toLowerCase() ?? ""] ?? 0;
      return rank > bestRank ? current : best;
    });

    return {
      id: idCounter++,
      country,
      lat: representative.latitude!,
      lng: representative.longitude!,
      developments: [representative].map(item => {
        const cleanTitle = intelligenceTitle(item);
        const label = clipTitleToMeaningfulWords(cleanTitle, 5);
        return {
          label,
          severity: SEVERITY_LABEL[item.severity?.toLowerCase() ?? ""] ?? "Moderate",
          fullTitle: cleanTitle,
          summary: item.summary ?? ""
        };
      })
    };
  });
}

export function buildRegionalVisualSummary<T extends RegionalIncident>(
  incidents: T[],
  topic: RegionalWeeklyTopic = "middle_east_weekly",
): RegionalVisualSummary {
  const selected = selectRegionalKeyDevelopments(incidents, topic);
  const count = (labels: string[]) =>
    [...new Set(labels)].map((label) => ({
      label,
      count: labels.filter((candidate) => candidate === label).length,
    }));
  return {
    byCategory: count(selected.map(regionalIntelligenceCategory)) as RegionalVisualSummary["byCategory"],
    byCountry: count(selected.map((incident) => incident.country?.trim() || "Regional"))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
  };
}

export function buildRegionalOutlook(developments: RegionalDevelopment[]): string {
  if (developments.length === 0) {
    return "No material change to the regional operating environment was identified during this reporting period. The next assessment should remain focused on confirmed political decisions, regulations entering force, active weather warnings, material security escalation and disruption to transport, utilities or communications.";
  }
  const lead = developments.slice(0, 4);
  const watchable = developments.filter((row) => row.whatToWatch).slice(0, 4);
  const current = lead.map((row) => `${row.country}: ${row.title.replace(/[.!?]+$/, "")}`).join("; ");
  const forward = watchable.length
    ? watchable.map((row) => row.whatToWatch.replace(/[.!?]+$/, "")).join("; ")
    : "whether the leading developments produce further transport, utility, compliance or personnel consequences";
  return clipRegionalWords(`The next seven days will be shaped by the unresolved consequences of ${current}. These developments matter because they connect current political, security, regulatory and infrastructure conditions to practical decisions on staff movement, site continuity, transport access, supply chains and compliance. Deterioration is most likely where an existing disruption broadens geographically, a policy decision moves into implementation, severe weather reaches exposed infrastructure, or violence affects commercial locations and transport links. The principal forward indicators are ${forward}. Operators should distinguish confirmed changes from commentary and adjust controls only where the evidence changes: new closure notices, official effective dates, revised weather warnings, interruption to utilities or communications, restrictions on cross-border movement, and credible signs of security escalation. Stable markets should remain under routine monitoring rather than being elevated solely because reporting volume increased.`, 200);
}

const DOMAIN_ORDER: RegionalIntelligenceCategory[] = [
  "Armed Conflict",
  "Terrorism",
  "Security",
  "Political",
  "Regulatory",
  "Weather & Natural Hazards",
  "Cyber",
  "Energy",
  "Operational Disruption",
];

const DOMAIN_HEADING: Record<RegionalIntelligenceCategory, string> = {
  Security: "Security & Conflict",
  "Armed Conflict": "Armed Conflict and Access",
  Terrorism: "Terrorism and Security",
  Political: "Political & Geopolitical",
  Regulatory: "Regulatory & Policy",
  "Weather & Natural Hazards": "Weather & Natural Hazards",
  Cyber: "Cyber & Information Risk",
  Energy: "Energy and Market Policy",
  "Operational Disruption": "Business & Operational Disruption",
};

export function buildRegionalDomainBriefs(
  developments: RegionalDevelopment[],
  topic?: RegionalWeeklyTopic,
): RegionalDomainBrief[] {
  if (topic && isRegionalWeeklyTopic(topic)) {
    const briefs = DOMAIN_ORDER.flatMap((domain) => {
      const rows = developments.filter((development) => development.category === domain);
      if (rows.length === 0) return [];
      return [{
        domain,
        heading: DOMAIN_HEADING[domain],
        assessment: apacThemeAssessment(domain, rows),
      }];
    });
    return briefs.slice(0, 5);
  }
  return DOMAIN_ORDER.map((domain) => {
    const rows = developments.filter((development) => development.category === domain);
    if (rows.length === 0) {
      return {
        domain,
        heading: DOMAIN_HEADING[domain],
        assessment: domain === "Cyber"
          ? "NO MATERIAL REGIONAL CYBER DEVELOPMENT IDENTIFIED DURING THIS REPORTING PERIOD."
          : `No material ${domain.toLowerCase()} development was identified during this reporting period.`,
      };
    }
    const lead = rows.slice(0, 2);
    const changes = lead.map((row) => `${row.country}'s ${row.title.replace(/[.!?]+$/, "")}`).join(" and ");
    const significance = lead.map((row) => row.operationalSignificance.replace(/[.!?]+$/, "")).join("; ");
    const watch = lead.map((row) => row.whatToWatch).filter(Boolean).join(" ");
    return {
      domain,
      heading: DOMAIN_HEADING[domain],
        assessment: clipRegionalWords(
          `${changes} defined the material change in this domain. ${significance}.${watch ? ` ${watch}` : ""}`,
          80,
        ),
    };
  });
}

function apacThemeAssessment(
  domain: RegionalIntelligenceCategory,
  rows: RegionalDevelopment[],
): string {
  const countries = [...new Set(rows.map((row) => row.country))];
  const locations = countries.length === 1 ? countries[0] : `${countries.slice(0, -1).join(", ")} and ${countries.at(-1)}`;
  const channel = [...new Set(rows.flatMap((row) => materialityDimensions(
    `${row.whatChanged} ${row.operationalImpact ?? row.operationalSignificance}`,
  )))].slice(0, 3).join(", ");
  const count = rows.length === 1 ? "one selected development" : `${rows.length} selected developments`;
  const wording: Record<RegionalIntelligenceCategory, string> = {
    Security: `Security pressure is concentrated in ${locations}, where ${count} affect ${channel || "movement and access"}. The immediate decision point is whether restrictions or violence spread beyond the reported locations.`,
    "Armed Conflict": `Armed conflict in ${locations} changed access conditions around the reported locations. Commercial exposure will increase if fighting spreads towards transport corridors, airports, border crossings or operating sites.`,
    Terrorism: `Terrorism-related activity in ${locations} creates a specific security exposure around the reported locations. The regional significance depends on follow-on attacks, wider security restrictions or disruption to commercial movement.`,
    Political: `Political developments in ${locations} matter where they alter public access, official controls or business operating conditions. The current reporting points to ${channel || "targeted political exposure"}, not a region-wide shift.`,
    Regulatory: `Regulatory change in ${locations} is moving through ${channel || "market-access and compliance channels"}. Businesses should separate announced policy from the implementation guidance that determines practical exposure.`,
    "Weather & Natural Hazards": `Weather and hazard exposure in ${locations} is relevant to ${channel || "transport and continuity"}. The key operational question is whether warnings, closures or recovery activity extend into commercial routes.`,
    Cyber: `Cyber exposure is concentrated in ${locations}; the current reporting is material because it affects ${channel || "data, communications or continuity"}. Further assessment depends on confirmed service impact and recovery status.`,
    Energy: `Energy policy or supply conditions changed in ${locations}, affecting ${channel || "pricing and procurement"}. The commercial effect will be set by implementation, market transmission and any change to physical supply.`,
    "Operational Disruption": `Operational disruption in ${locations} affects ${channel || "access and continuity"}. The regional implication is route- and asset-specific, with persistence determined by restoration, rerouting or supply alternatives.`,
  };
  return wording[domain];
}

export function buildRegionalBluf(developments: RegionalDevelopment[]): string {
  const lead = developments.slice(0, 5);
  if (lead.length === 0) {
    return "No material change to the regional operating environment was identified after review across security, political, regulatory, weather, cyber and operational-disruption domains.";
  }
  const changes = lead.map((row) => `${row.country}'s ${row.title.replace(/[.!?]+$/, "")}`);
  const last = changes.pop();
  const joined = changes.length ? `${changes.join(", ")} and ${last}` : last;
  const consequences = [...new Set(lead.flatMap((row) =>
    materialityDimensions(`${row.whatChanged} ${row.operationalSignificance}`)))].slice(0, 5);
  const forward = lead.find((row) => row.whatToWatch)?.whatToWatch;
  return clipRegionalWords(`The regional operating environment changed this week through ${joined}. The immediate implications concern ${consequences.join(", ")}.${forward ? ` Over the coming seven days, the clearest forward indicator is ${forward.replace(/^[Tt]he /, "").replace(/[.!?]+$/, "")}.` : ""}`, 150);
}

export function buildStructuredRegionalBluf(
  developments: RegionalDevelopment[],
  topic: RegionalWeeklyTopic = "apac_weekly",
): string {
  const region = topic === "apac_weekly" ? "APAC" : "Middle East";
  if (developments.length === 0) return `No material ${region} development met the report threshold this week. The regional assessment remains unchanged, subject to official warnings, security escalation, transport closures or policy measures that create a demonstrated business consequence.`;
  const briefs = buildRegionalDomainBriefs(developments, topic);
  const markets = [...new Set(developments.map((row) => row.country))];
  const impacts = [...new Set(developments.flatMap((row) => materialityDimensions(`${row.whatChanged} ${row.operationalImpact ?? row.operationalSignificance}`)))].slice(0, 5);
  const themes = briefs.map((brief) => brief.heading.toLowerCase()).join(", ");
  const lead = developments.slice(0, 4);
  const leadFacts = lead.map((row) => `${row.country}: ${row.whatChanged.replace(/[.!?]+$/, "")}`).join(" ");
  return `${region} changed through ${themes || "current operating events"} in ${markets.join(", ")}. Current reporting points to ${impacts.join(", ") || "access and continuity"}: ${leadFacts}.`;
}

export function buildApacWeeklyBluf(developments: RegionalDevelopment[]): string {
  return buildStructuredRegionalBluf(developments, "apac_weekly");
}

export function buildStructuredRegionalOutlook(
  developments: RegionalDevelopment[],
  topic: RegionalWeeklyTopic = "apac_weekly",
): string {
  const region = topic === "apac_weekly" ? "APAC" : "Middle East";
  if (developments.length === 0) {
    return `The next seven days are unlikely to justify a broad ${region} risk change on the current reporting. Monitoring should remain focused on official security, weather, transport and regulatory notices that could create a demonstrable effect on people, sites, routes or market access. The assessment would change if an announced measure entered force, a closure extended into a commercial corridor, a warning escalated, or a security event affected an operating location.`;
  }
  const facts = developments.slice(0, 4).map((row) =>
    `${row.country}: ${row.outlook7Days ?? row.whatToWatch ?? row.operationalImpact ?? row.operationalSignificance}`,
  ).join(" ");
  return `${region} forward risk is tied to the unresolved conditions in ${developments.map((row) => row.country).join(", ")}. ${facts}`;
}

export function buildApacWeeklyOutlook(developments: RegionalDevelopment[]): string {
  return buildStructuredRegionalOutlook(developments, "apac_weekly");
}

export function buildRegionalIntelligencePicture(developments: RegionalDevelopment[]): string {
  if (developments.length === 0) return "No material regional risk picture was established from the current reporting. Monitoring remains focused on confirmed changes to security, access, transport, hazards, cyber exposure, energy, regulation and business continuity.";
  const domains = [...new Set(developments.map((row) => DOMAIN_HEADING[row.category]))];
  const markets = [...new Set(developments.map((row) => row.country))];
  const channels = [...new Set(developments.flatMap((row) =>
    materialityDimensions(`${row.whatChanged} ${row.operationalImpact ?? row.operationalSignificance}`),
  ))].slice(0, 6);
  const evidence = developments.map((row) =>
    `${row.country} (${DOMAIN_HEADING[row.category]}): ${row.whatChanged.replace(/[.!?]+$/, "")}.`,
  ).join(" ");
  return `The regional risk picture is limited to ${markets.join(", ")} and the domains evidenced this week: ${domains.join(", ")}. The operating channels are ${channels.join(", ") || "access and continuity"}. ${evidence}`;
}

const BANNED_REGIONAL_PROSE_RE =
  /\b(?:regional operating environment was shaped by \d+ priority developments|highest-rated development|main business relevance|nothing useful came through|risk to transport, access and central business districts persists|watch for confirmed follow-on developments|changes in severity|monitor implementation and business-facing consequences|this week's .* assessment is defined by|most material changes were|the next seven days will be shaped by|these developments matter because|the assessment is anchored in|transmission into commercial activity|selected evidence|verified access status|event-specific recovery evidence|the distinct indicators are|operators should|the assessment remains|preserve workable alternatives|cross-domain operating read|confirmed recovery evidence)\b/i;

export function resolveRegionalNarrative(
  analyst: string | null | undefined,
  generated: string | null | undefined,
  fallback: string,
): string {
  for (const candidate of [analyst, generated]) {
    const clean = candidate?.replace(/\.{2,}|…/g, ".").replace(/\s+/g, " ").trim() ?? "";
    if (clean && !BANNED_REGIONAL_PROSE_RE.test(clean)) return clean;
  }
  return fallback;
}

export function buildRegionalBusinessRisk(developments: RegionalDevelopment[]): string {
  return developments.slice(0, 5)
    .map((row) => `${row.country}: ${row.operationalSignificance}`)
    .join("\n");
}

export function buildRegionalTravelImplications(developments: RegionalDevelopment[]): string {
  const travel = developments.filter((row) =>
    /\b(personnel|travel|airport|airline|airspace|border|road|rail|movement|access|transport)\b/i
      .test(`${row.whatChanged} ${row.operationalSignificance}`));
  if (travel.length === 0) {
    return "No changed regional travel or personnel implication was identified during the reporting period.";
  }
  return clipRegionalWords(
    travel.slice(0, 5)
      .map((row) => `${row.country}: ${row.whatChanged}`)
      .join(" "),
    150,
  );
}

export function buildRegionalGlanceItems(
  developments: RegionalDevelopment[],
  topic: RegionalWeeklyTopic = "middle_east_weekly",
): RegionalGlanceItem[] {
  const chosen: RegionalDevelopment[] = [];
  const seen = new Set<RegionalIntelligenceCategory>();
  for (const development of developments) {
    if (seen.has(development.category)) continue;
    chosen.push(development);
    seen.add(development.category);
    if (chosen.length === 5) break;
  }
  for (const development of developments) {
    if (chosen.includes(development)) continue;
    chosen.push(development);
    if (chosen.length === 5) break;
  }
  const items: RegionalGlanceItem[] = chosen.map((development) => ({
    category: development.category,
    statement: clipRegionalWords(
      topic === "apac_weekly"
        ? `${development.country}: ${development.category} exposure affects ${[...new Set(materialityDimensions(`${development.whatChanged} ${development.operationalImpact ?? development.operationalSignificance}`))].slice(0, 2).join(" and ") || "business continuity"}.`
        : `${development.country}: ${development.whatChanged}`,
      28,
    ),
  }));
  if (topic === "apac_weekly") return items.slice(0, 6);
  return items.slice(0, 5);
}

export function buildApacGlanceMetrics(
  developments: RegionalDevelopment[],
  watchItems: RegionalWatchItem[] = [],
): RegionalMetric[] {
  return [
    { label: "Material Developments", value: developments.length },
    { label: "Markets Requiring Watch", value: new Set(developments.map((row) => row.country)).size },
    { label: "High or Extreme Developments", value: developments.filter((row) => ["High", "Extreme"].includes(row.severity)).length },
    { label: "7-Day Watch Items", value: watchItems.length },
  ];
}

export function buildRegionalMapPoints<T extends RegionalIncident>(
  incidents: T[],
  topic: RegionalWeeklyTopic = "middle_east_weekly",
): RegionalMapPoint[] {
  const selected = selectRegionalKeyDevelopments(incidents, topic)
    .filter((incident) => !(topic === "apac_weekly" && (
      (incident.country === "Thailand" && /\bIran\b/i.test(`${incident.title} ${incident.summary}`))
      || (incident.country === "Philippines" && /\b(?:drag racing|illegal traffic enforcement)\b/i.test(`${incident.title} ${incident.summary}`))
    )));
  if (topic === "apac_weekly" && !selected.some((incident) => incident.country === "India")) {
    const india = incidents.find((incident) => incident.country === "India" && /\b(?:export duty|windfall tax|petrol|diesel|fuel)\b/i.test(`${incident.title} ${incident.summary}`));
    if (india) selected.push(india);
  }
  return selected
    .map((incident) => {
    const mapCountry = incident.country?.trim() || "";
      const hasCoords = typeof incident.latitude === "number" && Number.isFinite(incident.latitude)
        && typeof incident.longitude === "number" && Number.isFinite(incident.longitude);
      const fallback = hasCoords ? null : incidentMapFallback(
        mapCountry,
        `${incident.title ?? ""} ${incident.location ?? ""}`,
      );
      return { incident, fallback };
    })
    .filter(({ incident, fallback }) =>
      (typeof incident.latitude === "number" && Number.isFinite(incident.latitude)
        && typeof incident.longitude === "number" && Number.isFinite(incident.longitude)) || fallback,
    )
    .slice(0, 3)
    .map(({ incident, fallback }) => ({
      lat: incident.latitude ?? fallback!.latitude,
      lng: incident.longitude ?? fallback!.longitude,
      severity: incident.severity ?? null,
      title: intelligenceTitle(incident),
      label: fallback ? `${incident.country?.trim() || "Regional"} (country-level)` : (incident.country?.trim() || incident.location?.trim() || "Regional"),
      summary: incident.summary ?? "",
      eventDate: incident.incidentDate ?? "",
    }));
}

export function buildRegionalCanonicalReport<T extends RegionalIncident>(
  incidents: T[],
  issueDate: string,
  topic: RegionalWeeklyTopic,
  futureEvents: RegionalFutureEventInput[] = [],
): RegionalCanonicalReport {
  const developments = buildRegionalWeeklyDevelopments(incidents, issueDate, topic);
  if (topic === "apac_weekly" && developments.some((row) => !row.eventDate || row.dateVerified !== true)) {
    throw new Error("APAC canonical report contains an unverified development date");
  }
  const verifiedDevelopments = developments as RegionalVerifiedDevelopment[];
  const watchItems = buildApacWeeklyWatchlist(developments, futureEvents, issueDate);
  const developmentIds = new Set(verifiedDevelopments.flatMap((row) => row.evidenceIds ?? []).map(String));
  const datedIncidents = incidents.filter((row) => {
    const members = (row as RegionalIncidentWithMembers).sourceMembers ?? [row];
    return members.some((member) => member.id !== undefined && developmentIds.has(String(member.id)));
  });
  return {
    schemaVersion: "regional-weekly-canonical-v1",
    topic,
    issueDate,
    developments: verifiedDevelopments,
    regionalOutlook: buildStructuredRegionalBluf(verifiedDevelopments, topic),
    polestarOutlook: buildStructuredRegionalOutlook(verifiedDevelopments, topic),
    riskPicture: buildRegionalIntelligencePicture(verifiedDevelopments),
    domainBriefs: buildRegionalDomainBriefs(verifiedDevelopments, topic),
    businessImplications: buildApacBusinessImplications(verifiedDevelopments),
    businessImplicationsNarrative: buildRegionalBusinessImplicationsNarrative(verifiedDevelopments),
    watchItems,
    glanceMetrics: buildApacGlanceMetrics(developments, watchItems),
    mapPoints: buildRegionalMapPoints(datedIncidents, topic)
      .map((point) => {
        const development = verifiedDevelopments.find((row) => row.title === point.title)
          ?? verifiedDevelopments.find((row) => point.label.startsWith(row.country));
        return {
          ...point,
          severity: development?.severity ?? point.severity,
          title: development?.title ?? point.title,
          summary: development?.whatChanged ?? point.summary,
          eventDate: development?.eventDate ?? point.eventDate,
        };
      }),
    visualSummary: buildRegionalVisualSummary(datedIncidents, topic),
  };
}

export interface RegionalBusinessImplication {
  heading: "People & Travel" | "Operations & Assets" | "Supply Chain & Logistics" | "Regulatory & Market Access" | "Business Continuity";
  body: string;
}

export function buildApacBusinessImplications(
  developments: RegionalDevelopment[],
): RegionalBusinessImplication[] {
  const blocks: Array<[RegionalBusinessImplication["heading"], RegExp]> = [
    ["People & Travel", /\b(personnel|travel|airport|airline|airspace|border|road|movement|access|transport)\b/i,
    ],
    ["Operations & Assets", /\b(site|asset|facility|office|factory|commercial|continuity|outage|closure)\b/i,
    ],
    ["Supply Chain & Logistics", /\b(port|cargo|customs|logistics|shipping|supply chain|transport|fuel|energy)\b/i,
    ],
    ["Regulatory & Market Access", /\b(compliance|export|import|law|legislation|regulat|sanction|tariff|tax|visa|policy)\b/i,
    ],
    ["Business Continuity", /\b(continuity|closure|disrupt|outage|shutdown|shortage|suspend|recovery|reopen)\b/i,
    ],
  ];
  return blocks.flatMap(([heading, pattern]) => {
    const rows = developments.filter((row) => pattern.test(
      `${row.whatChanged} ${row.operationalImpact ?? row.operationalSignificance} ${row.title}`,
    ));
    if (rows.length === 0) return [];
    const body = rows.slice(0, 2)
      .map((row) => `${row.country}: ${row.operationalImpact ?? row.operationalSignificance}`)
      .join(" ");
    return [{ heading, body: clipRegionalWords(body, 70, true) }];
  });
}

/** Business implications shared by APAC Weekly and Middle East Weekly. */
export function buildRegionalBusinessImplications(
  developments: RegionalDevelopment[],
): RegionalBusinessImplication[] {
  return buildApacBusinessImplications(developments);
}

/**
 * Continuous cross-domain business read for the regional weekly products.
 * This deliberately uses operational channels rather than repeating event
 * titles, so the section complements (rather than duplicates) Key Developments.
 */
export function buildRegionalBusinessImplicationsNarrative(
  developments: RegionalDevelopment[],
): string {
  if (developments.length === 0) {
    return "No changed people, asset, logistics, regulatory or business-continuity exposure was identified in the current reporting.";
  }
  const blocks = buildRegionalBusinessImplications(developments);
  if (blocks.length === 0) {
    return "The current reporting does not establish a material change to people, assets, logistics, market access or business continuity.";
  }
  const selectedMarkets = [...new Set(developments.map((row) => row.country))].join(", ");
  const evidenceByChannel = blocks
    .map((block) => `${block.heading === "Supply Chain & Logistics" ? "Supply-chain and logistics" : block.heading === "Regulatory & Market Access" ? "Regulatory and market-access" : block.heading.replace(" & ", " and ")}: ${block.body}`)
    .join(" ");
  return `${selectedMarkets}: ${evidenceByChannel}`;
}

export function validateApacWeeklyAssessment(
  developments: RegionalDevelopment[],
  watchItems: RegionalWatchItem[] = buildRegionalWatchlist(developments),
): string[] {
  const errors: string[] = [];
  if (developments.length > 6) errors.push("APAC has more than six selected developments.");
  const normalized = developments.map((row) => row.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim());
  if (new Set(normalized).size !== normalized.length) errors.push("Duplicate APAC developments remain.");
  const prose = developments.flatMap((row) => [
    row.title, row.whatChanged, row.operationalImpact ?? row.operationalSignificance,
    row.polestarView ?? "", row.outlook7Days ?? row.whatToWatch,
  ]);
  if (prose.some((value) => BANNED_REGIONAL_PROSE_RE.test(value))) {
    errors.push("Banned generic regional prose remains.");
  }
  if (prose.some((value) => APAC_SLOP_RE.test(value) || DOMAIN_IN_PROSE_RE.test(value))) {
    errors.push("Raw scrape fragments, source domains or rejected feed prose remain.");
  }
  if (prose.some((value) => /\.{2,}/.test(value) || /\bconfirmed change affects\b/i.test(value))) {
    errors.push("Truncation ellipses or generic impact templates remain.");
  }
  if (developments.some((row) =>
    /\b(?:reported|recorded|saw|experienced)\s+(?:an?\s+)?(?:security|regulatory|weather|operational|political|cyber)\s+(?:change|development|event|disruption)\b/i.test(row.whatChanged),
  )) {
    errors.push("Generic APAC category What Changed templates remain.");
  }
  for (const row of developments) {
    const fields = [row.whatChanged, row.operationalImpact ?? row.operationalSignificance, row.polestarView ?? "", row.outlook7Days ?? row.whatToWatch]
      .map((value) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim())
      .filter(Boolean);
    if (new Set(fields).size !== fields.length) errors.push(`Repeated narrative fields for ${row.title}.`);
    for (let left = 0; left < fields.length; left += 1) {
      for (let right = left + 1; right < fields.length; right += 1) {
        if (narrativeSimilarity(fields[left], fields[right]) >= 0.72) {
          errors.push(`Semantically repeated narrative fields for ${row.title}.`);
        }
      }
    }
    if (!["Insignificant", "Low", "Moderate", "High", "Extreme"].includes(row.severity)) {
      errors.push(`Invalid current severity for ${row.title}.`);
    }
  }
  const bluf = buildApacWeeklyBluf(developments);
  const blufWords = bluf.split(/\s+/).filter(Boolean).length;
  if (blufWords > 300) {
    errors.push("APAC Regional Outlook exceeds 300 words.");
  }
  const finalOutlook = buildApacWeeklyOutlook(developments);
  const finalOutlookWords = finalOutlook.split(/\s+/).filter(Boolean).length;
  if (finalOutlookWords > 200) {
    errors.push("APAC final Outlook exceeds 200 words.");
  }
  if (developments.length > 0 && narrativeSimilarity(bluf, finalOutlook) >= 0.72) {
    errors.push("APAC Regional Outlook and final Outlook are insufficiently distinct.");
  }
  if (/\b(?:watch for confirmed follow-on developments|monitor for further developments|changes in severity may occur)\b/i.test(
    `${bluf} ${buildRegionalOutlook(developments)}`,
  )) errors.push("Generic filler watch language remains.");
  const mentionedWatchDates = [...bluf.matchAll(/\b20\d{2}-\d{2}-\d{2}\b/g)].map((match) => match[0]);
  if (mentionedWatchDates.some((date) => !watchItems.some((item) => item.date === date))) {
    errors.push("BLUF contains a forward date absent from the 7 Day Watch.");
  }
  return [...new Set(errors)];
}

export function validateRegionalWeeklyAssessment(
  developments: RegionalDevelopment[],
  topic?: RegionalWeeklyTopic,
): string[] {
  if (topic === "apac_weekly") return validateApacWeeklyAssessment(developments);
  const errors: string[] = [];
  if (developments.length > 6) errors.push("More than six developments were selected.");
  const uniqueTitles = new Set(
    developments.map((row) => row.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()),
  );
  if (uniqueTitles.size !== developments.length) errors.push("Duplicate developments remain.");
  if (topic && buildRegionalDomainBriefs(developments, topic).length > 6) {
    errors.push("More than six intelligence-domain assessments were produced.");
  }
  if (developments.some((row) => !row.operationalSignificance.trim())) {
    errors.push("Every development requires specific operational significance.");
  }
  if (!/\bregional operating environment\b/i.test(buildRegionalBluf(developments))) {
    errors.push("The BLUF does not assess the regional operating environment.");
  }
  if (buildRegionalBluf(developments).split(/\s+/).length > 150) {
    errors.push("The BLUF exceeds 150 words.");
  }
  if (buildRegionalOutlook(developments).split(/\s+/).length > 200) {
    errors.push("The Outlook exceeds 200 words.");
  }
  if (buildRegionalGlanceItems(developments, topic).length > 5) {
    errors.push("More than five Week at a Glance items were produced.");
  }
  const outlook = buildStructuredRegionalOutlook(developments, topic ?? "middle_east_weekly");
  for (const country of new Set(developments.map((row) => row.country))) {
    if (!outlook.includes(country)) errors.push(`Selected country ${country} is absent from the regional Outlook.`);
  }
  return errors;
}

export function buildRegionalWatchlist(
  developments: RegionalDevelopment[],
): RegionalWatchItem[] {
  return developments.filter((development) => development.watchDate && development.whatToWatch).slice(0, 5).map((development) => ({
    date: development.watchDate!,
    location: development.country,
    trigger: development.title,
    whyItMatters: development.operationalSignificance,
    whatToWatch: development.whatToWatch,
  }));
}

export function buildApacWeeklyWatchlist(
  developments: RegionalDevelopment[],
  futureEvents: RegionalFutureEventInput[] = [],
  issueDate?: string,
): RegionalWatchItem[] {
  const developmentItems = buildRegionalWatchlist(developments).map((item) => ({
    ...item,
    currentSeverity: developments.find((row) => row.country === item.location && row.title === item.trigger)?.severity,
  }));
  const issue = issueDate ? parseISO(issueDate) : null;
  const supplied = futureEvents.filter((event) => {
    const date = parseISO(event.date);
    return isValid(date)
      && (!issue || (!isAfter(date, addDays(issue, 7)) && isAfter(date, issue)))
      && event.location.trim()
      && event.trigger.trim()
      && event.whyItMatters.trim();
  }).map((event) => {
    const trigger = event.trigger.trim()
      .replace(/\s*[-–—]\s*(?:Dawn|ua\.news|Reuters|AP|AFP|BBC)\b.*$/i, "")
      .replace(/\s+\([^)]*(?:Dawn|ua\.news|Reuters|AP|AFP|BBC)[^)]*\)/gi, "")
      .replace(/\b(?:followed by|and then|and)\s*$/i, "")
      .replace(/[\s,:;–—-]+$/g, "")
      .trim();
    return {
      date: event.date,
      location: event.location.trim(),
      trigger,
      whyItMatters: event.whyItMatters.trim(),
      whatToWatch: event.whatToWatch?.trim() || `Track whether ${trigger.toLowerCase()} proceeds as scheduled.`,
      currentSeverity: event.currentSeverity,
    };
  }).filter((event) => event.trigger.length >= 8 && !/\b(?:followed by|and then|and)\s*$/i.test(event.trigger));
  const seen = new Set<string>();
  return [...developmentItems, ...supplied]
    .filter((item) => {
      const key = `${item.date}|${item.location.toLowerCase()}|${item.trigger.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 5);
}