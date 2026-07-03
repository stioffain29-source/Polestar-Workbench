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
import { summariseFireCauses } from "./countryFireCause";

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

// One PRESENT, MEANINGFUL Incident Details theme. The renderer shows the single
// `paragraph` (one short, count-free analytical paragraph — no four-part
// sub-template). The structured four parts are retained for any caller that
// still needs them. Deterministic, count-free, British English; a theme only
// appears when a remaining incident fell into it AND it clears the
// meaningfulness gate (recurs, or reaches Moderate severity).
export interface CountryIncidentThemeGroup {
  key: CountryIncidentTheme;
  heading: string;
  // One short count-free paragraph — what the renderer displays.
  paragraph: string;
  // What happened — the kind of activity reported, with the specific categories.
  whatHappened: string;
  // Where — the provinces/areas it concentrated in.
  where: string;
  // Why it matters — operational significance, severity-aware.
  whyItMatters: string;
  // What could be affected — the assets and operations exposed.
  whatCouldBeAffected: string;
}

// FIRE & EXPLOSION is written in SOURCE-SAFE operational language. Cardinal rule
// (analyst instruction): never classify a fire's cause as deliberate, accidental,
// operational, arson, attack or security-relevant unless a SOURCE explicitly says
// so. The report states only what is known (incidents + where), what is not
// confirmed (cause), and the operational relevance — never internal/methodology
// wording. The security-relevant framing is used ONLY when a source confirmed a
// deliberate fire or arson.
const FIRE_OPERATIONAL_CONCERN =
  "For business users, the operational concern is local disruption: road closures, " +
  "evacuation, utility interruption, access restrictions and possible impact on nearby " +
  "offices, warehouses, hotels, client sites or transport routes.";

