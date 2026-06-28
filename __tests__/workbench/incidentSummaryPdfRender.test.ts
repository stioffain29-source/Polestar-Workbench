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
// Long-report cap-crossing parity (regression guard).
//
// The per-incident AI summaries are GENERATED for a capped set keyed by id, and
// resolveIncidentSummary silently falls back to the deterministic line for any
// row whose id is missing from the map. So if the editor ever requested
// summaries for a DIFFERENT set of rows than an exporter actually draws — a
// different cap, ordering or dedup pass once the input pool is large — some PDF
// rows would silently show the deterministic line while the preview showed the
// richer AI line: the exact preview/PDF divergence this feature must prevent.
//
// The small-dataset tests above never cross the generation cap
// (MAX_PROSE_INCIDENTS = 60 on the server). Here we feed each exporter an input
// pool LARGER than that cap and assert, for the shipping AND topic exporters:
//   - the id set the editor would request summaries for (relatedForSummaries in
//     ReportEditor) is EXACTLY the id set the exporter renders — no row drawn
//     that was never offered a summary, and no requested id that is not drawn;
//   - with an AI summary supplied for every requested id, NO rendered row
//     silently falls back to its deterministic line.
// ---------------------------------------------------------------------------

const POOL_SIZE = 75; // > SERVER_GENERATION_CAP (60)

// The server caps the incident set it FINGERPRINTS and generates summaries for
// at MAX_PROSE_INCIDENTS = 60 (artifacts/api-server/src/lib/countryProse.ts,
// via canonicalIncidents). Any incident the editor requests BEYOND this cap is
// dropped from the canonical set, so it receives no AI summary and
// resolveIncidentSummary silently falls back to its deterministic line. We
// cannot import that constant here: countryProse.ts pulls in @workspace/ingest,
// whose dev-env loader uses import.meta and breaks every ts-jest suite that
// imports it. So we pin the value locally and assert against it.
const SERVER_GENERATION_CAP = 60;

// Faithful replica of the server's canonicalIncidents: deterministically order
// (most-recent first, then title, then id) and truncate to the cap. The summary
// map the server returns is keyed by the ids that SURVIVE this truncation, so
// this is exactly the boundary at which a requested row loses its AI summary.
function serverCanonicalIds(
  rows: Array<{ id: string; title: string; occurredAt: string }>,
  cap: number,
): string[] {
  return [...rows]
    .sort((a, b) => {
      const da = a.occurredAt.slice(0, 10);
      const db = b.occurredAt.slice(0, 10);
      if (da !== db) return da < db ? 1 : -1; // most recent first
      const t = a.title.localeCompare(b.title);
      if (t !== 0) return t;
      return a.id.localeCompare(b.id);
    })
    .slice(0, cap)
    .map((r) => r.id);
}

// Collision-proof per-id sentinel: a drawn row is detectable by id and can
// never be confused with a title or prose fragment.
const aiSentinel = (id: string) => `AISUMMARY-${id}-ENDMARK`;

// The ids whose AI sentinel actually reached the page. We supply a sentinel for
// EVERY input incident (not just the requested set) so a row drawn that the
// editor never offered a summary for is also detectable here.
function drawnIdsFrom(text: string[], allIds: string[]): Set<string> {
  const has = new Set(text);
  return new Set(allIds.filter((id) => has.has(aiSentinel(id))));
}

function expectSameIdSet(a: Set<string>, b: Set<string>) {
  expect([...a].sort()).toEqual([...b].sort());
}

// Spread occurredAt across the inclusive weekly window (issue date 2026-06-15
// covers 09..15 June) so every row is in-window.
const windowDay = (i: number) => String(9 + (i % 7)).padStart(2, "0");

