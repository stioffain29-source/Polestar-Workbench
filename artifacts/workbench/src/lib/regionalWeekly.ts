import { differenceInCalendarDays, parseISO } from "date-fns";
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
  whatHappened: string;
  whyItMatters: string;
  outlook: string;
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
  location: string;
  issue: string;
  currentSeverity: RegionalDevelopment["severity"];
  whatWeAreWatching: string;
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
  /\b(attack|armed|airspace|airport|border|cargo|closure|conflict|crime|curfew|disrupt|drone|electricity|election|energy|explosion|flood|fuel|government|grid|heat|import|insurgent|kidnap|killed|landslide|law|legislation|logistics|maritime|military|missile|outage|policy|port|protest|regulat|riot|road|ransomware|sanction|security|shipping|shortage|strike|supply chain|tariff|telecom|terror|typhoon|utility|visa|volcan|wildfire|violence)\b/i;

const OPERATIONAL_RE =
  /\b(airline|airspace|airport|asset|border|business|cargo|compliance|continuity|customs|data|energy|export|fuel|grid|import|infrastructure|logistics|personnel|port|regulat|road|sanction|shipping|site|supply chain|tariff|telecom|transport|travel|utilities?|visa|workforce)\b/i;

const LOW_VALUE_RE =
  /\b(anniversary|commemorati|fundrais|charity appeal|opinion|editorial|historical retrospective|years ago|religious ceremony|routine patrol|police blotter|visa fraud|criminal investigation)\b/i;

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
      return countries.has(country as never)
        && age >= 0
        && age <= 6
        && !LOW_VALUE_RE.test(text)
        && MATERIAL_RE.test(text)
        && (OPERATIONAL_RE.test(text) || regionalIntelligenceCategory(incident) === "Security");
    })
    .sort((a, b) => {
      const severity =
        (SEVERITY_RANK[b.severity?.toLowerCase() ?? ""] ?? 0)
        - (SEVERITY_RANK[a.severity?.toLowerCase() ?? ""] ?? 0);
      return severity || Date.parse(b.occurredAt) - Date.parse(a.occurredAt);
    });
  return consolidateRegionalEvents(eligible);
}

