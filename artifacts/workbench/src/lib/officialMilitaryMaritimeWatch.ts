import type { OfficialMilitaryMaritimeSource } from "@workspace/api-client-react";
import type { ListOfficialMilitaryMaritimeSourcesFlag } from "@workspace/api-client-react";

export const OFFICIAL_SOURCE_BADGE: Record<string, { label: string; className: string }> = {
  centcom: {
    label: "CENTCOM",
    className: "bg-[#0b0a3d] text-white border border-[#0b0a3d]",
  },
  ukmto: {
    label: "UKMTO",
    className: "bg-[#465bff] text-white border border-[#465bff]",
  },
  jmic: {
    label: "JMIC",
    className: "bg-muted text-primary border border-border",
  },
  cmf: {
    label: "CMF",
    className: "bg-muted text-primary border border-border",
  },
};

export const ANALYST_FLAG_DEFS = [
  {
    key: "flagSignificantIncident" as const,
    label: "Significant",
    className: "bg-red-100 text-red-800 border border-red-200",
  },
  {
    key: "flagEscalationIndicator" as const,
    label: "Escalation",
    className: "bg-orange-100 text-orange-800 border border-orange-200",
  },
  {
    key: "flagMaritimeDisruption" as const,
    label: "Maritime disruption",
    className: "bg-amber-100 text-amber-900 border border-amber-200",
  },
  {
    key: "flagEvidenceAvailable" as const,
    label: "Evidence",
    className: "bg-emerald-100 text-emerald-800 border border-emerald-200",
  },
  {
    key: "flagPossibleSpotReport" as const,
    label: "Possible Spot Report",
    className: "bg-violet-100 text-violet-900 border border-violet-200",
  },
] as const;

export type AnalystFlagKey = (typeof ANALYST_FLAG_DEFS)[number]["key"];

export function officialSourceBadge(sourceName: string): { label: string; className: string } {
  return (
    OFFICIAL_SOURCE_BADGE[sourceName] ?? {
      label: sourceName.toUpperCase(),
      className: "bg-muted text-primary border border-border",
    }
  );
}

export function activeAnalystFlags(
  item: Pick<OfficialMilitaryMaritimeSource, AnalystFlagKey>,
): Array<(typeof ANALYST_FLAG_DEFS)[number]> {
  return ANALYST_FLAG_DEFS.filter((def) => item[def.key]);
}

export function formatOfficialPublishedAt(
  publishedAt: Date | string | null | undefined,
): string {
  if (!publishedAt) return "—";
  const d = publishedAt instanceof Date ? publishedAt : new Date(publishedAt);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 10);
}

export type OfficialQueueFlagTab =
  | "all"
  | ListOfficialMilitaryMaritimeSourcesFlag;

export const OFFICIAL_QUEUE_FLAG_TABS: Array<{
  key: OfficialQueueFlagTab;
  label: string;
  apiFlag?: ListOfficialMilitaryMaritimeSourcesFlag;
}> = [
  { key: "all", label: "All flagged" },
  {
    key: "significant_incident",
    label: "Significant",
    apiFlag: "significant_incident",
  },
  {
    key: "escalation_indicator",
    label: "Escalation",
    apiFlag: "escalation_indicator",
  },
  {
    key: "maritime_disruption",
    label: "Maritime disruption",
    apiFlag: "maritime_disruption",
  },
  {
    key: "evidence_available",
    label: "Evidence",
    apiFlag: "evidence_available",
  },
  {
    key: "possible_spot_report",
    label: "Possible Spot Report",
    apiFlag: "possible_spot_report",
  },
];

const FLAG_FIELD_BY_API: Record<
  ListOfficialMilitaryMaritimeSourcesFlag,
  AnalystFlagKey
> = {
  significant_incident: "flagSignificantIncident",
  escalation_indicator: "flagEscalationIndicator",
  maritime_disruption: "flagMaritimeDisruption",
  evidence_available: "flagEvidenceAvailable",
  possible_spot_report: "flagPossibleSpotReport",
};

export function itemHasAnyAnalystFlag(
  item: Pick<OfficialMilitaryMaritimeSource, AnalystFlagKey>,
): boolean {
  return ANALYST_FLAG_DEFS.some((def) => item[def.key]);
}

export function itemMatchesQueueFlagTab(
  item: Pick<OfficialMilitaryMaritimeSource, AnalystFlagKey>,
  tab: OfficialQueueFlagTab,
): boolean {
  if (tab === "all") return itemHasAnyAnalystFlag(item);
  const field = FLAG_FIELD_BY_API[tab];
  return item[field];
}

export type OfficialQueueKpis = {
  totalFlagged: number;
  significant: number;
  escalation: number;
  maritimeDisruption: number;
  evidence: number;
  possibleSpotReport: number;
  bySource: Record<string, number>;
};

export function computeOfficialQueueKpis(
  items: OfficialMilitaryMaritimeSource[],
): OfficialQueueKpis {
  const flagged = items.filter(itemHasAnyAnalystFlag);
  const bySource: Record<string, number> = {};
  let significant = 0;
  let escalation = 0;
  let maritimeDisruption = 0;
  let evidence = 0;
  let possibleSpotReport = 0;

  for (const item of flagged) {
    bySource[item.sourceName] = (bySource[item.sourceName] ?? 0) + 1;
    if (item.flagSignificantIncident) significant += 1;
    if (item.flagEscalationIndicator) escalation += 1;
    if (item.flagMaritimeDisruption) maritimeDisruption += 1;
    if (item.flagEvidenceAvailable) evidence += 1;
    if (item.flagPossibleSpotReport) possibleSpotReport += 1;
  }

  return {
    totalFlagged: flagged.length,
    significant,
    escalation,
    maritimeDisruption,
    evidence,
    possibleSpotReport,
    bySource,
  };
}

export function extractRegionFromOfficialBody(bodyText?: string | null): string {
  const match = bodyText?.match(/^Region:\s*(.+)$/m);
  return match?.[1]?.trim() ?? "";
}

export function officialBodyExcerpt(bodyText?: string | null, max = 600): string {
  if (!bodyText?.trim()) return "";
  const withoutPdf = bodyText.split(/\n---\n\[PDF/)[0] ?? bodyText;
  const lines = withoutPdf
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const content = lines
    .filter((line) => !/^(Provider|Region|Threat level):/i.test(line))
    .join("\n")
    .trim();
  return content.slice(0, max);
}

export function regionToCountryHint(region: string): string {
  const trimmed = region.trim();
  if (!trimmed) return "";
  const first = trimmed.split(",")[0]?.trim() ?? trimmed;
  if (/hormuz|arabian gulf|gulf of oman|red sea|middle east/i.test(first)) {
    return "Middle East";
  }
  return first;
}

export async function fetchOfficialMilitaryMaritimeSource(
  id: number,
): Promise<OfficialMilitaryMaritimeSource | null> {
  const res = await fetch(`/api/official-military-maritime-sources/${id}`);
  if (!res.ok) return null;
  return res.json() as Promise<OfficialMilitaryMaritimeSource>;
}