describe("Long Shipping PDF — editor-requested ids match the drawn rows", () => {
  // Distinct in their first significant title tokens (so the selector's
  // title-dedupe keeps them separate) and unambiguously shipping-relevant.
  const LONG_SHIP_INCIDENTS: ShippingReportIncident[] = Array.from(
    { length: POOL_SIZE },
    (_, i) => ({
      id: `ts${i}`,
      topic: "shipping",
      title: `Tanker attacked by armed skiffs in the Gulf of Aden incident ${i}`,
      severity: i % 2 === 0 ? "high" : "moderate",
      occurredAt: `2026-06-${windowDay(i)}T08:00:00+00:00`,
      country: "Yemen",
      summary: `Armed men in skiffs attacked a tanker underway, case ${i}.`,
      source: "Test Wire",
      sourceUrl: `https://example.com/ts${i}`,
      location: null,
    }),
  );

  // The exact set the editor requests summaries for: ReportEditor's
  // relatedForSummaries for shipping is buildShippingReportDataset(...)
  // .relatedIncidents — the SAME builder the exporter draws from.
  function editorRequestedRows() {
    return buildShippingReportDataset(
      LONG_SHIP_INCIDENTS,
      "shipping",
      ISSUE_DATE,
      [],
    ).relatedIncidents;
  }

  it("pool exceeds the generation cap and the rendered set is parity-locked", async () => {
    expect(LONG_SHIP_INCIDENTS.length).toBeGreaterThanOrEqual(60);
    const requested = editorRequestedRows();
    const requestedIds = new Set(requested.map((r) => String(r.id)));
    expect(requestedIds.size).toBeGreaterThan(0);

    // PROTECTIVE INVARIANT: even from a >60 input pool the editor never REQUESTS
    // more summaries than the server will fingerprint/generate for, so the
    // server's canonical 60-cap can never silently drop a RENDERED row's
    // summary. If a future cap raise breaks this, the truncation test below
    // shows what would start failing silently in the PDF.
    expect(requestedIds.size).toBeLessThanOrEqual(SERVER_GENERATION_CAP);

    const summaries: Record<string, string> = {};
    for (const inc of LONG_SHIP_INCIDENTS)
      summaries[String(inc.id)] = aiSentinel(String(inc.id));

    const text = await textAfter(() =>
      exportShippingReportPdf(
        SHIP_DATA,
        LONG_SHIP_INCIDENTS,
        "shipping.pdf",
        [],
        [],
        summaries,
      ),
    );

    const drawnIds = drawnIdsFrom(
      text,
      LONG_SHIP_INCIDENTS.map((i) => String(i.id)),
    );
    // The drawn rows are EXACTLY the rows the editor requested summaries for.
    expectSameIdSet(drawnIds, requestedIds);

    // No rendered row silently fell back to its deterministic line.
    for (const row of requested) {
      expect(text).not.toContain(deterministicIncidentSummary(row));
      expect(text).toContain(aiSentinel(String(row.id)));
    }
  });
});

describe("Long Topic PDF — editor-requested ids match the drawn rows", () => {
  const LONG_TOPIC_INCIDENTS: TopicFastFactsIncident[] = Array.from(
    { length: POOL_SIZE },
    (_, i) => ({
      id: `te${i}`,
      topic: "energy",
      title: `Power grid failure causes a rolling blackout in sector ${i}`,
      severity: i % 2 === 0 ? "high" : "moderate",
      occurredAt: `2026-06-${windowDay(i)}T08:00:00.000Z`,
      country: "Indonesia",
      summary: `Grid outage number ${i} cut power to a district.`,
      source: "Test Source",
    }),
  );

  // ReportEditor's relatedForSummaries for a generic topic: window-filter on
  // the issue date, then selectRelatedIncidents — the SAME pipeline the topic
  // exporter runs inside drawRelatedIncidents.
  function editorRequestedRows() {
    return selectRelatedIncidents(
      filterTopicReportIncidents(LONG_TOPIC_INCIDENTS, "energy", ISSUE_DATE),
      "energy",
    );
  }

  it("pool exceeds the generation cap and the rendered set is parity-locked", async () => {
    expect(LONG_TOPIC_INCIDENTS.length).toBeGreaterThanOrEqual(60);
    const requested = editorRequestedRows();
    const requestedIds = new Set(requested.map((r) => String(r.id)));
    expect(requestedIds.size).toBeGreaterThan(0);

    // PROTECTIVE INVARIANT (see the shipping test): from a >60 pool the editor
    // still requests at most the server generation cap, so no rendered row can
    // be silently dropped by the server's canonical 60-cap truncation.
    expect(requestedIds.size).toBeLessThanOrEqual(SERVER_GENERATION_CAP);

    const summaries: Record<string, string> = {};
    for (const inc of LONG_TOPIC_INCIDENTS)
      summaries[String(inc.id)] = aiSentinel(String(inc.id));

    const text = await textAfter(() =>
      exportTopicReportPdf(
        TOPIC_DATA,
        LONG_TOPIC_INCIDENTS,
        TOPIC_LABELS,
        "energy.pdf",
        { incidentSummaries: summaries },
      ),
    );

    const drawnIds = drawnIdsFrom(
      text,
      LONG_TOPIC_INCIDENTS.map((i) => String(i.id)),
    );
    expectSameIdSet(drawnIds, requestedIds);

    for (const row of requested) {
      expect(text).not.toContain(deterministicIncidentSummary(row));
      expect(text).toContain(aiSentinel(String(row.id)));
    }
  });
});

