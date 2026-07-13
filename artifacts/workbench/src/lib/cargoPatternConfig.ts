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
  | "staging_yard"
  | "port_terminal"
  | "maritime"
  | "enforcement";

// Fixed left-to-right order of the six supply-chain exposure stages
// (spec PAGE 3). Every in-scope incident maps to EXACTLY ONE stage so the
// stage counts sum to the total unique-incident count.
export const STAGE_ORDER: CargoStageKey[] = [
  "warehouse_depot",
  "inland_transport",
  "staging_yard",
  "port_terminal",
  "maritime",
  "enforcement",
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
      "Convoy protocols",
    ],
    watchNext: "Repeat hits on the same corridor, operator or load type.",
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
  enforcement: {
    label: "Cross-cutting or enforcement activity",
    primaryConcern: "Investigation follow-through and cargo recovery",
    controlAffected: [
      "Law-enforcement liaison",
      "Recovery follow-up",
      "Intelligence sharing",
    ],
    watchNext: "Whether disruption operations reduce repeat offending.",
  },
};

// Maps every classifier taxonomy label (see CARGO_CATEGORIES in cargoAnalysis)
// onto a single supply-chain stage. The floor label routes to the
// cross-cutting/enforcement stage so it never inflates a specific stage, and
// the sentinel "Not relevant" is mapped defensively (in-scope rows never carry
// it). Seizures sit under PORT AND TERMINAL (per spec); arrests/recovery/
// investigations sit under ENFORCEMENT.
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
  // Port-related (16).
  "Port armed robbery": "port_terminal",
  "Anchorage robbery / theft": "maritime",
  "Vessel boarding (robbery)": "maritime",
  "Theft from vessel at port": "port_terminal",
  "Theft from container at port / terminal": "port_terminal",
  "Port intrusion / trespass": "port_terminal",
  "Stowaway incident": "maritime",
  "Port-linked cargo smuggling": "port_terminal",
  "Narcotics seizure (cargo / port)": "port_terminal",
  "Weapons / contraband seizure (cargo / port)": "port_terminal",
  "Port sabotage / arson": "port_terminal",
  "Suspicious activity near port": "port_terminal",
  "Port-access blockade (cargo disruption)": "port_terminal",
  "Port labour unrest (cargo risk)": "port_terminal",
  "Truck park / access-road crime": "port_terminal",
  "Arrest of cargo crime group": "enforcement",
  // Floor + sentinel.
  [CARGO_FLOOR_LABEL]: "enforcement",
  [CARGO_NOT_RELEVANT]: "enforcement",
};

export function stageForCategory(category: string): CargoStageKey {
  return CATEGORY_TO_STAGE[category] ?? "enforcement";
}

// --- Weekly activity matrix (spec PAGE 5) ---------------------------------
//
// The Weekly Activity by Pattern matrix uses the six supply-chain stages as its
// rows. These row labels are held here (rather than reusing STAGE_META.label)
// so the enforcement row reads as the shorter "Enforcement activity" the spec
// asks for, without changing the supply-chain exposure card wording.
export const WEEKLY_PATTERN_ROW_LABEL: Record<CargoStageKey, string> = {
  warehouse_depot: "Warehouse and depot",
  inland_transport: "Inland transport",
  staging_yard: "Staging yard",
  port_terminal: "Port and terminal",
  maritime: "Maritime",
  enforcement: "Enforcement activity",
};

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
export const PATTERN_SEVERITY_FLOOR = 4; // High
export const MAX_PATTERN_CARDS = 4;
