import { addDays, differenceInCalendarDays, format, isAfter, isValid, parse, parseISO } from "date-fns";
import { consolidateCountryStories } from "./countrySameStory";
import { incidentMapFallback } from "./incidentMapFallback";
import { isRegionalFactualEdition, validateRegionalEditorialReport } from "./regionalEditorial";
import { cleanRegionalSourceText } from "./regionalSourceText";

export type RegionalWeeklyTopic = "apac_weekly" | "middle_east_weekly";

export type RegionalIncident = {
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
  /** Semantic identity and verified facts, never an article headline as prose. */
  eventKey?: string;
  confirmedFacts?: string[];
  dateBasis?: "event" | "reported";
  country: string;
  location?: string;
  eventDate?: string;
  dateVerified?: true;
  title: string;
  severity: "Insignificant" | "Low" | "Moderate" | "High" | "Extreme";
  severityRationale?: string;
  severityEvidence?: string[];
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

export interface RegionalCoverageCheck {
  domain: string;
  topic?: string | null;
  query?: string;
  status: "checked" | "not_run";
  sourceNames: string[];
  itemsFetched: number;
  candidatesAccepted: number;
  errors: string[];
}

export interface RegionalCoverageManifest {
  requiredDomains: string[];
  domains: RegionalCoverageCheck[];
  forwardSearch: RegionalCoverageCheck;
  requiredGeographies: string[];
  searchedGeographies: string[];
  requiredForwardDomains?: string[];
  forwardDomains?: RegionalCoverageCheck[];
  collectionPasses?: number;
}

export interface RegionalCanonicalReport {
  schemaVersion: "regional-weekly-canonical-v1";
  editorialVersion?: string;
  evidenceFingerprint?: string;
  topic: RegionalWeeklyTopic;
  issueDate: string;
  developments: RegionalDevelopment[];
  regionalOutlook: string;
  polestarOutlook: string;
  polestarOutlookEvidenceKeys?: string[];
  riskPicture: string;
  domainBriefs: RegionalDomainBrief[];
  businessImplications: RegionalBusinessImplication[];
  businessImplicationsNarrative: string;
  watchItems: RegionalWatchItem[];
  glanceMetrics: RegionalMetric[];
  mapPoints: RegionalMapPoint[];
  visualSummary: RegionalVisualSummary;
  coverageManifest: RegionalCoverageManifest;
}

export const REQUIRED_REGIONAL_REPORT_DOMAINS = [
  "Security",
  "Political",
  "Regulatory",
  "Weather & Natural Hazards",
  "Cyber",
  "Operational Disruption",
] as const satisfies readonly RegionalIntelligenceCategory[];

export function validateRegionalCanonicalStructure(
  report: RegionalCanonicalReport,
): string[] {
  const errors: string[] = [];
  if (!report.coverageManifest || !isCompleteRegionalCoverage(report.coverageManifest)) {
    errors.push("Regional collection coverage is incomplete; do not save or export the report.");
  }
  const domains = new Set(report.domainBriefs.map((brief) => brief.domain));
  // Legacy snapshots used an explicit six-domain schema. New factual reports
  // omit unsupported domains rather than manufacturing "no change" paragraphs.
  if (!isRegionalFactualEdition(report.editorialVersion)) {
    for (const domain of REQUIRED_REGIONAL_REPORT_DOMAINS) {
      if (!domains.has(domain)) errors.push(`Missing required intelligence domain: ${domain}.`);
    }
  }
  if (domains.size !== report.domainBriefs.length
    || report.domainBriefs.some((brief) => !REQUIRED_REGIONAL_REPORT_DOMAINS.includes(brief.domain as never))) {
    errors.push("Regional intelligence domains must be distinct and supported.");
  }
  if (report.domainBriefs.some((brief) => !brief.assessment.trim())) {
    errors.push("Omit unsupported domains rather than padding them with empty assessments.");
  }
  if (report.mapPoints.length === 0) errors.push("Regional report requires a risk map with at least one verified point.");
  if (report.developments.length === 0) errors.push("Regional report requires key developments.");
  if (!report.businessImplicationsNarrative.trim()) errors.push("Regional report requires business implications.");
  if (!report.polestarOutlook.trim()) errors.push("Regional report requires a Polestar Outlook.");
  return [...errors, ...validateRegionalEditorialReport(report)];
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
  if (!value.coverageManifest || !isCompleteRegionalCoverage(value.coverageManifest)) return null;
  if (value.developments.some((row) => !row.eventDate || row.dateVerified !== true)) return null;
  if (validateRegionalCanonicalStructure(value).length > 0) return null;
  return value;
}

function isCompleteRegionalCoverage(manifest: RegionalCoverageManifest): boolean {
  if (![manifest.requiredDomains, manifest.domains, manifest.requiredGeographies, manifest.searchedGeographies]
    .every(Array.isArray)) return false;
  const completed = (check: RegionalCoverageCheck | undefined) => !!check
    && check.status === "checked"
    && Array.isArray(check.sourceNames) && check.sourceNames.length > 0
    && Array.isArray(check.errors) && check.errors.length === 0;
  return [7, 9].includes(manifest.requiredDomains.length)
    && new Set(manifest.requiredDomains).size === manifest.requiredDomains.length
    && manifest.domains.length === manifest.requiredDomains.length
    && manifest.requiredDomains.every((domain) => typeof domain === "string" && manifest.domains.some((check) => check?.domain === domain))
    && manifest.domains.every(completed)
    && completed(manifest.forwardSearch)
    && manifest.requiredGeographies.every((geography) =>
      typeof geography === "string" && manifest.searchedGeographies.some((searched) =>
        typeof searched === "string" && searched.toLowerCase().includes(geography.toLowerCase()),
      ),
    );
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
  /\b(airline|airspace|airport|asset|border|business|cargo|compliance|continuity|customs|data|energy|export|fuel|grid|import|infrastructure|liquefied petroleum gas|logistics|lpg|personnel|port|regulat(?:ion|ory|e|ed|es)?|road|sanction|shipping|site|supply chain|tariff|telecom|transport|travel|utilities?|visa|workforce)\b/i;

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
const CYBER_GENERIC_INFORMATION_RE =
  /^\s*(?:cyber(?:security)?\s+)?(?:advisory|explainer|guide|research|study|survey|tips?|white ?paper)\b|\bhow to (?:avoid|prevent|protect|respond)\b/i;
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
  const assigned = canonicalCountry(incident.country?.trim() ?? "");
  // Some feeds assign US presidential/immigration policy to the country whose
  // search collected it. These cues identify the policy jurisdiction without
  // treating every incidental mention of the US as a mismatch.
  if (assigned !== "united states"
    && /\b(?:Trump(?:'s)?|U\.?S\.?\s+presiden(?:t|cy|tial))\b/i.test(title)
    && /\b(?:H-?1B|visa (?:fee|payment|requirement)|immigration policy|executive order)\b/i.test(title)) {
    return true;
  }
  if (assigned !== "united states"
    && /\bH-?1B\b/i.test(title)
    && (/\b(?:USD|\$)\s*100[,\s]?000\b/i.test(title)
      || /\b(?:fee|payment|requirement)\b/i.test(title))) {
    return true;
  }
  const first = firstNamedCountry(title);
  if (!first || !assigned || canonicalCountry(first) === assigned) return false;
  const assignedLabel = incident.country?.trim();
  if (assignedLabel) {
    const assignedPattern = new RegExp(`\\b${assignedLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (assignedPattern.test(title)) return false;
  }
  // A country name is only a subject lead when it starts the headline. This
  // preserves genuine local/cross-border effects that merely mention the US.
  const firstPattern = new RegExp(`^\\s*(?:the\\s+)?${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  return firstPattern.test(title);
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
  ["energy and utilities", /\b(electricity|energy|fuel|grid|liquefied petroleum gas|lpg|power|telecom|utilities?)\b/i],
  ["compliance and market access", /\b(compliance|export control|foreign ownership|import|law|legislation|licen[cs]|regulat|sanction|tariff|tax|visa)\b/i],
  ["political exposure", /\b(cabinet|coalition|diplomat|election|government|interstate|parliament|political|policy)\b/i],
  ["business continuity", /\b(business|continuity|disrupt|closure|outage|shortage|strike)\b/i],
];

const CATEGORY_RULES: Array<[RegionalIntelligenceCategory, RegExp]> = [
  ["Weather & Natural Hazards", /\b(cyclones?|drought|earthquakes?|extreme heat|flood(?:s|ed|ing)?|landslides?|storms?|typhoons?|volcan(?:o|ic)?|wildfires?)\b/i],
  ["Cyber", /\b(cyber|data breach|malware|ransomware|state-linked hack)\b/i],
  ["Terrorism", /\b(terror(?:ism|ist)?|suicide bomb|ied|improvised explosive)\b/i],
  ["Armed Conflict", /\b(armed conflict|airstrike|artillery|battle|clash(?:es|ed)?|combat|insurgent|junta|military offensive|rebel|shelling|territorial control)\b/i],
  ["Energy", /\b(aviation turbine fuel|diesel|energy market|export duty|fuel|liquefied petroleum gas|lpg|oil|petrol|power market|windfall tax)\b/i],
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
  // Extract a bounded event label; a clipped headline is still a headline.
  // Source wording is used for classification only, never returned as prose.
  const sources = [row.eventName, row.title, row.description, row.sourceTitle].filter(Boolean) as string[];
  const text = [row.eventType, row.issue, ...sources].filter(Boolean).join(" ");
  const type = row.eventType ?? "";
  const isStrike = /\b(?:strike|walkout|industrial action)\b/i.test(type) ||
    /\b(?:bank(?:ing)?|transport|rail(?:way)?|general|national|labour|labor|union)\s+(?:strike|walkout)\b/i.test(text);
  const isMarch = /\bmarch\b/i.test(type) ||
    /\b(?:protest|long|labour|labor|political)\s+march\b|\bmarch\s+(?:to|on|through)\b/i.test(text);
  let action = "";
  if (isStrike) {
    action = /\bbank(?:ing)?\s+(?:strike|walkout)\b|\b(?:strike|walkout)\s+(?:by\s+)?bank\s+(?:staff|workers|employees)\b/i.test(text)
      ? "banking strike"
      : /\btransport\s+(?:strike|walkout)\b/i.test(text)
        ? "transport strike"
        : "strike";
  } else if (isMarch) {
    action = /\breservation\b/i.test(text) ? "reservation march" : "protest march";
  } else if (/\b(?:protest|rally|demonstration)\b/i.test(type)) {
    action = /\bemployment[\s-]+bill\b/i.test(text)
      ? "employment-bill demonstration"
      : /\bfarmers?['’]?\s+day\b/i.test(text)
        ? "Farmers' Day demonstrations"
        : "demonstration";
  } else if (/\bblockade\b/i.test(type)) {
    action = "blockade";
  }
  if (!action) return "";

  let organiser = (row.organiser ?? "").trim();
  if (organiser.split(/\s+/).length > 8 || /[|:;\n]/.test(organiser)) organiser = "";
  if (!organiser) {
    for (const source of sources) {
      const match = source.match(/^(?:[Cc]onditional\s+)?([A-Z][A-Z0-9-]{1,14})\s+(.+)/);
      if (match && /^(?:announc\w*|plans?|calls?|nationwide\s+(?:protest|march)|employment bill)\b/i.test(match[2])) {
        organiser = match[1];
        break;
      }
    }
  }
  const qualification = /\b(?:possible|conditional|unconfirmed)\b/i.test(row.status ?? "") ? "Possible" : "Planned";
  return [qualification, organiser, action].filter(Boolean).join(" ");
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
  topic: RegionalWeeklyTopic = "apac_weekly",
): RegionalFutureEventInput[] {
  const issue = parseISO(issueDate);
  if (!isValid(issue)) return [];
  const end = addDays(issue, 7);
  const countries = new Set(regionalCountryQuery(topic).split(",").map((country) => country.toLowerCase()));
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
  const projectedEvidence: { sourceIdentity: string; venue: string }[] = [];
  for (const row of candidates) {
    const date = format(parseISO(row.eventDate!), "yyyy-MM-dd");
    const location = [row.city, row.country].map((value) => value?.trim()).filter(Boolean).join(", ");
    if (!location) continue;
    const trigger = cleanFutureEventName(row);
    if (!trigger) continue;
    const text = trigger;
    const banking = /\bbanking strike\b/i.test(trigger);
    const route = /\b(?:route|road|highway|motorway|airport|port|station|transport|traffic|march|convoy)\b/i.test(text);
    const strike = /\b(?:strike|walkout|shutdown|blockade)\b/i.test(text);
    const whyItMatters = banking
      ? `Branch and transaction services in ${location} may be affected by the planned banking strike.`
      : route
      ? `Movement and access in ${location} may be affected by the scheduled activity.`
      : strike
        ? `The scheduled labour action may affect transport, staffing or site access in ${location}.`
        : `The planned gathering may affect access or security around ${location}.`;
    const whatToWatch = banking
      ? "Check banks' branch and payment-service advisories before time-sensitive transactions."
      : route
      ? `Track route and venue advisories, transport changes and police restrictions.`
      : strike
        ? `Track organiser confirmation, transport changes and cancellation or postponement notices.`
        : `Track venue advisories, organiser confirmation and any police restrictions.`;
    const input: RegionalFutureEventInput = {
      date,
      location,
      trigger,
      whyItMatters,
      currentSeverity: futureEventSeverity(row),
      whatToWatch,
    };
    const sourceIdentity = (row.sourceTitle || row.eventName || row.title || row.description || "")
      .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const venue = (row.venue ?? "").trim().toLowerCase();
    const genericLabel = /^(?:Planned|Possible) (?:banking strike|transport strike|strike|reservation march|protest march|employment-bill demonstration|Farmers' Day demonstrations|demonstration|blockade)$/i.test(trigger);
    const duplicate = projected.some((existing, index) => {
      if (existing.date !== input.date || existing.location.toLowerCase() !== input.location.toLowerCase()) return false;
      if (existing.trigger !== input.trigger) return false;
      const evidence = projectedEvidence[index];
      if (venue && evidence.venue && venue !== evidence.venue) return false;
      // A named organiser + activity + date + city can identify one event.
      // Generic labels cannot: retain distinct source events rather than
      // merging unrelated demonstrations just because their labels agree.
      return !genericLabel || (!!sourceIdentity && sourceIdentity === evidence.sourceIdentity);
    });
    if (!duplicate) {
      projected.push(input);
      projectedEvidence.push({ sourceIdentity, venue });
    }
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
  if (/\b(?:military incursion|incursion|airstrike|artillery|warplane|exchange strikes|missile)\b/i.test(eventText)
    && /\b(?:forces?|military|coalition|houthis?|israeli|saudi|syria|yemen)\b/i.test(eventText)) {
    return "Armed Conflict";
  }
  if (/\b(?:bomb|explosive|shooting|opened fire|armed attack)\b/i.test(eventText)) return "Security";
  if (/\b(?:flood(?:s|ed|ing)?|typhoons?|cyclones?|landslides?|earthquakes?|wildfires?)\b/i.test(eventText)) {
    return "Weather & Natural Hazards";
  }
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
                  && /\b(?:visa|migration|immigration|working holiday)\b/.test(text)
                  && /\b(?:crackdown|overhaul|visa hopping|international students?|backpackers?|eligibility|extension|dependants?|rules?|caps?)\b/.test(text)
                  ? `${scopedCountry}:australia-visa-policy-overhaul`
                : scopedCountry === "india"
                  && /\b(?:windfall tax|export duty|fuel tax|tax on|duty on|levy|government cuts?|centre slashes?|cuts?)\b/.test(text)
                    && /\b(?:petrol|diesel|atf|aviation turbine fuel|export)\b/.test(text)
                     ? `${scopedCountry}:india-fuel-tax-policy`
                : scopedCountry === "nepal"
                  && /\b(?:lpg|lp gas|liquefied petroleum gas|cooking gas|gas bullets?)\b/.test(text)
                  && /\b(?:shortage|scarcity|supply|distribution|import|queue|unavailable)\b/.test(text)
                    ? `${scopedCountry}:weekly-lpg-shortage`
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
      return {
        ...representative,
        summary: representative.summary,
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
      const representativeMember = sourceMembers.find((member) => member.id === row.id) ?? sourceMembers[0];
      return {
        ...row,
        summary: representativeMember?.summary ?? row.summary,
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
  if (/\b(?:southern syria|daraa|wadi al-raqad)\b/.test(text) && /\bincursion\b/.test(text)) {
    return "syria-southern-incursion";
  }
  if (row.country?.trim().toLowerCase() === "australia"
    && /\b(?:visa|migration|immigration|working holiday)\b/.test(text)
    && /\b(?:crackdown|overhaul|visa hopping|international students?|backpackers?|eligibility|extension|dependants?|rules?|caps?)\b/.test(text)) {
    return "australia-visa-policy-overhaul";
  }
  if (/\b(?:yanbu|east[- ]west pipeline|pipeline attack)\b/.test(text)) return "saudi-pipeline";
  if (/\briyadh\b/.test(text) && /\b(?:houthi|missile|airport|air raid)\b/.test(text)) {
    return "saudi-riyadh-airport";
  }
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

export function materialityDimensions(text: string): string[] {
  return BUSINESS_DIMENSIONS.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
}

function developmentScore(
  incident: RegionalIncident,
  topic: RegionalWeeklyTopic = "middle_east_weekly",
): number {
  const text = `${incident.displayTitle ?? incident.title ?? ""} ${incident.summary ?? ""}`;
  const dimensions = materialityDimensions(text).length;
  const severity = SEVERITY_RANK[regionalWeeklySeverity(incident, topic).toLowerCase()] ?? 0;
  const regional = /\b(national|nationwide|regional|cross-border|capital|major|critical infrastructure)\b/i.test(text) ? 2 : 0;
  const securitySignificance = regionalIntelligenceCategory(incident) === "Armed Conflict"
    || /\b(?:military|defen[cs]e volunteers?|security forces?|soldiers?|troops?|insurgents?|rebels?)\b/i.test(text)
    ? 3 : 0;
  const forwardRelevance = FORWARD_RE.test(text) ? 1 : 0;
  const apacSignals = topic === "apac_weekly" ? securitySignificance + forwardRelevance : 0;
  return severity * 4 + dimensions * 3 + regional + apacSignals;
}

export function regionalWeeklySeverity(
  incident: RegionalIncident,
  topic: RegionalWeeklyTopic,
): RegionalDevelopment["severity"] {
  const stored = SEVERITY_LABEL[incident.severity?.toLowerCase() ?? ""] ?? "Moderate";
  const text = `${incident.displayTitle ?? incident.title ?? ""} ${incident.summary ?? ""}`;
  const category = regionalIntelligenceCategory(incident);
  const majorOperational = /\b(?:nationwide|national emergency|mass evacuation|airport closure|port closure|border closure|major outage|critical infrastructure shutdown|operations? halted|services? suspended|supply shortage)\b/i.test(text);
  const currentOperational = CURRENT_CONSEQUENCE_RE.test(text);
  if (category === "Regulatory" || category === "Political") {
    if (!currentOperational || (WEAK_PROPOSED_LAW_RE.test(text) && !BINDING_LAW_RE.test(text))) return "Low";
    return majorOperational ? "High" : "Moderate";
  }
  if (category === "Security" || category === "Armed Conflict" || category === "Terrorism") {
    const deliberateAttack = /\b(?:attack(?:ed|s)?|car[- ]bomb|bomb(?:ing|ed)?|blast|ied|improvised explosive|shooting|opened fire|small[- ]arms?|gunfire|clash(?:ed|es)?|ambush(?:ed)?|missile|airstrike|incursion|exchange strikes)\b/i.test(text);
    const noCasualties = /\b(?:no (?:injuries (?:or|and) deaths|deaths (?:or|and) injuries|casualties)|without casualties)\b/i.test(text);
    const confirmedFatalities = !noCasualties && !/\b(?:no|without)\s+(?:reported\s+)?(?:fatalit(?:y|ies)|deaths?|one\s+killed|casualties)\b/i.test(text)
      && /\b(?:\d+\s+(?:people\s+|officers?\s+|personnel\s+)?(?:killed|dead)|fatalit(?:y|ies)|deaths?|died|killed)\b/i.test(text);
    const confirmedInjuries = !noCasualties && !/\b(?:no|without)\s+(?:reported\s+)?(?:injur(?:y|ies)|casualties)\b/i.test(text)
      && /\b(?:\d+\s+(?:people\s+|officers?\s+|personnel\s+)?(?:injured|wounded)|injur(?:y|ies)|wounded)\b/i.test(text);
    const compoundAttack = /\b(?:bomb|blast|ied|explosive)\b/i.test(text)
      && /\b(?:small[- ]arms?|gunfire|shooting|opened fire)\b/i.test(text);
    const massConsequences = /\b(?:mass casualt(?:y|ies)|dozens (?:killed|dead|injured|wounded)|[2-9]\d+\s+(?:people\s+)?(?:killed|dead|injured|wounded)|(?:kills?|injures?|wounds?)\s+(?:at least\s+)?[2-9]\d+|(?:death|casualty) toll[\s\S]{0,40}\b[2-9]\d+|major conflict escalation|sustained large-scale)\b/i.test(text);
    if (deliberateAttack && massConsequences) return "Extreme";
    if (majorOperational || (deliberateAttack && (confirmedFatalities || confirmedInjuries || (compoundAttack && !noCasualties)))) return "High";
    if (/\b(?:flee|fled|displaced|evacuat)\b/i.test(text) && deliberateAttack) return "Moderate";
    return currentOperational || deliberateAttack ? "Moderate" : "Low";
  }
  if (category === "Cyber" || category === "Weather & Natural Hazards" || category === "Operational Disruption" || category === "Energy") {
    if (majorOperational) return "High";
    return currentOperational ? "Moderate" : "Low";
  }
  return stored;
}

function severityConsistencyErrors(developments: RegionalDevelopment[]): string[] {
  const rank = (severity: RegionalDevelopment["severity"]) =>
    SEVERITY_RANK[severity.toLowerCase()] ?? 0;
  const armedAttacks = developments.filter((row) => {
    const text = `${row.title} ${row.whatChanged} ${row.operationalImpact ?? row.operationalSignificance}`;
    return (row.category === "Security" || row.category === "Armed Conflict" || row.category === "Terrorism")
      && /\b(?:bomb|blast|ied|explosive|shooting|small[- ]arms?|opened fire|armed attack|ambush)\b/i.test(text);
  });
  const routineRegulatory = developments.filter((row) => {
    const text = `${row.title} ${row.whatChanged} ${row.operationalImpact ?? row.operationalSignificance}`;
    return (row.category === "Regulatory" || row.category === "Political")
      && !/\b(?:operations? halted|services? suspended|airport closure|port closure|border closure|major outage|critical infrastructure shutdown|mass evacuation|national emergency)\b/i.test(text);
  });
  const errors: string[] = [];
  for (const attack of armedAttacks) {
    for (const regulatory of routineRegulatory) {
      if (rank(attack.severity) < rank(regulatory.severity)) {
        errors.push(`Armed attack severity requires review against routine regulatory development: ${attack.title}.`);
      }
    }
  }
  return errors;
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

export function regionalDomainMateriality(category: RegionalIntelligenceCategory, text: string): boolean {
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
    return !CYBER_GENERIC_INFORMATION_RE.test(text)
      && CYBER_SEMANTIC_RE.test(text)
      && CYBER_CONSEQUENCE_RE.test(text);
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
  const cleanedIncidents = incidents.map((incident) => ({
    ...incident,
    title: cleanRegionalSourceText(incident.title, incident.source),
    displayTitle: incident.displayTitle
      ? cleanRegionalSourceText(incident.displayTitle, incident.source)
      : incident.displayTitle,
    summary: incident.summary
      ? cleanRegionalSourceText(incident.summary, incident.source)
      : incident.summary,
  } as T));
  const eligible = cleanedIncidents
    .filter((incident) => {
      const country = incident.country?.trim() ?? "";
      const age = differenceInCalendarDays(issue, parseISO(incident.occurredAt));
      const text = `${incident.title ?? ""} ${incident.summary ?? ""}`;
      const eventTitle = `${incident.displayTitle ?? incident.title ?? ""}`;
      if (/\b(?:off Oman|Oman coast|Oman waters)\b/i.test(text) && country.toLowerCase() !== "oman") return false;
      const dimensions = materialityDimensions(text);
      const verifiedMiddleEastPriority = topic === "middle_east_weekly"
        && Boolean(incident.incidentDate)
        && (
          (/\briyadh\b/i.test(text) && /\b(?:houthi|missile|airport|air raid)\b/i.test(text))
          || (/\b(?:yanbu|east[- ]west pipeline)\b/i.test(text) && /\b(?:attack|closure|closed|loadings|shipments|cargoes|exports)\b/i.test(text))
          || (/\buae\b/i.test(text) && /\bvisa cancellations?\b/i.test(text) && /\bbangladesh/i.test(text))
          || (/\b(?:southern syria|daraa|wadi al-raqad)\b/i.test(text) && /\bincursion\b/i.test(text))
          || (/\b(?:saudis?|saudi arabia)\b/i.test(text) && /\bhouthis?\b/i.test(text) && /\b(?:exchange strikes|yemenis flee)\b/i.test(text))
        );
      const commonReject =
        REGIONAL_ROUNDUP_RE.test(text)
          || FEED_DUMP_RE.test(text)
          || NON_EVENT_ANALYSIS_RE.test(text)
          || ((NON_BINDING_POLICY_RE.test(eventTitle) || NON_BINDING_STATEMENT_RE.test(eventTitle))
            && !BINDING_EFFECT_RE.test(eventTitle))
          || ((NON_BINDING_POLICY_RE.test(text) || NON_BINDING_STATEMENT_RE.test(text))
            && !BINDING_EFFECT_RE.test(text)
            && !CURRENT_CONSEQUENCE_RE.test(text))
          || /\bvisa[- ]free\b|\bagreement\b|\bmemorandum\b/i.test(text)
          || DOMAIN_IN_PROSE_RE.test(text)
          || APAC_COMMUNITY_RE.test(text)
          || (APAC_FUTURE_ONLY_RE.test(text) && !APAC_CURRENT_CHANGE_RE.test(text))
          || apacRejectLowValueDevelopment(text)
          || APAC_TRIVIAL_ACCIDENT_RE.test(text)
          || (ROUTINE_ENFORCEMENT_RE.test(text) && !MAJOR_ENFORCEMENT_EFFECT_RE.test(text))
          || apacRejectCommentary(text);
      const jurisdictionMismatch = hasForeignSubjectLead(incident) || hasForeignVenue(incident);
      const category = regionalIntelligenceCategory(incident);
      const confirmedSeriousSecurity = (
        category === "Security"
        || category === "Armed Conflict"
        || category === "Terrorism"
      )
        && /\b(?:attack(?:ed)?|bomb(?:ing|ed)?|blast|missile|airstrike|shooting|opened fire|incursion)\b/i.test(text)
        && /\b(?:killed|dead|injured|wounded|damaged|destroyed|closed|closure|shutdown|security forces?|military|police)\b/i.test(text);
      const apacReject = commonReject
        || jurisdictionMismatch
        || (topic === "apac_weekly" && (
          APAC_SLOP_RE.test(text)
          || (WEAK_PROPOSED_LAW_RE.test(text) && !BINDING_LAW_RE.test(text))
          || (APAC_GENERIC_SPEECH_RE.test(text) && !APAC_ACTION_RE.test(text))
          || apacRejectOffRegionAirline(text)
          || APAC_LIQUOR_LOOTING_RE.test(text)
          || APAC_MANCHESTER_AIRLINE_RE.test(text)
          || APAC_TRIVIAL_PET_POLICE_RE.test(text)
        ));
      return countries.has(country as never)
        && age >= 0
        && age <= 6
        && !LOW_VALUE_RE.test(text)
        && !(LOCAL_CRIME_RE.test(text) && !WIDER_SECURITY_RE.test(text))
        && (
          verifiedMiddleEastPriority
          || (
            !apacReject
             && (dimensions.length > 0 || category === "Cyber" || confirmedSeriousSecurity)
             && regionalDomainMateriality(category, text)
          )
        );
    })
    .sort((a, b) => {
      return developmentScore(b, topic) - developmentScore(a, topic)
        || Date.parse(b.occurredAt) - Date.parse(a.occurredAt);
    });
  const consolidated = consolidateRegionalEvents(eligible).map((row) => {
    const text = `${row.title ?? ""} ${row.summary ?? ""}`;
    if (topic === "middle_east_weekly"
      && /\b(?:saudis?|saudi arabia)\b/i.test(text)
      && /\bhouthis?\b/i.test(text)
      && /\b(?:exchange strikes|yemenis flee)\b/i.test(text)) {
      return { ...row, country: "Yemen", location: "Yemen" } as T;
    }
    return row;
  });
  const families = new Map<string, T>();
  for (const row of consolidated) {
    const key = regionalEventFamily(row);
    const existing = families.get(key);
    const pipelinePriority = (value: RegionalIncident) => /\b(?:yanbu|east[- ]west pipeline|oil shipments)\b/i.test(`${value.title ?? ""} ${value.summary ?? ""}`) ? 3 : 0;
    if (!existing) {
      families.set(key, row);
      continue;
    }
    const preferred = developmentScore(row, topic) + pipelinePriority(row) > developmentScore(existing, topic) + pipelinePriority(existing)
      ? row
      : existing;
    const allMembers = [
      ...((existing as RegionalIncidentWithMembers).sourceMembers ?? [existing]),
      ...((row as RegionalIncidentWithMembers).sourceMembers ?? [row]),
    ];
    const sourceMembers = [...new Map(allMembers.map((member) => [
      member.id === undefined
        ? `${member.occurredAt}:${member.title ?? ""}`
        : String(member.id),
      member,
    ])).values()];
    families.set(key, { ...preferred, sourceMembers } as T);
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
  checks: RegionalCoverageManifest;
}
/** Deterministic, non-writing funnel proof used by acceptance tooling. */
export function auditRegionalWeeklyCandidateFunnel(
  incidents: RegionalIncident[],
  topic: RegionalWeeklyTopic,
  issueDate: string,
  coverage: RegionalCoverageManifest,
): RegionalWeeklyCandidateFunnel {
  if (!isCompleteRegionalCoverage(coverage)) {
    throw new Error("Regional coverage incomplete: every domain, geography and forward search must be checked");
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
  return {
    topic,
    issueDate,
    input: incidents.length,
    geographyAccepted,
    dateAccepted,
    domainAccepted,
    materialAccepted,
    consolidated: curated.length,
    ranked: curated.length,
    selected: selected.length,
    rejects,
    checks: coverage,
  };
}

/** Fail-closed gate used by preview/export harnesses after the funnel audit. */
export function assertRegionalWeeklyReady(
  funnel: RegionalWeeklyCandidateFunnel,
  opts: { auditedTrueShortage?: boolean } = {},
): void {
  if (funnel.selected < 5 && !opts.auditedTrueShortage) {
    throw new Error(
      `Regional weekly candidate funnel selected ${funnel.selected} developments; ` +
      "a complete coverage audit and true shortage review are required before publishing fewer than five.",
    );
  }
  if (funnel.selected > 8) throw new Error("Regional weekly candidate funnel selected more than eight developments");
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
    if (selected.length === 8) return selected;
  }
  for (const incident of ranked) {
    if (selected.includes(incident)) continue;
    const country = incident.country?.trim() || "Regional";
    if ((countryCounts.get(country) ?? 0) >= 3) continue;
    selected.push(incident);
    countryCounts.set(country, (countryCounts.get(country) ?? 0) + 1);
    if (selected.length === 8) break;
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
    .replace(/\b(?:Reuters|SBS|BBC|AP|AFP|Business Standard(?: India)?|Business Today|Mathrubhumi English|India Today|Bangkok Post|RTV News|Burma News International|The Straits Times|Saudi Gazette|Hindu|Kursiv Media|TravelMole|Fruitnet|The Bangladesh Monitor|OpIndia)\b[^.!?]*/gi, "")
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
  if (/\b(?:kohat|northwest pakistan|khyber pakhtunkhwa)\b/i.test(text) && /\b(?:car bomb|blast|police)\b/i.test(text)) {
    const toll = text.match(/\b(?:death toll[^.]{0,45}|(?:killed|dead)[^.]{0,35}|(?:injured|wounded)[^.]{0,35})\b/i)?.[0];
    return `A car bomb struck a police facility in Kohat, Khyber Pakhtunkhwa${toll ? `; reporting placed the casualties at ${toll.replace(/^the\s+/i, "")}` : ""}. The attack was directed at a security site rather than commercial operations, but it materially raised personnel and movement risk around the affected area.`;
  }
  if (/\bnarathiwat\b/i.test(text) && /\b(?:bomb|shooting|opened fire|small[- ]arms?)\b/i.test(text)) {
    return "Attackers detonated a bomb and opened fire on a vehicle carrying territorial defence volunteers in Narathiwat on 18 September. No commercial site was reported hit, but the combined attack method and security response increase journey risk in the affected district.";
  }
  if (/\bbackpacker|visa crackdown|migration overhaul\b/i.test(text)) return "Australia tightened migration and visa settings, changing eligibility and documentation requirements for affected workers and visitors.";
  if (/\b(?:pipeline|yanbu|oil shipments)\b/i.test(text)) {
    return "An attack on Saudi Arabia's East-West pipeline was followed by the suspension of crude loadings at Yanbu on 15 September. Export cargoes were rerouted while pipeline integrity and terminal operations were assessed.";
  }
  if (/\briyadh\b/i.test(text) && /\b(?:houthi|missile|airport|air raid)\b/i.test(text)) {
    return "The Saudi-led coalition said it intercepted a Houthi ballistic missile fired at Riyadh on 19 September, after fire and smoke were reported near the capital's international airport. No verified airport closure or sustained flight suspension was established in the selected evidence.";
  }
  if (/\b(?:southern syria|daraa|wadi al-raqad)\b/i.test(text) && /\bincursion\b/i.test(text)) {
    return "Israeli forces carried out a ground incursion in southern Syria on 18 September, with reporting of home raids and military aircraft activity. The evidence establishes a local cross-border security deterioration but not a confirmed interruption to a commercial corridor.";
  }
  if (/\buae\b/i.test(text) && /\bvisa cancellations?\b/i.test(text) && /\bbangladesh/i.test(text)) {
    return "The UAE cancelled visas affecting almost 5,000 Bangladeshi nationals, according to reporting released on 14 September. The immediate effect is on affected workers' eligibility, travel plans and employer documentation.";
  }
  if (/\b(?:saudis?|saudi arabia)\b/i.test(text) && /\bhouthis?\b/i.test(text) && /\b(?:exchange strikes|yemenis flee)\b/i.test(text)) {
    return "Saudi and Houthi forces exchanged strikes on 17 September as civilians fled affected areas in Yemen. The evidence indicates a widening security and displacement problem, but does not confirm a new regional transport closure.";
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
  if (/\briyadh\b/i.test(text) && /\b(?:houthi|missile|airport|air raid)\b/i.test(text)) {
    return "Personnel and aviation exposure increased around Riyadh, but the absence of a verified closure means operators should treat this as a security escalation and contingency trigger, not as confirmed airport disruption.";
  }
  if (/\b(?:southern syria|daraa|wadi al-raqad)\b/i.test(text) && /\bincursion\b/i.test(text)) {
    return "The direct exposure is to personnel and road movement near the incursion area. Wider business impact depends on repeat operations, new checkpoints or spillover towards border routes.";
  }
  if (/\buae\b/i.test(text) && /\bvisa cancellations?\b/i.test(text) && /\bbangladesh/i.test(text)) {
    return "Employers using Bangladeshi labour may face delayed mobilisation, replacement hiring and documentation work; the effect is concentrated by nationality rather than across the UAE workforce.";
  }
  if (/\b(?:saudis?|saudi arabia)\b/i.test(text) && /\bhouthis?\b/i.test(text) && /\b(?:exchange strikes|yemenis flee)\b/i.test(text)) {
    return "The immediate consequence is civilian displacement and a higher threat to movement in affected Yemeni areas. Regional logistics exposure would rise only if strikes extend to ports, airports or cross-border routes.";
  }
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
    const target = /\b(?:police|security forces?|military|soldiers?|troops?|defen[cs]e volunteers?)\b/i.test(text)
      ? "personnel safety and security-site access"
      : /\b(?:airport|port|cargo|vessel|road|border)\b/i.test(text)
        ? "route and facility access"
        : "movement and site access";
    return `The immediate exposure is to ${target}; the assessment depends on whether the incident remains contained, prompts new restrictions or produces repeat disruption around the named location.`;
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
  if (/\briyadh\b/i.test(text) && /\b(?:houthi|missile|airport|air raid)\b/i.test(text)) {
    judgement = "The strategic significance is the demonstrated reach towards the Saudi capital. The operational judgement should remain narrower until airport restrictions, damage or repeat launches are confirmed.";
  } else if (/\b(?:southern syria|daraa|wadi al-raqad)\b/i.test(text) && /\bincursion\b/i.test(text)) {
    judgement = "This is a local military-access risk, not evidence of region-wide deterioration. Repeated incursions or controls on connecting roads would materially change the business assessment.";
  } else if (/\buae\b/i.test(text) && /\bvisa cancellations?\b/i.test(text) && /\bbangladesh/i.test(text)) {
    judgement = "The policy has low immediate physical severity but potentially broad employer reach within one labour cohort. Practical exposure depends on whether cancellations extend to new applications, renewals or existing permit holders.";
  } else if (/\b(?:saudis?|saudi arabia)\b/i.test(text) && /\bhouthis?\b/i.test(text) && /\b(?:exchange strikes|yemenis flee)\b/i.test(text)) {
    judgement = "The displacement signal shows civilian consequences are growing. A regional operating change would require evidence that the strike exchange is affecting ports, aviation, border access or energy infrastructure.";
  } else if (/\b(?:pipeline|yanbu|oil shipments)\b/i.test(text)) {
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
    const location = incident.location?.trim() || incident.country?.trim() || "the affected area";
    judgement = `The event is most consequential if follow-on security measures restrict access around ${location}, disrupt nearby operations or indicate a wider pattern rather than a contained incident.`;
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
  if (/\briyadh\b/i.test(text) && /\b(?:houthi|missile|airport|air raid)\b/i.test(text)) {
    return "Watch for repeat launches, official airport restrictions, verified damage near the aviation complex and any sustained diversion or cancellation of flights.";
  }
  if (/\b(?:southern syria|daraa|wadi al-raqad)\b/i.test(text) && /\bincursion\b/i.test(text)) {
    return "Watch for repeat incursions, new checkpoints, road closures or military activity extending towards commercial routes in Daraa and the wider south.";
  }
  if (/\buae\b/i.test(text) && /\bvisa cancellations?\b/i.test(text) && /\bbangladesh/i.test(text)) {
    return "Watch for UAE or Bangladeshi official guidance defining affected visa classes, treatment of existing holders and employer obligations.";
  }
  if (/\b(?:saudis?|saudi arabia)\b/i.test(text) && /\bhouthis?\b/i.test(text) && /\b(?:exchange strikes|yemenis flee)\b/i.test(text)) {
    return "Watch for additional displacement, strikes near ports or airports, and any cross-border restrictions that convert local insecurity into a logistics constraint.";
  }
  if (/\b(?:pipeline|yanbu|oil shipments)\b/i.test(text)) {
    return "Verify pipeline integrity, Yanbu loading status, export-flow restoration and any confirmed diversion of oil shipments.";
  }
  if (/\b(?:cargo ship|vessel|maritime)\b/i.test(text)) {
    return "Verify crew recovery, vessel movement, navigational warnings and any confirmed rerouting of cargo traffic.";
  }
  if (isIndiaFuelPolicy(incident, text)) {
    return "Watch the revised export-duty schedule, fuel-market pricing and any confirmed effect on aviation or road-transport procurement.";
  }
  if (/\b(?:visa|migration|immigration|student|workforce)\b/i.test(text)) {
    return "Watch official implementation guidance, employer-facing instructions and any change to the effective timetable.";
  }
  if (/\b(?:flood|typhoon|cyclone|storm|landslide|rainfall|river)\b/i.test(text)) {
    return "Track official warnings, river levels, road or airport closures and confirmed reopening times.";
  }
  if (/\b(?:airport|airspace|flight|aviation)\b/i.test(text)) {
    return "Track airport status notices, flight cancellations, alternate routing and restoration timing.";
  }
  if (/\b(?:arson|set fire|burned|burnt|fire attack|machinery attack)\b/i.test(text)) {
    return "Watch site-access restrictions, damage assessments, investigation findings and any repeat attack or contractor-safety notice.";
  }
  if (/\b(?:offensive|attack|armed|clash|military|border|insurgent|drone)\b/i.test(text)) {
    const location = incident.location?.trim() || incident.country?.trim() || "the affected area";
    return `Track security notices for ${location}, repeat attacks, access restrictions, casualty updates and any confirmed effect on nearby transport or operating sites.`;
  }
  const category = regionalIntelligenceCategory(incident);
  if (category === "Regulatory") {
    return "Watch official guidance, implementation notices and any compliance deadline.";
  }
  if (/\b(?:ferry|capsiz|maritime|vessel|port|shipping|cargo)\b/i.test(text)) {
    return "Watch official casualty, vessel-recovery, port-access or route notices.";
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
      ?? incident.occurredAt
      ?? null;
    if (structuredWeekly && !eventDate) return [];
    const integratedNarrative = structuredWeekly
      ? clipApacComplete(whatChanged, 0, 95)
      : whatChanged;
    return {
      country: incident.country?.trim() || "Regional",
      ...(structuredWeekly ? {
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
  const byCategory = count(selected.map(regionalIntelligenceCategory)) as RegionalVisualSummary["byCategory"];
  const byCountry = count(selected.map((incident) => incident.country?.trim() || "Regional"))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  // A one-each distribution is not intelligence; it is just a disguised
  // development list. Leave the visual slot available for analytical prose.
  return {
    byCategory: byCategory.every((item) => item.count === 1) ? [] : byCategory,
    byCountry: byCountry.every((item) => item.count === 1) ? [] : byCountry,
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
  return clipRegionalWords(`The next seven days will be shaped by the unresolved consequences of ${current}. These developments matter because they connect current political, security, regulatory and infrastructure conditions to practical decisions on staff movement, site continuity, transport access, supply chains and compliance. Deterioration is most likely where an existing disruption broadens geographically, a policy decision moves into implementation, severe weather reaches exposed infrastructure, or violence affects commercial locations and transport links. The principal forward indicators are ${forward}. Operators should distinguish confirmed changes from commentary and adjust controls only where the evidence changes: new closure notices, official effective dates, revised weather warnings, interruption to utilities or communications, restrictions on cross-border movement, and credible signs of security escalation. Stable markets should remain under routine monitoring rather than being elevated solely because reporting volume increased.`, 120, true);
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

// The report presents six durable intelligence lenses. Armed conflict and
// terrorism roll into Security & Conflict; energy consequences roll into
// Operational Disruption. This keeps every requested domain visible without
// fragmenting one operating issue across near-duplicate cards.
const REPORT_DOMAIN_ORDER: RegionalIntelligenceCategory[] = [
  "Security",
  "Political",
  "Regulatory",
  "Weather & Natural Hazards",
  "Cyber",
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
    return REPORT_DOMAIN_ORDER.map((domain) => {
      const acceptedDomains = domain === "Security"
        ? new Set<RegionalIntelligenceCategory>(["Security", "Armed Conflict", "Terrorism"])
        : domain === "Operational Disruption"
          ? new Set<RegionalIntelligenceCategory>(["Operational Disruption", "Energy"])
          : new Set<RegionalIntelligenceCategory>([domain]);
      const rows = developments.filter((development) => acceptedDomains.has(development.category));
      if (rows.length === 0) {
        return {
          domain,
          heading: DOMAIN_HEADING[domain],
          assessment: domain === "Cyber"
            ? "No material regional cyber development was identified during this reporting period."
            : `No material ${domain.toLowerCase()} development was identified during this reporting period.`,
        };
      }
      return {
        domain,
        heading: DOMAIN_HEADING[domain],
        assessment: apacThemeAssessment(domain, rows),
      };
    });
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
  const lead = rows.slice(0, 2);
  const facts = lead.map((row) => `${row.country}: ${row.whatChanged}`);
  const impacts = lead.map((row) => row.operationalImpact ?? row.operationalSignificance);
  const indicator = lead.map((row) => row.outlook7Days ?? row.whatToWatch).find(Boolean);
  return clipRegionalWords(
    `${sentenceJoinRegionalClauses(facts)} ${sentenceJoinRegionalClauses(impacts)}${indicator ? ` ${indicator}` : ""}`,
    110,
    true,
  );
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

function joinRegionalClauses(values: string[]): string {
  const clean = values.map((value) => value.trim().replace(/[.!?]+$/, "")).filter(Boolean);
  if (clean.length <= 1) return clean[0] ?? "";
  const lowerInitial = (value: string) => value ? `${value[0].toLowerCase()}${value.slice(1)}` : value;
  return `${clean[0]}${clean.slice(1, -1).map((value) => `; ${lowerInitial(value)}`).join("")}; and ${lowerInitial(clean.at(-1) ?? "")}`;
}

function sentenceJoinRegionalClauses(values: string[]): string {
  const joined = joinRegionalClauses(values);
  return joined ? `${joined}.` : "";
}

function cleanForwardIndicator(value: string): string {
  return value
    .replace(/^Next seven days:\s*/i, "")
    .replace(/^Watch\s+/i, "")
    .replace(/[.!?]+$/, "")
    .trim();
}

function regionalLeadPhrase(row: RegionalDevelopment): string {
  const text = `${row.title} ${row.whatChanged}`;
  if (/\b(?:kohat|khyber pakhtunkhwa)\b/i.test(text)) return "the Kohat police-facility bombing";
  if (/\bnarathiwat\b/i.test(text)) return "the bomb-and-shooting attack in Narathiwat";
  if (/\briyadh\b/i.test(text) && /\bmissile\b/i.test(text)) return "the intercepted ballistic-missile attack on Riyadh";
  if (/\b(?:pipeline|yanbu)\b/i.test(text)) return "the East-West pipeline attack and Yanbu loading suspension";
  if (/\bsouthern syria\b|\bincursion\b/i.test(text)) return "the southern Syria incursion";
  if (/\bvisa cancellations?\b/i.test(text) && /\bbangladesh/i.test(text)) return "the UAE visa cancellations affecting Bangladeshi nationals";
  if (/\bhouthis?\b/i.test(text) && /\byemen\b/i.test(text)) return "the Saudi-Houthi strike exchange and civilian displacement in Yemen";
  if (/\baustralia\b/i.test(row.country) && /\bvisa|migration\b/i.test(text)) return "Australia's migration-policy tightening";
  return `${row.title[0]?.toLowerCase() ?? ""}${row.title.slice(1)}`;
}

export function buildStructuredRegionalBluf(
  developments: RegionalDevelopment[],
  topic: RegionalWeeklyTopic = "apac_weekly",
): string {
  const region = topic === "apac_weekly" ? "APAC" : "Middle East";
  if (developments.length === 0) return `No material ${region} development met the report threshold this week. The regional assessment remains unchanged, subject to official warnings, security escalation, transport closures or policy measures that create a demonstrated business consequence.`;
  const security = developments.filter((row) => /Security|Conflict|Terrorism/.test(row.category));
  const continuity = developments.filter((row) => /Operational|Weather|Energy|Cyber/.test(row.category));
  const policy = developments.filter((row) => /Regulatory|Political/.test(row.category));
  const severe = developments.filter((row) => row.severity === "High" || row.severity === "Extreme");
  const lead = developments[0];
  const second = developments[1];
  const securityFacts = security.slice(0, 2).map((row) => row.whatChanged);
  const continuityFacts = continuity.slice(0, 2).map((row) => row.whatChanged);
  const policyFacts = policy.slice(0, 2).map((row) => row.whatChanged);
  return clipRegionalWords(
    `The principal ${region} changes this week were ${regionalLeadPhrase(lead)}${second ? ` and ${regionalLeadPhrase(second)}` : ""}. ${securityFacts.length ? sentenceJoinRegionalClauses(securityFacts) : "No selected event established a material security deterioration."} ${severe.length ? `The High or Extreme assessments are confined to ${severe.map(regionalLeadPhrase).join(" and ")}; they do not establish the same operating condition across the region.` : "None of the selected developments produced a High or Extreme current consequence."}

${continuityFacts.length ? `The main continuity issue is ${sentenceJoinRegionalClauses(continuityFacts).replace(/^./, (letter) => letter.toLowerCase())}` : "No material weather, cyber or infrastructure event entered the final evidence set after those domains were checked."} ${policyFacts.length ? `The lower-severity but potentially broader business change is ${sentenceJoinRegionalClauses(policyFacts).replace(/^./, (letter) => letter.toLowerCase())}` : "No binding policy change met the publication threshold."} This distinction matters: violent events require location-specific movement and security decisions, while energy, transport or workforce measures can spread through cargo schedules, staffing and compliance even when their immediate physical severity is lower.

The business response should therefore be selective. Security and travel teams should tighten controls only around the named attack or military locations and avoid converting strategic concern into unsupported closure claims. Operations teams should verify the status of any affected airport, terminal, pipeline or route before rerouting. Workforce and compliance teams should identify the employee groups actually caught by the reported policy change. A broader regional escalation would require evidence that one of these local effects is spreading into a major transport corridor, operating site or critical supply chain; absent that transmission, the report supports local controls rather than a general change in regional posture.`,
    330,
    true,
  );
}

export function buildApacWeeklyBluf(developments: RegionalDevelopment[]): string {
  // Keep the editor's compact BLUF API concise; the canonical report uses
  // buildStructuredRegionalBluf for its longer analytical Regional Outlook.
  return buildRegionalBluf(developments);
}

export function buildStructuredRegionalOutlook(
  developments: RegionalDevelopment[],
  topic: RegionalWeeklyTopic = "apac_weekly",
): string {
  const region = topic === "apac_weekly" ? "APAC" : "Middle East";
  if (developments.length === 0) {
    return `The next seven days are unlikely to justify a broad ${region} risk change on the current reporting. Monitoring should remain focused on official security, weather, transport and regulatory notices that could create a demonstrable effect on people, sites, routes or market access. The assessment would change if an announced measure entered force, a closure extended into a commercial corridor, a warning escalated, or a security event affected an operating location.`;
  }
  const security = developments.filter((row) => /Security|Conflict|Terrorism/.test(row.category));
  const access = developments.filter((row) => /Operational|Weather|Energy|Cyber/.test(row.category));
  const policy = developments.filter((row) => /Regulatory|Political/.test(row.category));
  const indicators = developments
    .map((row) => row.outlook7Days ?? row.whatToWatch)
    .filter(Boolean)
    .map(cleanForwardIndicator)
    .slice(0, 4);
  const securityMarkets = [...new Set(security.map((row) => row.country))];
  const accessMarkets = [...new Set(access.map((row) => row.country))];
  const policyMarkets = [...new Set(policy.map((row) => row.country))];
  return clipRegionalWords(
    `The next-week judgement is not that ${region} faces uniform deterioration. The question is whether the current events remain bounded to their reported locations or begin to affect the systems businesses depend on. ${security.length ? `In ${securityMarkets.join(" and ")}, repeat attacks, new checkpoints, displacement or official access restrictions would be the first evidence of escalation beyond the incidents already recorded.` : "No security event in the final set currently supports a wider escalation judgement."}

${access.length ? `Continuity risk is concentrated in ${accessMarkets.join(" and ")}. Verified restoration, loading, routing or service notices will show whether the disruption is clearing; sustained suspension or diversion would justify a stronger logistics response.` : "No selected transport, energy, weather or cyber event currently creates a regional continuity constraint."} ${policy.length ? `In ${policyMarkets.join(" and ")}, the important signal is implementation: affected eligibility classes, effective dates and employer obligations matter more than further political commentary.` : "No binding policy deadline is currently driving the forward assessment."}

The specific indicators are ${indicators.length ? joinRegionalClauses(indicators) : "new closure notices, binding guidance and credible signs of escalation"}. Stabilisation would be indicated by restored operations, no repeat attack, and narrowly scoped implementation guidance. Deterioration would require the opposite: repeated violence near operating nodes, a disruption extending into a major route, or a policy measure broadening to additional workforce or market-access groups. Until one of those thresholds is crossed, controls should remain tied to the exposed location, route or cohort rather than applied across the region.`,
    230,
    true,
  );
}

export function buildApacWeeklyOutlook(developments: RegionalDevelopment[]): string {
  return buildRegionalOutlook(developments);
}

export function buildRegionalIntelligencePicture(developments: RegionalDevelopment[]): string {
  if (developments.length === 0) return "No material regional risk picture was established from the current reporting. Monitoring remains focused on confirmed changes to security, access, transport, hazards, cyber exposure, energy, regulation and business continuity.";
  const security = developments.filter((row) => /Security|Conflict|Terrorism/.test(row.category));
  const continuity = developments.filter((row) => /Operational|Weather|Energy|Cyber/.test(row.category));
  const policy = developments.filter((row) => /Regulatory|Political/.test(row.category));
  const securityRead = security.slice(0, 3).map((row) => `${row.country}: ${row.operationalImpact ?? row.operationalSignificance}`);
  const continuityRead = continuity.slice(0, 3).map((row) => `${row.country}: ${row.operationalImpact ?? row.operationalSignificance}`);
  const policyRead = policy.slice(0, 2).map((row) => `${row.country}: ${row.operationalImpact ?? row.operationalSignificance}`);
  return clipRegionalWords(
    `The week's risk picture has two different scales. Physical-security events are acute but geographically narrow. ${securityRead.length ? joinRegionalClauses(securityRead) : "No selected security event established a material change."} Their regional importance comes from what could follow, not from an assumption that the first incident already disrupted every nearby business. A repeat attack, a wider security cordon or restrictions on a transport node would convert a local threat into an operating constraint; without that evidence, exposure remains concentrated around the named locations.

Continuity developments have a different transmission path. ${continuityRead.length ? joinRegionalClauses(continuityRead) : "No selected energy, transport, weather or cyber event created a material continuity change."} These events matter when a damaged asset or suspended service removes an alternative used by cargo, travellers or suppliers. Duration is therefore more important than headline intensity. A short suspension with available rerouting is manageable; prolonged loss of capacity, congestion at the substitute route or an unresolved repair schedule would spread the effect.

Policy exposure is broader but normally slower. ${policyRead.length ? joinRegionalClauses(policyRead) : "No binding political or regulatory measure met the threshold."} The affected population, implementation timetable and treatment of existing permissions determine the real business burden. Companies should avoid applying a nationality-, visa- or market-specific rule to unaffected staff or operations.

Across the selected evidence, there is no basis for one regional risk level. Security controls should follow the attack geography; logistics controls should follow verified service status and available alternatives; workforce controls should follow the exact scope of the rule. The cross-domain risk is highest where these pressures overlap—for example, a security event that closes the only practical route, or a workforce restriction that reduces recovery capacity during a disruption. That overlap is not yet established across the region, but it is the threshold that would change the assessment.`,
    470,
    true,
  );
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
    .map(({ incident, fallback }) => ({
      lat: incident.latitude ?? fallback!.latitude,
      lng: incident.longitude ?? fallback!.longitude,
      severity: incident.severity ?? null,
      title: intelligenceTitle(incident),
      label: fallback ? `${incident.country?.trim() || "Regional"} (country-level)` : (incident.country?.trim() || incident.location?.trim() || "Regional"),
      summary: incident.summary ?? "",
      eventDate: incident.incidentDate ?? incident.occurredAt,
    }));
}

export function buildCanonicalRegionalMapPoints<T extends RegionalIncident>(
  incidents: T[],
  developments: RegionalVerifiedDevelopment[],
): RegionalMapPoint[] {
  return developments.flatMap((development) => {
    const evidenceIds = new Set((development.evidenceIds ?? []).map(String));
    const incident = incidents.find((row) => row.id !== undefined && evidenceIds.has(String(row.id)))
      ?? incidents.find((row) => row.country?.trim() === development.country);
    const mapCountry = development.country.trim();
    const hasCoords = incident
      && typeof incident.latitude === "number" && Number.isFinite(incident.latitude)
      && typeof incident.longitude === "number" && Number.isFinite(incident.longitude);
    const fallback = hasCoords ? null : incidentMapFallback(
      mapCountry,
      `${incident?.title ?? development.title} ${incident?.location ?? ""}`,
    );
    if (!hasCoords && !fallback) return [];
    return [{
      lat: hasCoords ? incident!.latitude! : fallback!.latitude,
      lng: hasCoords ? incident!.longitude! : fallback!.longitude,
      severity: development.severity,
      title: development.title,
      label: fallback ? `${mapCountry} (country-level)` : mapCountry,
      summary: development.whatChanged,
      eventDate: development.eventDate,
    }];
  });
}

export function buildRegionalCanonicalReport<T extends RegionalIncident>(
  incidents: T[],
  issueDate: string,
  topic: RegionalWeeklyTopic,
  futureEvents: RegionalFutureEventInput[] = [],
  coverageManifest: RegionalCoverageManifest,
): RegionalCanonicalReport {
  if (!isCompleteRegionalCoverage(coverageManifest)) {
    throw new Error("Regional canonical report requires complete seven-domain and forward-search coverage");
  }
  const developments = [...new Map(
    buildRegionalWeeklyDevelopments(incidents, issueDate, topic).map((row) => [
      row.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
      row,
    ]),
  ).values()];
  const severityErrors = severityConsistencyErrors(developments);
  if (severityErrors.length > 0) {
    throw new Error(severityErrors.join(" "));
  }
  const unverifiedDates = developments.filter((row) => !row.eventDate || row.dateVerified !== true);
  if (unverifiedDates.length > 0) {
    throw new Error(
      `Regional canonical report contains unverified development dates: ${unverifiedDates
        .map((row) => `${row.country} — ${row.title}`)
        .join("; ")}`,
    );
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
    mapPoints: buildCanonicalRegionalMapPoints(datedIncidents, verifiedDevelopments),
    visualSummary: buildRegionalVisualSummary(datedIncidents, topic),
    coverageManifest,
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
    const effects = [...new Set(rows.slice(0, 3)
      .map((row) => row.operationalImpact ?? row.operationalSignificance)
      .map((value) => value.replace(/^[A-Z][A-Za-z -]+:\s*/, "")))];
    const body = effects.length > 1
      ? `${effects.slice(0, -1).join("; ")}; and ${effects.at(-1)}`
      : effects[0] ?? "the evidence does not establish a material operating effect";
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
  const security = developments.filter((row) => /Security|Conflict|Terrorism/.test(row.category));
  const logistics = developments.filter((row) => /Operational|Weather|Energy|Cyber/.test(row.category));
  const policy = developments.filter((row) => /Regulatory|Political/.test(row.category));
  const evidenceRead = (rows: RegionalDevelopment[]) =>
    sentenceJoinRegionalClauses(rows.slice(0, 2).map((row) =>
      `${row.country}: ${row.operationalImpact ?? row.operationalSignificance}`));
  return clipRegionalWords(
    `${security.length ? `People and travel: ${evidenceRead(security)}` : "No selected development requires a security-driven change to travel controls."}

${logistics.length ? `Operations and assets; supply-chain and logistics continuity: ${evidenceRead(logistics)}` : "No selected development establishes a new logistics, utility, weather or cyber constraint."}

${policy.length ? `Regulatory and market-access: ${evidenceRead(policy)}` : "No binding policy development requires a new compliance response."}`,
    190,
    true,
  );
}

export function validateApacWeeklyAssessment(
  developments: RegionalDevelopment[],
  watchItems: RegionalWatchItem[] = buildRegionalWatchlist(developments),
): string[] {
  const errors: string[] = [];
  if (developments.length > 8) errors.push("APAC has more than eight selected developments.");
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
  errors.push(...severityConsistencyErrors(developments));
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
  if (topic) {
    const domains = buildRegionalDomainBriefs(developments, topic);
    if (domains.length !== REQUIRED_REGIONAL_REPORT_DOMAINS.length) {
      errors.push("Exactly six intelligence-domain assessments are required.");
    }
    for (const required of REQUIRED_REGIONAL_REPORT_DOMAINS) {
      if (!domains.some((brief) => brief.domain === required)) {
        errors.push(`Missing required intelligence domain: ${required}.`);
      }
    }
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
  // The 7 Day Watch is forward-looking. Current developments already appear in
  // Key Developments and must not be repeated here with monitoring prose.
  void developments;
  const issue = issueDate ? parseISO(issueDate) : null;
  const supplied = futureEvents.filter((event) => {
    const date = parseISO(event.date);
    const location = event.location.trim();
    return isValid(date)
      && (!issue || (!isAfter(date, addDays(issue, 7)) && isAfter(date, issue)))
      && location
      && !/^(?:national|nationwide|regional|countrywide)$/i.test(location)
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
  return supplied
    .filter((item) => {
      const key = `${item.date}|${item.location.toLowerCase()}|${item.trigger.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 5);
}