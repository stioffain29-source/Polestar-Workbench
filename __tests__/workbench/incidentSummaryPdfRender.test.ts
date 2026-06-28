// PDF-path parity guard for the per-incident summary line under each Related
// Incidents row. The on-screen previews are already covered by
// incidentSummaryRender.test.tsx (renderToStaticMarkup). But the SAME line is
// ALSO drawn into the headless jsPDF exports by `drawRelatedIncidents` in the
// topic / shipping / conflict exporters, which render through jsPDF rather than
// React — so a regression that dropped or mis-wired the summary line in the PDF
// path (e.g. an exporter drawing the wrong field, or skipping
// resolveIncidentSummary) would slip past the preview tests entirely.
//
// We run each REAL exporter end-to-end with `./pdfChrome` mocked so the heavy
// PDF chrome (font loading, cover images, geometry helpers) is inert and the
// jsPDF instance is replaced by a recording stub. Every `pdf.text(...)` call is
// captured, so we can assert exactly what text reaches the page. The data and
// row selection run for real (the same dataset builders / selectRelatedIncidents
// the previews use), so the enriched rows here are byte-for-byte the rows the
// exporter draws.
//
// Mirroring the preview parity tests, for each of shipping + topic + conflict we
// assert:
//   - a generated summary is emitted under its row,
//   - an analyst's saved EDIT wins over the generated/fallback line,
//   - a row with no summary falls back to the deterministic, source-free line
//     (never a blank cell) — resolved through the shared resolveIncidentSummary.

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
            // Keep each value on a single "line" so a summary string is
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
  const sevLabel: Record<string, string> = {
    insignificant: "Insignificant",
    low: "Low",
    moderate: "Moderate",
    high: "High",
    extreme: "Extreme",
  };
  const sevColor: Record<string, string> = {
    insignificant: "#9AA0A6",
    low: "#4655FF",
    moderate: "#F2A900",
    high: "#E8731C",
    extreme: "#A33232",
  };
  const api: Record<string, unknown> = {
    __esModule: true,
    __textCalls: textCalls,
    __reset: () => {
      textCalls.length = 0;
    },
    // A fresh ctx per export call; H is large + helpers are inert so nothing
    // paginates or short-circuits before Related Incidents is reached.
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
    sevKey: (s: unknown) => String(s ?? "").toLowerCase(),
    SEV_LABEL: sevLabel,
    SEV_COLOR: sevColor,
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
  // Every other named export (drawSectionHeading, drawFooters, setText, ...) is
  // an inert no-op so only the real Related-Incidents drawing emits text.
  return new Proxy(api, {
    get(target, prop) {
      if (prop === "__esModule") return true;
      if (typeof prop === "symbol") return undefined;
      if (prop in target) return (target as Record<string, unknown>)[prop];
      return () => undefined;
    },
  });
});

import { exportConflictReportPdf } from "../../artifacts/workbench/src/lib/exportConflictReportPdf";
import { exportShippingReportPdf } from "../../artifacts/workbench/src/lib/exportShippingReportPdf";
import { exportTopicReportPdf } from "../../artifacts/workbench/src/lib/exportTopicReportPdf";
import { buildConflictReportDataset } from "../../artifacts/workbench/src/lib/conflictReportDataset";
import type { ConflictReportIncident } from "../../artifacts/workbench/src/lib/conflictReportDataset";
import { buildShippingReportDataset } from "../../artifacts/workbench/src/lib/shippingReportDataset";
import type { ShippingReportIncident } from "../../artifacts/workbench/src/lib/shippingReportDataset";
import { filterTopicReportIncidents } from "../../artifacts/workbench/src/lib/topicFastFacts";
import type { TopicFastFactsIncident } from "../../artifacts/workbench/src/lib/topicFastFacts";
import { selectRelatedIncidents } from "../../artifacts/workbench/src/lib/relatedIncidents";
import {
  deterministicIncidentSummary,
  resolveIncidentSummary,
} from "../../artifacts/workbench/src/lib/incidentSummary";

