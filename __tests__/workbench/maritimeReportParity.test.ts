import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  buildMaritimeIntelligence,
  BOARD_CHOKEPOINTS,
  type MaritimeIncidentInput,
} from "../../artifacts/workbench/src/lib/maritimeIntelligence";
import {
  MARITIME_CONF_LABEL,
  MARITIME_CHOKEPOINT_CARDS_TITLE,
  MARITIME_POLESTAR_SUBSECTIONS,
  MARITIME_SUBSECTION_ORDER,
  maritimeChokepointTitles,
  maritimeExecCards,
  maritimeReportChokepointCards,
  maritimeReportMovementTheatres,
  formatMaritimeMovementDate,
  formatMaritimeMovementSample,
} from "../../artifacts/workbench/src/lib/maritimeReportView";
import type {
  BusinessImpact,
  MovementTheatre,
} from "../../artifacts/workbench/src/lib/maritimeIntelligence";
import { semanticIncident } from "./maritimeSemanticTestHelpers";

// ---------------------------------------------------------------------------
// Screen == PDF parity guard for the Shipping Watch "Maritime Intelligence"
// board. The on-screen preview (ShippingReportPreview.tsx →
// MaritimeIntelligenceReportSection) and the exported PDF
// (exportShippingReportPdf.ts → drawMaritimeIntelligence) BOTH render the exec
// KPI cards, sub-section subtitles and Polestar sub-sections from the SINGLE
// shared view contract in lib/maritimeReportView.ts.
//
// This test locks that contract against a fixed incident fixture, so the moment
// either surface drifts (e.g. the historical "5 — Extreme" vs "L5 · Extreme"
// regression, or the dropped middot in "Confirmed Incidents · 7d") the build
// fails. Two further source-level assertions prove neither surface has gone
// back to inlining its own literals instead of consuming the shared module.
// ---------------------------------------------------------------------------

const MIDDOT = "\u00b7"; // ·
const EMDASH = "\u2014"; // —

// A fixed fixture: a kinetic Hormuz attack with casualties plus a Red Sea
// drone strike, both inside the window and phrased so the strict vessel
// classifier confirms them ("Missile struck a tanker" / "Drone struck a
// vessel") — enough to push risk above L1 and mark chokepoints affected, so the
// exec cards carry non-trivial values. Both name BOARD chokepoints, so both are
// in scope (the second describe covers off-board exclusion).
const WINDOW_END = new Date("2026-06-18T00:00:00.000Z");
const WINDOW_START = new Date("2026-06-11T00:00:00.000Z");

const FIXTURE: MaritimeIncidentInput[] = [
  semanticIncident(1, "Missile struck a tanker in the Strait of Hormuz, two crew killed", {
    eventClass: "commercial_attack",
    severity: "extreme",
    country: "Iran",
    physicalLocation: "Strait of Hormuz",
    physicalLocationEvidence: "Missile struck a tanker in the Strait of Hormuz, two crew killed",
    routeRelationship: {
      kind: "physical",
      routeName: "Strait of Hormuz",
      evidence: "Missile struck a tanker in the Strait of Hormuz, two crew killed",
    },
  }),
  semanticIncident(2, "Drone struck a vessel in the Red Sea", {
    eventClass: "drone_activity",
    commercialTargetValidated: true,
    commercialTarget: "vessel",
    commercialTargetName: "Test vessel",
    commercialTargetEvidence: "Drone struck a vessel in the Red Sea",
    severity: "high",
    country: "Yemen",
    physicalLocation: "Red Sea",
    physicalLocationEvidence: "Drone struck a vessel in the Red Sea",
    routeRelationship: {
      kind: "physical",
      routeName: "Red Sea",
      evidence: "Drone struck a vessel in the Red Sea",
    },
  }),
  // A non-shipping row that must be ignored by the builder (topic scope).
  {
    id: 3,
    title: "Unrelated protest in Jakarta",
    severity: "low",
    occurredAt: "2026-06-15T08:00:00.000Z",
    country: "Indonesia",
    topic: "flashpoint",
  },
];

