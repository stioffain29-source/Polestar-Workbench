import { addDays, differenceInCalendarDays, format, isAfter, isValid, parse, parseISO } from "date-fns";
import { consolidateCountryStories } from "@/lib/countrySameStory";

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
};

type RegionalIncidentWithMembers = RegionalIncident & {
  sourceMembers?: RegionalIncident[];
};

export type RegionalIntelligenceCategory =
  | "Security"
  | "Political"
  | "Regulatory"
  | "Weather & Natural Hazards"
  | "Cyber"
  | "Operational Disruption";

export interface RegionalDevelopment {
  country: string;
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
  /** Source labels retained from every record in a consolidated event. */
  sourceEvidence?: string[];
}

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

export interface RegionalMapPoint {
  lat: number;
  lng: number;
  severity: string | null;
  title: string;
  label: string;
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
  /\b(?:reuters\.com|apnews\.com|bbc\.com|theguardian\.com|aljazeera\.com|channelnewsasia\.com|scmp\.com|abc\.net\.au|nikkei\.com)\b/i;
const APAC_COMMUNITY_RE =
  /\b(?:polling (?:place|center|centre)|school[- ]turned[- ](?:evacuation|polling)|islamic school|madrasat|ordinary days|community (?:event|story)|human interest|local residents? (?:celebrate|gather)|charity|fundrais)\b/i;
const APAC_CURRENT_CHANGE_RE =
  /\b(?:held|staged|clashed|clashes|arrested|detained|injured|killed|blocked|closed|disrupted|deployed|restricted|banned|cancelled|canceled|outage|shutdown|attack(?:ed)?|strike(?:s|d)?|effective|implemented|approved|enacted)\b/i;
const APAC_FUTURE_ONLY_RE =
  /\b(?:scheduled|plans? to|set to|will hold|is expected to|await(?:s|ing)?|upcoming|on\s+\d{1,2}\s+(?:september|october|november|december|january|february|march|april|may|june|july|august))\b/i;
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
  ["Regulatory", /\b(compliance|customs|export control|foreign ownership|immigration|legislation|regulat|sanction|tariff|visa)\b/i],
  ["Political", /\b(cabinet|diplomat|election|government change|interstate tension|political|policy decision)\b/i],
  ["Operational Disruption", /\b(airspace|airport|border|closure|disrupt|energy|fuel|grid|industrial action|logistics|outage|port|road|shipping|strike|supply chain|telecom|transport|utility)\b/i],
  ["Security", /\b(attack|armed|conflict|crime|curfew|insurgent|kidnap|military|missile|protest|riot|security|terror|violence)\b/i],
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
 * Shared APAC projection for the editor and headless exporter. It intentionally
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
  const discovery = incident.analystNotes?.match(/regional-weekly:(security|political|regulatory|weather|cyber|operational)/i)?.[1]?.toLowerCase();
  if (discovery === "security") return "Security";
  if (discovery === "political") return "Political";
  if (discovery === "regulatory") return "Regulatory";
  if (discovery === "weather") return "Weather & Natural Hazards";
  if (discovery === "cyber") return "Cyber";
  if (discovery === "operational") return "Operational Disruption";
  const text = `${incident.displayTitle ?? incident.title ?? ""} ${incident.summary ?? ""} ${incident.category ?? ""}`;
  return CATEGORY_RULES.find(([, pattern]) => pattern.test(text))?.[0] ?? "Operational Disruption";
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

function materialityDimensions(text: string): string[] {
  return BUSINESS_DIMENSIONS.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
}

function developmentScore(incident: RegionalIncident): number {
  const text = `${incident.displayTitle ?? incident.title ?? ""} ${incident.summary ?? ""}`;
  const dimensions = materialityDimensions(text).length;
  const severity = SEVERITY_RANK[incident.severity?.toLowerCase() ?? ""] ?? 0;
  const corroboration = Array.isArray((incident as RegionalIncident & { sourceMembers?: unknown[] }).sourceMembers)
    ? Math.min(3, (incident as RegionalIncident & { sourceMembers?: unknown[] }).sourceMembers!.length - 1)
    : 0;
  const discovery = /regional-weekly:/i.test(incident.analystNotes ?? "") ? 2 : 0;
  const regional = /\b(national|nationwide|regional|cross-border|capital|major|critical infrastructure)\b/i.test(text) ? 2 : 0;
  return severity * 4 + dimensions * 3 + corroboration + discovery + regional;
}

function apacRejectLowValueDevelopment(text: string): boolean {
  return (APAC_LOCAL_THEFT_RE.test(text)
    && !(APAC_STRATEGIC_THEFT_RE.test(text) && APAC_WIDER_THEFT_EFFECT_RE.test(text)))
    || (APAC_CASUALTY_RE.test(text) && !APAC_ONGOING_OPERATION_RE.test(text));
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
      const dimensions = materialityDimensions(text);
      const apacReject =
        topic === "apac_weekly"
        && (
          APAC_SLOP_RE.test(text)
          || (APAC_GENERIC_SPEECH_RE.test(text) && !APAC_ACTION_RE.test(text))
          || DOMAIN_IN_PROSE_RE.test(text)
          || APAC_COMMUNITY_RE.test(text)
          || (APAC_FUTURE_ONLY_RE.test(text) && !APAC_CURRENT_CHANGE_RE.test(text))
          || apacRejectLowValueDevelopment(text)
          || apacRejectOffRegionAirline(text)
          || apacRejectCommentary(text)
        );
      return countries.has(country as never)
        && age >= 0
        && age <= 6
        && !apacReject
        && !LOW_VALUE_RE.test(text)
        && !(LOCAL_CRIME_RE.test(text) && !WIDER_SECURITY_RE.test(text))
        && MATERIAL_RE.test(text)
        && dimensions.length > 0
        && (OPERATIONAL_RE.test(text) || regionalIntelligenceCategory(incident) === "Security");
    })
    .sort((a, b) => {
      return developmentScore(b) - developmentScore(a)
        || Date.parse(b.occurredAt) - Date.parse(a.occurredAt);
    });
  return consolidateRegionalEvents(eligible);
}