// Read the recorded text + reset hook back off the mocked module.
const pdfChromeMock = jest.requireMock(PDF_CHROME_PATH) as {
  __textCalls: string[];
  __reset: () => void;
};

function textAfter(run: () => Promise<unknown>): Promise<string[]> {
  pdfChromeMock.__reset();
  return run().then(() => [...pdfChromeMock.__textCalls]);
}

const ISSUE_DATE = "2026-06-15";

// Build a summaries map covering every row except the last, so exactly one row
// must fall back to its deterministic line.
function summariesForAllButLast<T extends { id: number | string }>(
  rows: T[],
  text: (r: T) => string,
): Record<string, string> {
  const map: Record<string, string> = {};
  rows.slice(0, -1).forEach((r) => {
    map[String(r.id)] = text(r);
  });
  return map;
}

// ---------------------------------------------------------------------------
// Conflict Watch PDF (exportConflictReportPdf -> drawRelatedIncidents).
// ---------------------------------------------------------------------------

function confInc(
  over: Partial<ConflictReportIncident> & {
    id: number | string;
    severity: string;
    country: string;
    title: string;
  },
): ConflictReportIncident {
  return {
    topic: "conflict",
    occurredAt: "2026-06-14T08:00:00+00:00",
    summary: null,
    source: "Test Wire",
    sourceUrl: `https://example.com/${over.id}`,
    location: null,
    ...over,
  };
}

const CONFLICT_INCIDENTS: ConflictReportIncident[] = [
  confInc({
    id: 1,
    country: "Philippines",
    severity: "high",
    title: "Armed clashes between troops and militants near the outpost",
  }),
  confInc({
    id: 2,
    country: "Myanmar",
    severity: "moderate",
    title: "Militants ambush an army patrol on the highway",
  }),
  confInc({
    id: 3,
    country: "India",
    severity: "low",
    title: "Armed clashes between troops and militants reported overnight",
  }),
];

const CONFLICT_DATA = {
  title: "Conflict Watch",
  topic: "conflict",
  issueDate: ISSUE_DATE,
};

function conflictRows() {
  return buildConflictReportDataset(CONFLICT_INCIDENTS, "conflict", ISSUE_DATE)
    .relatedIncidents;
}

describe("Conflict PDF — Related Incidents summary line emitted", () => {
  it("draws the generated AI summary under each related incident row", async () => {
    const rows = conflictRows();
    expect(rows.length).toBeGreaterThan(0);
    const summaries: Record<string, string> = {};
    rows.forEach((r, idx) => {
      summaries[String(r.id)] = `Generated conflict summary number ${idx}.`;
    });

    const text = await textAfter(() =>
      exportConflictReportPdf(
        CONFLICT_DATA,
        CONFLICT_INCIDENTS,
        "conflict.pdf",
        null,
        summaries,
      ),
    );

    for (const summary of Object.values(summaries)) {
      expect(text).toContain(summary);
    }
  });

  it("draws the analyst's saved EDIT in place of the generated line", async () => {
    const rows = conflictRows();
    const target = rows[0];
    const edit = "ANALYST EDIT: militants and troops clashed at the outpost.";
    const summaries: Record<string, string> = { [String(target.id)]: edit };

    const text = await textAfter(() =>
      exportConflictReportPdf(
        CONFLICT_DATA,
        CONFLICT_INCIDENTS,
        "conflict.pdf",
        null,
        summaries,
      ),
    );

    expect(text).toContain(edit);
    // The drawn line is exactly what the shared selector resolves for that row.
    expect(resolveIncidentSummary(target, summaries)).toBe(edit);
  });

  it("falls back to the deterministic line when a row has no summary", async () => {
    const rows = conflictRows();
    const summaries = summariesForAllButLast(
      rows,
      (r) => `Generated for ${r.id}.`,
    );
    const fallbackRow = rows[rows.length - 1];
    const fallback = deterministicIncidentSummary(fallbackRow);
    expect(fallback.length).toBeGreaterThan(0);

    const text = await textAfter(() =>
      exportConflictReportPdf(
        CONFLICT_DATA,
        CONFLICT_INCIDENTS,
        "conflict.pdf",
        null,
        summaries,
      ),
    );

    expect(text).toContain(fallback);
    expect(resolveIncidentSummary(fallbackRow, summaries)).toBe(fallback);
  });
});