function buildFixtureBoard() {
  return buildMaritimeIntelligence({
    incidents: FIXTURE,
    movement: [],
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
  });
}

describe("Maritime Intelligence shared view contract (screen == PDF)", () => {
  const board = buildFixtureBoard();

  it("builds the populated exec KPI cards in the correct order with the right labels", () => {
    const cards = maritimeExecCards(board);
    expect(cards.map((c) => c.label)).toEqual([
      "Maritime Risk Level",
      `Confirmed Maritime Incidents ${MIDDOT} 7d`,
      "Chokepoints Affected",
    ]);
  });

  it("formats the Maritime Risk value as 'L{n} · {label}', never '{n} — {label}'", () => {
    const [riskCard] = maritimeExecCards(board);
    // Regression guard for the PDF "5 — Extreme" vs screen "L5 · Extreme" drift.
    expect(riskCard.value).toMatch(/^L[1-5] \u00b7 .+$/);
    expect(riskCard.value).toBe(`L${board.risk.level} ${MIDDOT} ${board.risk.label}`);
    expect(riskCard.value).not.toContain(EMDASH);
  });

  it("uses a neutral pending card without leaking placeholder L1 or severity colour", () => {
    const pending = maritimeExecCards(
      {
        ...board,
        risk: { ...board.risk, level: 1, label: "Assessment pending" },
        overallRisk: { ...board.overallRisk, level: 1, label: "Assessment pending" },
      },
      { complete: false, assessmentLabel: "Assessment pending" },
    )[0];
    expect(pending.value).toBe("Assessment pending");
    expect(pending.value).not.toContain("L1");
    expect(pending.accent).toBeUndefined();
  });

  it("keeps the middot in the 'Confirmed Maritime Incidents · 7d' label", () => {
    const confirmedCard = maritimeExecCards(board)[1];
    expect(confirmedCard.label).toContain(MIDDOT);
    expect(confirmedCard.value).toBe(String(board.incidentSnapshot.total));
  });

  it("reports Chokepoints Affected as 'affected / total board chokepoints'", () => {
    const card = maritimeExecCards(board)[2];
    // Denominator is the fixed board-chokepoint count (there are always exactly
    // seven cards, since off-board incidents are excluded from the report).
    expect(card.value).toBe(
      `${board.chokepointsAffected} / ${BOARD_CHOKEPOINTS.length}`,
    );
  });

  it("omits an empty Business Impact card and labels populated impact areas", () => {
    expect(maritimeExecCards(board).some((card) => card.label === "Business Impact Areas")).toBe(false);
    const populated = maritimeExecCards({
      ...board,
      businessImpact: ["Transit delay risk"] as BusinessImpact[],
    });
    expect(populated.find((card) => card.label === "Business Impact Areas")?.value).toBe("1 affected");
  });

  it("produces a non-empty BLUF", () => {
    expect(board.bluf.trim().length).toBeGreaterThan(0);
  });

  it("lists the seven chokepoint card titles in BOARD order", () => {
    expect(maritimeChokepointTitles(board)).toEqual(BOARD_CHOKEPOINTS);
    expect(maritimeChokepointTitles(board)).toHaveLength(7);
  });

  it("locks the populated mid sub-sections, in order", () => {
    expect([...MARITIME_SUBSECTION_ORDER]).toEqual([
      "Confirmed Maritime Incidents",
      `Maritime Context ${EMDASH} Vessel Movement (AIS)`,
    ]);
    expect(MARITIME_CHOKEPOINT_CARDS_TITLE).toBe("Chokepoint Cards");
  });

  it("locks the four Polestar View sub-sections, in order", () => {
    expect([...MARITIME_POLESTAR_SUBSECTIONS]).toEqual([
      "Assessment",
      "Business Impact",
      "Confidence",
      "Watch Next",
    ]);
  });

  it("exposes a shared confidence label map", () => {
    expect(MARITIME_CONF_LABEL).toEqual({
      low: "Low",
      medium: "Medium",
      high: "High",
    });
  });
});

