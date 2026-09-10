// Shared "view contract" for the Maritime Intelligence board as rendered by the
// Shipping Watch report on BOTH surfaces:
//   * the on-screen preview  (components/ShippingReportPreview.tsx)
//   * the exported PDF        (lib/exportShippingReportPdf.ts)
//
// The project has a hard screen == PDF rule. Historically the two surfaces each
// re-declared the executive KPI cards and section labels with their own string
// literals, and they silently drifted (the PDF once read "5 — Extreme" while the
// screen read "L5 · Extreme", and a middot went missing from "Confirmed
// Maritime Incidents · 7d"). Defining the labels/values/order ONCE here and having both
// surfaces consume them makes that class of drift impossible, and the parity
// test (maritimeReportParity.test.ts) locks these definitions against a fixture.

import { format, parseISO } from "date-fns";
import {
  BOARD_CHOKEPOINTS,
  MARITIME_RISK_COLOR,
} from "./maritimeIntelligence";
import type {
  ChokepointCard,
  MaritimeIntelligence,
  MovementTheatre,
} from "./maritimeIntelligence";

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

export interface MaritimeReportCompleteness {
  complete: boolean;
  assessmentLabel?: string | null;
  disclosure?: string | null;
}

export const MARITIME_COVERAGE_STATUS_LABEL = "Assessment pending";

export function maritimeExecCards(
  board: MaritimeIntelligence,
  completeness?: MaritimeReportCompleteness | null,
): MaritimeExecCard[] {
  const { risk, incidentSnapshot, chokepointsAffected } = board;
  // Incomplete coverage deliberately uses level 1 internally as a neutral
  // placeholder. Never leak that implementation value or its Insignificant
  // colour into a client-facing report.
  const assessmentPending =
    completeness?.complete === false ||
    completeness?.assessmentLabel === MARITIME_COVERAGE_STATUS_LABEL ||
    risk.label === MARITIME_COVERAGE_STATUS_LABEL ||
    board.overallRisk.label === MARITIME_COVERAGE_STATUS_LABEL;
  const namedImpacts = board.businessImpact.filter(
    (impact) => impact !== "No material impact",
  );
  const cards: MaritimeExecCard[] = [
    {
      label: "Maritime Risk Level",
      value: assessmentPending
        ? MARITIME_COVERAGE_STATUS_LABEL
        : `L${risk.level} \u00b7 ${risk.label}`,
      // A pending assessment intentionally has no severity accent. Both
      // renderers fall back to the neutral brand accent instead.
      ...(assessmentPending
        ? {}
        : {
            // Accent strip corresponds to the displayed risk level (e.g.
            // Extreme → subdued red #A33232), matching the L-level value.
            accent: MARITIME_RISK_COLOR[risk.level],
          }),
    },
    // This is the global maritime count, not a chokepoint-only subset. Naming
    // it explicitly prevents the KPI from being mistaken for a second route
    // count beside the Fast Facts "Confirmed Incidents" figure.
    {
      label: "Confirmed Maritime Incidents \u00b7 7d",
      value: String(incidentSnapshot.total),
    },
    {
      label: "Chokepoints Affected",
      // Denominator is the fixed number of tracked board chokepoints. Keeps the
      // KPI reading "X / 7".
      value: `${chokepointsAffected} / ${BOARD_CHOKEPOINTS.length}`,
    },
  ];
  // Do not ship an empty KPI card. A dash-labelled Business Impact card made
  // the report look as though an impact assessment had been omitted.
  if (namedImpacts.length > 0) {
    cards.push({
      label: "Business Impact Areas",
      value: `${namedImpacts.length} affected`,
    });
  }
  return cards;
}

/**
 * The populated mid sub-sections rendered between the BLUF box and the
 * Polestar View, in order. Empty sections are omitted by both surfaces.
 */
