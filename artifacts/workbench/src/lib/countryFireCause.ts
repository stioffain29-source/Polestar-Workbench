// Fire / explosion cause classification for the Country Report (spec §10).
//
// Fires are a large share of country incident feeds, and the cause is very often
// NOT stated by the source. The cardinal rule here is no-fabrication: this
// classifier NEVER infers arson, an attack or unrest unless the source text
// explicitly says so. When no cause is stated it returns "cause-not-yet-
// reported" — never a guessed security cause. It also separates SECURITY
// relevance (deliberate: arson / attack / unrest) from business-CONTINUITY
// relevance (accidental / electrical / industrial / commercial / residential /
// vehicle / wildfire), so the narrative can treat the two correctly.
//
// Pure and dependency-free so it can be unit-tested directly and consumed by the
// Incident Details narrative, Recommended Actions, the Top-3 value score and the
// Reporting Confidence call without pulling in the ingest barrel.

export type FireCauseTag =
  | "arson-suspicious"
  | "attack-related"
  | "protest-related"
  | "electrical"
  | "accidental"
  | "wildfire"
  | "fire-safety"
  | "explosion"
  | "cause-not-yet-reported";

export type FireSetting =
  | "industrial"
  | "commercial"
  | "residential"
  | "vehicle"
  | "transport"
  | "wildfire"
  | "other";

export type FireRelevance = "security" | "continuity" | "unclear";

export interface FireCauseResult {
  /** Fire OR explosion language present in the text. */
  isFire: boolean;
  /** Single best cause tag, safe-by-default (never a guessed security cause). */
  cause: FireCauseTag;
  /** True only when the SOURCE stated a cause / circumstance. Feeds confidence. */
  causeStated: boolean;
  /** Whether this reads as a security matter, a continuity matter, or unclear. */
  relevance: FireRelevance;
  /** Where it burned, when discernible — drives continuity vs security framing. */
  setting: FireSetting;
  /** Short, count-free human phrase for the narrative. */
  label: string;
}

const FIRE_RE =
  /\b(fire|fires|blaze|blazes|inferno|burned|burnt|burning|ablaze|gutted|gutting|razed|engulf\w*|caught\s+fire|up\s+in\s+flames)\b/i;
const EXPLOSION_RE = /\b(explosion|explosions|explode[ds]?|blast|blasts|detonat\w*)\b/i;

// Deliberate-cause cues. Each gate requires the source to SAY it — we never tag
// a bare fire as arson / attack / unrest.
const ARSON_RE =
  /\b(arson|arsonist|firebomb\w*|molotov|torched|deliberately\s+(?:set|lit|started)|set\s+(?:ablaze|alight|on\s+fire)\s+(?:by|deliberately)|suspected\s+arson)\b/i;
const ATTACK_RE =
  /\b(bomb\w*|ied|grenade|shelling|air\s?strike|drone\s+strike|missile|militant\w*|insurgent\w*|terror\w*|gunmen|sabotage)\b/i;
const PROTEST_RE =
  /\b(protest\w*|riot\w*|unrest|clash\w*|demonstrat\w*|mob|looting)\b/i;
const ELECTRICAL_RE =
  /\b(electrical|short[\s-]?circuit\w*|wiring|faulty\s+wiring|power\s+surge|transformer|electric\s+fault|overheat\w*\s+(?:wiring|cable))\b/i;
const ACCIDENTAL_RE =
  /\b(accidental\w*|gas\s+leak|gas\s+cylinder|lpg|cooking|stove|candle|cigarette|spark\w*|short[\s-]?fuse|negligen\w*\s+handling)\b/i;
const WILDFIRE_RE =
  /\b(wildfire\w*|bush\s?fire\w*|forest\s+fire\w*|grass\s+fire\w*|scrub\s+fire\w*|peat\b|land[\s-]?clearing|vegetation\s+fire\w*|hotspot\w*)\b/i;
const FIRE_SAFETY_RE =
  /\b(fire\s+safety|safety\s+violation\w*|safety\s+lapse\w*|no\s+fire\s+(?:exit|exits|escape)|fire\s+code|building\s+code|fire\s+hazard\w*)\b/i;

const SETTING_RE: { re: RegExp; setting: FireSetting }[] = [
  {
    re: /\b(factory|factories|plant|refiner\w*|warehouse\w*|mill|depot|godown|industrial|chemical|petrochemical|smelter|foundry)\b/i,
    setting: "industrial",
  },
  {
    re: /\b(market|markets|mall|malls|shop\w*|store\w*|supermarket\w*|minimart|hotel\w*|restaurant\w*|office\w*|plaza|showroom|bank|kiosk|stall\w*|bazaar)\b/i,
    setting: "commercial",
  },
  {
    re: /\b(house\w*|home\w*|apartment\w*|residential|dwelling\w*|settlement\w*|slum\w*|shanty|housing|flat\w*)\b/i,
    setting: "residential",
  },
  {
    re: /\b(car|cars|bus|buses|truck\w*|lorry|lorries|vehicle\w*|motorcycle\w*|van\b|tanker\w*|minibus\w*)\b/i,
    setting: "vehicle",
  },
  {
    re: /\b(airport\w*|seaport\w*|\bport\b|terminal\w*|station\w*|train\w*|aircraft|airplane\w*|plane\b|ship\w*|ferry\w*|vessel\w*)\b/i,
    setting: "transport",
  },
];

