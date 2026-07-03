import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  buildMaritimeIntelligence,
  BOARD_CHOKEPOINTS,
  WIDER_WATERS_KEY,
  type MaritimeIncidentInput,
} from "../../artifacts/workbench/src/lib/maritimeIntelligence";
import {
  MARITIME_CONF_LABEL,
  MARITIME_POLESTAR_SUBSECTIONS,
  MARITIME_SUBSECTION_ORDER,
  maritimeChokepointTitles,
  maritimeExecCards,
} from "../../artifacts/workbench/src/lib/maritimeReportView";

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
// exec cards carry non-trivial values. Both name BOARD chokepoints, so no
// wider-waters bucket is appended here (the second describe covers that).
const WINDOW_END = new Date("2026-06-18T00:00:00.000Z");
const WINDOW_START = new Date("2026-06-11T00:00:00.000Z");

const FIXTURE: MaritimeIncidentInput[] = [
  {
    id: 1,
    title: "Missile struck a tanker in the Strait of Hormuz, two crew killed",
    severity: "extreme",
    occurredAt: "2026-06-16T08:00:00.000Z",
    country: "Iran",
    source: "Reuters",
    sourceUrl: "https://example.com/hormuz",
    topic: "shipping",
  },
  {
    id: 2,
    title: "Drone struck a vessel in the Red Sea",
    severity: "high",
    occurredAt: "2026-06-14T08:00:00.000Z",
    country: "Yemen",
    source: "gCaptain",
    sourceUrl: "https://example.com/redsea",
    topic: "shipping",
  },
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

  it("builds the four exec KPI cards in the correct order with the right labels", () => {
    const cards = maritimeExecCards(board);
    expect(cards.map((c) => c.label)).toEqual([
      "Maritime Risk Level",
      `Confirmed Incidents ${MIDDOT} 7d`,
      "Chokepoints Affected",
      "Business Impact",
    ]);
  });

  it("formats the Maritime Risk value as 'L{n} · {label}', never '{n} — {label}'", () => {
    const [riskCard] = maritimeExecCards(board);
    // Regression guard for the PDF "5 — Extreme" vs screen "L5 · Extreme" drift.
    expect(riskCard.value).toMatch(/^L[1-5] \u00b7 .+$/);
    expect(riskCard.value).toBe(`L${board.risk.level} ${MIDDOT} ${board.risk.label}`);
    expect(riskCard.value).not.toContain(EMDASH);
  });

  it("keeps the middot in the 'Confirmed Incidents · 7d' label", () => {
    const confirmedCard = maritimeExecCards(board)[1];
    expect(confirmedCard.label).toContain(MIDDOT);
    expect(confirmedCard.value).toBe(String(board.incidentSnapshot.total));
  });

  it("reports Chokepoints Affected as 'affected / total board chokepoints'", () => {
    const card = maritimeExecCards(board)[2];
    // Denominator is the fixed board-chokepoint count, never chokepointCards.length
    // (which grows when the wider-waters reconciliation bucket is appended).
    expect(card.value).toBe(
      `${board.chokepointsAffected} / ${BOARD_CHOKEPOINTS.length}`,
    );
  });

  it("reports Business Impact as a count, or an em-dash when none", () => {
    const named = board.businessImpact.filter((b) => b !== "No material impact");
    const card = maritimeExecCards(board)[3];
    expect(card.value).toBe(named.length > 0 ? String(named.length) : EMDASH);
  });

  it("produces a non-empty BLUF", () => {
    expect(board.bluf.trim().length).toBeGreaterThan(0);
  });

  it("lists the seven chokepoint card titles in BOARD order", () => {
    expect(maritimeChokepointTitles(board)).toEqual(BOARD_CHOKEPOINTS);
    expect(maritimeChokepointTitles(board)).toHaveLength(7);
  });

  it("locks the three mid sub-sections, in order", () => {
    expect([...MARITIME_SUBSECTION_ORDER]).toEqual([
      "Chokepoint Cards",
      "Confirmed Maritime Incidents",
      `Maritime Context ${EMDASH} Vessel Movement (AIS)`,
    ]);
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

describe("Maritime board reconciliation bucket (no 'Extreme over zeros')", () => {
  // A single confirmed kinetic incident whose ONLY chokepoint is a NON-board
  // strait ("Arabian / Persian Gulf" is in the detection vocabulary but is not
  // its own card; the country stays Iran so it passes the Middle-East scope
  // gate). Its extreme severity drives the overall risk to L5, so without the
  // reconciliation bucket the board would read "Extreme" over seven zero cards —
  // the exact defect the owner reported. Because it names a chokepoint (just not
  // a board one), it also proves the predicate is "no BOARD chokepoint", not the
  // naive "no chokepoint at all".
  const OFF_BOARD_FIXTURE: MaritimeIncidentInput[] = [
    {
      id: 10,
      title: "Missile struck a tanker in the Persian Gulf, two crew killed",
      severity: "extreme",
      occurredAt: "2026-06-16T08:00:00.000Z",
      country: "Iran",
      source: "Reuters",
      sourceUrl: "https://example.com/persian-gulf",
      topic: "shipping",
    },
  ];
  const board = buildMaritimeIntelligence({
    incidents: OFF_BOARD_FIXTURE,
    movement: [],
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
  });

  it("routes an off-board confirmed kinetic incident into the wider-waters bucket", () => {
    const bucket = board.chokepointCards.find((c) => c.key === WIDER_WATERS_KEY);
    expect(bucket).toBeDefined();
    expect(bucket?.incidentCount).toBeGreaterThanOrEqual(1);
  });

  it("appends the bucket strictly last, leaving the seven board cards intact", () => {
    const keys = board.chokepointCards.map((c) => c.key);
    expect(keys.slice(0, BOARD_CHOKEPOINTS.length)).toEqual(BOARD_CHOKEPOINTS);
    expect(keys[keys.length - 1]).toBe(WIDER_WATERS_KEY);
  });

  it("never shows an elevated overall risk over an all-zero chokepoint grid", () => {
    // Core invariant (coverage, not sum): if the board risk is High or above,
    // at least one card MUST carry a confirmed incident.
    expect(board.risk.level).toBe(5);
    if (board.risk.level >= 4) {
      expect(board.chokepointCards.some((c) => c.incidentCount > 0)).toBe(true);
    }
  });

  it("keeps 'Chokepoints Affected' scoped to named board cards (off-board excluded)", () => {
    // The off-board incident must NOT inflate the tracked-chokepoint KPI.
    expect(board.chokepointsAffected).toBe(0);
    const affectedCard = maritimeExecCards(board)[2];
    expect(affectedCard.value).toBe(`0 / ${BOARD_CHOKEPOINTS.length}`);
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
    expect(pdfSrc).toContain("maritimeExecCards(board)");
  });

  it("the preview imports and uses the shared exec-card builder", () => {
    expect(previewSrc).toContain("maritimeReportView");
    expect(previewSrc).toContain("maritimeExecCards(board)");
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
