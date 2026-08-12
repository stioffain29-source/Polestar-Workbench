// Cargo Watch pattern-report configuration.
//
// This module holds the CONFIGURABLE, human-readable rules that drive the
// redesigned Cargo Watch report (supply-chain exposure, pattern dashboard,
// timeline, priority matrix). Keeping the mapping and scoring here — rather
// than hard-coded inside the PDF/preview components — means an analyst can
// retune the report without touching rendering code.
//
// Nothing in this file fabricates data: it only maps the taxonomy the
// classifier already produces onto supply-chain stages, and documents the
// weights used to score operational consequence.

import {
  CARGO_FLOOR_LABEL,
  CARGO_NOT_RELEVANT,
} from "./cargoAnalysis";

// --- Supply-chain stages --------------------------------------------------

export type CargoStageKey =
  | "warehouse_depot"
  | "inland_transport"
  | "inland_waterway"
  | "staging_yard"
  | "port_terminal"
  | "maritime"
  | "unattributed";

// Fixed left-to-right order of the OPERATIONAL supply-chain exposure stages
// (spec PAGE 3). Every OPERATIONAL incident maps to EXACTLY ONE stage so the
// stage counts sum to the operational unique-incident total. Enforcement
// outcomes (arrests / seizures / recoveries / investigations) are NOT a
// supply-chain stage — they are partitioned into their own panel and excluded
// from these stages (see isEnforcementOutcome / ENFORCEMENT_CATEGORIES). The
// honest "Other or unattributed" stage holds real cargo-security events the
// reporting does not place precisely in the chain (the classifier floor), so
// they still count operationally without inflating a specific stage.
export const STAGE_ORDER: CargoStageKey[] = [
  "warehouse_depot",
  "inland_transport",
  "inland_waterway",
  "staging_yard",
  "port_terminal",
  "maritime",
  "unattributed",
];

export interface CargoStageMeta {
  label: string;
  // Short control concern shown on the supply-chain exposure card.
  primaryConcern: string;
  // Controls a pattern in this stage typically stresses (pattern dashboard).
  controlAffected: string[];
  // Forward-looking indicator template (pattern dashboard "Watch next").
  watchNext: string;
}

export const STAGE_META: Record<CargoStageKey, CargoStageMeta> = {
  warehouse_depot: {
    label: "Warehouse and depot",
    primaryConcern: "Access control and after-hours facility security",
    controlAffected: [
      "Perimeter security",
      "CCTV and alarms",
      "Guarding",
      "Access control",
    ],
    watchNext:
      "Repeat intrusion at the same facility, operator or after-hours window.",
  },
  inland_transport: {
    label: "Inland transport",
    primaryConcern: "Route security and driver integrity",
    controlAffected: [
      "Route planning",
      "Driver vetting",
      "In-transit tracking",
      "Escort protocols",
    ],
    watchNext: "Repeat hits on the same corridor, operator or load type.",
  },
  inland_waterway: {
    label: "Inland waterway",
    primaryConcern: "River and barge movement security",
    controlAffected: [
      "Route planning",
      "On-water escort and watch",
      "Cargo custody in transit",
      "Jetty access control",
    ],
    watchNext:
      "Repeat hits on the same river route, jetty or barge operator.",
  },
  staging_yard: {
    label: "Staging yard",
    primaryConcern: "Handover, seal integrity and cargo custody",
    controlAffected: [
      "Seal integrity",
      "Handover checks",
      "Yard access",
      "Documentation controls",
    ],
    watchNext:
      "Seal or handover compromise recurring at the same yard or carrier.",
  },
  port_terminal: {
    label: "Port and terminal",
    primaryConcern: "Access control and cargo custody at the terminal",
    controlAffected: [
      "Terminal access control",
      "Cargo custody",
      "Quayside surveillance",
      "Contractor vetting",
    ],
    watchNext:
      "Repeat access breaches or custody losses at the same terminal.",
  },
  maritime: {
    label: "Maritime",
    primaryConcern: "Vessel security and anchorage watch",
    controlAffected: [
      "Anchorage watch",
      "Deck security",
      "Access to holds",
      "Crew vigilance",
    ],
    watchNext: "Repeat boardings or thefts in the same anchorage or approach.",
  },
  unattributed: {
    label: "Other or unattributed",
    primaryConcern: "Reporting detail insufficient to place the exposure point",
    controlAffected: [
      "Reporting quality",
      "Source corroboration",
    ],
    watchNext:
      "Whether fuller reporting clarifies where in the chain the exposure sits.",
  },
};

