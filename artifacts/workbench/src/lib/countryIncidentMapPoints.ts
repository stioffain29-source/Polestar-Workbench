import type { IncidentMapPoint } from "@/components/IncidentMap";
import { spotSevKey } from "@/lib/spotReport";
import type { CountryFastFactsIncident } from "@/lib/countryFastFacts";

// Severity rank used when several incidents share the exact same coordinates:
// the coalesced dot takes the WORST severity present at that point.
const SEV_RANK: Record<string, number> = {
  insignificant: 0,
  low: 1,
  moderate: 2,
  high: 3,
  extreme: 4,
};

/**
 * Build spot-report-style map points from a country report's (already gated)
 * window incidents.
 *
 * - Only rows with real numeric coordinates plot; nothing is invented for
 *   location-less records (mirrors the spot-report rule).
 * - Rows sharing the EXACT same lat/lng (common when several records resolve
 *   to one town/centroid) coalesce into ONE dot carrying the worst severity,
 *   with the stacked titles joined for the hover tooltip. This replaces the
 *   old zone/impact aggregation: the map now simply shows the incidents.
 */
export function buildCountryIncidentMapPoints(
  incidents: CountryFastFactsIncident[],
): IncidentMapPoint[] {
  const byCoord = new Map<string, { point: IncidentMapPoint; titles: string[]; rank: number }>();
  for (const inc of incidents) {
    const lat = inc.latitude;
    const lng = inc.longitude;
    if (typeof lat !== "number" || typeof lng !== "number" || Number.isNaN(lat) || Number.isNaN(lng)) {
      continue;
    }
    const sev = spotSevKey(inc.severity);
    const rank = SEV_RANK[sev] ?? 1;
    const title = (inc.displayTitle ?? inc.title ?? "").trim();
    const key = `${lat},${lng}`;
    const existing = byCoord.get(key);
    if (!existing) {
      byCoord.set(key, {
        point: { lat, lng, severity: sev, title, label: inc.location ?? null },
        titles: title ? [title] : [],
        rank,
      });
      continue;
    }
    if (title && !existing.titles.includes(title)) existing.titles.push(title);
    if (rank > existing.rank) {
      existing.rank = rank;
      existing.point.severity = sev;
    }
  }
  return Array.from(byCoord.values()).map(({ point, titles }) => ({
    ...point,
    title:
      titles.length > 1
        ? `${titles.length} incidents: ${titles.slice(0, 3).join(" • ")}${titles.length > 3 ? " • …" : ""}`
        : point.title,
  }));
}
