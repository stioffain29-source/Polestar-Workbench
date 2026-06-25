// Operating-risk prose variant for the Indonesia Operating Risk Watch and
// Jakarta Security Watch reports. These two theatres set
// `proseVariant: "operating-risk"` on their StructuredTheatreConfig; everything
// here is scoped behind that flag, so the PNG / West Papua briefs are untouched.
//
// All functions are pure and deterministic. They read the period's incidents
// only — no fabrication, no incident counts (counts belong on stat tiles, never
// in narrative prose), British English throughout.

// ---------------------------------------------------------------------------
// Display categories
// ---------------------------------------------------------------------------
// Map a granular extracted category (the shared IncidentCategory enum) onto the
// eleven client-facing business labels from the spec. Unmapped categories
// (e.g. "Terrorism / militancy", "Other security") pass through unchanged so the
// label is never fabricated.
const DISPLAY_CATEGORY_MAP: Record<string, string> = {
  "civil unrest / protest": "Protest / civil unrest",
  "labour action": "Labour action",
  "theft / break-in": "Crime / theft / robbery",
  "armed robbery / hold-up": "Armed robbery / violent crime",
  "homicide / violent crime": "Armed robbery / violent crime",
  fire: "Fire / explosion",
  "natural hazard": "Natural hazard",
  "environmental / haze": "Natural hazard",
  "aviation / airport": "Transport disruption",
  "maritime / port": "Transport disruption",
  "road / highway": "Transport disruption",
  "power / utilities": "Utilities / infrastructure disruption",
  "telecoms / connectivity": "Utilities / infrastructure disruption",
  "government stability": "Regulatory / corruption / governance",
  "policing operation": "Security force activity",
  "community policing": "Security force activity",
  "intelligence / training": "Security force activity",
  "corrections / detention": "Security force activity",
  "tribal / communal violence": "Community tension / land dispute",
};

export function operatingRiskDisplayCategory(rawCategory: string): string {
  const k = rawCategory.trim().toLowerCase();
  return DISPLAY_CATEGORY_MAP[k] ?? rawCategory;
}

// Natural prose noun phrase for each display label. Raw labels read as word
// salad inside a sentence, so every narrative section uses these instead.
const DISPLAY_CATEGORY_PHRASE: Record<string, string> = {
  "protest / civil unrest": "protest and civil unrest",
  "labour action": "labour action",
  "crime / theft / robbery": "crime, theft and robbery",
  "armed robbery / violent crime": "armed robbery and violent crime",
  "fire / explosion": "fire and explosion incidents",
  "natural hazard": "natural hazards",
  "transport disruption": "transport disruption",
  "utilities / infrastructure disruption": "utilities and infrastructure disruption",
  "regulatory / corruption / governance": "regulatory, corruption and governance issues",
  "security force activity": "security-force activity",
  "community tension / land dispute": "community tension and land disputes",
  "terrorism / militancy": "terrorism and militancy",
  "other security": "other security-relevant activity",
};

export function operatingRiskCategoryPhrase(label: string): string {
  const k = label.trim().toLowerCase();
  return DISPLAY_CATEGORY_PHRASE[k] ?? k.replace(/\s*\/\s*/g, " and ");
}

// ---------------------------------------------------------------------------
// Recommended actions
// ---------------------------------------------------------------------------
// Per-category, incident-specific business guidance. The six explicit strings
// below are taken verbatim from the spec; the remainder give each display label
// its own action so the report never falls back to a single generic line.
const DISPLAY_CATEGORY_ACTION: Record<string, string> = {
  "fire / explosion": "Check nearby site exposure, access disruption and continuity arrangements.",
  "protest / civil unrest": "Avoid protest locations, allow extra journey time and keep routes flexible.",
  "crime / theft / robbery": "Review movement routines, cash handling, parking and local premises security.",
  "armed robbery / violent crime":
    "Review movement routines, cash handling, parking and local premises security.",
  "utilities / infrastructure disruption":
    "Monitor power, water, telecoms or fuel disruption and check backup arrangements.",
  "regulatory / corruption / governance":
    "Monitor for regulatory, procurement or local authority follow-on.",
  "transport disruption":
    "Check route exposure, allow additional journey time and confirm alternative access options.",
  "labour action":
    "Track strike and labour-action notices that may disrupt sites, logistics and staff movement.",
  "natural hazard":
    "Monitor hazard and flood warnings; check site access, drainage and continuity arrangements.",
  "community tension / land dispute":
    "Avoid disputed or tense areas near operating sites until conditions settle.",
  "security force activity":
    "Expect security-force activity; confirm road, checkpoint and access status before movement.",
  "terrorism / militancy":
    "Maintain heightened vigilance and access control at prominent sites; review crowd exposure.",
};