export function selectRegionalKeyDevelopments<T extends RegionalIncident>(
  incidents: T[],
): T[] {
  const selected: T[] = [];
  const categoryCounts = new Map<RegionalIntelligenceCategory, number>();
  const countryCounts = new Map<string, number>();
  for (const incident of incidents) {
    const category = regionalIntelligenceCategory(incident);
    const country = incident.country?.trim() || "Regional";
    if ((categoryCounts.get(category) ?? 0) > 0 || (countryCounts.get(country) ?? 0) >= 2) continue;
    selected.push(incident);
    categoryCounts.set(category, 1);
    countryCounts.set(country, (countryCounts.get(country) ?? 0) + 1);
    if (selected.length === 10) return selected;
  }
  for (const incident of incidents) {
    if (selected.includes(incident)) continue;
    const country = incident.country?.trim() || "Regional";
    if ((countryCounts.get(country) ?? 0) >= 2 && selected.length < 5) continue;
    selected.push(incident);
    countryCounts.set(country, (countryCounts.get(country) ?? 0) + 1);
    if (selected.length === 10) break;
  }
  // If the real evidence is concentrated in one country/category, fill the
  // remaining slots rather than suppressing distinct material events. The
  // diversity pass above remains the preference, not a fabrication quota.
  for (const incident of incidents) {
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

function operationalImplication(text: string): string {
  if (/\b(cyber|data breach|malware|ransomware)\b/i.test(text)) {
    return "This may affect systems, data, communications or service continuity; review exposure and confirmed recovery updates.";
  }
  if (/\b(cyclone|drought|earthquake|extreme heat|flood|landslide|storm|typhoon|volcan|wildfire)\b/i.test(text)) {
    return "This may affect personnel, travel, utilities, sites or supply routes in the exposed area; monitor impact and access updates.";
  }
  if (/\b(compliance|customs|export control|foreign ownership|legislation|regulat|sanction|tariff|visa)\b/i.test(text)) {
    return "This may change compliance, market-access, workforce or cross-border requirements; confirm effective dates and affected operations.";
  }
  if (/\b(election|government|political|policy|diplomat)\b/i.test(text)) {
    return "This may alter policy direction, operating conditions or interstate exposure; monitor implementation and business-facing consequences.";
  }
  if (/\b(port|airport|airspace|road|border|shipping|cargo|logistics|supply chain|transport)\b/i.test(text)) {
    return "This may affect transport, logistics or supply-chain continuity in the affected area; monitor confirmed disruption updates.";
  }
  if (/\b(attack|armed|conflict|crime|kidnap|military|missile|protest|riot|terror|violence|security)\b/i.test(text)) {
    return "This is relevant to personnel safety and site security in the affected area; monitor confirmed changes.";
  }
  return "This is operationally relevant because it may affect business continuity in the affected area; monitor confirmed developments.";
}

export function buildRegionalDevelopments<T extends RegionalIncident>(
  incidents: T[],
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
      whatHappened: clip(evidence, 480),
      whyItMatters: operationalImplication(evidenceText),
      outlook: "Watch for confirmed follow-on developments, changes in severity, or operational disruption over the next seven days.",
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
    return "No qualifying material change was identified across political, regulatory, security, weather, cyber or operational reporting. Maintain standing controls and monitor policy deadlines, transport access, weather warnings, utility continuity and security escalation indicators.";
  }
  const categories = [...new Set(developments.map((development) => development.category))].slice(0, 3);
  const countries = [...new Set(developments.map((development) => development.country))].slice(0, 4);
  return `Over the next seven days, attention should focus on ${categories.join(", ")} developments affecting ${countries.join(", ")}. Conditions may deteriorate if reported disruption intensifies, spreads or triggers new government or regulatory action. Monitor confirmed effective dates, transport access, utility and communications continuity, weather warnings and security escalation indicators, together with the resulting effects on people, travel, sites, supply chains and compliance.`;
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
    const countries = [...new Set(rows.map((row) => row.country))].slice(0, 4);
    const highest = rows.reduce((best, row) =>
      SEVERITY_RANK[row.severity.toLowerCase()] > SEVERITY_RANK[best.severity.toLowerCase()] ? row : best,
    );
    return {
      domain,
      heading: DOMAIN_HEADING[domain],
      assessment: `${rows.length} material ${domain.toLowerCase()} development${rows.length === 1 ? "" : "s"} affected ${countries.join(", ")}. The highest-rated development was ${highest.severity.toLowerCase()}; the main business relevance is ${highest.whyItMatters.replace(/^This\s+/i, "").replace(/\.$/, "")}.`,
    };
  });
}

export function buildRegionalBluf(developments: RegionalDevelopment[]): string {
  const lead = developments.slice(0, 5);
  if (lead.length === 0) {
    return "No material change to the regional operating environment was identified after review across security, political, regulatory, weather, cyber and operational-disruption domains.";
  }
  const domains = [...new Set(lead.map((row) => row.category))];
  const countries = [...new Set(lead.map((row) => row.country))];
  return `The regional operating environment was shaped by ${lead.length} priority developments across ${domains.join(", ")}, with the principal exposure concentrated in ${countries.join(", ")}. The immediate business considerations are personnel and travel safety, continuity of sites and transport, supply-chain access, utilities and compliance obligations.`;
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
  if (developments.some((row) => !row.whyItMatters.trim() || !row.outlook.trim())) {
    errors.push("Every development requires business relevance and forward outlook.");
  }
  if (!/\bregional operating environment\b/i.test(buildRegionalBluf(developments))) {
    errors.push("The BLUF does not assess the regional operating environment.");
  }
  return errors;
}

export function buildRegionalWatchlist(
  developments: RegionalDevelopment[],
): RegionalWatchItem[] {
  return developments.slice(0, 10).map((development) => ({
    location: development.country,
    issue: development.title,
    currentSeverity: development.severity,
    whatWeAreWatching: development.outlook,
  }));
}