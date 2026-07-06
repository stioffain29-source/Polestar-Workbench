// PDF-path guard for the Jakarta brief's NO-LIVE-DATA fallback sections.
//
// The sibling test (jakartaBriefProsePdf.test.ts) proves each Jakarta plain-prose
// section renders its REAL body when live data exists. THIS test guards the
// opposite path: when the Jakarta tactical brief is genuinely absent
// (jakartaTacticalBrief == null), renderJakartaBrief deliberately falls back to
// "Not populated." for every section guarded by `if (tactical)`, and to
// "No specific escalation triggers flagged this period." when there are no
// escalation indicators. A future edit could crash the exporter on that null
// path, or drop a fallback so a heading is emitted with no body at all —
// silently producing an empty section.
//
// Why the tactical brief is FORCED null here: the real derivation
// (buildJakartaReportDataset) always synthesises a STANDING-ONLY tactical brief
// even with zero in-window incidents, so the `else` branches are never reached
// through the public export. To exercise those defensive fallbacks we mock
// buildJakartaReportDataset to return the real base dataset with
// jakartaTacticalBrief stripped and escalationIndicators emptied — the exact
// shape renderJakartaBrief must survive — then drive the REAL
// exportCountryReportPdf end-to-end with `./pdfChrome` mocked (same recording
// stub as the sibling test).

const PDF_CHROME_PATH = "../../artifacts/workbench/src/lib/pdfChrome";
const DATASET_PATH = "../../artifacts/workbench/src/lib/pngReportDataset";

