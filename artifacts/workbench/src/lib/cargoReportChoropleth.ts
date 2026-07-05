// Builds the Cargo Watch REPORT choropleth intensity map from a windowed
// incident set, using the SAME per-incident country resolution + USD parser the
// interactive monitor uses (cargoCountry / parseUsdLoss). Keeping this in one
// place means the report preview, the report PDF and the monitor all shade the
// same countries by the same counts.

import { cargoCountry, parseUsdLoss, type CargoIncidentLike } from "./cargoAnalysis";
import type { CargoCountryIntensity } from "./cargoChoropleth";

export interface CargoChoroplethIncident extends CargoIncidentLike {
  occurredAt?: string;
}

/**
 * Aggregate incidents into a per-country { count, usd } intensity map, keyed by
 * the app's canonical display-country name (which matches the choropleth
 * polygon names). Records with no identifiable in-scope country are excluded,
 * mirroring the monitor's shading rule.
 */
export function buildCargoCountryIntensity(
  incidents: CargoChoroplethIncident[],
): Map<string, CargoCountryIntensity> {
  const m = new Map<string, CargoCountryIntensity>();
  for (const i of incidents) {
    const c = cargoCountry(i);
    if (!c) continue;
    const e = m.get(c) ?? { count: 0, usd: 0 };
    e.count += 1;
    e.usd += parseUsdLoss(i) ?? 0;
    m.set(c, e);
  }
  return m;
}