// Deterministic, per-STAGE operational-relevance line for the curated "Key
// Incidents" cards. Explains why an event at this point in the supply chain
// matters operationally — generic to the stage, never a fabricated per-incident
// detail. Kept beside STAGE_META so the two stay in step.
export const OPERATIONAL_RELEVANCE_BY_STAGE: Record<CargoStageKey, string> = {
  warehouse_depot:
    "Highlights static-site exposure at storage and distribution facilities, where access control and after-hours security carry the load.",
  inland_transport:
    "Points to exposure during road movement on predictable corridors, where route planning and in-transit tracking are the main defences.",
  inland_waterway:
    "Points to exposure during river and barge movement, where on-water escort and jetty access control are the main defences.",
  staging_yard:
    "Underlines custody and seal-integrity risk at handover points between carriers.",
  port_terminal:
    "Reflects cargo-custody and access-control exposure inside the terminal environment.",
  maritime:
    "Shows vessel and anchorage exposure to boarding and theft on the water.",
  unattributed:
    "Records a cargo-security event the reporting does not place precisely in the supply chain.",
};

// Maps every OPERATIONAL classifier taxonomy label (see CARGO_CATEGORIES in
// cargoAnalysis) onto a single supply-chain stage. The floor label routes to
// the honest "Other or unattributed" stage so it never inflates a specific
// stage, and the sentinel "Not relevant" is mapped defensively (in-scope rows
// never carry it). The three ENFORCEMENT categories (arrest + both seizures)
// are DELIBERATELY absent — they are partitioned into the enforcement panel
// before any stage lookup, so they never appear in the supply-chain totals
// (spec pt1). If one somehow reaches stageForCategory it defaults to
// "unattributed" rather than silently inflating a stage.
export const CATEGORY_TO_STAGE: Record<string, CargoStageKey> = {
  // Land-side (12).
  "Truck hijacking": "inland_transport",
  "Attack on cargo vehicle / convoy": "inland_transport",
  "Highway / road cargo robbery": "inland_transport",
  "Warehouse theft": "warehouse_depot",
  "Depot / yard theft": "warehouse_depot",
  "Container theft (inland)": "inland_transport",
  "Pilferage / seal tampering": "staging_yard",
  "Fictitious pickup / fake carrier fraud": "staging_yard",
  "Cargo diversion / misrouting": "inland_transport",
  "Insider / driver collusion theft": "inland_transport",
  "Cargo documentation fraud": "staging_yard",
  "Cargo theft in transit": "inland_transport",
  // Port-related operational (13 — the three enforcement categories excluded).
  "Port armed robbery": "port_terminal",
  "Anchorage robbery / theft": "maritime",
  "Vessel boarding (robbery)": "maritime",
  "Theft from vessel at port": "port_terminal",
  "Theft from container at port / terminal": "port_terminal",
  "Port intrusion / trespass": "port_terminal",
  "Stowaway incident": "maritime",
  "Port-linked cargo smuggling": "port_terminal",
  "Port sabotage / arson": "port_terminal",
  "Suspicious activity near port": "port_terminal",
  "Port-access blockade (cargo disruption)": "port_terminal",
  "Port labour unrest (cargo risk)": "port_terminal",
  "Truck park / access-road crime": "port_terminal",
  // Floor + sentinel.
  [CARGO_FLOOR_LABEL]: "unattributed",
  [CARGO_NOT_RELEVANT]: "unattributed",
};

export function stageForCategory(category: string): CargoStageKey {
  return CATEGORY_TO_STAGE[category] ?? "unattributed";
}