// Recording stub for the PDF chrome — identical in spirit to the sibling test:
// drawSectionHeading / drawSectionWithProse / renderProse capture every heading
// and prose paragraph they emit, while the heavy chrome stays inert.
jest.mock("../../artifacts/workbench/src/lib/pdfChrome", () => {
  const textCalls: string[] = [];
  const record = (arg: unknown) => {
    if (Array.isArray(arg)) for (const s of arg) textCalls.push(String(s));
    else if (arg != null) textCalls.push(String(arg));
  };
  const paragraphs = (body: unknown) =>
    String(body ?? "")
      .split(/\n+/)
      .map((p) => p.trim())
      .filter(Boolean);
  const pdf = new Proxy(
    {},
    {
      get(_t, prop) {
        if (typeof prop === "symbol") return undefined;
        switch (prop) {
          case "splitTextToSize":
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
    drawSectionHeading: (_ctx: unknown, title: unknown) => {
      record(String(title).toUpperCase());
    },
    renderProse: (_ctx: unknown, body: unknown) => {
      for (const p of paragraphs(body)) record(p);
    },
    drawSectionWithProse: (_ctx: unknown, title: unknown, body: unknown) => {
      record(String(title).toUpperCase());
      for (const p of paragraphs(body)) record(p);
    },
  };
  return new Proxy(api, {
    get(target, prop) {
      if (prop === "__esModule") return true;
      if (typeof prop === "symbol") return undefined;
      if (prop in target) return (target as Record<string, unknown>)[prop];
      return () => undefined;
    },
  });
});

// Force the NO-LIVE-DATA shape: real base dataset, tactical brief stripped and
// escalation indicators emptied, so renderJakartaBrief takes every fallback path.
jest.mock("../../artifacts/workbench/src/lib/pngReportDataset", () => {
  const actual = jest.requireActual(
    "../../artifacts/workbench/src/lib/pngReportDataset",
  );
  return {
    ...actual,
    buildJakartaReportDataset: (args: unknown) => {
      const base = actual.buildJakartaReportDataset(args);
      return {
        ...base,
        jakartaTacticalBrief: undefined,
        escalationIndicators: [],
      };
    },
  };
});

import { exportCountryReportPdf } from "../../artifacts/workbench/src/lib/exportCountryReportPdf";
import type { CountryFastFactsIncident } from "../../artifacts/workbench/src/lib/countryFastFacts";

const pdfChromeMock = jest.requireMock(PDF_CHROME_PATH) as {
  __textCalls: string[];
  __reset: () => void;
};

function textAfter(run: () => Promise<unknown>): Promise<string[]> {
  pdfChromeMock.__reset();
  return run().then(() => [...pdfChromeMock.__textCalls]);
}

const JAKARTA_COUNTRY = {
  name: "Jakarta",
  region: "Southeast Asia",
  overview: "Test overview.",
  trendSummary: "Test trend summary.",
  implications: "Test implications.",
};

// EMPTY incident set — no in-window data at all. Combined with the dataset mock
// above, this drives the exporter down the null-tactical fallback path.
const NO_INCIDENTS: CountryFastFactsIncident[] = [];

async function jakartaPdfText(): Promise<string[]> {
  return textAfter(() =>
    exportCountryReportPdf(
      JAKARTA_COUNTRY as Parameters<typeof exportCountryReportPdf>[0],
      NO_INCIDENTS as unknown as Parameters<typeof exportCountryReportPdf>[1],
      {},
      "jakarta-empty.pdf",
    ),
  );
}

const NOT_POPULATED = "Not populated.";
const NO_ESCALATION = "No specific escalation triggers flagged this period.";

// Count how many times `seq` appears as a CONSECUTIVE run in `text`. A guarded
// section emits its heading then its fallback body back to back, so heading →
// fallback is a contiguous run; a count of 1 proves the section drew its heading
// AND a non-empty body exactly once (not dropped, duplicated, or blanked).
function runCount(text: string[], seq: string[]): number {
  let count = 0;
  for (let i = 0; i + seq.length <= text.length; i++) {
    let ok = true;
    for (let j = 0; j < seq.length; j++) {
      if (text[i + j] !== seq[j]) {
        ok = false;
        break;
      }
    }
    if (ok) count++;
  }
  return count;
}

// The sections guarded by `if (tactical)` that fall back to "Not populated." as a
// contiguous heading → body pair. Headings are pinned as test-local canonical
// constants (NOT imported) so a heading rename in renderJakartaBrief diverges
// from these and fails, instead of the rename being silently absorbed.
const CONTIGUOUS_FALLBACK_HEADINGS = [
  "Crime Trends and Business Impact",
  "Priority Areas This Week",
  "Staff Movement Impact",
  "Airport Transfer Impact",
  "Port and Logistics Impact",
  "Office, Hotel and Meeting Venue Exposure",
  "Route and Timing Guidance",
  "Recommended Actions",
];

describe("Jakarta brief no-live-data fallback sections in the PDF", () => {
  it("does not throw on the null-tactical export path", async () => {
    await expect(jakartaPdfText()).resolves.toBeInstanceOf(Array);
  });

  it("draws each `if (tactical)` section as heading → 'Not populated.', exactly once", async () => {
    const text = await jakartaPdfText();
    for (const heading of CONTIGUOUS_FALLBACK_HEADINGS) {
      const seq = [heading.toUpperCase(), NOT_POPULATED];
      expect({ heading, count: runCount(text, seq) }).toEqual({
        heading,
        count: 1,
      });
    }
  });

  it("draws the Escalation Triggers heading with its no-triggers line", async () => {
    const text = await jakartaPdfText();
    const seq = ["Escalation Triggers".toUpperCase(), NO_ESCALATION];
    expect(runCount(text, seq)).toBe(1);
  });

  it("draws the Operational Map heading followed by the 'Not populated.' area summary", async () => {
    const text = await jakartaPdfText();
    const mapIdx = text.indexOf("Operational Map".toUpperCase());
    expect(mapIdx).toBeGreaterThanOrEqual(0);
    // The seven-zone posture table is drawn between the heading and the area
    // summary, so they are not contiguous — assert a "Not populated." appears
    // AFTER the heading (the area-summary fallback).
    const summaryIdx = text.indexOf(NOT_POPULATED, mapIdx + 1);
    expect(summaryIdx).toBeGreaterThan(mapIdx);
  });

  it("never emits a guarded heading with no body after it", async () => {
    const text = await jakartaPdfText();
    // For every fallback heading, the very next recorded call must be its body,
    // never another heading (which would mean the section was emitted empty).
    for (const heading of CONTIGUOUS_FALLBACK_HEADINGS) {
      const idx = text.indexOf(heading.toUpperCase());
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(text[idx + 1]).toBe(NOT_POPULATED);
    }
  });
});
