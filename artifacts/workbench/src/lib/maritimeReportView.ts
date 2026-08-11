// Shared "view contract" for the Maritime Intelligence board as rendered by the
// Shipping Watch report on BOTH surfaces:
//   * the on-screen preview  (components/ShippingReportPreview.tsx)
//   * the exported PDF        (lib/exportShippingReportPdf.ts)
//
// The project has a hard screen == PDF rule. Historically the two surfaces each
// re-declared the executive KPI cards and section labels with their own string
// literals, and they silently drifted (the PDF once read "5 — Extreme" while the
// screen read "L5 · Extreme", and a middot went missing from "Confirmed
// Incidents · 7d"). Defining the labels/values/order ONCE here and having both
// surfaces consume them makes that class of drift impossible, and the parity
// test (maritimeReportParity.test.ts) locks these definitions against a fixture.

import { BOARD_CHOKEPOINTS, MARITIME_RISK_COLOR } from "./maritimeIntelligence";
import type { MaritimeIntelligence } from "./maritimeIntelligence";

/** Human label for the board confidence enum. Shared by preview + PDF. */
export const MARITIME_CONF_LABEL: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

/** Section heading for the whole Maritime Intelligence block. */
export const MARITIME_SECTION_TITLE = "Maritime Intelligence";

/**
 * The executive KPI cards, in display order. The PDF and the preview render
 * these exact label/value pairs. The `\u00b7` (·) and `\u2014` (—) are spelled
 * out so the strings are byte-identical across both surfaces.
 */
export interface MaritimeExecCard {
  label: string;
  value: string;
  /** Optional explicit accent-strip colour (overrides the severity ramp). */
  accent?: string;
}

export function maritimeExecCards(
  board: MaritimeIntelligence,
): MaritimeExecCard[] {
  const { risk, incidentSnapshot, chokepointsAffected } = board;
  const namedImpacts = board.businessImpact.filter(
    (b) => b !== "No material impact",
  );
  return [
    {
      label: "Maritime Risk Level",
      value: `L${risk.level} \u00b7 ${risk.label}`,
      // Accent strip corresponds to the displayed risk level (e.g. Extreme →
      // subdued red #A33232), matching the L-level chip/value colour.
      accent: MARITIME_RISK_COLOR[risk.level],
    },
    // "Chokepoint Incidents" — this board counts confirmed incidents AT THE
    // TRACKED STRAITS only, a subset of the report's canonical incident pool.
    // The label says so, so this card can never read as a rival total to the
    // Fast Facts "Confirmed Incidents" count.
    { label: "Chokepoint Incidents \u00b7 7d", value: String(incidentSnapshot.total) },
    {
      label: "Chokepoints Affected",
      // Denominator is the fixed number of tracked board chokepoints. Keeps the
      // KPI reading "X / 7".
      value: `${chokepointsAffected} / ${BOARD_CHOKEPOINTS.length}`,
    },
    {
      // A bare number ("Business Impact 8") explains nothing — say what is
      // being counted, and spell the unit in the value.
      label: "Business Impact Areas",
      value:
        namedImpacts.length > 0
          ? `${namedImpacts.length} affected`
          : "\u2014",
    },
  ];
}

/**
 * The three mid sub-sections rendered between the BLUF box and the Polestar
 * View, in order. Both surfaces draw these exact subtitles.
 */
export const MARITIME_SUBSECTION_ORDER = [
  "Chokepoint Cards",
  "Confirmed Maritime Incidents",
  "Maritime Context \u2014 Vessel Movement (AIS)",
] as const;

/** The four Polestar View sub-sections rendered on screen, in order. */
export const MARITIME_POLESTAR_SUBSECTIONS = [
  "Assessment",
  "Business Impact",
  "Confidence",
  "Watch Next",
] as const;

/**
 * The chokepoint card titles, in the board's display order — the seven tracked
 * board chokepoints. Both surfaces iterate `board.chokepointCards` so the keys
 * are inherently shared; this helper exists so the parity test can assert the
 * order in one place.
 */
export function maritimeChokepointTitles(
  board: MaritimeIntelligence,
): string[] {
  return board.chokepointCards.map((c) => c.key);
}