// --- Weekly activity matrix (spec PAGE 5) ---------------------------------
//
// The Weekly Activity by Pattern matrix uses the six supply-chain stages as its
// rows. These row labels are held here (rather than reusing STAGE_META.label)
// so a compact form can be used in the matrix without changing the
// supply-chain exposure card wording.
export const WEEKLY_PATTERN_ROW_LABEL: Record<CargoStageKey, string> = {
  warehouse_depot: "Warehouse and depot",
  inland_transport: "Inland transport",
  inland_waterway: "Inland waterway",
  staging_yard: "Staging yard",
  port_terminal: "Port and terminal",
  maritime: "Maritime",
  unattributed: "Other or unattributed",
};

// --- Operational vs enforcement partition (spec pt1) ----------------------
//
// Enforcement OUTCOMES (arrests, seizures, recoveries, investigations) are a
// RESPONSE to cargo crime, not a fresh theft event. Counting them alongside
// theft would double-count (they often report on incidents already in the set)
// and inflate every operational surface. They are therefore partitioned into
// their own panel and EXCLUDED from the operational total, the theft trend,
// the supply-chain percentages, the theft map, the pattern dashboard and the
// per-country totals (spec pt1). This is a PER-INCIDENT, title-first decision —
// there is deliberately NO cross-incident matching (that would risk dropping a
// genuine second event that merely shares a suspect with an earlier one).

// The three taxonomy categories that are, by definition, enforcement outcomes.
// Kept as string literals (not imported) because they are stable brand-safe
// labels; mirror CARGO_CATEGORIES in cargoAnalysis if those labels ever change.
export const ENFORCEMENT_CATEGORIES: ReadonlySet<string> = new Set([
  "Arrest of cargo crime group",
  "Narcotics seizure (cargo / port)",
  "Weapons / contraband seizure (cargo / port)",
]);

// Completed enforcement-action framing in a headline. Deliberately STRONG,
// completed-outcome words only (arrest / seizure / recovery / charge /
// conviction / detention) — NOT weak investigation words like "probe" or
// "manhunt", which routinely accompany a theft headline that must stay
// operational.
export const ENFORCEMENT_TITLE_RE =
  /\b(arrest\w*|apprehend\w*|detain\w*|nabbed|busted|held over|remand\w*|charged|charge sheet|indict\w*|convict\w*|sentenc\w*|jailed|seiz\w*|confiscat\w*|impound\w*|recover\w*|dismantl\w*|bust\b)\b/i;

// Theft / robbery framing in a headline. When BOTH a theft word and an
// enforcement word appear in a title we keep the record OPERATIONAL via this
// guard (an "…arrested after truck robbery" headline is dominated by the fresh
// robbery event unless the classifier itself assigned an enforcement CATEGORY,
// which is checked first).
export const THEFT_TITLE_RE =
  /\b(theft|thefts|stolen|stole|steal\w*|robber\w*|robbed|loot\w*|hijack\w*|burglar\w*|pilfer\w*|snatch\w*|heist|raid\w*|ransack\w*|siphon\w*|plunder\w*|carted away|made off with)\b/i;

// Inland WATERWAY movement signals (spec pt2 — Mithamoin is an inland
// waterway, not a road). NARROW on purpose: barge / ferry / jetty / river port
// / inland waterway. Bare "river" is deliberately excluded (a road that merely
// crosses a river is still a road incident).
export const INLAND_WATERWAY_RE =
  /\b(barge|barges|ferry|ferries|jetty|jetties|river port|river ports|inland waterway|inland waterways|waterway|waterways|riverboat|river boat|river vessel|river cargo|river route|haor)\b/i;

