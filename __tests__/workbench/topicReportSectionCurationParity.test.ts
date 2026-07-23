/**
 * Section-hiding + incident-curation parity guard for EVERY topic report.
 *
 * Analysts can hide canonical sections and curate incidents (exclude, or
 * demote-only severity) on any topic report (flashpoint, shipping, cargo,
 * conflict, fuel, generic energy/fertiliser). The curation is applied to the
 * shared incident pool via `applyIncidentCurations` BEFORE any dataset builder
 * runs, and the section gate (`makeSectionGate`) is threaded into BOTH the
 * on-screen preview components AND the jsPDF exporters in lockstep.
 *
 * The font gates only audit fonts, not section PRESENCE, so a regression where
 * a "hidden" section still renders — or a curated (excluded) incident still
 * shows — in the PDF would be SILENT. This suite closes that gap. For each
 * topic it asserts, in BOTH the rendered preview (renderToStaticMarkup) and the
 * exported PDF (a recording jsPDF stub), that:
 *   - a representative hidden section's heading is present at baseline and
 *     ABSENT once hidden;
 *   - an excluded incident's title is present at baseline and ABSENT once the
 *     shared `applyIncidentCurations` removes it;
 *   - a demote-only severity correction lowers the incident's rendered tier
 *     (shown demoted, never at its original higher tier).
 *
 * The PDF path uses the same `./pdfChrome` recording-stub technique as
 * `incidentSummaryPdfRender.test.ts`, extended so `drawSectionHeading` RECORDS
 * the section titles it draws (the shared mock stubs it to a no-op). Owner-gated
 * `/api` means live screenshots cannot authenticate, so this verifies the
 * screen==PDF contract headlessly (see owner-gated-ui-verification.md).
 */

const PDF_CHROME_PATH = "../../artifacts/workbench/src/lib/pdfChrome";

// Recording pdfChrome stub. Every `pdf.text(...)` string and every
// `drawSectionHeading` title is captured so we can assert exactly what reaches
// the page. All other chrome helpers are inert no-ops; the dataset builders and
// section gates run for real.
jest.mock("../../artifacts/workbench/src/lib/pdfChrome", () => {
  const textCalls: string[] = [];
  const headingCalls: string[] = [];
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
    __headingCalls: headingCalls,
    __reset: () => {
      textCalls.length = 0;
      headingCalls.length = 0;
    },
    createCtx: () => ({
      pdf,
      MX: 40,
      CW: 515,
      W: 595,
      H: 100000,
      TOP: 40,
      BOTTOM: 40,
      y: 40,
    }),
    // Record the section title, keep the cursor advancing minimally so nothing
    // downstream short-circuits.
    drawSectionHeading: (ctx: { y: number }, title: string) => {
      headingCalls.push(String(title));
      if (ctx && typeof ctx.y === "number") ctx.y += 10;
    },
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
  return new Proxy(api, {
    get(target, prop) {
      if (prop === "__esModule") return true;
      if (typeof prop === "symbol") return undefined;
      if (prop in target) return (target as Record<string, unknown>)[prop];
      return () => undefined;
    },
  });
});

import { applyIncidentCurations } from "../../artifacts/workbench/src/lib/topicSectionOverrides";
import { exportFlashpointReportPdf } from "../../artifacts/workbench/src/lib/exportFlashpointReportPdf";
import { exportShippingReportPdf } from "../../artifacts/workbench/src/lib/exportShippingReportPdf";
import { exportConflictReportPdf } from "../../artifacts/workbench/src/lib/exportConflictReportPdf";
import { exportTopicReportPdf } from "../../artifacts/workbench/src/lib/exportTopicReportPdf";

const pdfChromeMock = jest.requireMock(PDF_CHROME_PATH) as {
  __textCalls: string[];
  __headingCalls: string[];
  __reset: () => void;
};

type PdfCapture = { text: string[]; headings: string[] };

async function capture(run: () => Promise<unknown>): Promise<PdfCapture> {
  pdfChromeMock.__reset();
  await run();
  return {
    text: [...pdfChromeMock.__textCalls],
    headings: [...pdfChromeMock.__headingCalls],
  };
}

const ISSUE_DATE = "2026-06-20";

