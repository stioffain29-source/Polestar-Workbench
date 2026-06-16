// Conflict Watch analysis helpers.
//
// The "Conflict Watch" monitor is fed by the live `conflict` data topic — war,
// armed conflict, insurgency and serious armed crime. This is a SEPARATE
// kinetic theatre from the `flashpoint`/`protests` feed (which owns the
// protest / demonstration / strike / civil-disorder vocabulary). This module
// is the single source of truth for:
//   1. classifying each record into one of four event types, and
//   2. inferring cautious operational-impact tags from the title/summary text.
//
// Classification is deliberately keyword-based and conservative. There is no
// "Other" bucket — when nothing matches we default to Armed Clash, the broadest
// of the four. Keep these pure and side-effect free so they stay easy to test.

export const CONFLICT_CATEGORIES = [
  "Armed Clash",
  "Insurgency",
  "Bombing & Airstrike",
  "Abduction & Armed Crime",
] as const;

export type ConflictCategory = (typeof CONFLICT_CATEGORIES)[number];

export interface ConflictTextLike {
  title: string;
  summary?: string | null;
  displayTitle?: string | null;
}

// Classify on the translated headline (when present) plus the original title and
// summary, so foreign-language rows that carry an English `displayTitle` still
// match the keyword rules.
function text(i: ConflictTextLike): string {
  return `${i.displayTitle ?? ""} ${i.title} ${i.summary ?? ""}`.toLowerCase();
}

// Word-stem patterns. Anchored with \b at the start so "mine" does not match
// "examine" etc.; trailing inflections (bombings, raiders, fighters) are left
// open so plurals/verb forms are caught. These mirror the kinetic vocabulary of
// the `conflict` relevance rule so the monitor and the ingest gate stay aligned.
const BOMBING_AIRSTRIKE =
  /\b(ied|improvised explosive|roadside bomb|car bomb|truck bomb|suicide bomb|grenade|bomb blast|bombing|explosion|detonat|land ?mine|airstrike|air strike|air ?raid|drone strike|shelling|shelled|artillery|mortar|rocket (attack|strike)|missile)/;
const ABDUCTION_CRIME =
  /\b(abduct|kidnap|hostage|armed robbery|armed heist|armed hold-?up|at gunpoint|extortion|kidnap[- ]for[- ]ransom|ransom)/;
const INSURGENCY =
  /\b(insurgen|militan|rebel|separatis|guerrilla|paramilitar|militia|warlord|junta|tpnpb|opm|free papua|west papua (rebel|fighter|insurgen|liberation|armed)|\bnpa\b|new people'?s army|abu sayyaf|biff|bifm|bangsamoro|moro (rebel|fighter|front)|ttp|tehrik|baloch|naxal|maoist|arakan army|ethnic armed)/;

// Precedence is intentional: the explosive / aerial weapon signal (Bombing &
// Airstrike) is the most lethal and indiscriminate, so it leads even when an
// insurgent actor is named. Abduction & Armed Crime is next (a specific,
// identifiable event type), then Insurgency (actor-driven), then Armed Clash as
// the catch-all default for any other armed engagement (firefights, gun
// battles, ambushes, skirmishes, shootings).
export function classifyConflictCategory(i: ConflictTextLike): ConflictCategory {
  const t = text(i);
  if (BOMBING_AIRSTRIKE.test(t)) return "Bombing & Airstrike";
  if (ABDUCTION_CRIME.test(t)) return "Abduction & Armed Crime";
  if (INSURGENCY.test(t)) return "Insurgency";
  return "Armed Clash";
}

// Category colours — drawn ONLY from the Polestar brand family: Electric Blue,
// Midnight Blue, Dusk Gray and a muted steel-blue Midnight tint for the
// highest-lethality category. Red is deliberately NOT used here — subdued red
// (#A33232) is reserved for Extreme severity only. All four are dark enough to
// carry white chip text.
export const CATEGORY_COLOR: Record<ConflictCategory, string> = {
  "Armed Clash": "#465bff", // Electric Blue
  Insurgency: "#0b0a3d", // Midnight Blue
  "Bombing & Airstrike": "#4D5C7A", // Steel Blue (muted Midnight tint)
  "Abduction & Armed Crime": "#363636", // Dusk Gray
};

// Plural / display labels for the category metric cards (the incident table
// keeps the singular canonical names above).
export const CATEGORY_CARD_LABEL: Record<ConflictCategory, string> = {
  "Armed Clash": "Armed Clashes",
  Insurgency: "Insurgency",
  "Bombing & Airstrike": "Bombings & Airstrikes",
  "Abduction & Armed Crime": "Abduction & Crime",
};

// ---------------------------------------------------------------------------
// Operational impact inference (cautious — keyword only, no confidence claims)
// ---------------------------------------------------------------------------

export interface OperationalImpactRule {
  label: string;
  description: string;
  re: RegExp;
}

export const OPERATIONAL_IMPACTS: OperationalImpactRule[] = [
  {
    label: "Casualties reported",
    description: "Deaths or injuries reported in the incident.",
    re: /\b(killed|kill|dead|death|deaths|fatalit|wounded|injured|injuries|casualt|massacre|shot dead|gunned down|slain)/,
  },
  {
    label: "Civilian harm or displacement",
    description: "Civilians harmed, villages attacked or people displaced.",
    re: /\b(civilian|villager|village (burn|raid|attack|torch)|displac|refugee|fled|flee|evacuat|homes? (burn|destroy|razed))/,
  },
  {
    label: "Transport or checkpoint disruption",
    description: "Roads, checkpoints, convoys, rail or air movement affected.",
    re: /\b(road|highway|checkpoint|convoy|route|bridge|rail|railway|train|airport|flight|transport|traffic|roadblock)/,
  },
  {
    label: "Energy or utility disruption",
    description: "Power, fuel, water or energy infrastructure affected.",
    re: /\b(power (plant|line|station|cut|outage)|electricity|\bgrid\b|blackout|pipeline|substation|fuel depot|refinery|\boil\b|\bgas\b|water supply|utility|utilities)/,
  },
  {
    label: "Aviation or maritime risk",
    description: "Airports, airspace, ports or shipping exposed.",
    re: /\b(airport|airspace|aircraft|helicopter|\bport\b|vessel|\bship\b|naval|navy|maritime|strait|sea lane|coast guard)/,
  },
  {
    label: "Security-force or government targeting",
    description: "Military, police or government facilities targeted.",
    re: /\b(military (base|camp|post|outpost|convoy|patrol)|army (base|camp|post|patrol)|police station|barracks|garrison|government (building|office|forces)|ministry|parliament|district office|security forces)/,
  },
];

/** Returns the operational-impact labels whose keywords appear in the text. */
export function detectOperationalImpacts(i: ConflictTextLike): string[] {
  const t = text(i);
  return OPERATIONAL_IMPACTS.filter((r) => r.re.test(t)).map((r) => r.label);
}