// The theft-type taxonomy categories. Used to decide the map title: when EVERY
// operational incident is a theft-type category the map may honestly read
// "Cargo Theft Incidents by Country"; otherwise it reads the broader "Cargo
// Security Reporting by Country" (spec pt3).
export const THEFT_CATEGORIES: ReadonlySet<string> = new Set([
  "Truck hijacking",
  "Attack on cargo vehicle / convoy",
  "Highway / road cargo robbery",
  "Warehouse theft",
  "Depot / yard theft",
  "Container theft (inland)",
  "Pilferage / seal tampering",
  "Cargo diversion / misrouting",
  "Insider / driver collusion theft",
  "Cargo theft in transit",
  "Port armed robbery",
  "Anchorage robbery / theft",
  "Vessel boarding (robbery)",
  "Theft from vessel at port",
  "Theft from container at port / terminal",
  "Truck park / access-road crime",
]);

// Completed enforcement verbs that must appear for a seizure CATEGORY to count
// as an enforcement outcome. Without these, a looting / robbery headline that
// merely names "weapons" or "contraband" near "port" must stay OPERATIONAL —
// category labels alone are not evidence of an arrest, seizure or recovery.
export const ENFORCEMENT_ACTION_RE =
  /\b(arrest\w*|apprehend\w*|detain\w*|nabbed|busted|held over|remand\w*|charged|charge sheet|indict\w*|convict\w*|sentenc\w*|jailed|seiz\w*|confiscat\w*|impound\w*|recover\w*|dismantl\w*|intercept\w*|bust\b)\b/i;

// Per-incident enforcement-outcome decision (spec pt1). Arrest category is
// authoritative. Seizure categories require a completed enforcement verb in the
// title (otherwise port looting / robbery is misfiled as "enforcement"). A
// title-frame backstop catches operational categories whose HEADLINE leads with
// a completed enforcement action and carries no theft verb.
export function isEnforcementOutcome(category: string, title: string): boolean {
  if (category === "Arrest of cargo crime group") return true;
  if (
    (category === "Narcotics seizure (cargo / port)" ||
      category === "Weapons / contraband seizure (cargo / port)") &&
    ENFORCEMENT_ACTION_RE.test(title)
  ) {
    return true;
  }
  if (ENFORCEMENT_TITLE_RE.test(title) && !THEFT_TITLE_RE.test(title)) {
    return true;
  }
  return false;
}

// Operational supply-chain stage for an incident, applying the inland-waterway
// override (spec pt2) on top of the category→stage base map. Only called on
// OPERATIONAL incidents (enforcement is partitioned out beforehand).
export function stageForIncident(
  category: string,
  text: string,
): CargoStageKey {
  const base = stageForCategory(category);
  if (base === "inland_transport" && INLAND_WATERWAY_RE.test(text)) {
    return "inland_waterway";
  }
  return base;
}

// Whether an operational category set is theft-only (drives the map title).
export function isTheftOnly(categories: Iterable<string>): boolean {
  let any = false;
  for (const c of categories) {
    any = true;
    if (!THEFT_CATEGORIES.has(c)) return false;
  }
  return any;
}

// Below this many unique incidents the frequency matrix is not meaningful; the
// report lists the incidents individually in a compact box instead.
export const ACTIVITY_MATRIX_MIN_INCIDENTS = 3;

// Guard against a corrupt far-future date inflating the column count. The cargo
// window is ~30 days, so a real period is ~5 weeks; the cap never bites in
// practice but bounds the table width defensively.
export const ACTIVITY_MATRIX_MAX_WEEKS = 26;