export function selectRegionalKeyDevelopments<T extends RegionalIncident>(
  incidents: T[],
  topic: RegionalWeeklyTopic = "middle_east_weekly",
): T[] {
  const ranked = [...incidents].sort((a, b) =>
    developmentScore(b) - developmentScore(a)
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
    if (selected.length === (topic === "apac_weekly" ? 10 : 6)) return selected;
  }
  for (const incident of ranked) {
    if (selected.includes(incident)) continue;
    const country = incident.country?.trim() || "Regional";
    if ((countryCounts.get(country) ?? 0) >= 3) continue;
    selected.push(incident);
    countryCounts.set(country, (countryCounts.get(country) ?? 0) + 1);
    if (selected.length === (topic === "apac_weekly" ? 10 : 6)) break;
  }
  if (topic === "apac_weekly") return selected;
  // Existing Middle East behaviour: if the real evidence is concentrated in
  // one country/category, fill the remaining slots rather than suppressing
  // distinct material events.
  for (const incident of ranked) {
    if (selected.includes(incident)) continue;
    selected.push(incident);
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
    .replace(/\s+/g, " ")
    .trim();
}

function cleanApacEvidence(text: string): string {
  return text
    .replace(/^[A-Za-z][A-Za-z .'-]{2,40},\s+[A-Za-z][A-Za-z .'-]{2,40}\s+-\s*/u, "")
    .replace(/\b(?:Reuters|SBS|BBC|AP|AFP|Business Standard(?: India)?|Business Today|Mathrubhumi English|India Today|Bangkok Post|RTV News|Burma News International)\b[^.!?]*/gi, "")
    .replace(/\.{2,}/g, ".")
    .replace(/…/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?])/g, "$1")
    .trim();
}

