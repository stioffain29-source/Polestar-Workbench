// PDF-path guard for the PNG / West Papua / Indonesia structured briefs'
// NO-LIVE-DATA fallback sections.
//
// The sibling test (jakartaBriefEmptyPdf.test.ts) proves the JAKARTA brief still
// renders a non-empty body on its null-tactical path. The three OTHER structured
// briefs — PNG (papua-new-guinea), West Papua (papua) and Indonesia — render
// through the SAME exporter branch (renderStructuredBrief in
// exportCountryReportPdf.ts) and carry their own fallback branches:
//   - `d.bluf || "Not populated."`            (Bottom Line Up Front)
//   - `d.executiveSummary || "Not populated."`(Current Situation)
//   - `d.outlook || "Not populated."`         (Outlook: Next Seven Days)
//   - `d.polestarView || "Not populated."`    (Polestar View)
//   - Top 3 / Incident Details / Operational Impact / Recommended Actions each
//     fall back to a non-empty note when the window holds no qualifying data.
// A future edit could crash the exporter on the empty path, or drop a fallback so
// a heading is emitted with no body at all — silently producing an empty section.
//
// Why the prose fields are FORCED empty here: the real derivation
// (buildStructuredReportDataset) always synthesises standing-only bluf /
// executiveSummary / outlook / polestarView even with zero in-window incidents,
// so the `|| "Not populated."` branches are never reached through the public
// export. To exercise those defensive fallbacks we mock the three builders to
// return the real base dataset with those four prose fields blanked — the exact
// shape renderStructuredBrief must survive — then drive the REAL
// exportCountryReportPdf end-to-end with `./pdfChrome` mocked (same recording
// stub as the Jakarta test), passing an EMPTY incident set so the remaining
// data-driven sections take their empty-window fallbacks too.

const PDF_CHROME_PATH = "../../artifacts/workbench/src/lib/pdfChrome";

// Recording stub for the PDF chrome — identical in spirit to the Jakarta test:
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