// ---------------------------------------------------------------------------
// Shipping Watch PDF (exportShippingReportPdf -> drawRelatedIncidents).
// ---------------------------------------------------------------------------

const SHIP_INCIDENTS: ShippingReportIncident[] = [
  {
    id: "s1",
    topic: "shipping",
    title: "Tanker attacked by armed skiffs in the Gulf of Aden",
    severity: "high",
    occurredAt: "2026-06-14T08:00:00+00:00",
    country: "Yemen",
    summary: "Armed men in skiffs attacked a tanker underway.",
    source: "Test Wire",
    sourceUrl: "https://example.com/s1",
    location: null,
  },
  {
    id: "s2",
    topic: "shipping",
    title: "Cargo vessel boarded and crew robbed in the Singapore Strait",
    severity: "moderate",
    occurredAt: "2026-06-12T08:00:00+00:00",
    country: "Singapore",
    summary: "Robbers boarded a bulk carrier and stole stores.",
    source: "Test Wire",
    sourceUrl: "https://example.com/s2",
    location: null,
  },
];

const SHIP_DATA = {
  title: "Shipping Watch",
  topic: "shipping",
  issueDate: ISSUE_DATE,
};

function shippingRows() {
  return buildShippingReportDataset(SHIP_INCIDENTS, "shipping", ISSUE_DATE, [])
    .relatedIncidents;
}

describe("Shipping PDF — Related Incidents summary line emitted", () => {
  it("draws the generated AI summary under each related incident row", async () => {
    const rows = shippingRows();
    expect(rows.length).toBeGreaterThan(0);
    const summaries: Record<string, string> = {};
    rows.forEach((r, idx) => {
      summaries[String(r.id)] = `Generated shipping summary number ${idx}.`;
    });

    const text = await textAfter(() =>
      exportShippingReportPdf(
        SHIP_DATA,
        SHIP_INCIDENTS,
        "shipping.pdf",
        [],
        [],
        summaries,
      ),
    );

    for (const summary of Object.values(summaries)) {
      expect(text).toContain(summary);
    }
  });

  it("draws the analyst's saved EDIT in place of the generated line", async () => {
    const rows = shippingRows();
    const target = rows[0];
    const edit = "ANALYST EDIT: a laden tanker was fired on by skiffs off Yemen.";
    const summaries: Record<string, string> = { [String(target.id)]: edit };

    const text = await textAfter(() =>
      exportShippingReportPdf(
        SHIP_DATA,
        SHIP_INCIDENTS,
        "shipping.pdf",
        [],
        [],
        summaries,
      ),
    );

    expect(text).toContain(edit);
    expect(resolveIncidentSummary(target, summaries)).toBe(edit);
  });

  it("falls back to the deterministic line when a row has no summary", async () => {
    const rows = shippingRows();
    const summaries = summariesForAllButLast(
      rows,
      (r) => `Generated for ${r.id}.`,
    );
    const fallbackRow = rows[rows.length - 1];
    const fallback = deterministicIncidentSummary(fallbackRow);
    expect(fallback.length).toBeGreaterThan(0);

    const text = await textAfter(() =>
      exportShippingReportPdf(
        SHIP_DATA,
        SHIP_INCIDENTS,
        "shipping.pdf",
        [],
        [],
        summaries,
      ),
    );

    expect(text).toContain(fallback);
    expect(resolveIncidentSummary(fallbackRow, summaries)).toBe(fallback);
  });
});