// --- Operational-consequence scoring model (spec PAGE 6) ------------------
//
// Documented, configurable weights. Each unique incident earns a RAW score;
// the pattern's consequence is the MEAN of its members' normalised scores
// (raw / MAX_RAW_SCORE). This keeps consequence on a 0..1 scale independent of
// how many incidents a pattern holds (frequency is the separate matrix axis).
//
//   base            = severity rank (1..5) * SEVERITY_WEIGHT
//   confirmed loss  = +USD_HIGH_BONUS  (>= USD_HIGH_MIN, confirmed only)
//                     +USD_MID_BONUS   (USD_MID_MIN..USD_HIGH_MIN, confirmed)
//   violence/weapon = +VIOLENCE_BONUS
//   org-crime/insider = +ORG_INSIDER_BONUS
//   repeat route/facility = +REPEAT_BONUS
//   business interruption = +BUSINESS_INTERRUPTION_BONUS
//
// "Confirmed loss" means parseUsdLoss returned a figure (it is context-gated on
// theft/loss/value wording), so enforcement-only records with no stated loss
// never earn a USD bonus — satisfying the spec rule that enforcement records
// are not counted as losses unless a confirmed loss is present.
export const SEVERITY_WEIGHT = 2; // rank 1..5 -> 2..10
export const USD_HIGH_MIN = 100_000;
export const USD_MID_MIN = 10_000;
export const USD_HIGH_BONUS = 2;
export const USD_MID_BONUS = 1;
export const VIOLENCE_BONUS = 2;
export const ORG_INSIDER_BONUS = 1;
export const REPEAT_BONUS = 1;
export const BUSINESS_INTERRUPTION_BONUS = 1;

// Max raw = 10 (sev) + 2 (usd) + 2 (violence) + 1 (org/insider)
//         + 1 (repeat) + 1 (business interruption) = 17.
export const MAX_RAW_SCORE =
  5 * SEVERITY_WEIGHT +
  USD_HIGH_BONUS +
  VIOLENCE_BONUS +
  ORG_INSIDER_BONUS +
  REPEAT_BONUS +
  BUSINESS_INTERRUPTION_BONUS;

// Signal regexes owned here so the scoring model is fully self-documented.
export const VIOLENCE_RE =
  /\b(gun|guns|gunman|gunmen|armed|firearm|firearms|weapon|weapons|knife|knives|machete|parang|pistol|rifle|shot|shots|shoot\w*|assault\w*|violen\w*|beat\w*|stab\w*|ambush\w*|kidnap\w*|hostage|wounded|injured|killed|fatal|murder\w*|hijack\w*|robbery|robbed|raid\w*)\b/i;

export const ORG_CRIME_RE =
  /\b(syndicate|syndicates|organised crime|organized crime|cartel|gang|gangs|network|ring|mafia)\b/i;

export const INSIDER_RE =
  /\b(insider|inside job|collusion|colluded|complicit|connivance|driver collusion|staff collusion)\b/i;

export const BUSINESS_INTERRUPTION_RE =
  /\b(blockad\w*|barricad\w*|shut\s?down|shutdown|closure|closed|suspend\w*|halt\w*|disrupt\w*|strike|walkout|stoppage|standstill|gridlock|congestion|backlog)\b/i;

// --- Priority-matrix thresholds -------------------------------------------
//
// A pattern is HIGH consequence when its mean normalised score is at or above
// the mid-point of the scale, and HIGH frequency when its unique-incident
// count is at or above the mean pattern frequency (never below 2 — a single
// incident is not a "recurring" pattern). Both are documented and configurable.
export const CONSEQUENCE_HIGH_MIN = 0.5;
export const MATRIX_MIN_INCIDENTS = 3; // fewer -> matrix is not meaningful
export const MATRIX_MIN_PATTERNS = 2; // fewer distinct patterns -> not meaningful
// Cap on how many pattern points the matrix plots, to avoid clutter.
export const MATRIX_MAX_POINTS = 8;

// --- Pattern dashboard selection ------------------------------------------
//
// A category group qualifies as a "meaningful pattern" (dashboard card) when it
// has at least MIN_PATTERN_INCIDENTS unique incidents OR reaches at least
// PATTERN_SEVERITY_FLOOR severity rank (a lone but High/Extreme event still
// matters). At most MAX_PATTERN_CARDS cards are shown, ranked by total
// consequence weight (frequency x mean consequence).
export const MIN_PATTERN_INCIDENTS = 2;
// Peak High/Extreme still qualifies a lone incident as a pattern card, but the
// card's displayed severity is the MODAL tier among members (see pattern model)
// so the dashboard cannot contradict an executive summary that is mostly Moderate.
export const PATTERN_SEVERITY_FLOOR = 4; // High
export const MAX_PATTERN_CARDS = 4;