// Force the NO-LIVE-DATA shape: real base dataset for each theatre, with the four
// `|| "Not populated."`-guarded prose fields blanked, so renderStructuredBrief
// takes every fallback path. Escalation indicators are emptied too so the Outlook
// section renders its bare "Not populated." with no trailing indicator list.
jest.mock("../../artifacts/workbench/src/lib/pngReportDataset", () => {
  const actual = jest.requireActual(
    "../../artifacts/workbench/src/lib/pngReportDataset",
  );
  const strip = (base: Record<string, unknown>) => ({
    ...base,
    bluf: "",
    executiveSummary: "",
    outlook: "",
    polestarView: "",
    escalationIndicators: [],
  });
  return {
    ...actual,
    buildPngReportDataset: (args: unknown) =>
      strip(actual.buildPngReportDataset(args)),
    buildWestPapuaReportDataset: (args: unknown) =>
      strip(actual.buildWestPapuaReportDataset(args)),
    buildIndonesiaReportDataset: (args: unknown) =>
      strip(actual.buildIndonesiaReportDataset(args)),
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

// EMPTY incident set — no in-window data at all. Combined with the dataset mock
// above, this drives the exporter down every structured-brief fallback path.
const NO_INCIDENTS: CountryFastFactsIncident[] = [];

// The three structured theatres and the canonical report name each routes on
// (see acceptedCountryTokens in exportCountryReportPdf.ts). "Papua" is the West
// Papua report name.
const THEATRES = [
  { label: "PNG", name: "Papua New Guinea" },
  { label: "West Papua", name: "Papua" },
  { label: "Indonesia", name: "Indonesia" },
] as const;

function briefPdfText(countryName: string): Promise<string[]> {
  return textAfter(() =>
    exportCountryReportPdf(
      {
        name: countryName,
        region: "Southeast Asia",
        overview: "Test overview.",
        trendSummary: "Test trend summary.",
        implications: "Test implications.",
      } as Parameters<typeof exportCountryReportPdf>[0],
      NO_INCIDENTS as unknown as Parameters<typeof exportCountryReportPdf>[1],
      {},
      `${countryName.toLowerCase().replace(/\s+/g, "-")}-empty.pdf`,
    ),
  );
}

const NOT_POPULATED = "Not populated.";

// Count how many times `seq` appears as a CONSECUTIVE run in `text`. A guarded
// drawSectionWithProse section emits its heading then its fallback body back to
// back, so heading → fallback is a contiguous run; a count of 1 proves the
// section drew its heading AND a non-empty body exactly once (not dropped,
// duplicated, or blanked).
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

// Post-merge contract (owner ruling, 11 Aug 2026 — five canonical sections):
// only Bottom Line Up Front keeps a `|| "Not populated."` fallback; every other
// section is OMITTED when it has no content, mirroring PngCountryReportBody's
// inclusion gates exactly. Headings are pinned as test-local canonical
// constants (NOT imported) so a heading rename in renderStructuredBrief
// diverges from these and fails, instead of being silently absorbed.
const NOT_POPULATED_HEADINGS = ["Bottom Line Up Front"];

// The full canonical heading vocabulary (current + retired). Used for the
// "no heading directly followed by another heading" empty-section guard.
const HEADING_VOCAB = [
  "Bottom Line Up Front",
  "Top 3 Developments",
  "Current Situation",
  "Actions & Outlook",
  "Polestar View",
];

// Retired standalone section headings — merged into "Actions & Outlook". If any
// reappears as a drawSectionHeading, the preview/PDF section model diverged.
const RETIRED_HEADINGS = [
  "Operational Impact",
  "Recommended Actions",
  "Outlook: Next Seven Days",
];

describe.each(THEATRES)(
  "$label structured brief no-live-data fallback sections in the PDF",
  ({ name }) => {
    it("does not throw on the empty-data export path", async () => {
      await expect(briefPdfText(name)).resolves.toBeInstanceOf(Array);
    });

    it("draws each `|| \"Not populated.\"` section as heading → fallback, exactly once", async () => {
      const text = await briefPdfText(name);
      for (const heading of NOT_POPULATED_HEADINGS) {
        const seq = [heading.toUpperCase(), NOT_POPULATED];
        expect({ heading, count: runCount(text, seq) }).toEqual({
          heading,
          count: 1,
        });
      }
    });

    it("omits the Top 3 Developments section entirely when there are no developments", async () => {
      const text = await briefPdfText(name);
      expect(text).not.toContain("TOP 3 DEVELOPMENTS");
    });

    it("omits the blanked prose sections instead of drawing them empty, and never retires a heading into view", async () => {
      const text = await briefPdfText(name);
      // Outlook and Polestar were blanked by the dataset mock, so their
      // sections must be OMITTED (no filler), matching the on-screen body.
      expect(text).not.toContain("POLESTAR VIEW");
      for (const retired of RETIRED_HEADINGS) {
        expect(text).not.toContain(retired.toUpperCase());
      }
    });

    it("never emits a section heading directly followed by another heading (empty section)", async () => {
      const text = await briefPdfText(name);
      const headingSet = new Set(HEADING_VOCAB.map((h) => h.toUpperCase()));
      const rendered = HEADING_VOCAB.filter((h) => text.includes(h.toUpperCase()));
      for (const heading of rendered) {
        const idx = text.indexOf(heading.toUpperCase());
        const next = text[idx + 1];
        // The next recorded call must be a real body line — present, non-empty,
        // and NOT itself another section heading (which would mean the section
        // was emitted with no body).
        expect({
          heading,
          bodyIsRealText: typeof next === "string" && next.trim().length > 0,
          bodyIsNotAHeading: !headingSet.has(next ?? ""),
        }).toEqual({
          heading,
          bodyIsRealText: true,
          bodyIsNotAHeading: true,
        });
      }
    });
  },
);