export const MARITIME_SUBSECTION_ORDER = [
  "Confirmed Maritime Incidents",
  "Maritime Context \u2014 Vessel Movement (AIS)",
] as const;

export const MARITIME_CHOKEPOINT_CARDS_TITLE = "Chokepoint Cards";

/**
 * Return only populated chokepoint cards for the report. The live board keeps
 * all seven tracked routes so analysts can see zeros, but a client report
 * should not spend a heading and seven empty cards on that internal shape.
 *
 * Movement is replaced with the same latest-per-theatre, report-window-bounded
 * snapshot used by the movement subsection. This prevents an old or future
 * AIS row from leaking into a current report card.
 */
export function maritimeReportChokepointCards(
  board: MaritimeIntelligence,
): ChokepointCard[] {
  const theatres = maritimeReportMovementTheatres(board);
  const findMovement = (key: string): MovementTheatre | null => {
    const normalized = key.toLowerCase();
    return (
      theatres.find((theatre) => {
        const name = theatre.theatre.toLowerCase();
        const chokepoint = (theatre.chokepoint ?? "").toLowerCase();
        return (
          name.includes(normalized) ||
          normalized.includes(name) ||
          (chokepoint &&
            (chokepoint.includes(normalized) ||
              normalized.includes(chokepoint)))
        );
      }) ?? null
    );
  };

  return board.chokepointCards
    .filter((card) => card.incidentCount > 0)
    .map((card) => ({
      ...card,
      risk: board.risk.label === "Assessment pending"
        ? { ...card.risk, label: "Assessment pending" }
        : card.risk,
      movement: findMovement(card.key),
    }));
}

/**
 * Collapse the movement rows already attached to the board into one latest
 * dated observation per theatre. The publication finalizer supplies the
 * report window end, so rows collected after the issue date are excluded even
 * when the API returned them in the same response.
 */
export function maritimeReportMovementTheatres(
  board: MaritimeIntelligence,
): MovementTheatre[] {
  const source = board.movementSnapshot?.theatres ?? [];
  const cutoff = board.windowEnd.getTime();
  const latest = new Map<string, { theatre: MovementTheatre; time: number }>();

  for (const theatre of source) {
    const time = Date.parse(theatre.dataAsOf);
    if (!Number.isFinite(time) || (Number.isFinite(cutoff) && time > cutoff)) {
      continue;
    }
    const key = theatre.theatre.trim().toLowerCase();
    if (!key) continue;
    const previous = latest.get(key);
    if (!previous || time > previous.time) {
      latest.set(key, { theatre, time });
    }
  }

  return [...latest.values()]
    .sort((a, b) => a.theatre.theatre.localeCompare(b.theatre.theatre))
    .map(({ theatre }) => theatre);
}

/** Human-readable date shared by the report preview and PDF. */
export function formatMaritimeMovementDate(dataAsOf: string): string {
  try {
    const date = parseISO(dataAsOf);
    return Number.isNaN(date.getTime())
      ? dataAsOf
      : format(date, "dd MMM yyyy");
  } catch {
    return dataAsOf;
  }
}

/**
 * Compact, explicitly scoped movement wording for client reports. These are
 * AIS sample observations, not a traffic total or an incident count.
 */
export function formatMaritimeMovementSample(t: MovementTheatre): string {
  const parts: string[] = [];
  parts.push(
    t.totalVessels != null
      ? `AIS sample: ${t.totalVessels} vessels`
      : "AIS sample size unavailable",
  );
  if (t.inboundCount != null && t.outboundCount != null) {
    parts.push(`${t.inboundCount} inbound / ${t.outboundCount} outbound`);
  }
  if (t.anchoredOrWaitingCount != null) {
    parts.push(`${t.anchoredOrWaitingCount} anchored or waiting`);
  }
  // Historical gap/baseline counters are not denominators of this snapshot.
  // Comparing them to the current sample produces impossible ratios.
  return parts.join(" \u00b7 ");
}

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
