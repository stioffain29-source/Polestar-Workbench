// PDF-path guard for the Jakarta brief PLAIN-PROSE sections.
//
// Tasks #294/#295 added headless-PDF guards for the Jakarta data TABLES and the
// LABELLED-BLOCK / BULLET-LIST sections. But the same Jakarta brief also draws
// several sections purely as prose via drawSectionWithProse / renderProse, with
// no equivalent content guard:
//   - Bottom Line Up Front        (drawSectionWithProse — d.bluf)
//   - Tactical Operating Picture  (drawSectionWithProse — d.executiveSummary)
//   - Crime Trends and Business Impact prose trio (renderProse ×3)
//   - Airport Transfer Impact     (drawSectionWithProse — tactical.airportTransfer)
//   - Seven Day Outlook           (drawSectionWithProse — d.outlook)
//   - Polestar View               (drawSectionWithProse — d.polestarView)
//   - Operational Map area summary(renderProse — tactical.areaSummary)
// A future edit could silently DROP one of these sections, blank its body, or
// leave it rendering the "Not populated." fallback while live data exists — the
// same class of regression the sibling tests fixed for the tables and blocks.
//
// We drive the REAL `exportCountryReportPdf` for Jakarta end-to-end with
// `./pdfChrome` mocked. Unlike the sibling tests (which leave the prose
// renderers inert so only tables/blocks emit), THIS mock gives
// drawSectionHeading / drawSectionWithProse / renderProse functional RECORDING
// stubs so every heading and prose paragraph they emit is captured, while the
// heavy chrome (font loading, cover images, pagination) stays inert. The
// EXPECTED prose is derived by replaying the exporter's OWN derivation chain
// (buildCountryLayers → resolveActiveCountryWindow → buildJakartaReportDataset),
// so the expected text is exactly what the exporter draws — a divergence in
// either direction fails.

const PDF_CHROME_PATH = "../../artifacts/workbench/src/lib/pdfChrome";