describe("Maritime report surfaces remove empty cards and bound AIS movement", () => {
  const movement = (theatre: string, dataAsOf: string, totalVessels: number): MovementTheatre => ({
    theatre,
    chokepoint: theatre,
    dataAsOf,
    totalVessels,
    inboundCount: 10,
    outboundCount: 8,
    tankersCount: null,
    bulkCarriersCount: null,
    containerCount: null,
    lngLpgCount: null,
    anchoredOrWaitingCount: 2,
    aisVisibleCount: null,
    aisDarkOrGapCount: null,
    changeVs7DayBaseline: null,
    confidence: "high",
    sourceName: "Test AIS",
    sourceUrl: null,
    notes: null,
  });

  it("keeps one latest dated movement sample per theatre before report end", () => {
    const board = {
      ...buildFixtureBoard(),
      movementSnapshot: {
        theatres: [
          movement("Red Sea", "2026-06-12T00:00:00.000Z", 40),
          movement("Red Sea", "2026-06-17T00:00:00.000Z", 42),
          movement("Red Sea", "2026-06-19T00:00:00.000Z", 99),
          movement("Hormuz", "2026-06-16T00:00:00.000Z", 20),
        ],
        asOf: "2026-06-19T00:00:00.000Z",
        sourceName: "Test AIS",
        confidence: "high" as const,
      },
    };
    const theatres = maritimeReportMovementTheatres(board);
    expect(theatres.map((row) => [row.theatre, row.dataAsOf, row.totalVessels])).toEqual([
      ["Hormuz", "2026-06-16T00:00:00.000Z", 20],
      ["Red Sea", "2026-06-17T00:00:00.000Z", 42],
    ]);
    expect(formatMaritimeMovementDate(theatres[1].dataAsOf)).toBe("17 Jun 2026");
    expect(formatMaritimeMovementSample(theatres[1])).toContain("AIS sample: 42 vessels");
    expect(formatMaritimeMovementSample(theatres[1])).not.toContain("vessels tracked");
  });

  it("returns only incident-bearing chokepoint cards", () => {
    const cards = maritimeReportChokepointCards(buildFixtureBoard());
    expect(cards.map((card) => card.key)).toEqual([
      "Strait of Hormuz",
      "Red Sea",
    ]);
    expect(maritimeReportChokepointCards({
      ...buildFixtureBoard(),
      chokepointCards: buildFixtureBoard().chokepointCards.map((card) => ({
        ...card,
        incidentCount: 0,
      })),
    })).toEqual([]);
  });
});

describe("Off-board validated route evidence remains separate from board cards", () => {
  // A single confirmed kinetic incident whose ONLY chokepoint is a NON-board
  // strait ("Arabian / Persian Gulf" is in the detection vocabulary but is not
  // its own card). It remains part of the canonical incident/risk picture,
  // while the seven fixed board cards remain zero.
  const OFF_BOARD_FIXTURE: MaritimeIncidentInput[] = [
    semanticIncident(10, "Missile struck a tanker in the Persian Gulf, two crew killed", {
      eventClass: "commercial_attack",
      severity: "extreme",
      country: "Iran",
      physicalLocation: "Persian Gulf",
      physicalLocationEvidence: "Missile struck a tanker in the Persian Gulf, two crew killed",
      routeRelationship: {
        kind: "physical",
        routeName: "Arabian / Persian Gulf",
        evidence: "Missile struck a tanker in the Persian Gulf, two crew killed",
      },
    }),
  ];
  const board = buildMaritimeIntelligence({
    incidents: OFF_BOARD_FIXTURE,
    movement: [],
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
  });

  it("renders exactly the seven board cards and no wider-waters bucket", () => {
    expect(maritimeChokepointTitles(board)).toEqual(BOARD_CHOKEPOINTS);
    expect(board.chokepointCards).toHaveLength(BOARD_CHOKEPOINTS.length);
  });

  it("keeps the off-board incident in the validated confirmed set", () => {
    expect(board.incidentSnapshot.total).toBe(1);
    expect(board.confirmedIncidents).toHaveLength(1);
  });

  it("does not assign the off-board incident to a tracked route card", () => {
    expect(board.risk.level).toBe(4);
    expect(board.chokepointCards.every((c) => c.incidentCount === 0)).toBe(true);
  });

  it("keeps tracked 'Chokepoints Affected' at 0 / 7", () => {
    expect(board.chokepointsAffected).toBe(0);
    const affectedCard = maritimeExecCards(board)[2];
    expect(affectedCard.value).toBe(`0 / ${BOARD_CHOKEPOINTS.length}`);
  });

  it("scopes the empty-week BLUF to tracked chokepoints, not an absolute negative", () => {
    expect(board.risk.level).toBe(4);
    expect(board.bluf).not.toContain("No validated maritime incidents");
  });
});