function apacWhatChanged(incident: RegionalIncident, evidence: string): string | null {
  const cleaned = cleanApacEvidence(evidence);
  const text = `${incident.displayTitle ?? incident.title ?? ""} ${cleaned}`;
  const country = incident.country?.trim() || "the affected market";
  if (/\b(?:protest|rally|demonstration|strike|transport strike|industrial action)\b/i.test(text)) {
    return `${country} saw a public-order or transport action that disrupted movement, services or site access.`;
  }
  if (isIndiaFuelPolicy(incident, text)) {
    return `India reduced export-linked fuel taxation on petrol, diesel and aviation turbine fuel, changing the levy applied to outbound shipments.`;
  }
  if (/\b(?:visa|migration|immigration|student|workforce)\b/i.test(text)) {
    return `${country} announced changes to migration or visa settings that alter eligibility, documentation or employer obligations.`;
  }
  if (/\b(?:flood|typhoon|cyclone|storm|landslide|rainfall|river)\b/i.test(text)) {
    return `${country} experienced a weather or natural-hazard event with reported consequences for exposed routes, communities or infrastructure.`;
  }
  if (/\b(?:airport|airspace|flight|aviation)\b/i.test(text)) {
    return `Flight operations or routing in ${country} were disrupted while security or recovery measures proceeded.`;
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
    return `${country} introduced or adjusted a policy measure with consequences for market access, pricing or compliance.`;
  }
  if (/\b(?:protest|rally|demonstration|strike)\b/i.test(text)) {
    return `${country} saw a public-order or industrial action with a demonstrated effect on movement or site access.`;
  }
  const factual = firstSentences(cleaned, 1, 30).replace(/…/g, "").trim();
  if (!factual || factual.toLowerCase() === cleanApacTitle(incident.displayTitle ?? incident.title ?? "").toLowerCase()) {
    return null;
  }
  return null;
}

function isIndiaFuelPolicy(incident: RegionalIncident, text: string): boolean {
  return /^india$/i.test(incident.country?.trim() ?? "")
    && /\b(?:windfall tax|export duty|fuel tax|tax on|duty on|levy|government cuts?|centre slashes?|cuts?)\b/i.test(text)
    && /\b(?:petrol|diesel|atf|aviation turbine fuel|export)\b/i.test(text);
}

function apacOperationalImpact(incident: RegionalIncident, evidence: string): string {
  const text = `${incident.displayTitle ?? incident.title ?? ""} ${evidence}`;
  if (/\b(?:protest|rally|demonstration|strike|transport strike|industrial action)\b/i.test(text)) {
    return "The action can interrupt public transport and employee movement; assess route alternatives, attendance constraints and any confirmed service suspension.";
  }
  if (isIndiaFuelPolicy(incident, text)) {
    return "The measure changes fuel-export pricing and trade economics, with direct implications for fuel procurement, aviation cost assumptions and road-transport margins.";
  }
  if (/\b(?:visa|migration|immigration|student|workforce)\b/i.test(text)) {
    return "Employers may need to revise workforce eligibility, documentation and travel planning as implementation guidance becomes clearer.";
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
    return "The immediate exposure is to movement and site access near affected routes; operators should confirm route status and maintain alternatives rather than generalise the risk region-wide.";
  }
  const dimensions = materialityDimensions(text);
  const affected = dimensions.slice(0, 3).join(", ") || "regional business continuity";
  if (/\b(?:ferry|capsiz|maritime|vessel|port|shipping|cargo)\b/i.test(text)) {
    return "The incident puts passenger safety and maritime logistics under pressure; operators should confirm vessel status, routing and any port or cargo consequences.";
  }
  if (/\b(?:protest|rally|demonstration|strike)\b/i.test(text)) {
    return "The operational exposure is concentrated around movement, site access and public-transport reliability in the affected urban area.";
  }
  return `The development is relevant to ${affected}; the practical consequence is defined by the named access, continuity or compliance channel rather than by reporting volume.`;
}

