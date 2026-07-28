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
  "explosive remnants of war / accidental explosion": "Fire / explosion",
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
    "Avoid disputed or tense areas near staffed premises until conditions settle.",
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

// Per-category escalation trigger — the concrete, forward-looking condition that
// would raise exposure for a business. Framed as a watch condition ("if this
// happens"), never a prediction, so it stays within no-fabrication. Each is a
// noun phrase with no trailing full stop; the caller supplies punctuation.
const DISPLAY_CATEGORY_TRIGGER: Record<string, string> = {
  "protest / civil unrest":
    "a call for mass mobilisation, a march on government or company premises, or clashes with police",
  "labour action":
    "a strike notice affecting ports, airports, fuel distribution or a named employer",
  "crime / theft / robbery":
    "a shift to armed or violent robbery, or repeat targeting of the same premises or route",
  "armed robbery / violent crime":
    "repeat armed incidents in the same area, or targeting of staff, vehicles or commercial premises",
  "fire / explosion":
    "a fire or blast at an industrial, fuel or utility site, or one forcing an evacuation nearby",
  "natural hazard":
    "an official flood, storm or seismic warning upgrade, or an airport or port closure",
  "transport disruption":
    "a full closure of a road, terminal or airport, or disruption lasting beyond a single day",
  "utilities / infrastructure disruption":
    "a prolonged or wide-area power, water, fuel or telecoms outage",
  "regulatory / corruption / governance":
    "a new regulation, licence suspension or enforcement action affecting operations",
  "security force activity":
    "a large security operation, curfew or new checkpoint regime near staffed premises",
  "community tension / land dispute":
    "escalation to violence, road blockades, or damage to company or contractor assets",
  "terrorism / militancy":
    "a specific threat, a foiled plot, or an attack on a public or commercial site",
};

const DEFAULT_TRIGGER =
  "a higher-severity or casualty-bearing incident, or repeat activity in the same area";

export function operatingRiskTrigger(label: string): string {
  return DISPLAY_CATEGORY_TRIGGER[label.trim().toLowerCase()] ?? DEFAULT_TRIGGER;
}


// ---------------------------------------------------------------------------
// Narrative builders
// ---------------------------------------------------------------------------
// The legacy BLUF / Executive Summary / Polestar View builders were deleted:
// the shared country engine (@workspace/country-engine) is now the sole author
// of those sections. Only the rendered Priorities-This-Week list remains.

// Priorities This Week: short, operational points keyed by location rather than
// restated incident titles. Each line names WHERE (the location bucket), WHAT to
// do (the category action) and the ESCALATION TRIGGER to watch — the concrete
// condition that would raise exposure. Each group is the dominant display
// category at a location; deduplicated and capped.
export function buildOperatingRiskPriorities(
  groups: { location: string; dominantDisplayCat: string }[],
): string[] {
  const seen = new Set<string>();
  // Repetition guard: the same dominant category at several locations shares
  // one trigger phrase — state it on the first line only, omit thereafter
  // (omit, never pad; a verbatim repeated sentence reads as boilerplate).
  const usedTriggers = new Set<string>();
  const out: string[] = [];
  for (const g of groups) {
    const loc = g.location.trim();
    if (!loc) continue;
    const action = operatingRiskAction(g.dominantDisplayCat);
    const trigger = operatingRiskTrigger(g.dominantDisplayCat);
    const firstUse = !usedTriggers.has(trigger);
    usedTriggers.add(trigger);
    const line = firstUse
      ? `${loc}: ${action} Escalation trigger — ${trigger}.`
      : `${loc}: ${action}`;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
    if (out.length >= 5) break;
  }
  return out;
}
