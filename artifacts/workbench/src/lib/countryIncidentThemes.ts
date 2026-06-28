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
// no fabrication — only themes that ACTUALLY occurred this period are emitted.
// An empty window yields no theme groups (the renderer shows the explicit
// "no fresh reporting" fallback), never an invented "Not reported" placeholder.

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

// One PRESENT Incident Details theme, rendered as a four-part analytical group.
// Each field is deterministic, count-free and in British English; a theme only
// appears when at least one remaining incident fell into it.
export interface CountryIncidentThemeGroup {
  key: CountryIncidentTheme;
  heading: string;
  // What happened — the kind of activity reported, with the specific categories.
  whatHappened: string;
  // Where — the provinces/areas it concentrated in.
  where: string;
  // Why it matters — operational significance, severity-aware.
  whyItMatters: string;
  // What could be affected — the assets and operations exposed.
  whatCouldBeAffected: string;
}

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

// "What happened" stems — the kind of activity each theme covers.
const THEME_WHAT: Record<CountryIncidentTheme, string> = {
  protest: "Protest activity and the crowd-control response to it were reported",
  crime: "Crime, theft and violent incidents were reported",
  natural: "Natural-hazard and environmental disruption was reported",
  governance: "Policing, regulatory and political-stability activity was reported",
  fire: "Fire and explosion incidents were reported",
  other: "Operational disruption to transport, utilities or connectivity was reported",
};

// "Why it matters" — the operational significance of each theme.
const THEME_SIGNIFICANCE: Record<CountryIncidentTheme, string> = {
  protest:
    "Gatherings and the response to them can close roads and disrupt access at short notice.",
  crime:
    "Incidents of this kind threaten staff, premises and the movement of cash and assets.",
  natural: "Hazards of this kind can interrupt transport, utilities and site access.",
  governance:
    "Regulatory, policing and political-stability friction can affect compliance, permits and freedom of movement.",
  fire: "Fires and explosions cause localised damage and can force evacuation around affected sites.",
  other: "Disruption of this kind can interrupt operations, logistics and connectivity.",
};

// "What could be affected" — the assets and operations exposed.
const THEME_AFFECTED: Record<CountryIncidentTheme, string> = {
  protest: "Road movement, site access and staff commuting near affected areas.",
  crime: "Staff safety, premises, vehicles and the secure movement of cash and assets.",
  natural: "Transport links, utilities, site access and the safety of outdoor operations.",
  governance: "Permits, compliance, checkpoints and freedom of movement.",
  fire: "Affected premises, the sites immediately around them and their access routes.",
  other: "Transport, power, communications and the operations that depend on them.",
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

// Distinct client-facing categories present, ranked by frequency, capped to max.
function topCategories(items: PngReportItem[], max = 3): string[] {
  const counts = new Map<string, number>();
  for (const it of items) {
    const c = (it.displayCategory?.trim() || it.category) ?? "";
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([c]) => c);
}

// Render a raw category label ("Armed robbery / hold-up") as a natural lowercase
// noun phrase for splicing into a sentence.
function readableCategory(label: string): string {
  return label.toLowerCase().replace(/\s*\/\s*/g, " and ");
}

// Highest five-tier severity index present in an item set (-1 when none).
const SEVERITY_ORDER = ["insignificant", "low", "moderate", "high", "extreme"];
function worstSeverityIndex(items: PngReportItem[]): number {
  return items.reduce((m, it) => Math.max(m, SEVERITY_ORDER.indexOf(it.severity)), -1);
}

// Build the Incident Details groups from the REMAINING incidents (those not
// already shown as Top 3 above). PRESENT themes only, in fixed order; each is a
// four-part analytical group (what happened / where / why it matters / what
// could be affected). Deterministic and COUNT-FREE. Empty input → [].
export function buildCountryIncidentThemes(
  remaining: PngReportItem[],
): CountryIncidentThemeGroup[] {
  const byTheme = new Map<CountryIncidentTheme, PngReportItem[]>();
  for (const it of remaining ?? []) {
    const key = themeForCategory(it.category);
    const arr = byTheme.get(key) ?? [];
    arr.push(it);
    byTheme.set(key, arr);
  }
  return COUNTRY_INCIDENT_THEMES.filter(
    (def) => (byTheme.get(def.key)?.length ?? 0) > 0,
  ).map((def) => {
    const items = byTheme.get(def.key)!;
    const provs = topProvinces(items);
    const cats = topCategories(items).map(readableCategory);
    const worst = worstSeverityIndex(items);
    const whatHappened = cats.length
      ? `${THEME_WHAT[def.key]}, including ${joinList(cats)}.`
      : `${THEME_WHAT[def.key]}.`;
    const where = provs.length
      ? `Concentrated in ${joinList(provs)}.`
      : "Specific locations were not consistently reported this period.";
    const sevPrefix =
      worst >= 4
        ? "Extreme-severity reporting featured. "
        : worst === 3
          ? "High-severity reporting featured. "
          : "";
    const whyItMatters = `${sevPrefix}${THEME_SIGNIFICANCE[def.key]}`;
    return {
      key: def.key,
      heading: def.heading,
      whatHappened,
      where,
      whyItMatters,
      whatCouldBeAffected: THEME_AFFECTED[def.key],
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