function buildFireParagraph(items: PngReportItem[], provinces: string[]): string {
  const where = provinces.length ? ` in ${joinList(provinces)}` : "";
  const opening = `Fire and explosion incidents were reported${where}.`;
  // STRICT gate: use the deliberate count, which is set ONLY when a source
  // explicitly stated arson or an attack. It deliberately excludes merely
  // protest-adjacent fires (contextual association is not an explicit cause), so
  // the security-relevant wording is never inferred.
  const sourceConfirmedDeliberate = summariseFireCauses(items).deliberate > 0;
  const cause = sourceConfirmedDeliberate
    ? "Where source reporting identified deliberate fire or arson, it has been treated as " +
      "security relevant. Other fire reports are treated as local disruption or business " +
      "continuity issues unless a cause is confirmed."
    : "Available reporting did not consistently identify cause.";
  return `${opening} ${cause} ${FIRE_OPERATIONAL_CONCERN}`;
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

// Render a category label ("Armed robbery / hold-up", or an operating-risk
// display label like "Crime / theft / robbery") as a CLEAN single noun phrase
// for splicing into a list. The old readableCategory expanded every "A / B"
// slash to "A and B", so a list of two or three such labels read as an
// "and … and … and …" run ("homicide and violent crime, theft and break-in and
// terrorism and militancy"). Taking the first slash segment yields a clean noun
// with no internal "and"; a small override map fixes the few first-segments that
// read poorly on their own.
const CATEGORY_NOUN_OVERRIDE: Record<string, string> = {
  "tribal / communal violence": "communal violence",
  "homicide / violent crime": "violent crime",
  "intelligence / training": "security activity",
  "environmental / haze": "environmental hazards",
};
function categoryNoun(label: string): string {
  const k = label.trim().toLowerCase();
  if (CATEGORY_NOUN_OVERRIDE[k]) return CATEGORY_NOUN_OVERRIDE[k]!;
  return (k.split("/")[0] ?? k).trim();
}

// The highest-severity, then most-recent incident in a theme's item set,
// rendered as ONE concrete, count-free sentence naming the real headline, where
// it happened and its assessed severity. This is what turns a theme paragraph
// from a generic template ("Crime … was reported") into a specific account
// ("The most serious reported was …"). No fabrication: title, province and
// severity label are the incident's own fields. Mirrors watchLine in
// pngReportDataset (kept local to preserve this module's type-only import).
function leadIncidentSentence(items: PngReportItem[]): string {
  const ranked = [...items].sort((a, b) => {
    if (b.severityRank !== a.severityRank) return b.severityRank - a.severityRank;
    const ad = a.reportedDate instanceof Date ? a.reportedDate.getTime() : 0;
    const bd = b.reportedDate instanceof Date ? b.reportedDate.getTime() : 0;
    return bd - ad;
  });
  const lead = ranked[0];
  if (!lead) return "";
  const raw = (lead.developmentTitle?.trim() || lead.title || "")
    .replace(/\s+/g, " ")
    .replace(/[.;,]+$/, "")
    .trim();
  if (!raw) return "";
  const prov = lead.province?.trim();
  const loc = prov && !raw.toLowerCase().includes(prov.toLowerCase()) ? ` (${prov})` : "";
  const label = lead.severityLabel?.trim();
  const sevClause = label ? `, assessed as ${label} severity` : "";
  const end = /[?!.]$/.test(raw) ? "" : ".";
  return `The most serious reported was ${raw}${loc}${sevClause}${end}`;
}

// Highest five-tier severity index present in an item set (-1 when none).
const SEVERITY_ORDER = ["insignificant", "low", "moderate", "high", "extreme"];
function worstSeverityIndex(items: PngReportItem[]): number {
  return items.reduce((m, it) => Math.max(m, SEVERITY_ORDER.indexOf(it.severity)), -1);
}

// Build the Incident Details groups from the REMAINING incidents (those not
// already shown as Top 3 above). PRESENT, MEANINGFUL themes only, in fixed
// order; each renders as ONE short, count-free analytical paragraph. The
// structured four parts are kept on the group for any caller that needs them.
// Deterministic and COUNT-FREE. Empty input → [].
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
  return COUNTRY_INCIDENT_THEMES.filter((def) => {
    const items = byTheme.get(def.key);
    if (!items || items.length === 0) return false;
    // "Meaningful category" gate (sharper, shorter briefs): a category carried
    // by a single Low/Insignificant item with no analytical weight is dropped
    // from the narrative — it still counts in the totals, charts and map, it
    // simply does not earn its own Incident Details paragraph. Kept once it
    // recurs (two or more items) OR reaches Moderate severity or above.
    return items.length >= 2 || worstSeverityIndex(items) >= 2;
  }).map((def) => {
    const items = byTheme.get(def.key)!;
    const provs = topProvinces(items);
    const cats = topCategories(items).map(categoryNoun);
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
    // The renderer shows ONE short, count-free paragraph per theme. Fire &
    // explosion is special-cased into strict source-safe operational language
    // (never inferring a cause); every other theme composes from the same stems:
    // what happened (+ the main categories), where it concentrated, then the
    // operational significance.
    const catClause = cats.length ? `, including ${joinList(cats)}` : "";
    const whereClause = provs.length ? ` It concentrated in ${joinList(provs)}.` : "";
    // Name the single most serious real incident so the paragraph is a specific
    // account, not a generic template. The lead sentence carries the top
    // severity ("assessed as High severity"), so the old sevPrefix is dropped
    // from the paragraph to avoid restating it (sevPrefix is retained on
    // whyItMatters for callers that consume the structured parts).
    const leadClause = def.key === "fire" ? "" : leadIncidentSentence(items);
    const leadPart = leadClause ? ` ${leadClause}` : "";
    const paragraph =
      def.key === "fire"
        ? buildFireParagraph(items, provs)
        : `${THEME_WHAT[def.key]}${catClause}.${whereClause}${leadPart} ${THEME_SIGNIFICANCE[def.key]}`
            .replace(/\s+/g, " ")
            .trim();
    return {
      key: def.key,
      heading: def.heading,
      paragraph,
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