function detectSetting(hay: string): FireSetting {
  if (WILDFIRE_RE.test(hay)) return "wildfire";
  for (const s of SETTING_RE) if (s.re.test(hay)) return s.setting;
  return "other";
}

const LABELS: Record<FireCauseTag, string> = {
  "arson-suspicious": "Reported as suspected arson",
  "attack-related": "Reported as an attack",
  "protest-related": "Linked to unrest",
  electrical: "Reported electrical cause",
  accidental: "Reported accidental cause",
  wildfire: "Vegetation or land fire",
  "fire-safety": "Fire-safety failure reported",
  explosion: "Explosion; cause not yet reported",
  "cause-not-yet-reported": "Cause not yet reported",
};

export function classifyFireCause(input: {
  title?: string | null;
  summary?: string | null;
  category?: string | null;
}): FireCauseResult {
  const hay = `${input.title ?? ""} ${input.summary ?? ""} ${input.category ?? ""}`.toLowerCase();
  const hasFire = FIRE_RE.test(hay);
  const hasExplosion = EXPLOSION_RE.test(hay);
  // Arson is by definition fire-setting, and a headline may name the arson
  // without the word "fire" ("Arson suspected at depot"), so it counts as a fire
  // even when no bare fire word is present. Attack / protest cues do NOT imply a
  // fire on their own (a bombing or a rally is not necessarily a blaze).
  const isFire = hasFire || hasExplosion || ARSON_RE.test(hay);

  const setting = detectSetting(hay);

  // Stated-cause precedence: deliberate causes first (each strictly gated on the
  // source saying so), then non-security causes, then explosion-as-type, then
  // the safe default.
  let cause: FireCauseTag;
  let causeStated = true;
  if (ARSON_RE.test(hay)) cause = "arson-suspicious";
  else if (ATTACK_RE.test(hay)) cause = "attack-related";
  else if (PROTEST_RE.test(hay)) cause = "protest-related";
  else if (ELECTRICAL_RE.test(hay)) cause = "electrical";
  else if (ACCIDENTAL_RE.test(hay)) cause = "accidental";
  else if (WILDFIRE_RE.test(hay)) cause = "wildfire";
  else if (FIRE_SAFETY_RE.test(hay)) cause = "fire-safety";
  else if (hasExplosion) {
    cause = "explosion";
    causeStated = false;
  } else {
    cause = "cause-not-yet-reported";
    causeStated = false;
  }

  // Relevance: deliberate causes are a SECURITY matter; clearly non-security
  // causes are a continuity matter. When the cause is unknown we lean on the
  // setting — a non-security setting (factory / shop / home / vehicle / bush) is
  // a continuity concern, never an inferred security one — otherwise unclear.
  let relevance: FireRelevance;
  if (cause === "arson-suspicious" || cause === "attack-related" || cause === "protest-related") {
    relevance = "security";
  } else if (
    cause === "electrical" ||
    cause === "accidental" ||
    cause === "wildfire" ||
    cause === "fire-safety"
  ) {
    relevance = "continuity";
  } else if (setting !== "other") {
    relevance = "continuity";
  } else {
    relevance = "unclear";
  }

  return { isFire, cause, causeStated, relevance, setting, label: LABELS[cause] };
}

export interface FireCauseSummary {
  total: number;
  /** Fires/explosions with a deliberate (security) cause STATED by the source. */
  security: number;
  /** Fires/explosions reading as a continuity matter. */
  continuity: number;
  /** Fires/explosions where the cause is not yet reported / unclear. */
  unclear: number;
  /** True when at least one fire is a major one (caller decides) with no cause. */
  hasCauseGap: boolean;
}

// Summarise the fire/explosion items in a window. `items` should already be the
// fire-themed subset; non-fire rows are ignored defensively.
export function summariseFireCauses(
  items: { title?: string | null; summary?: string | null; category?: string | null }[],
): FireCauseSummary {
  let security = 0;
  let continuity = 0;
  let unclear = 0;
  let hasCauseGap = false;
  let total = 0;
  for (const it of items) {
    const r = classifyFireCause(it);
    if (!r.isFire) continue;
    total += 1;
    if (r.relevance === "security") security += 1;
    else if (r.relevance === "continuity") continuity += 1;
    else unclear += 1;
    if (!r.causeStated) hasCauseGap = true;
  }
  return { total, security, continuity, unclear, hasCauseGap };
}