const DEFAULT_ACTION =
  "Maintain standard movement and continuity precautions; monitor for operational follow-on.";

export function operatingRiskAction(label: string): string {
  return DISPLAY_CATEGORY_ACTION[label.trim().toLowerCase()] ?? DEFAULT_ACTION;
}

// ---------------------------------------------------------------------------
// Local text helpers (kept here to avoid a runtime import cycle with the
// builder; mirror joinList / capitaliseFirst in pngReportDataset.ts).
// ---------------------------------------------------------------------------
function joinList(parts: string[]): string {
  const clean = parts.filter(Boolean);
  if (clean.length === 0) return "";
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0, -1).join(", ")} and ${clean[clean.length - 1]}`;
}

function capitaliseFirst(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// Narrative builders
// ---------------------------------------------------------------------------
export interface OperatingRiskProseInput {
  countryName: string;
  empty: boolean;
  trajectory: "worsening" | "easing" | "stable" | "quiet";
  // Lead display-mapped categories (ranked, most prominent first).
  leadDisplayCats: string[];
  // Lead locations as friendly bucket / district labels (ranked, deduplicated).
  leadLocations: string[];
  // Worst severity rank seen this period (5 = Extreme … 1 = Insignificant).
  worstRank: number;
}

export interface OperatingRiskPolestarInput extends OperatingRiskProseInput {
  // The theatre's escalation/volatility clause (config.outlookVolatilityClause).
  outlookVolatilityClause: string;
}

// A short, action-focused close for the BLUF, composed from the lead categories.
function blufActions(leadDisplayCats: string[], worstRank: number): string {
  const set = new Set(leadDisplayCats.map((c) => c.trim().toLowerCase()));
  const parts: string[] = [];
  parts.push(worstRank >= 4 ? "tighten movement planning" : "maintain standard movement precautions");
  if (set.has("protest / civil unrest") || set.has("labour action"))
    parts.push("avoid protest and crowd locations");
  if (set.has("armed robbery / violent crime") || set.has("crime / theft / robbery"))
    parts.push("review movement routines and premises security");
  if (
    set.has("fire / explosion") ||
    set.has("utilities / infrastructure disruption") ||
    set.has("transport disruption") ||
    set.has("natural hazard")
  )
    parts.push("monitor localised fire, utility and transport disruption and check site continuity");
  if (set.has("regulatory / corruption / governance"))
    parts.push("watch for regulatory or local-authority follow-on");
  if (parts.length === 1) parts.push("review exposed-site continuity arrangements");
  return joinList(parts.slice(0, 3));
}

// BLUF: 3–4 lines answering four questions — is the picture improving, stable or
// deteriorating; what is driving it; where is the main exposure; what should
// business users do this week.
export function buildOperatingRiskBluf(i: OperatingRiskProseInput): string {
  if (i.empty) {
    return `The ${i.countryName} operating picture is unclear this week: no fresh open-source reporting was identified, which is read as a coverage gap rather than a genuine improvement. Standing exposures continue to apply. Business users should maintain existing movement and continuity precautions and treat the quiet period as provisional.`;
  }
  const trend =
    i.trajectory === "worsening"
      ? i.worstRank >= 4
        ? "deteriorated this week"
        : "deteriorated slightly this week"
      : i.trajectory === "easing"
        ? "eased a little this week, though from a high baseline"
        : "was broadly stable this week";
  const cats = i.leadDisplayCats.map(operatingRiskCategoryPhrase);
  const driver = cats.length
    ? `${i.worstRank >= 4 ? "with higher-severity reporting across" : "with reporting concentrated around"} ${joinList(cats)}`
    : "with only limited fresh reporting";
  const exposure = i.leadLocations.length
    ? `${joinList(i.leadLocations)} ${i.leadLocations.length > 1 ? "remain the main exposure" : "remains the main exposure"} for staff movement and site continuity`
    : "the main exposure remains movement disruption and site continuity";
  const actions = blufActions(i.leadDisplayCats, i.worstRank);
  return `The ${i.countryName} operating picture ${trend}, ${driver}. ${capitaliseFirst(exposure)}. Business users should ${actions}.`;
}

// Executive Summary: themes, geographic concentration, business impact and
// whether the reporting picture is broad/narrow and improving/stable/
// deteriorating. Deliberately framed to NOT restate the BLUF.
export function buildOperatingRiskExecutiveSummary(i: OperatingRiskProseInput): string {
  if (i.empty) {
    return `No fresh open-source reporting was identified for ${i.countryName} this week, so this assessment rests on standing context rather than current signals. The established operating-risk pattern carries over; treat the absence of reporting as a coverage gap, not as an improvement in conditions.`;
  }
  const cats = i.leadDisplayCats.map(operatingRiskCategoryPhrase);
  const themes = cats.length
    ? `The week's reporting was led by ${joinList(cats)}`
    : "Fresh reporting this week was limited";
  const geo = i.leadLocations.length
    ? `, concentrated around ${joinList(i.leadLocations)}`
    : ", spread across the country without a single dominant centre";
  const impact =
    i.worstRank >= 4
      ? "The main business impact is direct exposure to violence and major disruption at affected sites"
      : "The main business impact is incidental exposure to crime and localised disruption rather than a targeted threat";
  const breadthWord =
    i.leadDisplayCats.length >= 3 && i.leadLocations.length >= 3
      ? "broad"
      : i.leadDisplayCats.length <= 1 && i.leadLocations.length <= 1
        ? "narrow"
        : "mixed";
  const trajWord =
    i.trajectory === "worsening"
      ? "deteriorating"
      : i.trajectory === "easing"
        ? "improving"
        : "broadly stable";
  return `${themes}${geo}. ${impact}. The reporting picture this week reads as ${breadthWord} and ${trajWord}.`;
}

