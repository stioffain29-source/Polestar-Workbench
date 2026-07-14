import type { OfficialMilitaryMaritimeSource } from "@workspace/api-client-react";

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
