import { differenceInCalendarDays, parseISO } from "date-fns";

export type RegionalWeeklyTopic = "apac_weekly" | "middle_east_weekly";

type RegionalIncident = {
  country?: string | null;
  title?: string | null;
  displayTitle?: string | null;
  summary?: string | null;
  topic?: string | null;
  severity?: string | null;
  occurredAt: string;
};

export interface RegionalDevelopment {
  country: string;
  title: string;
  severity: "Insignificant" | "Low" | "Moderate" | "High" | "Extreme";
  whatHappened: string;
  whyItMatters: string;
  outlook: string;
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
  /\b(attack|armed|airspace|airport|border|cargo|closure|conflict|crime|curfew|disrupt|drone|electricity|energy|explosion|fuel|grid|insurgent|kidnap|killed|logistics|maritime|military|missile|outage|port|protest|regulat|riot|road|sanction|security|shipping|shortage|strike|supply chain|telecom|terror|utility|violence)\b/i;

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

export function curateRegionalWeeklyIncidents<T extends RegionalIncident>(
  incidents: T[],
  topic: RegionalWeeklyTopic,
  issueDate: string,
): T[] {
  const countries = new Set(topic === "apac_weekly" ? APAC : MIDDLE_EAST);
  const issue = parseISO(issueDate);
  return incidents
    .filter((incident) => {
      const country = incident.country?.trim() ?? "";
      const age = differenceInCalendarDays(issue, parseISO(incident.occurredAt));
      const text = `${incident.title ?? ""} ${incident.summary ?? ""}`;
      return countries.has(country as never)
        && age >= 0
        && age <= 6
        && (SEVERITY_RANK[incident.severity?.toLowerCase() ?? ""] ?? 0) >= 2
        && MATERIAL_RE.test(text);
    })
    .sort((a, b) => {
      const severity =
        (SEVERITY_RANK[b.severity?.toLowerCase() ?? ""] ?? 0)
        - (SEVERITY_RANK[a.severity?.toLowerCase() ?? ""] ?? 0);
      return severity || Date.parse(b.occurredAt) - Date.parse(a.occurredAt);
    })
    .slice(0, 8);
}

export function selectRegionalKeyDevelopments<T extends RegionalIncident>(
  incidents: T[],
): T[] {
  return incidents.slice(0, 8);
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
      whatHappened: clip(evidence, 480),
      whyItMatters: operationalImplication(evidenceText),
      outlook: "Watch for confirmed follow-on developments, changes in severity, or operational disruption over the next seven days.",
    };
  });
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