describe("Long Conflict PDF — editor-requested ids match the drawn rows", () => {
  // Distinct in their first significant title tokens — the per-row index sits
  // INSIDE the first eight significant words so selectRelatedIncidents' title
  // dedupe keeps them separate — and unambiguously conflict-relevant (kinetic,
  // casualty-bearing) so none drops to the weak bucket.
  const LONG_CONFLICT_INCIDENTS: ConflictReportIncident[] = Array.from(
    { length: POOL_SIZE },
    (_, i) =>
      confInc({
        id: `tc${i}`,
        country: "Philippines",
        severity: i % 2 === 0 ? "high" : "moderate",
        title: `Armed clash ${i} kills militants and troops near an outpost`,
        occurredAt: `2026-06-${windowDay(i)}T08:00:00+00:00`,
        summary: `Militants and troops clashed near an outpost, case ${i}.`,
      }),
  );

  // The exact set the editor requests summaries for: ReportEditor's
  // relatedForSummaries for conflict is buildConflictReportDataset(...)
  // .relatedIncidents — the SAME builder the exporter draws from.
  function editorRequestedRows() {
    return buildConflictReportDataset(
      LONG_CONFLICT_INCIDENTS,
      "conflict",
      ISSUE_DATE,
    ).relatedIncidents;
  }

  it("pool exceeds the generation cap and the rendered set is parity-locked", async () => {
    expect(LONG_CONFLICT_INCIDENTS.length).toBeGreaterThanOrEqual(60);
    const requested = editorRequestedRows();
    const requestedIds = new Set(requested.map((r) => String(r.id)));
    expect(requestedIds.size).toBeGreaterThan(0);

    // PROTECTIVE INVARIANT (see the shipping/topic tests): from a >60 input
    // pool the editor still requests at most the server generation cap, so the
    // server's canonical 60-cap can never silently drop a RENDERED conflict
    // row's summary.
    expect(requestedIds.size).toBeLessThanOrEqual(SERVER_GENERATION_CAP);

    const summaries: Record<string, string> = {};
    for (const inc of LONG_CONFLICT_INCIDENTS)
      summaries[String(inc.id)] = aiSentinel(String(inc.id));

    const text = await textAfter(() =>
      exportConflictReportPdf(
        CONFLICT_DATA,
        LONG_CONFLICT_INCIDENTS,
        "conflict.pdf",
        null,
        summaries,
      ),
    );

    const drawnIds = drawnIdsFrom(
      text,
      LONG_CONFLICT_INCIDENTS.map((i) => String(i.id)),
    );
    // The drawn rows are EXACTLY the rows the editor requested summaries for.
    expectSameIdSet(drawnIds, requestedIds);

    // No rendered row silently fell back to its deterministic line.
    for (const row of requested) {
      expect(text).not.toContain(deterministicIncidentSummary(row));
      expect(text).toContain(aiSentinel(String(row.id)));
    }
  });
});

// ---------------------------------------------------------------------------
// Generation-cap truncation boundary (the failure mode the invariant guards).
//
// The two parity tests above prove the editor's requested set survives intact
// today because it is far below the server's 60-incident generation cap. This
// test makes the BOUNDARY itself concrete: feed a >60 requested set through a
// faithful replica of the server's canonical-cap truncation, build the summary
// map exactly as the server would (keyed ONLY by the surviving ids), and prove
// that:
//   - every SURVIVING (top-60) row resolves to its AI line, and
//   - every TRUNCATED (61st+) row silently falls back to its deterministic line
//     — no error, no marker, indistinguishable from "AI unavailable".
// This is the exact silent divergence that would reach the PDF if the editor
// ever requested more rows than the server generates for, which is why the
// parity tests assert requestedIds.size <= SERVER_GENERATION_CAP.
// ---------------------------------------------------------------------------
describe("Server generation cap truncates summaries past 60 -> silent fallback", () => {
  // 75 rows with strictly DECREASING dates, so the server's most-recent-first
  // canonical order equals index order: survivors are cap00..cap59, the dropped
  // overflow is cap60..cap74.
  const CAP_POOL = Array.from({ length: POOL_SIZE }, (_, i) => ({
    id: `cap${String(i).padStart(2, "0")}`,
    topic: "shipping",
    title: `Cap boundary incident ${String(i).padStart(2, "0")}`,
    severity: "moderate" as const,
    occurredAt: new Date(Date.UTC(2026, 5, 15) - i * 86_400_000).toISOString(),
    country: "Yemen",
    location: null,
    source: "Test Wire",
  }));

  it("only the surviving 60 ids get summaries; the overflow falls back silently", () => {
    expect(CAP_POOL.length).toBeGreaterThan(SERVER_GENERATION_CAP);

    const survivorIds = serverCanonicalIds(CAP_POOL, SERVER_GENERATION_CAP);
    expect(survivorIds.length).toBe(SERVER_GENERATION_CAP);

    // The server returns a summary map keyed ONLY by the surviving ids.
    const generated: Record<string, string> = {};
    for (const sid of survivorIds) generated[sid] = aiSentinel(sid);

    const survivors = new Set(survivorIds);
    const overflow = CAP_POOL.filter((r) => !survivors.has(r.id));
    expect(overflow.length).toBe(POOL_SIZE - SERVER_GENERATION_CAP);

    // Surviving rows resolve to their AI summary.
    for (const row of CAP_POOL) {
      if (!survivors.has(row.id)) continue;
      expect(resolveIncidentSummary(row, generated)).toBe(aiSentinel(row.id));
    }

    // Truncated rows have NO entry in the map -> resolveIncidentSummary silently
    // returns the deterministic line, with no AI marker. This is the regression
    // the requestedIds.size <= cap invariant prevents from ever reaching a PDF.
    for (const row of overflow) {
      const resolved = resolveIncidentSummary(row, generated);
      expect(resolved).toBe(deterministicIncidentSummary(row));
      expect(resolved).not.toContain("AISUMMARY");
    }
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