// Polestar View: the strongest analytical section. A clear judgement, the
// business relevance, where exposure is highest, what would change the
// assessment, and what users should do now. Avoids bare "risk remains" wording.
export function buildOperatingRiskPolestarView(i: OperatingRiskPolestarInput): string {
  if (i.empty) {
    return `Polestar holds the standing assessment for ${i.countryName}: with no fresh reporting this week, the established operating-risk pattern persists and the quiet period is read as a coverage gap, not an improvement. Maintain current precautions, and treat any return of reporting — particularly higher-severity or casualty-bearing incidents — as the trigger to reassess.`;
  }
  const cats = i.leadDisplayCats.map(operatingRiskCategoryPhrase);
  const judgement =
    i.trajectory === "worsening"
      ? `Polestar assesses that operating risk in ${i.countryName} stepped up this week`
      : i.trajectory === "easing"
        ? `Polestar assesses that operating risk in ${i.countryName} eased modestly this week, though from an elevated baseline`
        : `Polestar assesses that operating risk in ${i.countryName} held to its established pattern this week`;
  const driver = cats.length ? `, driven by ${joinList(cats)}` : "";
  const relevance =
    i.worstRank >= 4
      ? "For commercial operations the practical concern is direct disruption to staff movement, sites and continuity where these incidents cluster"
      : "For commercial operations the practical concern is incidental disruption to staff movement and local continuity rather than a direct threat";
  const exposure = i.leadLocations.length
    ? `Exposure is highest in ${joinList(i.leadLocations)}`
    : "Exposure is diffuse rather than tied to a single centre";
  const change = `The assessment would shift if larger protest mobilisation, casualty-bearing incidents or sustained disruption emerge around ${i.outlookVolatilityClause}`;
  const action =
    i.worstRank >= 4
      ? "Tighten movement planning and site protection at the exposed locations now, and keep routes and contingency arrangements under active review"
      : "Keep standard movement and continuity precautions in place now, and vary routines around the exposed locations";
  return `${judgement}${driver}. ${relevance}. ${exposure}. ${change}. ${action}.`;
}

// Priorities This Week: short, action-focused points keyed by location rather
// than restated incident titles. Each group is the dominant display category at
// a location; deduplicated and capped.
export function buildOperatingRiskPriorities(
  groups: { location: string; dominantDisplayCat: string }[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const g of groups) {
    const loc = g.location.trim();
    if (!loc) continue;
    const line = `${loc}: ${operatingRiskAction(g.dominantDisplayCat)}`;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
    if (out.length >= 5) break;
  }
  return out;
}
