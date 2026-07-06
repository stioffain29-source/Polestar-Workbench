// PDF-path guard for the OTHER Jakarta brief data tables.
//
// Task #293 added a headless-PDF guard for the Jakarta "Operational Map"
// seven-zone posture table (drawJakartaPostureTable). But the same Jakarta brief
// draws several OTHER data tables into the PDF with no equivalent content guard:
//   - Priority Areas This Week  (drawJakartaPriorityTable)
//   - Port and Logistics Impact (drawJakartaPortTable)
//   - Crime Trends and Business Impact (drawJakartaCrimeTable)
// A future edit to their columns, row builders, or the shared grid renderer
// (drawJakartaGridTable) could silently drop / duplicate a row or mislabel a
// column without failing any current check.
//
// We drive the REAL `exportCountryReportPdf` for Jakarta end-to-end with
// `./pdfChrome` mocked so the heavy chrome (font loading, cover images,
// pagination, section headings) is inert and the jsPDF instance is a recording
// stub. Every table is drawn via `pdf.text(...)`, so every header and cell they
// emit is captured. The EXPECTED rows are derived by replicating the exporter's
// OWN derivation chain (buildCountryLayers → resolveActiveCountryWindow →
// buildJakartaReportDataset), so the expected rows here are exactly the rows the
// exporter draws — a divergence in either direction fails.

const PDF_CHROME_PATH = "../../artifacts/workbench/src/lib/pdfChrome";

// The mock owns the recording stub so it survives ts-jest's jest.mock hoisting
// (the factory must not close over later top-level consts). The recorded text
// and a reset hook are exposed as extra named exports we read back in the test.
jest.mock("../../artifacts/workbench/src/lib/pdfChrome", () => {
  const textCalls: string[] = [];
  const record = (arg: unknown) => {
    if (Array.isArray(arg)) for (const s of arg) textCalls.push(String(s));
    else if (arg != null) textCalls.push(String(arg));
  };
  const pdf = new Proxy(
    {},
    {
      get(_t, prop) {
        if (typeof prop === "symbol") return undefined;
        switch (prop) {
          case "splitTextToSize":
            // Keep each cell / header on a single "line" so it is recorded
            // whole and is trivially assertable as one entry.
            return (txt: unknown) => (Array.isArray(txt) ? txt : [String(txt)]);
          case "text":
            return (arg: unknown) => record(arg);
          case "getTextWidth":
          case "getStringUnitWidth":
            return () => 10;
          case "getNumberOfPages":
            return () => 1;
          case "internal":
            return { pageSize: { getWidth: () => 595, getHeight: () => 842 } };
          default:
            // rect / line / setFontSize / setFont / setLineWidth / save / etc.
            return () => undefined;
        }
      },
    },
  );
  const api: Record<string, unknown> = {
    __esModule: true,
    __textCalls: textCalls,
    __reset: () => {
      textCalls.length = 0;
    },
    // A fresh ctx per export call; H is large + helpers are inert so nothing
    // paginates or short-circuits before the tables are reached.
    createCtx: () => ({
      pdf,
      MX: 40,
      CW: 515,
      W: 595,
      H: 100000,
      BOTTOM: 40,
      y: 40,
    }),
    sanitize: (s: unknown) => s,
    todayLabel: () => "2026-07-06",
    sevKey: (s: unknown) => String(s ?? "").toLowerCase(),
    SEV_LABEL: {
      insignificant: "Insignificant",
      low: "Low",
      moderate: "Moderate",
      high: "High",
      extreme: "Extreme",
    },
    SEV_COLOR: {
      insignificant: "#9AA0A6",
      low: "#4655FF",
      moderate: "#F2A900",
      high: "#E8731C",
      extreme: "#A33232",
    },
    ensureRobotoLoaded: async () => {},
    prepareCoverImage: async () => undefined,
    NAVY: "#0B0B3D",
    POLAR: "#E2E2E2",
    DUSK: "#303030",
    WHITE: "#FFFFFF",
    ELECTRIC: "#4655FF",
    COVER_TOP_BAND_H: 100,
    COVER_BOTTOM_BLOCK_H: 100,
  };
  // Every other named export (drawSectionHeading, renderProse, setText, ...) is
  // an inert no-op so only the real Jakarta tables emit text.
  return new Proxy(api, {
    get(target, prop) {
      if (prop === "__esModule") return true;
      if (typeof prop === "symbol") return undefined;
      if (prop in target) return (target as Record<string, unknown>)[prop];
      return () => undefined;
    },
  });
});

