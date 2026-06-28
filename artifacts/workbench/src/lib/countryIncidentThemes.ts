// Themed Incident Details grouping for the shared country-brief renderer.
//
// Pure, dependency-free (TYPE-only imports, so it carries no runtime dependency
// on the ingest barrel) so it is safe to unit-test directly. Used by
// PngCountryReportBody to render the "Incident Details" themed narrative groups
// and the "Operational Impact" bullets for EVERY country report (PNG, West
// Papua, Indonesia, Jakarta and all generic countries) from one source.
//
// House rules honoured here: COUNT-FREE (no record/incident numbers ever appear
// in the generated prose), British English, five-tier severity vocabulary, and
// no fabrication — an empty theme reads "Not reported this period." rather than
// being hidden or guessed.

import type { PngReportItem, PngCategory } from "./pngReportDataset";

// The six fixed Incident Details themes, in display order.
export type CountryIncidentTheme =
  | "protest"
  | "crime"
  | "natural"
  | "governance"
  | "fire"
  | "other";

export interface CountryIncidentThemeDef {
  key: CountryIncidentTheme;
  heading: string;
}

// Fixed display order + client-facing headings.
export const COUNTRY_INCIDENT_THEMES: CountryIncidentThemeDef[] = [
  { key: "protest", heading: "Protest & civil unrest" },
  { key: "crime", heading: "Crime, theft & robbery" },
  { key: "natural", heading: "Natural hazards" },
  { key: "governance", heading: "Governance & regulatory" },
  { key: "fire", heading: "Fire & explosion" },
  { key: "other", heading: "Other operational disruption" },
];

// Exhaustive map from the structured incident category to one of the six
// Incident Details themes. Declared as a Record over PngCategory so adding a new
// category to the rulebook fails the typecheck until it is themed here.
const CATEGORY_THEME: Record<PngCategory, CountryIncidentTheme> = {
  "Terrorism / militancy": "crime",
  "Armed robbery / hold-up": "crime",
  "Tribal / communal violence": "crime",
  "Homicide / violent crime": "crime",
  "Theft / break-in": "crime",
  "Civil unrest / protest": "protest",
  "Labour action": "protest",
  "Policing operation": "governance",
  "Community policing": "governance",
  "Intelligence / training": "governance",
  "Corrections / detention": "governance",
  "Aviation / airport": "other",
  "Maritime / port": "other",
  "Road / highway": "other",
  "Natural hazard": "natural",
  Fire: "fire",
  "Environmental / haze": "natural",
  "Power / utilities": "other",
  "Telecoms / connectivity": "other",
  "Government stability": "governance",
  "Other security": "other",
};

export function themeForCategory(category: PngCategory): CountryIncidentTheme {
  return CATEGORY_THEME[category] ?? "other";
}

export interface CountryIncidentThemeGroup {
  key: CountryIncidentTheme;
  heading: string;
  // True when at least one remaining incident fell into this theme.
  present: boolean;
  // Count-free deterministic narrative, or the "Not reported this period."
  // caveat when the theme is empty.
  narrative: string;
}

const THEME_EMPTY_NARRATIVE = "Not reported this period.";

// Per-theme operational-impact descriptors (Operational Impact section).
const THEME_IMPACT: Record<CountryIncidentTheme, string> = {
  protest:
    "Gatherings and crowd-control responses can close roads and disrupt access at short notice; build in transit buffers and keep routes flexible.",
  crime:
    "Direct threat to staff, premises and the movement of cash or assets; harden security, vary routines and brief travellers.",
  natural:
    "Weather and geological hazards can interrupt transport, utilities and site access; check conditions before movement and confirm site readiness.",
  governance:
    "Regulatory, policing and political-stability friction can affect compliance, permits and freedom of movement; monitor official guidance.",
  fire: "Fires and explosions cause localised damage and forced evacuation around affected sites; confirm site status before approach.",
  other:
    "Transport, utilities and connectivity disruption can interrupt operations and logistics; plan for contingencies and alternate routing.",
};

function joinList(parts: string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0]!;
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

// Distinct provinces present in an item set, ranked by frequency (most-cited
// first), capped to `max`.
function topProvinces(items: PngReportItem[], max = 3): string[] {
  const counts = new Map<string, number>();
  for (const it of items) {
    const p = it.province?.trim();
    if (p) counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([p]) => p);
}

// Highest five-tier severity index present in an item set (-1 when none).
const SEVERITY_ORDER = ["insignificant", "low", "moderate", "high", "extreme"];
function worstSeverityIndex(items: PngReportItem[]): number {
  return items.reduce((m, it) => Math.max(m, SEVERITY_ORDER.indexOf(it.severity)), -1);
}

// Build the six themed Incident Details groups from the REMAINING incidents
// (those not already shown as Top 3 tiles). Every theme is always present in the
// output in fixed order; an empty theme carries the "Not reported this period."
// caveat. Narratives are deterministic and COUNT-FREE, citing only location
// focus and severity emphasis.
export function buildCountryIncidentThemes(
  remaining: PngReportItem[],
): CountryIncidentThemeGroup[] {
  const byTheme = new Map<CountryIncidentTheme, PngReportItem[]>();
  for (const it of remaining) {
    const key = themeForCategory(it.category);
    const arr = byTheme.get(key) ?? [];
    arr.push(it);
    byTheme.set(key, arr);
  }
  return COUNTRY_INCIDENT_THEMES.map((def) => {
    const items = byTheme.get(def.key) ?? [];
    if (items.length === 0) {
      return {
        key: def.key,
        heading: def.heading,
        present: false,
        narrative: THEME_EMPTY_NARRATIVE,
      };
    }
    const provs = topProvinces(items);
    const locClause = provs.length ? `, centred on ${joinList(provs)}` : "";
    const worst = worstSeverityIndex(items);
    const sevClause =
      worst >= 4
        ? ", including extreme-severity reporting"
        : worst >= 3
          ? ", including high-severity reporting"
          : "";
    return {
      key: def.key,
      heading: def.heading,
      present: true,
      narrative: `Reported this period${locClause}${sevClause}.`,
    };
  });
}

// Build the Operational Impact bullets: one impact line per theme PRESENT in the
// full window (in fixed theme order). Count-free. Empty window → [].
export function buildOperationalImpactBullets(windowItems: PngReportItem[]): string[] {
  const present = new Set<CountryIncidentTheme>();
  for (const it of windowItems) present.add(themeForCategory(it.category));
  return COUNTRY_INCIDENT_THEMES.filter((d) => present.has(d.key)).map(
    (d) => `${d.heading} — ${THEME_IMPACT[d.key]}`,
  );
}