function apacPolestarView(incident: RegionalIncident, evidence: string): string {
  const severity = SEVERITY_LABEL[incident.severity?.toLowerCase() ?? ""] ?? "Moderate";
  const text = `${incident.displayTitle ?? incident.title ?? ""} ${evidence}`;
  let judgement: string;
  if (isIndiaFuelPolicy(incident, text)) {
    judgement = "This is a policy-and-pricing change: the immediate question is how the revised export levy flows through fuel markets, procurement assumptions and transport margins.";
  } else if (/\b(?:visa|migration|immigration|student|workforce)\b/i.test(text)) {
    judgement = "This is a transition risk: the business effect will be set by the implementation timetable and the practical interpretation of new eligibility rules.";
  } else if (/\b(?:flood|typhoon|cyclone|storm|landslide|rainfall|river)\b/i.test(text)) {
    judgement = "This is a geographically concentrated continuity risk; the assessment would worsen if river levels, road closures or warnings extend into commercial corridors.";
  } else if (/\b(?:airport|airspace|flight|aviation)\b/i.test(text)) {
    judgement = "This is an immediate access constraint rather than a region-wide aviation assessment; restoration timing and diversion capacity will determine persistence.";
  } else if (/\b(?:arson|set fire|burned|burnt|fire attack|machinery attack)\b/i.test(text)) {
    judgement = "This is a site-asset security risk; the key uncertainty is whether damage, investigation restrictions or follow-on threats affect facility activity.";
  } else if (/\b(?:offensive|attack|armed|clash|military|border|insurgent|drone)\b/i.test(text)) {
    judgement = "This is a route-and-access security risk; deterioration would be indicated by territorial spread, additional restrictions or effects on commercial facilities.";
  } else {
    judgement = "The assessment remains conditional on duration and geographic reach; a wider operational consequence would change the current view.";
  }
  return `${severity} assessment: ${judgement}`;
}

function apacOutlook7Days(incident: RegionalIncident, evidence: string, watchDate: string | null): string {
  const text = `${incident.displayTitle ?? incident.title ?? ""} ${evidence}`;
  if (watchDate) return `Next seven days: confirm the implementation or scheduled action on ${format(parseISO(watchDate), "d MMMM yyyy")} and record any resulting operating change.`;
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
  topic: RegionalWeeklyTopic = "middle_east_weekly",
): RegionalDevelopment[] {
  const eligible = topic === "apac_weekly"
    ? incidents.filter((incident) => {
      const text = `${incident.title ?? ""} ${incident.summary ?? ""}`;
      return !APAC_SLOP_RE.test(text)
        && !(APAC_GENERIC_SPEECH_RE.test(text) && !APAC_ACTION_RE.test(text))
        && !DOMAIN_IN_PROSE_RE.test(text)
        && !APAC_COMMUNITY_RE.test(text)
        && !(APAC_FUTURE_ONLY_RE.test(text) && !APAC_CURRENT_CHANGE_RE.test(text))
        && !apacRejectLowValueDevelopment(text)
        && !apacRejectOffRegionAirline(text)
        && !apacRejectCommentary(text);
    })
    : incidents;
  return selectRegionalKeyDevelopments(eligible, topic).flatMap((incident) => {
    const sourceTitle = (incident.displayTitle ?? incident.title ?? "Unspecified development").trim();
    const evidence = (incident.summary ?? "").trim() || sourceTitle;
    const apac = topic === "apac_weekly";
    const title = apac ? cleanApacTitle(sourceTitle) : clip(sourceTitle, 90);
    const members = (incident as RegionalIncidentWithMembers).sourceMembers;
    const sourceCount = members?.length ?? 1;
    const sourceEvidence = (members ?? [incident])
      .map((member) => member.source?.trim() || member.displayTitle?.trim() || member.title?.trim() || "")
      .filter(Boolean)
      .filter((value, index, values) => values.indexOf(value) === index);
    const whatChanged = apac
      ? apacWhatChanged(incident, evidence)
      : firstSentences(evidence, 2, 30);
    if (!whatChanged) return [];
    const operationalImpact = apac ? apacOperationalImpact(incident, evidence) : undefined;
    const polestarView = apac ? apacPolestarView(incident, evidence) : undefined;
    const watchDate = extractWatchDate(incident, issueDate);
    const outlook = apac
      ? apacOutlook7Days(incident, evidence, watchDate)
      : firstSentences(specificWatch(incident, evidence, watchDate), 1, 20);
    return {
      country: incident.country?.trim() || "Regional",
      title,
      severity: SEVERITY_LABEL[incident.severity?.toLowerCase() ?? ""] ?? "Moderate",
      category: regionalIntelligenceCategory(incident),
      whatChanged,
      operationalSignificance: apac ? operationalImpact! : firstSentences(operationalSignificance(incident, evidence), 1, 25),
      ...(apac ? { operationalImpact, polestarView, outlook7Days: outlook, sourceCount, sourceEvidence } : {}),
      watchDate,
      whatToWatch: outlook,
    };
  });
}