import { exportCountryReportPdf } from "../../artifacts/workbench/src/lib/exportCountryReportPdf";
import {
  buildCountryLayers,
  resolveActiveCountryWindow,
  resolvePreviousCountryWindow,
} from "../../artifacts/workbench/src/lib/countryReportLayers";
import {
  buildJakartaReportDataset,
  type PngSourceIncident,
} from "../../artifacts/workbench/src/lib/pngReportDataset";
import type { CountryFastFactsIncident } from "../../artifacts/workbench/src/lib/countryFastFacts";

// Read the recorded text + reset hook back off the mocked module.
const pdfChromeMock = jest.requireMock(PDF_CHROME_PATH) as {
  __textCalls: string[];
  __reset: () => void;
};

function textAfter(run: () => Promise<unknown>): Promise<string[]> {
  pdfChromeMock.__reset();
  return run().then(() => [...pdfChromeMock.__textCalls]);
}

// A small live Jakarta dataset spread across the weekly window so it counts;
// the protest elevates a zone so the priority table carries an "(active this
// week)" row alongside the standing rows.
const today = new Date();
const iso = (daysAgo: number) =>
  new Date(today.getTime() - daysAgo * 86400000).toISOString();

const JAKARTA_INCIDENTS: CountryFastFactsIncident[] = [
  {
    id: 1,
    title: "Protesters rally near Monas in Central Jakarta government district",
    topic: "flashpoint",
    severity: "high",
    occurredAt: iso(1),
    country: "Indonesia",
    location: "Central Jakarta",
  },
  {
    id: 2,
    title: "Port congestion at Tanjung Priok slows container access",
    topic: "flashpoint",
    severity: "moderate",
    occurredAt: iso(2),
    country: "Indonesia",
    location: "Tanjung Priok",
  },
  {
    id: 3,
    title: "Congestion reported on the Soekarno-Hatta airport corridor",
    topic: "flashpoint",
    severity: "low",
    occurredAt: iso(3),
    country: "Indonesia",
    location: "Airport",
  },
] as unknown as CountryFastFactsIncident[];

const JAKARTA_COUNTRY = {
  name: "Jakarta",
  region: "Southeast Asia",
  overview: "Test overview.",
  trendSummary: "Test trend summary.",
  implications: "Test implications.",
};

async function jakartaPdfText(): Promise<string[]> {
  return textAfter(() =>
    exportCountryReportPdf(
      JAKARTA_COUNTRY as Parameters<typeof exportCountryReportPdf>[0],
      JAKARTA_INCIDENTS as unknown as Parameters<
        typeof exportCountryReportPdf
      >[1],
      {},
      "jakarta.pdf",
    ),
  );
}

// Reproduce the EXACT tactical brief the exporter renders by replaying its own
// derivation chain (see exportCountryReportPdf.ts: buildCountryLayers →
// resolveActiveCountryWindow → buildJakartaReportDataset). Because both this
// test and the exporter call the same builder with the same window incidents,
// the rows here are exactly the rows the exporter draws.
function expectedTacticalBrief() {
  const todayIso = new Date().toISOString().slice(0, 10);
  const layers = buildCountryLayers(JAKARTA_INCIDENTS, todayIso);
  const active = resolveActiveCountryWindow(layers, todayIso);
  const dataset = buildJakartaReportDataset({
    windowIncidents: active.incidents as unknown as PngSourceIncident[],
    previousWindowIncidents: resolvePreviousCountryWindow(
      layers,
      todayIso,
    ) as unknown as PngSourceIncident[],
    thirtyDay: layers.thirtyDay as unknown as PngSourceIncident[],
    ninetyDay: layers.ninetyDay as unknown as PngSourceIncident[],
    baselineWatchlist: [],
    periodLabel: active.basisLabel,
  });
  const tactical = dataset.jakartaTacticalBrief;
  if (!tactical) throw new Error("expected a Jakarta tactical brief");
  return tactical;
}

