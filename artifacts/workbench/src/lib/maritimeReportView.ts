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
}

export function maritimeExecCards(
  board: MaritimeIntelligence,
): MaritimeExecCard[] {
  const { risk, incidentSnapshot, chokepointCards, chokepointsAffected } = board;
  const namedImpacts = board.businessImpact.filter(
    (b) => b !== "No material impact",
  );
  return [
    { label: "Maritime Risk Level", value: `L${risk.level} \u00b7 ${risk.label}` },
    { label: "Confirmed Incidents \u00b7 7d", value: String(incidentSnapshot.total) },
    {
      label: "Chokepoints Affected",
      value: `${chokepointsAffected} / ${chokepointCards.length}`,
    },
    {
      label: "Business Impact",
      value: namedImpacts.length > 0 ? String(namedImpacts.length) : "\u2014",
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
 * The six chokepoint card titles, in the board's display order. Both surfaces
 * iterate `board.chokepointCards` so the keys are inherently shared; this helper
 * exists so the parity test can assert the order in one place.
 */
export function maritimeChokepointTitles(
  board: MaritimeIntelligence,
): string[] {
  return board.chokepointCards.map((c) => c.key);
}
