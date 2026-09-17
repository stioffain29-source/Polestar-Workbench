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
  source?: string | null;
  occurredAt: string;
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
  whatToWatch: string;
  watchDate: string | null;
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
          ? "bangkok-protest"
          : /\bmanibela\b/.test(text) && /\b(strike|transport|protest)\b/.test(text)
            ? "philippines-manibela-strike"
            : /\bmyanmar\b/.test(text) && /\bairport\b/.test(text) && /\b(attack|drone|explosion|strike)\b/.test(text)
              ? "myanmar-airport-attack"
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
    return consolidateCountryStories(matchable) as T[];
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
      return countries.has(country as never)
        && age >= 0
        && age <= 6
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
    if (selected.length === 10) return selected;
  }
  for (const incident of ranked) {
    if (selected.includes(incident)) continue;
    const country = incident.country?.trim() || "Regional";
    if ((countryCounts.get(country) ?? 0) >= 3) continue;
    selected.push(incident);
    countryCounts.set(country, (countryCounts.get(country) ?? 0) + 1);
    if (selected.length === 10) break;
  }
  // If the real evidence is concentrated in one country/category, fill the
  // remaining slots rather than suppressing distinct material events. The
  // diversity pass above remains the preference, not a fabrication quota.
  for (const incident of ranked) {
    if (selected.includes(incident)) continue;
    selected.push(incident);
    if (selected.length === 10) break;
  }
  return selected;
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

export function buildRegionalDevelopments<T extends RegionalIncident>(
  incidents: T[],
  issueDate?: string,
): RegionalDevelopment[] {
  return selectRegionalKeyDevelopments(incidents).map((incident) => {
    const sourceTitle = (incident.displayTitle ?? incident.title ?? "Unspecified development").trim();
    const evidence = (incident.summary ?? "").trim() || sourceTitle;
    const evidenceText = `${sourceTitle} ${evidence}`;
    return {
      country: incident.country?.trim() || "Regional",
      title: clip(sourceTitle, 90),
      severity: SEVERITY_LABEL[incident.severity?.toLowerCase() ?? ""] ?? "Moderate",
      category: regionalIntelligenceCategory(incident),
      whatChanged: clip(evidence, 480),
      operationalSignificance: operationalSignificance(incident, evidence),
      watchDate: extractWatchDate(incident, issueDate),
      whatToWatch: specificWatch(incident, evidence, extractWatchDate(incident, issueDate)),
    };
  });
}

export function buildRegionalVisualSummary<T extends RegionalIncident>(
  incidents: T[],
): RegionalVisualSummary {
  const selected = selectRegionalKeyDevelopments(incidents);
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
  return `The next seven days will be shaped by the unresolved consequences of ${current}. These developments matter because they connect current political, security, regulatory and infrastructure conditions to practical decisions on staff movement, site continuity, transport access, supply chains and compliance. Deterioration is most likely where an existing disruption broadens geographically, a policy decision moves into implementation, severe weather reaches exposed infrastructure, or violence affects commercial locations and transport links. The principal forward indicators are ${forward}. Operators should distinguish confirmed changes from commentary and adjust controls only where the evidence changes: new closure notices, official effective dates, revised weather warnings, interruption to utilities or communications, restrictions on cross-border movement, and credible signs of security escalation. Stable markets should remain under routine monitoring rather than being elevated solely because reporting volume increased.`;
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
): RegionalDomainBrief[] {
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
      assessment: `${changes} defined the material change in this domain. ${significance}.${watch ? ` ${watch}` : ""}`,
    };
  });
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
  return `The regional operating environment changed this week through ${joined}. The immediate implications concern ${consequences.join(", ")}.${forward ? ` Over the coming seven days, the clearest forward indicator is ${forward.replace(/^[Tt]he /, "").replace(/[.!?]+$/, "")}.` : ""}`;
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
  return travel.slice(0, 5)
    .map((row) => `${row.country}: ${row.whatChanged}`)
    .join("\n");
}

export function validateRegionalWeeklyAssessment(
  developments: RegionalDevelopment[],
): string[] {
  const errors: string[] = [];
  if (developments.length > 10) errors.push("More than ten developments were selected.");
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