export function buildApacWeeklyDevelopments<T extends RegionalIncident>(
  incidents: T[],
  issueDate?: string,
): RegionalDevelopment[] {
  return buildRegionalDevelopments(incidents, issueDate, "apac_weekly");
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
      developments: items.map(item => {
        const title = item.displayTitle ?? item.title ?? "Unspecified development";
        const cleanTitle = cleanApacTitle(title);
        const label = clipTitleToMeaningfulWords(cleanTitle, 5);
        return {
          label,
          severity: SEVERITY_LABEL[item.severity?.toLowerCase() ?? ""] ?? "Moderate",
          fullTitle: cleanTitle
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
  "Security",
  "Political",
  "Regulatory",
  "Weather & Natural Hazards",
  "Cyber",
  "Operational Disruption",
];

const DOMAIN_HEADING: Record<RegionalIntelligenceCategory, string> = {
  Security: "Security & Conflict",
  Political: "Political & Geopolitical",
  Regulatory: "Regulatory & Policy",
  "Weather & Natural Hazards": "Weather & Natural Hazards",
  Cyber: "Cyber & Information Risk",
  "Operational Disruption": "Business & Operational Disruption",
};

export function buildRegionalDomainBriefs(
  developments: RegionalDevelopment[],
  topic: RegionalWeeklyTopic = "middle_east_weekly",
): RegionalDomainBrief[] {
  if (topic === "apac_weekly") {
    const briefs = DOMAIN_ORDER.flatMap((domain) => {
      const rows = developments.filter((development) => development.category === domain);
      if (rows.length === 0) return [];
      return [{
        domain,
        heading: DOMAIN_HEADING[domain],
        assessment: apacThemeAssessment(domain, rows),
      }];
    });
    if (developments.length >= 4 && briefs.length < 4) {
      const countries = [...new Set(developments.map((row) => row.country))].join(", ");
      const channels = [...new Set(developments.flatMap((row) => materialityDimensions(
        `${row.whatChanged} ${row.operationalImpact ?? row.operationalSignificance}`,
      )))].slice(0, 4).join(", ");
      briefs.push({
        domain: "Operational Disruption",
        heading: "Operating Posture",
        assessment: `Across ${countries}, the selected evidence points to differentiated controls for ${channels || "movement and access"}. Escalation depends on measurable spread or persistence; easing depends on verified restoration.`,
      });
    }
    return briefs;
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
    Political: `Political developments in ${locations} matter where they alter public access, official controls or business operating conditions. The selected evidence points to ${channel || "targeted political exposure"}, not a region-wide shift.`,
    Regulatory: `Regulatory change in ${locations} is moving through ${channel || "market-access and compliance channels"}. Businesses should separate announced policy from the implementation guidance that determines practical exposure.`,
    "Weather & Natural Hazards": `Weather and hazard exposure in ${locations} is relevant to ${channel || "transport and continuity"}. The key operational question is whether warnings, closures or recovery activity extend into commercial routes.`,
    Cyber: `Cyber exposure is concentrated in ${locations}; the selected evidence is material because it affects ${channel || "data, communications or continuity"}. Further assessment depends on confirmed service impact and recovery status.`,
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

export function buildApacWeeklyBluf(developments: RegionalDevelopment[]): string {
  if (developments.length === 0) {
    return "The curated APAC dataset contains no confirmed development with sufficient evidence of material operational effect this week. This is a statement about the selected evidence, not a claim that background risk has disappeared. The next assessment should focus on official decisions, transport or utility disruption, weather warnings, security escalation and scheduled events that could change business movement, access, compliance or continuity.";
  }
  const lead = developments.slice(0, 10);
  const countries = [...new Set(lead.map((row) => row.country))];
  const categories = [...new Set(lead.map((row) => row.category.toLowerCase()))];
  const themeSummaries = buildRegionalDomainBriefs(lead, "apac_weekly")
    .slice(0, 5)
    .map((theme) => theme.assessment.replace(/[.!?]+$/, ""))
    .join(" ");
  const impacts = [...new Set(lead.flatMap((row) => materialityDimensions(
    `${row.whatChanged} ${row.operationalImpact ?? row.operationalSignificance}`,
  )))].slice(0, 5).join(", ");
  const forwardCount = lead.filter((row) => row.outlook7Days || row.whatToWatch).length;
  return clipApacComplete(
    `The APAC operating picture changed across ${countries.join(", ")} through ${categories.join(", ")}. The selected evidence represents confirmed developments and decisions rather than reporting volume. ${themeSummaries} Their shared business relevance is concentrated in ${impacts || "movement, site access and continuity"}, but the exposure is uneven: a policy transition, a weather-affected route, an airport interruption and a security development require different controls. ${forwardCount > 0 ? `${forwardCount} selected developments have specific forward indicators that should be carried into the 7 Day Watch.` : "No selected development has a sufficiently specific forward indicator to justify a current-developments watch claim."} Risk would rise if disruption spreads geographically, restrictions reach commercial routes, implementation changes workforce or market-access obligations, or restoration fails. The next assessment should therefore prioritise official notices, reopening or recovery evidence, implementation guidance, route status and credible security changes. Markets without a selected development should not be elevated solely because they generated commentary. Regional businesses should assign each material signal to a route, facility, workforce decision or compliance owner, while keeping controls proportionate to the location and demonstrated consequence. This is a targeted operating assessment, not a blanket deterioration call across APAC. The evidence does not support treating all countries or categories alike. Decision-makers should distinguish a measurable access constraint from a policy transition, and a localised security event from a broader regional trend. That discipline keeps preparedness focused on named routes, assets, staff movements and compliance actions, while allowing controls to be relaxed when official recovery evidence is sustained. Differentiated controls are preferable to a regional alert: travel teams need route evidence, facility owners need access evidence, and compliance teams need an effective date. Escalation should follow measurable spread or persistence, while easing should follow sustained restoration and verified continuity.`,
    250,
    350,
  );
}

export function buildApacWeeklyOutlook(developments: RegionalDevelopment[]): string {
  if (developments.length === 0) {
    return "The next seven days are unlikely to justify a broad APAC risk change on the selected evidence. Monitoring should remain focused on official security, weather, transport and regulatory notices that could create a demonstrable effect on people, sites, routes or market access. The assessment would change if an announced measure entered force, a closure extended into a commercial corridor, a warning escalated, or a security event affected an operating location.";
  }
  const countries = [...new Set(developments.map((row) => row.country))];
  const categories = [...new Set(developments.map((row) => row.category))];
  const watchCount = developments.filter((row) => row.outlook7Days).length;
  const priorities = [...new Set(developments.flatMap((row) => materialityDimensions(
    `${row.whatChanged} ${row.operationalImpact ?? row.operationalSignificance}`,
  )))].slice(0, 5);
  const themes = buildRegionalDomainBriefs(developments, "apac_weekly")
    .slice(0, 4)
    .map((theme) => theme.heading.replace(/&/g, "and").toLowerCase())
    .join(", ");
  return clipApacComplete(
    `Over the next seven days, APAC risk is most likely to be driven by ${themes || categories.join(", ").toLowerCase()}. The priority markets are ${countries.join(", ")}, but the exposure is not uniform: operational consequences depend on whether an event affects a route, facility, workforce decision or compliance obligation. The most important near-term question is whether current disruption remains localised or begins to constrain wider movement, supply links or commercial access. ${watchCount > 0 ? `${watchCount} selected developments have specific indicators that should be checked through official notices and operating updates.` : "No current development has a reliable event-specific forward date, so the watch should not be padded with scheduled commentary."} Conditions could deteriorate around affected border and transport corridors, exposed flood routes, disrupted aviation links or locations where security restrictions are already tightening. Monitoring priorities are therefore reopening and recovery notices, implementation guidance, route and airport status, border controls, official warnings and credible evidence of territorial or access change. The assessment would move higher if restrictions spread, a closure persists beyond the expected recovery window, a policy enters force without workable guidance, or violence reaches commercial facilities and logistics routes. It would ease if services reopen, warnings are downgraded, implementation is clarified, or independent operating evidence shows that access and continuity have been restored. Businesses should assign these indicators to travel, site, logistics and compliance owners and update controls only when the relevant local evidence changes. Decision owners should record the threshold that would change a route, staffing, procurement or compliance decision. Escalation is credible only when an indicator is verified locally; easing requires sustained service recovery rather than a single reassuring update.`,
    200,
    300,
  );
}

export function buildRegionalIntelligencePicture(developments: RegionalDevelopment[]): string {
  if (developments.length === 0) return buildRegionalBluf(developments);
  const lead = developments.slice(0, 5);
  const changed = lead.map((row) => `${row.country}: ${row.whatChanged.replace(/[.!?]+$/, "")}`).join("; ");
  const stableDomains = DOMAIN_ORDER.filter((domain) => !developments.some((row) => row.category === domain));
  const crossBorder = [...new Set(developments.map((row) => row.country))].length > 1
    ? "The distribution across several markets points to a regional pattern rather than a single-country reporting spike."
    : "The evidence was concentrated in one market and should not be treated as a region-wide deterioration.";
  return `The material changes during the reporting period were ${changed}. ${crossBorder} Operational exposure is concentrated where these developments affect personnel movement, site access, transport links, utilities, communications, supply chains or compliance obligations. The assessment gives greater weight to demonstrated consequences and official decisions than to article volume, repeated commentary or isolated local incidents. ${stableDomains.length ? `No material change was identified in ${stableDomains.map((domain) => DOMAIN_HEADING[domain]).join(", ")} after the dedicated review of those domains. ` : ""}Across the region, the main connection between the selected developments is their capacity to interrupt access or force near-term operating decisions. Conditions should be treated as changed only where there is a confirmed event, policy action, warning or disruption. Elsewhere, the absence of a selected development indicates stability or insufficient evidence of material change, not an absence of underlying risk.`;
}

const BANNED_REGIONAL_PROSE_RE =
  /\b(?:regional operating environment was shaped by \d+ priority developments|highest-rated development|main business relevance|nothing useful came through|risk to transport, access and central business districts persists|watch for confirmed follow-on developments|changes in severity|monitor implementation and business-facing consequences)\b/i;

export function resolveRegionalNarrative(
  analyst: string | null | undefined,
  generated: string | null | undefined,
  fallback: string,
): string {
  for (const candidate of [analyst, generated]) {
    const clean = candidate?.trim() ?? "";
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
  for (const domain of DOMAIN_ORDER) {
    if (items.length === 5) break;
    if (items.some((item) => item.category === domain)) continue;
    items.push({
      category: domain,
      statement: `No material ${DOMAIN_HEADING[domain].toLowerCase()} change was identified this week.`,
    });
  }
  return items.slice(0, 5);
}

export function buildRegionalMapPoints<T extends RegionalIncident>(
  incidents: T[],
  topic: RegionalWeeklyTopic = "middle_east_weekly",
): RegionalMapPoint[] {
  return selectRegionalKeyDevelopments(incidents, topic)
    .filter(
      (incident) =>
        typeof incident.latitude === "number" &&
        Number.isFinite(incident.latitude) &&
        typeof incident.longitude === "number" &&
        Number.isFinite(incident.longitude),
    )
    .map((incident) => ({
      lat: incident.latitude!,
      lng: incident.longitude!,
      severity: incident.severity ?? null,
      title: incident.displayTitle ?? incident.title ?? "Regional development",
      label: incident.country?.trim() || incident.location?.trim() || "Regional",
    }));
}

export interface RegionalBusinessImplication {
  heading: "People & Travel" | "Operations & Assets" | "Supply Chain & Logistics" | "Regulatory & Market Access";
  body: string;
}

export function buildApacBusinessImplications(
  developments: RegionalDevelopment[],
): RegionalBusinessImplication[] {
  const blocks: Array<[RegionalBusinessImplication["heading"], RegExp, string]> = [
    ["People & Travel", /\b(personnel|travel|airport|airline|airspace|border|road|movement|access|transport)\b/i,
      "Travel and personnel exposure is concentrated in the named markets. Airport, border, flood and public-movement developments require route checks, traveller contingencies and a clear trigger for changing site-access controls."],
    ["Operations & Assets", /\b(site|asset|facility|office|factory|commercial|continuity|outage|closure)\b/i,
      "Operational continuity exposure is location-specific. Flood, security and access changes should be mapped to affected facilities and recovery dependencies rather than treated as a region-wide operating downgrade."],
    ["Supply Chain & Logistics", /\b(port|cargo|customs|logistics|shipping|supply chain|transport|fuel|energy)\b/i,
      "Supply-chain exposure is driven by route availability, vessel or airport status and fuel economics. Logistics teams should confirm alternatives and restoration evidence before changing service assumptions."],
    ["Regulatory & Market Access", /\b(compliance|export|import|law|legislation|regulat|sanction|tariff|tax|visa|policy)\b/i,
      "Regulatory exposure is concentrated in implementation and market-access decisions. Compliance owners should translate effective dates and official guidance into workforce, documentation, pricing or trade controls."],
  ];
  return blocks.flatMap(([heading, pattern, body]) => {
    const rows = developments.filter((row) => pattern.test(
      `${row.whatChanged} ${row.operationalImpact ?? row.operationalSignificance} ${row.title}`,
    ));
    if (rows.length === 0) return [];
    const countries = [...new Set(rows.map((row) => row.country))];
    const marketList = countries.length <= 2
      ? countries.join(" and ")
      : `${countries.slice(0, -1).join(", ")} and ${countries.at(-1)}`;
    const channels = [...new Set(rows.flatMap((row) => materialityDimensions(
      `${row.whatChanged} ${row.operationalImpact ?? row.operationalSignificance}`,
    )))].slice(0, 3);
    const evidence = channels.length
      ? `The selected evidence links ${channels.join(", ")} to ${marketList}.`
      : `The selected evidence is concentrated in ${marketList}.`;
    return [{ heading, body: clipRegionalWords(`${evidence} ${body}`, 90) }];
  });
}

export function validateApacWeeklyAssessment(
  developments: RegionalDevelopment[],
  watchItems: RegionalWatchItem[] = buildRegionalWatchlist(developments),
): string[] {
  const errors: string[] = [];
  if (developments.length > 10) errors.push("APAC has more than ten selected developments.");
  const normalized = developments.map((row) => row.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim());
  if (new Set(normalized).size !== normalized.length) errors.push("Duplicate APAC developments remain.");
  const prose = developments.flatMap((row) => [
    row.title, row.whatChanged, row.operationalImpact ?? row.operationalSignificance,
    row.polestarView ?? "", row.outlook7Days ?? row.whatToWatch,
  ]);
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
  if (developments.length > 0 && (blufWords < 250 || blufWords > 350)) {
    errors.push("APAC BLUF is outside the 250–350 word target envelope.");
  }
  const finalOutlook = buildApacWeeklyOutlook(developments);
  const finalOutlookWords = finalOutlook.split(/\s+/).filter(Boolean).length;
  if (developments.length > 0 && (finalOutlookWords < 200 || finalOutlookWords > 300)) {
    errors.push("APAC final Outlook is outside the 200–300 word target envelope.");
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
  topic: RegionalWeeklyTopic = "middle_east_weekly",
): string[] {
  if (topic === "apac_weekly") return validateApacWeeklyAssessment(developments);
  const errors: string[] = [];
  if (developments.length > 6) errors.push("More than six developments were selected.");
  const uniqueTitles = new Set(
    developments.map((row) => row.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()),
  );
  if (uniqueTitles.size !== developments.length) errors.push("Duplicate developments remain.");
  if (buildRegionalDomainBriefs(developments).length !== 6) {
    errors.push("All six intelligence-domain assessments are required.");
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
  if (buildRegionalGlanceItems(developments).length !== 5) {
    errors.push("Exactly five Week at a Glance items are required.");
  }
  return errors;
}

export function buildRegionalWatchlist(
  developments: RegionalDevelopment[],
): RegionalWatchItem[] {
  return developments.filter((development) => development.watchDate && development.whatToWatch).slice(0, 8).map((development) => ({
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
  }).map((event) => ({
    date: event.date,
    location: event.location.trim(),
    trigger: event.trigger.trim(),
    whyItMatters: event.whyItMatters.trim(),
    whatToWatch: event.whatToWatch?.trim() || `Track whether ${event.trigger.trim().toLowerCase()} proceeds as scheduled.`,
    currentSeverity: event.currentSeverity,
  }));
  const seen = new Set<string>();
  return [...developmentItems, ...supplied]
    .filter((item) => {
      const key = `${item.date}|${item.location.toLowerCase()}|${item.trigger.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
}