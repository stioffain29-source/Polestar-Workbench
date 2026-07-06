// PDF-path guard for the Jakarta brief LABELLED-BLOCK and BULLET-LIST sections.
//
// Task #294 added a headless-PDF guard for the Jakarta data TABLES (Priority
// Areas, Port and Logistics, Crime exposure). But the same Jakarta brief also
// draws several non-table sections into the PDF with no equivalent content
// guard:
//   - Staff Movement Impact   (drawJakartaLabelledBlock — seven movement types)
//   - Recommended Actions      (drawJakartaLabelledBlock — role-based blocks)
//   - Port Actions             (drawJakartaBulletList)
//   - Route and Timing Guidance(drawJakartaBulletList)
//   - Escalation Triggers      (drawJakartaBulletList)
// A future edit to their field lists or block builders could silently drop,
// duplicate, or mislabel an entry without failing any current check — the same
// class of regression #294 fixed for the tables.
//
// We drive the REAL `exportCountryReportPdf` for Jakarta end-to-end with
// `./pdfChrome` mocked so the heavy chrome (font loading, cover images,
// pagination, section headings) is inert and the jsPDF instance is a recording
// stub. drawJakartaLabelledBlock / drawJakartaBulletList draw via `pdf.text(...)`,
// so every label, body, and bullet they emit is captured. The EXPECTED content
// is derived by replaying the exporter's OWN derivation chain (buildCountryLayers
// → resolveActiveCountryWindow → buildJakartaReportDataset), so the expected
// entries here are exactly what the exporter draws — a divergence in either
// direction fails.

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
            // Keep each block body / bullet on a single "line" so it is
            // recorded whole and is trivially assertable as one entry.
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
    // paginates or short-circuits before the blocks are reached.
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
  // an inert no-op so only the real Jakarta blocks emit text.
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
import type { JakartaStaffMovementImpact } from "../../artifacts/workbench/src/lib/jakartaBrief";
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
// standing rows.
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
// the content here is exactly what the exporter draws.
function expectedDataset() {
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

// Count how many times `seq` appears as a CONSECUTIVE run in `text`. Labelled
// blocks emit their label then body as back-to-back pdf.text calls (only
// non-text styling calls sit between them), so a block is a contiguous run; a
// count of 1 proves it was drawn exactly once — no dropped, duplicated, or
// reordered entry, and no wrong label/body.
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

// The Staff Movement Impact field labels + their dataset keys, drawn one
// labelled block each. Pinned as test-local canonical constants — NOT imported
// from production — so a label rename in exportCountryReportPdf.ts (renderJakarta
// Brief section 5) diverges from these fixed labels and fails here, instead of
// the rename being silently absorbed. The order matches the exporter's `fields`.
const STAFF_MOVEMENT_FIELDS: Array<[string, keyof JakartaStaffMovementImpact]> =
  [
    ["Office access", "officeAccess"],
    ["Hotel to office movement", "hotelToOffice"],
    ["Airport transfer", "airportTransfer"],
    ["Client meeting movement", "clientMeeting"],
    ["Staff commute", "staffCommute"],
    ["Driver route planning", "driverRoute"],
    ["After hours movement", "afterHours"],
  ];

describe("Jakarta brief labelled-block sections emitted into the PDF", () => {
  it("draws each Staff Movement field as label → body, exactly once", async () => {
    const text = await jakartaPdfText();
    const sm = expectedTacticalBrief().staffMovement;

    for (const [label, key] of STAFF_MOVEMENT_FIELDS) {
      const body = sm[key];
      expect(body.length).toBeGreaterThan(0);
      // drawJakartaLabelledBlock emits label (upper-cased) then body as two
      // consecutive text calls, so the pair is a contiguous run. Count 1 proves
      // the field is present, unique, and carries its OWN body (not mislabelled).
      const seq = [label.toUpperCase(), body];
      expect({ label, count: runCount(text, seq) }).toEqual({ label, count: 1 });
    }
  });

  it("draws the seven Staff Movement blocks in order as one contiguous run", async () => {
    const text = await jakartaPdfText();
    const sm = expectedTacticalBrief().staffMovement;

    expect(STAFF_MOVEMENT_FIELDS).toHaveLength(7);
    // The full label→body sequence for all seven fields, back to back. Asserting
    // it appears exactly once guards field ORDER and against a dropped, added, or
    // reordered movement type in a single check.
    const flat = STAFF_MOVEMENT_FIELDS.flatMap(([label, key]) => [
      label.toUpperCase(),
      sm[key],
    ]);
    expect(runCount(text, flat)).toBe(1);
  });

  it("draws each Recommended Actions role block as role → guidance, exactly once", async () => {
    const text = await jakartaPdfText();
    const roleActions = expectedTacticalBrief().roleActions;
    expect(roleActions.length).toBeGreaterThan(0);

    for (const a of roleActions) {
      const seq = [a.role.toUpperCase(), a.guidance];
      expect({ role: a.role, count: runCount(text, seq) }).toEqual({
        role: a.role,
        count: 1,
      });
    }
  });

  it("draws the role-action blocks in order as one contiguous run", async () => {
    const text = await jakartaPdfText();
    const roleActions = expectedTacticalBrief().roleActions;
    const flat = roleActions.flatMap((a) => [a.role.toUpperCase(), a.guidance]);
    expect(runCount(text, flat)).toBe(1);
  });
});

describe("Jakarta brief bullet-list sections emitted into the PDF", () => {
  // Each bullet is drawn by drawJakartaBulletList as `• ${item}`.
  const bullet = (item: string) => `\u2022 ${item}`;

  it("draws every Port Actions bullet exactly once, in order", async () => {
    const text = await jakartaPdfText();
    const actions = expectedTacticalBrief().portLogistics.actions;
    expect(actions.length).toBeGreaterThan(0);

    for (const item of actions) {
      const count = text.filter((t) => t === bullet(item)).length;
      expect({ item, count }).toEqual({ item, count: 1 });
    }
    // Full ordered run guards against a dropped / reordered bullet.
    expect(runCount(text, actions.map(bullet))).toBe(1);
  });

  it("draws every Route and Timing bullet exactly once, in order", async () => {
    const text = await jakartaPdfText();
    const routeTiming = expectedTacticalBrief().routeTiming;
    expect(routeTiming.length).toBeGreaterThan(0);

    for (const item of routeTiming) {
      const count = text.filter((t) => t === bullet(item)).length;
      expect({ item, count }).toEqual({ item, count: 1 });
    }
    expect(runCount(text, routeTiming.map(bullet))).toBe(1);
  });

  it("draws every Escalation Triggers bullet exactly once, in order", async () => {
    const text = await jakartaPdfText();
    const indicators = expectedDataset().escalationIndicators;
    expect(indicators.length).toBeGreaterThan(0);

    for (const item of indicators) {
      const count = text.filter((t) => t === bullet(item)).length;
      expect({ item, count }).toEqual({ item, count: 1 });
    }
    expect(runCount(text, indicators.map(bullet))).toBe(1);
  });
});