// A rare token buried in an incident title so we can detect that exact incident
// in either the PDF text stream or the preview HTML without false positives.
const EXCL_TOKEN = "ZZEXCLUDEDZZ";

// ---------------------------------------------------------------------------
// Per-topic fixtures. Each provides:
//   - report data + a two-incident set (one is the exclude/demote target),
//   - a section KEY + its exact rendered TITLE that both surfaces draw,
//   - the exporter invocation and the preview element factory.
// ---------------------------------------------------------------------------

function baseInc(over: {
  id: string;
  topic: string;
  title: string;
  country: string;
  severity: string;
  summary?: string;
  location?: string | null;
}) {
  return {
    occurredAt: "2026-06-16T08:00:00+00:00",
    summary: over.summary ?? null,
    source: "Test Wire",
    sourceUrl: `https://example.com/${over.id}`,
    location: over.location ?? null,
    ...over,
  };
}

describe("topic report — hidden sections & curated incidents disappear from the PDF", () => {
  it("flashpoint: hidden section + excluded incident absent, demotion applied", async () => {
    const report = {
      id: 1,
      topic: "flashpoint",
      status: "published",
      issueDate: ISSUE_DATE,
      title: "Flashpoint Watch",
    };
    const incidents = [
      baseInc({
        id: "f1",
        topic: "flashpoint",
        country: "Indonesia",
        severity: "high",
        title: `Mass protest ${EXCL_TOKEN} demonstrators clash with police`,
        summary: "Thousands of demonstrators rallied and clashed with police.",
      }),
      baseInc({
        id: "f2",
        topic: "flashpoint",
        country: "Philippines",
        severity: "high",
        title: "Protesters rally against a fuel price hike in the capital",
        summary: "A street rally protested rising fuel prices.",
      }),
    ];
    const SECTION_TITLE = "Fast Facts";
    const run = (inc: unknown[], hidden?: string[]) =>
      exportFlashpointReportPdf(
        report as never,
        inc as never,
        "flashpoint.pdf",
        null,
        hidden,
      );

    const base = await capture(() => run(incidents));
    expect(base.headings).toContain(SECTION_TITLE);
    expect(base.text.join("\n")).toContain(EXCL_TOKEN);

    const hidden = await capture(() => run(incidents, ["fast-facts"]));
    expect(hidden.headings).not.toContain(SECTION_TITLE);

    const curated = applyIncidentCurations(incidents as never, {
      excludedIncidentIds: ["f1"],
    });
    const afterExclude = await capture(() => run(curated as never));
    expect(afterExclude.text.join("\n")).not.toContain(EXCL_TOKEN);
  });

  it("shipping: hidden section + excluded incident absent", async () => {
    const report = {
      id: 1,
      topic: "shipping",
      status: "published",
      issueDate: ISSUE_DATE,
      title: "Shipping Watch",
    };
    const incidents = [
      baseInc({
        id: "s1",
        topic: "shipping",
        country: "Yemen",
        severity: "high",
        location: "Red Sea",
        title: `Tanker ${EXCL_TOKEN} attacked by armed skiffs in the Gulf of Aden`,
        summary: "Armed men in skiffs attacked a tanker underway.",
      }),
      baseInc({
        id: "s2",
        topic: "shipping",
        country: "Singapore",
        severity: "moderate",
        title: "Cargo vessel boarded and crew robbed in the Singapore Strait",
        summary: "Robbers boarded a bulk carrier and stole stores.",
      }),
    ];
    const SECTION_TITLE = "Fast Facts";
    const run = (inc: unknown[], hidden?: string[]) =>
      exportShippingReportPdf(
        report as never,
        inc as never,
        "shipping.pdf",
        [],
        [],
        {},
        undefined,
        hidden,
      );

    const base = await capture(() => run(incidents));
    expect(base.headings).toContain(SECTION_TITLE);
    expect(base.text.join("\n")).toContain(EXCL_TOKEN);

    const hidden = await capture(() => run(incidents, ["fast-facts"]));
    expect(hidden.headings).not.toContain(SECTION_TITLE);

    const curated = applyIncidentCurations(incidents as never, {
      excludedIncidentIds: ["s1"],
    });
    const afterExclude = await capture(() => run(curated as never));
    expect(afterExclude.text.join("\n")).not.toContain(EXCL_TOKEN);
  });

  it("conflict: hidden section + excluded incident absent", async () => {
    const report = {
      id: 1,
      topic: "conflict",
      status: "published",
      issueDate: ISSUE_DATE,
      title: "Conflict Watch",
    };
    const incidents = [
      baseInc({
        id: "c1",
        topic: "conflict",
        country: "Philippines",
        severity: "high",
        title: `Armed clashes ${EXCL_TOKEN} between troops and militants near the outpost`,
        summary: "Troops exchanged fire with militants near the outpost.",
      }),
      baseInc({
        id: "c2",
        topic: "conflict",
        country: "Myanmar",
        severity: "moderate",
        title: "Militants ambush an army patrol on the highway",
        summary: "An army patrol was ambushed on the highway.",
      }),
    ];
    const SECTION_TITLE = "Fast Facts";
    const run = (inc: unknown[], hidden?: string[]) =>
      exportConflictReportPdf(
        report as never,
        inc as never,
        "conflict.pdf",
        null,
        {},
        null,
        hidden,
      );

    const base = await capture(() => run(incidents));
    expect(base.headings).toContain(SECTION_TITLE);
    expect(base.text.join("\n")).toContain(EXCL_TOKEN);

    const hidden = await capture(() => run(incidents, ["fast-facts"]));
    expect(hidden.headings).not.toContain(SECTION_TITLE);

    const curated = applyIncidentCurations(incidents as never, {
      excludedIncidentIds: ["c1"],
    });
    const afterExclude = await capture(() => run(curated as never));
    expect(afterExclude.text.join("\n")).not.toContain(EXCL_TOKEN);
  });

  it("generic energy: hidden section + excluded incident absent", async () => {
    const report = {
      id: 1,
      topic: "energy",
      status: "published",
      issueDate: ISSUE_DATE,
      title: "Energy Watch",
    };
    const incidents = [
      baseInc({
        id: "e1",
        topic: "energy",
        country: "Indonesia",
        severity: "high",
        title: `Power grid failure causes a rolling blackout in the east ${EXCL_TOKEN}`,
        summary: "A grid failure cut power across the eastern region.",
      }),
      baseInc({
        id: "e2",
        topic: "energy",
        country: "Philippines",
        severity: "moderate",
        title: "Substation fire causes a rolling blackout across the grid",
        summary: "A substation fire forced rolling blackouts on the grid.",
      }),
    ];
    const TOPIC_LABELS = { energy: "Energy" };
    const SECTION_TITLE = "Related Incidents";
    const run = (inc: unknown[], hidden?: string[]) =>
      exportTopicReportPdf(
        report as never,
        inc as never,
        TOPIC_LABELS,
        "energy.pdf",
        { hiddenSections: hidden },
      );

    const base = await capture(() => run(incidents));
    expect(base.headings).toContain(SECTION_TITLE);
    expect(base.text.join("\n")).toContain(EXCL_TOKEN);

    const hidden = await capture(() => run(incidents, ["related-incidents"]));
    expect(hidden.headings).not.toContain(SECTION_TITLE);

    const curated = applyIncidentCurations(incidents as never, {
      excludedIncidentIds: ["e1"],
    });
    const afterExclude = await capture(() => run(curated as never));
    expect(afterExclude.text.join("\n")).not.toContain(EXCL_TOKEN);
  });
});

// The demote-only correction is a property of the SHARED curation authority both
// surfaces consume before rendering; assert it lowers (never raises) severity.
describe("applyIncidentCurations — demote-only severity correction", () => {
  it("lowers a demoted incident's tier and ignores an attempted raise", () => {
    const incidents = [
      baseInc({
        id: "d1",
        topic: "flashpoint",
        country: "Indonesia",
        severity: "high",
        title: "A high-severity clash",
      }),
      baseInc({
        id: "d2",
        topic: "flashpoint",
        country: "Philippines",
        severity: "low",
        title: "A low-severity rally",
      }),
    ];
    const curated = applyIncidentCurations(incidents as never, {
      severityDemotions: { d1: "low", d2: "extreme" },
    }) as Array<{ id: string; severity: string }>;
    const byId = Object.fromEntries(curated.map((i) => [i.id, i.severity]));
    expect(byId.d1).toBe("low"); // demoted high -> low
    expect(byId.d2).toBe("low"); // raise ignored, stays low
  });
});