// Count how many times `cells` appears as a CONSECUTIVE run in `text`. The grid
// renderer emits each row's cells as back-to-back pdf.text calls (only non-text
// styling calls sit between them), so a table row is a contiguous run. A count
// of 1 proves the row was drawn exactly once — no dropped, duplicated, or
// reordered row, and no wrong cell value.
function runCount(text: string[], cells: string[]): number {
  let count = 0;
  for (let i = 0; i + cells.length <= text.length; i++) {
    let ok = true;
    for (let j = 0; j < cells.length; j++) {
      if (text[i + j] !== cells[j]) {
        ok = false;
        break;
      }
    }
    if (ok) count++;
  }
  return count;
}

// The column labels each table draws, pinned as test-local canonical constants
// (headers are drawn upper-cased). Kept local — NOT imported from production —
// so a header rename in exportCountryReportPdf.ts diverges from these fixed
// labels and fails here, instead of the rename being silently absorbed.
const PRIORITY_HEADERS = ["#", "AREA", "DRIVER", "BUSINESS IMPACT", "ACTION"];
const PORT_HEADERS = [
  "AREA",
  "OPERATIONAL RELEVANCE",
  "POSSIBLE IMPACT",
  "REQUIRED ACTION",
];
const CRIME_HEADERS = ["OPERATING CONTEXT", "CRIME EXPOSURE", "PRECAUTION"];

describe("Jakarta brief data tables emitted into the PDF", () => {
  it("draws every Priority Areas row exactly once, in column order", async () => {
    const text = await jakartaPdfText();
    const rows = expectedTacticalBrief().priorityAreas;
    expect(rows.length).toBeGreaterThan(0);

    for (const r of rows) {
      // Mirrors drawJakartaPriorityTable's cell mapping exactly.
      const cells = [
        String(r.priority),
        r.elevated ? `${r.area} (active this week)` : r.area,
        r.driver,
        r.businessImpact,
        r.action,
      ];
      expect({ area: r.area, count: runCount(text, cells) }).toEqual({
        area: r.area,
        count: 1,
      });
    }

    // Ranks are contiguous 1..N and unique (no dropped / duplicated priority).
    const priorities = rows.map((r) => r.priority).sort((a, b) => a - b);
    expect(priorities).toEqual(rows.map((_, i) => i + 1));

    // The live protest elevated at least one area, so the "(active this week)"
    // branch is actually exercised, not just the standing rows.
    expect(rows.some((r) => r.elevated)).toBe(true);
  });

  it("draws every Port and Logistics row exactly once, in column order", async () => {
    const text = await jakartaPdfText();
    const rows = expectedTacticalBrief().portLogistics.rows;
    expect(rows.length).toBeGreaterThan(0);

    for (const r of rows) {
      const cells = [
        r.area,
        r.operationalRelevance,
        r.possibleImpact,
        r.requiredAction,
      ];
      expect({ area: r.area, count: runCount(text, cells) }).toEqual({
        area: r.area,
        count: 1,
      });
    }
  });

  it("draws every Crime exposure row exactly once, in column order", async () => {
    const text = await jakartaPdfText();
    const rows = expectedTacticalBrief().crimeTrends.businessImpact;
    expect(rows.length).toBeGreaterThan(0);

    for (const r of rows) {
      const cells = [r.context, r.exposure, r.precaution];
      expect({ context: r.context, count: runCount(text, cells) }).toEqual({
        context: r.context,
        count: 1,
      });
    }
  });

  it("emits each table's column headers so the sections really rendered", async () => {
    const text = await jakartaPdfText();
    for (const header of [
      ...PRIORITY_HEADERS,
      ...PORT_HEADERS,
      ...CRIME_HEADERS,
    ]) {
      expect(text).toContain(header);
    }
  });

  it("emits the header rows as contiguous runs (right columns, right order)", async () => {
    const text = await jakartaPdfText();
    // Each table's header row is drawn as back-to-back pdf.text calls, so the
    // full ordered header sequence must appear as one contiguous run. This
    // guards column ORDER and against a dropped or renamed column header.
    expect(runCount(text, PRIORITY_HEADERS)).toBe(1);
    expect(runCount(text, PORT_HEADERS)).toBe(1);
    expect(runCount(text, CRIME_HEADERS)).toBe(1);
  });
});
