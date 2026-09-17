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
    const unclustered: T[] = [];
    for (const row of scoped) {
      const key = row.eventClusterKey?.trim();
      if (!key) unclustered.push(row);
      else authoritative.set(key, [...(authoritative.get(key) ?? []), row]);
    }
    const representatives = [...authoritative.values()].map((members) => {
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
    if (selected.length === 8) return selected;
  }
  for (const incident of incidents) {
    if (selected.includes(incident)) continue;
    const country = incident.country?.trim() || "Regional";
    if ((countryCounts.get(country) ?? 0) >= 2 && selected.length < 5) continue;
    selected.push(incident);
    countryCounts.set(country, (countryCounts.get(country) ?? 0) + 1);
    if (selected.length === 8) break;
  }
  // If the real evidence is concentrated in one country/category, fill the
  // remaining slots rather than suppressing distinct material events. The
  // diversity pass above remains the preference, not a fabrication quota.
  for (const incident of incidents) {
    if (selected.includes(incident)) continue;
    selected.push(incident);
    if (selected.length === 8) break;
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

export function buildRegionalWatchlist(
  developments: RegionalDevelopment[],
): RegionalWatchItem[] {
  return developments.slice(0, 8).map((development) => ({
    location: development.country,
    issue: development.title,
    currentSeverity: development.severity,
    whatWeAreWatching: development.outlook,
  }));
}