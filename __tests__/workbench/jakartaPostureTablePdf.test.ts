// PDF-path guard for the Jakarta "Operational Map" seven-zone posture table.
//
// The zone MODEL is unit-tested (jakartaOperatingPosture.test.ts) and the
// Jakarta PDF audit (scripts/auditJakartaPdf.ts) checks section order +
// Roboto-only fonts. But nothing asserts the HEADLESS `drawJakartaPostureTable`
// actually emits all seven zone names AND their exposure rating words into the
// exported PDF. A future edit to the table columns, the zone list, or the
// POSTURE_EXPOSURE_LABEL map could silently drop a zone or mislabel a rating
// without failing any current check.
//
// We drive the REAL `exportCountryReportPdf` for Jakarta end-to-end with
// `./pdfChrome` mocked so the heavy chrome (font loading, cover images,
// pagination, section headings) is inert and the jsPDF instance is a recording
// stub. `drawJakartaPostureTable` is a LOCAL function that draws via
// `pdf.text(...)`, so every zone label / rating word it emits is captured and
// asserted. The zone derivation runs for real (the same buildJakartaPostureZones
// the on-screen map uses), so the rows here are the rows the exporter draws.

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
            // Keep each value on a single "line" so a zone / rating string is
            // recorded whole and is trivially assertable.
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
    // paginates or short-circuits before the Operational Map is reached.
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
  JAKARTA_POSTURE_ZONES,
  POSTURE_EXPOSURE_LABEL,
  buildJakartaPostureModel,
} from "../../artifacts/workbench/src/lib/jakartaOperatingPosture";
import type { JakartaExposureLevel } from "../../artifacts/workbench/src/lib/jakartaCorridors";
import type { CountryFastFactsIncident } from "../../artifacts/workbench/src/lib/countryFastFacts";

// The exact rating vocabulary the exported table MUST print for each exposure
// level. This is DELIBERATELY a test-local constant, NOT derived from the
// production `POSTURE_EXPOSURE_LABEL` map: if a production edit mislabels a
// rating (e.g. renames "Elevated" → "Raised"), the rendered PDF diverges from
// this fixed vocabulary and the row assertions below fail, instead of the bug
// being silently absorbed by a shared constant. The five words are the risk
// vocabulary the task pins for the Operational Map.
const CANONICAL_RATING_WORD: Record<JakartaExposureLevel, string> = {
  high: "HIGH",
  elevated: "ELEVATED",
  monitored: "MONITORED",
  low: "LOW",
  "not-assessed": "NOT ASSESSED",
};

// Read the recorded text + reset hook back off the mocked module.
const pdfChromeMock = jest.requireMock(PDF_CHROME_PATH) as {
  __textCalls: string[];
  __reset: () => void;
};

function textAfter(run: () => Promise<unknown>): Promise<string[]> {
  pdfChromeMock.__reset();
  return run().then(() => [...pdfChromeMock.__textCalls]);
}

// A small live Jakarta dataset: enough to exercise the exposure model and put a
// real rating on the elevated zones while quiet zones fall to their standing
// rating. Spread across the weekly window so they count.
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
];

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

// The exact zone-label strings drawJakartaPostureTable draws: `${number}. ${name}`.
const ZONE_LABELS = JAKARTA_POSTURE_ZONES.map((z) => `${z.number}. ${z.name}`);

describe("Jakarta Operational Map — posture table emitted into the PDF", () => {
  it("draws all seven zone labels (1–7), each exactly once", async () => {
    const text = await jakartaPdfText();

    expect(ZONE_LABELS).toHaveLength(7);
    for (const label of ZONE_LABELS) {
      const count = text.filter((t) => t === label).length;
      // Present (no dropped zone) and exactly once (no duplicated zone).
      expect({ label, count }).toEqual({ label, count: 1 });
    }
  });

  it("pins the exported rating vocabulary to the five canonical words", () => {
    // Vocabulary lock: every production exposure label, upper-cased, must equal
    // the canonical word this test asserts against. Because the row checks below
    // compare the RENDERED text to CANONICAL_RATING_WORD (a test-local map), a
    // production rename of any POSTURE_EXPOSURE_LABEL value would break the
    // rendered output while this cross-check fails loudly here — the exact
    // "wrong rating label" regression the task guards against.
    const levels = Object.keys(CANONICAL_RATING_WORD) as JakartaExposureLevel[];
    for (const level of levels) {
      expect(POSTURE_EXPOSURE_LABEL[level].toUpperCase()).toBe(
        CANONICAL_RATING_WORD[level],
      );
    }
  });

  it("emits each zone row as label → its own rating word → reason → action", async () => {
    const text = await jakartaPdfText();

    // The zones the exporter draws derive from the SAME builder chain the model
    // uses (buildJakartaCorridorStatuses → buildJakartaPostureZones), so the
    // per-zone rating/reason/action here are exactly what the table renders.
    const zones = buildJakartaPostureModel(JAKARTA_INCIDENTS).zones;
    expect(zones).toHaveLength(7);

    for (const z of zones) {
      const label = `${z.number}. ${z.name}`;
      const idx = text.indexOf(label);
      // Zone row present.
      expect({ label, idx: idx >= 0 }).toEqual({ label, idx: true });

      // drawJakartaPostureTable emits each row strictly as:
      //   zone label → rating word → reason → action
      // so the rating word for THIS zone must be the very next recorded string.
      // This couples the rating to its own row: a wrong rating on a specific
      // zone is caught even if the right word appears elsewhere in the table.
      const expectedRating = CANONICAL_RATING_WORD[z.rating];
      expect({ label, rating: text[idx + 1] }).toEqual({
        label,
        rating: expectedRating,
      });
      expect({ label, reason: text[idx + 2] }).toEqual({
        label,
        reason: z.reason,
      });
      expect({ label, action: text[idx + 3] }).toEqual({
        label,
        action: z.action,
      });
    }

    // At least one zone was elevated by the live protest, proving the ratings
    // are derived from data (not a fixed "Not assessed" for every row) — so the
    // per-row coupling above is exercised across more than one rating value.
    expect(zones.some((z) => z.elevated)).toBe(true);
    const renderedRatings = new Set(
      zones.map((z) => CANONICAL_RATING_WORD[z.rating]),
    );
    expect(renderedRatings.size).toBeGreaterThan(1);
  });

  it("emits the table column headers so the section really rendered", async () => {
    const text = await jakartaPdfText();
    for (const header of ["ZONE", "EXPOSURE", "REASON", "ACTION"]) {
      expect(text).toContain(header);
    }
  });
});