describe("Both surfaces consume the shared contract (no re-inlined literals)", () => {
  const root = resolve(__dirname, "../../artifacts/workbench/src");
  const pdfSrc = readFileSync(
    resolve(root, "lib/exportShippingReportPdf.ts"),
    "utf8",
  );
  const previewSrc = readFileSync(
    resolve(root, "components/ShippingReportPreview.tsx"),
    "utf8",
  );

  it("the PDF exporter imports and uses the shared exec-card builder", () => {
    expect(pdfSrc).toContain("maritimeReportView");
    expect(pdfSrc).toContain("maritimeExecCards(board, completeness)");
  });

  it("the preview imports and uses the shared exec-card builder", () => {
    expect(previewSrc).toContain("maritimeReportView");
    expect(previewSrc).toContain("maritimeExecCards(board, completeness)");
  });

  it("both surfaces use the shared populated-card and movement projection", () => {
    for (const source of [pdfSrc, previewSrc]) {
      expect(source).toContain("maritimeReportChokepointCards(board)");
      expect(source).toContain("maritimeReportMovementTheatres(board)");
      expect(source).toContain("formatMaritimeMovementSample");
    }
  });

  it("neither surface re-declares its own MARITIME_CONF_LABEL", () => {
    expect(pdfSrc).not.toMatch(/const MARITIME_CONF_LABEL\s*[:=]/);
    expect(previewSrc).not.toMatch(/const MARITIME_CONF_LABEL\s*[:=]/);
  });

  it("neither surface re-inlines the exec-card literal array", () => {
    // The drift bugs lived in these inline literals; they must now only exist
    // in the shared maritimeReportView module.
    expect(pdfSrc).not.toContain('label: "Maritime Risk Level"');
    expect(previewSrc).not.toContain('label: "Maritime Risk Level"');
  });
});

// ---------------------------------------------------------------------------
// Font proof. The brand spec forbids any non-Roboto font being SELECTED via a
// Tf operator in the exported PDF. A real Tf-inventory can only be produced by
// the documented headless export (see replit.md "Gotchas"):
//
//   cd artifacts/workbench && REPORT_ID=<id> TOPIC=shipping \
//     OUT_PATH=<abs.pdf> npx tsx --import ./scripts/registerLoader.mjs \
//     scripts/exportReportPdfHeadless.ts
//   # then re-run the per-page Tf audit that writes screenshots/font_proof/FONT_AUDIT.txt
//
// This lightweight test asserts the committed proof shows only Roboto fonts
// used, so a regression in that proof (or its accidental deletion) fails CI.
// ---------------------------------------------------------------------------
describe("PDF font proof (only Roboto selected via Tf)", () => {
  const auditPath = resolve(
    __dirname,
    "../../artifacts/workbench/screenshots/font_proof/FONT_AUDIT.txt",
  );
  const audit = readFileSync(auditPath, "utf8");

  it("records every audited report as PASS with no non-Roboto font", () => {
    expect(audit).toContain("NON-Roboto used: NONE \u2014 PASS");
    expect(audit).not.toContain("NON-Roboto used: ['");
  });

  it("only ever lists Roboto faces in the 'fonts USED via Tf' summaries", () => {
    const summaries = audit.match(/ALL fonts USED via Tf: \[[^\]]*\]/g) ?? [];
    expect(summaries.length).toBeGreaterThan(0);
    for (const line of summaries) {
      const faces = line.match(/'([^']+)'/g) ?? [];
      for (const face of faces) {
        expect(face).toMatch(/^'Roboto/);
      }
    }
  });
});