// ---------------------------------------------------------------------------
// Topic PDF (exportTopicReportPdf -> drawRelatedIncidents, via the shared
// filterTopicReportIncidents + selectRelatedIncidents selector).
// ---------------------------------------------------------------------------

const TOPIC_INCIDENTS: TopicFastFactsIncident[] = [
  {
    id: "e1",
    topic: "energy",
    title: "Power grid blackout disrupts Jakarta",
    severity: "high",
    occurredAt: "2026-06-14T00:00:00.000Z",
    country: "Indonesia",
    summary: "A power outage hit the capital.",
    source: "Test Source",
  },
  {
    id: "e2",
    topic: "energy",
    title: "Substation fire causes rolling blackout in Manila",
    severity: "moderate",
    occurredAt: "2026-06-12T00:00:00.000Z",
    country: "Philippines",
    summary: "Rolling blackouts followed a substation failure.",
    source: "Test Source",
  },
  {
    id: "e3",
    topic: "energy",
    title: "Gas shortage triggers power rationing in Indonesia",
    severity: "low",
    occurredAt: "2026-06-10T00:00:00.000Z",
    country: "Indonesia",
    summary: "Energy rationing introduced amid a gas shortage.",
    source: "Test Source",
  },
];

const TOPIC_DATA = {
  title: "Energy Watch",
  topic: "energy",
  issueDate: ISSUE_DATE,
};

const TOPIC_LABELS = { energy: "Energy" };

function topicRows() {
  return selectRelatedIncidents(
    filterTopicReportIncidents(TOPIC_INCIDENTS, "energy", ISSUE_DATE),
    "energy",
  );
}

describe("Topic PDF — Related Incidents summary line emitted", () => {
  it("draws the generated AI summary under each related incident row", async () => {
    const rows = topicRows();
    expect(rows.length).toBeGreaterThan(0);
    const summaries: Record<string, string> = {};
    rows.forEach((r, idx) => {
      summaries[String(r.id)] = `Generated topic summary number ${idx}.`;
    });

    const text = await textAfter(() =>
      exportTopicReportPdf(TOPIC_DATA, TOPIC_INCIDENTS, TOPIC_LABELS, "energy.pdf", {
        incidentSummaries: summaries,
      }),
    );

    for (const summary of Object.values(summaries)) {
      expect(text).toContain(summary);
    }
  });

  it("draws the analyst's saved EDIT in place of the generated line", async () => {
    const rows = topicRows();
    const target = rows[0];
    const edit = "ANALYST EDIT: a grid failure left Jakarta without power.";
    const summaries: Record<string, string> = { [String(target.id)]: edit };

    const text = await textAfter(() =>
      exportTopicReportPdf(TOPIC_DATA, TOPIC_INCIDENTS, TOPIC_LABELS, "energy.pdf", {
        incidentSummaries: summaries,
      }),
    );

    expect(text).toContain(edit);
    expect(resolveIncidentSummary(target, summaries)).toBe(edit);
  });

  it("falls back to the deterministic line when a row has no summary", async () => {
    const rows = topicRows();
    const summaries = summariesForAllButLast(
      rows,
      (r) => `Generated for ${r.id}.`,
    );
    const fallbackRow = rows[rows.length - 1];
    const fallback = deterministicIncidentSummary(fallbackRow);
    expect(fallback.length).toBeGreaterThan(0);

    const text = await textAfter(() =>
      exportTopicReportPdf(TOPIC_DATA, TOPIC_INCIDENTS, TOPIC_LABELS, "energy.pdf", {
        incidentSummaries: summaries,
      }),
    );

    expect(text).toContain(fallback);
    expect(resolveIncidentSummary(fallbackRow, summaries)).toBe(fallback);
  });
});