// The mock owns the recording buffer so it survives ts-jest's jest.mock
// hoisting (the factory must not close over later top-level consts). The
// recorded text and a reset hook are exposed as extra named exports.
jest.mock("../../artifacts/workbench/src/lib/pdfChrome", () => {
  const textCalls: string[] = [];
  const record = (arg: unknown) => {
    if (Array.isArray(arg)) for (const s of arg) textCalls.push(String(s));
    else if (arg != null) textCalls.push(String(arg));
  };
  // Split a prose body into rendered paragraphs the SAME way renderProse /
  // drawSectionWithProse do (sanitize is identity here), so each recorded
  // paragraph matches the dataset string it came from.
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
    // Functional recording stubs for the prose renderers — mirror the REAL
    // emission order (heading upper-cased, then one call per prose paragraph)
    // so a heading→body pair is a contiguous run in the recorded text.
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
  // Every other named export stays an inert no-op so only headings + prose emit.
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
  type PngReportDataset,
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

// A small live Jakarta dataset spread across the weekly window so it counts; the
// protest elevates a zone so the brief carries live-driven content alongside the
// standing rows (so the prose sections resolve to real text, not fallbacks).
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

// Reproduce the EXACT dataset the exporter renders by replaying its own
// derivation chain (see exportCountryReportPdf.ts: buildCountryLayers →
// resolveActiveCountryWindow → buildJakartaReportDataset). Because both this
// test and the exporter call the same builder with the same window incidents,
// the prose here is exactly what the exporter draws.
function expectedDataset(): PngReportDataset {
  const todayIso = new Date().toISOString().slice(0, 10);
  const layers = buildCountryLayers(JAKARTA_INCIDENTS, todayIso);
  const active = resolveActiveCountryWindow(layers, todayIso);
  return buildJakartaReportDataset({
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
}

function expectedTacticalBrief() {
  const tactical = expectedDataset().jakartaTacticalBrief;
  if (!tactical) throw new Error("expected a Jakarta tactical brief");
  return tactical;
}

// The exact strings the exporter uses when a section has nothing to draw. The
// guard asserts these NEVER appear, so a section silently falling back to the
// placeholder while live data exists is caught.
const FALLBACKS = ["Not populated.", "Not populated for this report."];

const paragraphsOf = (body: string) =>
  body
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

// Count how many times `seq` appears as a CONSECUTIVE run in `text`. A prose
// section emits its heading then its body paragraphs as back-to-back recorded
// calls, so heading→body is a contiguous run; a count of 1 proves the section
// was drawn exactly once with its own body (not dropped, duplicated, or with a
// swapped/blanked body).
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

// The drawSectionWithProse sections: fixed heading + a body pulled live from the
// replayed dataset. Headings are pinned as test-local canonical constants — NOT
// imported from production — so a heading rename in renderJakartaBrief diverges
// from these and fails, instead of the rename being silently absorbed.
type ProseSection = { heading: string; body: () => string };

describe("Jakarta brief plain-prose sections emitted into the PDF", () => {
  const sections = (): ProseSection[] => {
    const d = expectedDataset();
    const tb = expectedTacticalBrief();
    return [
      { heading: "Bottom Line Up Front", body: () => d.bluf },
      { heading: "Tactical Operating Picture", body: () => d.executiveSummary },
      { heading: "Airport Transfer Impact", body: () => tb.airportTransfer },
      { heading: "Seven Day Outlook", body: () => d.outlook },
      { heading: "Polestar View", body: () => d.polestarView },
    ];
  };

  it("draws each drawSectionWithProse section as heading → body, exactly once", async () => {
    const text = await jakartaPdfText();

    for (const { heading, body } of sections()) {
      const raw = body();
      const paras = paragraphsOf(raw);
      // Live data present → the body must be real prose, never blank and never
      // the placeholder fallback.
      expect({ heading, empty: paras.length === 0 }).toEqual({
        heading,
        empty: false,
      });
      expect(FALLBACKS).not.toContain(raw.trim());

      // heading (upper-cased) then every body paragraph, back to back. Exactly
      // one run proves the section was drawn once and its body is intact.
      const seq = [heading.toUpperCase(), ...paras];
      expect({ heading, count: runCount(text, seq) }).toEqual({
        heading,
        count: 1,
      });
    }
  });

  it("draws the Crime Trends prose trio under its heading, each non-empty", async () => {
    const text = await jakartaPdfText();
    const crime = expectedTacticalBrief().crimeTrends;

    // Heading present.
    expect(text).toContain("Crime Trends and Business Impact".toUpperCase());

    // The three crime paragraphs are drawn in order, back to back, right after
    // the heading. Asserting the full run appears once guards against a dropped,
    // reordered, or blanked crime paragraph.
    const trio = [
      crime.reportedThisPeriod,
      crime.standingPattern,
      crime.trendRead,
    ];
    for (const p of trio) {
      expect(p.trim().length).toBeGreaterThan(0);
      expect(FALLBACKS).not.toContain(p.trim());
    }
    const seq = [
      "Crime Trends and Business Impact".toUpperCase(),
      ...trio.flatMap((p) => paragraphsOf(p)),
    ];
    expect(runCount(text, seq)).toBe(1);
  });

  it("draws the Operational Map area summary prose under its heading", async () => {
    const text = await jakartaPdfText();
    const areaSummary = expectedTacticalBrief().areaSummary;

    expect(areaSummary.trim().length).toBeGreaterThan(0);
    expect(FALLBACKS).not.toContain(areaSummary.trim());

    // The heading is emitted (the posture table is drawn between it and the
    // summary, so the two are not contiguous).
    expect(text).toContain("Operational Map".toUpperCase());

    // The area summary is drawn via a single renderProse call, so its
    // paragraphs land back to back — exactly one run guards against the summary
    // being dropped or blanked.
    expect(runCount(text, paragraphsOf(areaSummary))).toBe(1);
  });

  it("never renders a 'Not populated.' fallback when live data exists", async () => {
    const text = await jakartaPdfText();
    for (const fallback of FALLBACKS) {
      expect(text).not.toContain(fallback);
    }
  });
});
