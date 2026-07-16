/**
 * @jest-environment jsdom
 *
 * Blank-preview guard for the report editor's live preview panel.
 *
 * The sibling `reportEditorPreviewLayout.test.tsx` only proves the preview
 * stays in the RIGHT COLUMN (it stubs every topic-specific preview component to
 * a marker). It does NOT prove the preview actually renders content: a
 * topic-specific preview component that THROWS or returns empty under realistic
 * data would still leave analysts staring at a blank panel, and nothing would
 * catch it.
 *
 * This test renders the REAL `ReportEditor` for EVERY report topic
 * (conflict, shipping, flashpoint, protests, cargo_watch, energy, fertiliser,
 * fuel) with a small realistic incident set, with the per-topic preview
 * components rendered FOR REAL (NOT stubbed). The only stubs are the heavy
 * chart/map leaf children (recharts/leaflet) that cannot mount under jsdom —
 * those are redirected to inert placeholders by `jest.config` `moduleNameMapper`
 * (`JetFuelTrajectoryChart`, `CargoTrendChart`, `IncidentMap`, `CountryReportMap`,
 * `SituationalContextSection`). Because the preview branches render for real, a
 * crash in any topic's preview branch fails the test here.
 *
 * It asserts, per topic:
 *   1. the preview box (the `previewRef` container) renders inside the SECOND
 *      (right) grid column, and
 *   2. it holds substantial, non-empty content (the report title plus a healthy
 *      amount of rendered prose/chrome) — never a blank panel.
 */
import { render, waitFor, within } from "@testing-library/react";

let mockReportData: Record<string, unknown> | undefined;
let mockIncidents: Array<Record<string, unknown>> = [];

jest.mock("wouter", () => ({
  __esModule: true,
  useRoute: () => [true, { id: "1" }],
  Link: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("@tanstack/react-query", () => ({
  __esModule: true,
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));

jest.mock("@workspace/api-client-react", () => ({
  __esModule: true,
  useGetReport: () => ({ data: mockReportData, isLoading: false }),
  useUpdateReport: () => ({ mutate: jest.fn(), isPending: false }),
  useListIncidents: () => ({ data: mockIncidents }),
  useListLatestMaritimeMovement: () => ({ data: [] }),
  useListMaritimeMovement: () => ({ data: [] }),
  useListMaritimeSecurityEvents: () => ({ data: [] }),
  useListReliefWebReports: () => ({ data: [] }),
  useGenerateReportIncidentSummaries: () => ({
    mutate: jest.fn(),
    isPending: false,
  }),
  useEditReportIncidentSummaries: () => ({
    mutate: jest.fn(),
    isPending: false,
  }),
  // The OpenAI prose engine is ABSENT: a 200 {available:false} degrades to the
  // deterministic template prose. The previews must still render in full.
  useGenerateReportProse: () => ({
    mutate: (
      _vars: unknown,
      opts?: { onSuccess?: (res: unknown) => void },
    ) => {
      opts?.onSuccess?.({ available: false, sections: null, edited: null });
    },
    isPending: false,
  }),
  getListMaritimeMovementQueryKey: () => ["maritime-movement"],
  useListMarketPrices: () => ({ data: [] }),
  getListMarketPricesQueryKey: (p?: unknown) => ["market-prices", p],
  getListIncidentsQueryKey: (p?: unknown) => ["incidents", p],
  getGetReportQueryKey: () => ["report"],
  getListReportsQueryKey: () => ["reports"],
  getGetDashboardOverviewQueryKey: () => ["overview"],
}));

// The PDF exporters pull in jspdf/html2canvas (jsdom lacks TextEncoder/canvas)
// and are only invoked on the Download button, not in this test; stub them.
jest.mock("@/lib/exportPdf", () => ({
  __esModule: true,
  exportElementToPdf: jest.fn(),
  slugifyForFilename: (s: string) => s,
}));
jest.mock("@/lib/exportTopicReportPdf", () => ({
  __esModule: true,
  exportTopicReportPdf: jest.fn(),
}));
jest.mock("@/lib/exportFlashpointReportPdf", () => ({
  __esModule: true,
  exportFlashpointReportPdf: jest.fn(),
}));
jest.mock("@/lib/exportShippingReportPdf", () => ({
  __esModule: true,
  exportShippingReportPdf: jest.fn(),
}));
jest.mock("@/lib/exportConflictReportPdf", () => ({
  __esModule: true,
  exportConflictReportPdf: jest.fn(),
}));

// NOTE: unlike the layout guard, the per-topic preview components
// (ShippingReportPreview / FlashpointReportPreview / ConflictReportPreview /
// ReportPreview) are deliberately NOT mocked here — they render for real so a
// crash or empty render in any branch is caught. Their heavy chart/map leaf
// children are stubbed by jest.config `moduleNameMapper`.

// `ReportPreview` transitively imports jsPDF (via pdfChrome), whose Node build
// touches TextEncoder/TextDecoder at module load — absent in this jsdom env.
// Polyfill BEFORE the editor module is required, then load it lazily so the
// polyfill is in place first.
let ReportEditor: React.ComponentType;

beforeAll(() => {
  // jsPDF's Node build needs TextEncoder/TextDecoder at import time.
  if (typeof (globalThis as Record<string, unknown>).TextEncoder === "undefined") {
    const { TextEncoder, TextDecoder } = require("util");
    (globalThis as Record<string, unknown>).TextEncoder = TextEncoder;
    (globalThis as Record<string, unknown>).TextDecoder = TextDecoder;
  }
  ReportEditor = require("@/pages/ReportEditor").default;

  // jsdom is missing a few DOM APIs that Radix primitives touch on mount.
  if (!window.matchMedia) {
    // @ts-expect-error minimal stub
    window.matchMedia = () => ({
      matches: false,
      media: "",
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    });
  }
  // @ts-expect-error minimal stub
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  // @ts-expect-error minimal stub
  window.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  };
  if (!Element.prototype.scrollIntoView)
    Element.prototype.scrollIntoView = () => {};
  if (!Element.prototype.hasPointerCapture)
    Element.prototype.hasPointerCapture = () => false;
  if (!Element.prototype.setPointerCapture)
    Element.prototype.setPointerCapture = () => {};
  if (!Element.prototype.releasePointerCapture)
    Element.prototype.releasePointerCapture = () => {};
});

const TITLE = "Workbench Preview Render Test";

// The issue date sits AFTER every incident below so the records all fall inside
// the report's reporting window (and no stale-prose reseed fires) — the preview
// renders its data-driven sections, not just empty chrome.
const ISSUE_DATE = "2026-06-20";

function report(topic: string): Record<string, unknown> {
  return {
    id: 1,
    topic,
    status: "published",
    issueDate: ISSUE_DATE,
    title: TITLE,
    riskRating: "",
    situation: "",
    whatHappened: "",
    whatMatters: "",
    implications: "",
    polestarView: "",
    watchNext: "",
    author: "",
  };
}

function baseIncident(
  over: Record<string, unknown> & {
    id: string;
    topic: string;
    title: string;
    country: string;
    severity: string;
  },
): Record<string, unknown> {
  return {
    occurredAt: "2026-06-16T08:00:00Z",
    summary: null,
    source: "Test Wire",
    sourceUrl: `https://example.com/${over.id}`,
    location: null,
    ...over,
  };
}

// Per-topic incident sets, each phrased so it survives that topic's preview
// dataset relevance/window filter and reaches the data-driven sections. The
// conflict / shipping / energy sets mirror incidentSummaryRender.test.tsx.
function incidentsFor(topic: string): Array<Record<string, unknown>> {
  switch (topic) {
    case "conflict":
      return [
        baseIncident({
          id: "c1",
          topic: "conflict",
          country: "Philippines",
          severity: "high",
          title: "Armed clashes between troops and militants near the outpost",
          summary: "Troops exchanged fire with militants near the outpost.",
        }),
        baseIncident({
          id: "c2",
          topic: "conflict",
          country: "Myanmar",
          severity: "moderate",
          title: "Militants ambush an army patrol on the highway",
          summary: "An army patrol was ambushed on the highway.",
        }),
      ];
    case "shipping":
      return [
        baseIncident({
          id: "s1",
          topic: "shipping",
          country: "Yemen",
          severity: "high",
          location: "Red Sea",
          title: "Tanker attacked by armed skiffs in the Gulf of Aden",
          summary: "Armed men in skiffs attacked a tanker underway.",
        }),
        baseIncident({
          id: "s2",
          topic: "shipping",
          country: "Singapore",
          severity: "moderate",
          title:
            "Cargo vessel boarded and crew robbed in the Singapore Strait",
          summary: "Robbers boarded a bulk carrier and stole stores.",
        }),
      ];
    case "flashpoint":
    case "protests":
      return [
        baseIncident({
          id: "f1",
          topic: "flashpoint",
          country: "Indonesia",
          severity: "high",
          title: "Mass protest erupts as demonstrators clash with police",
          summary:
            "Thousands of demonstrators rallied and clashed with riot police.",
        }),
        baseIncident({
          id: "f2",
          topic: "flashpoint",
          country: "Philippines",
          severity: "moderate",
          title: "Protesters rally against fuel price hike in the capital",
          summary: "A street rally protested against rising fuel prices.",
        }),
      ];
    case "cargo_watch":
      return [
        baseIncident({
          id: "cw1",
          topic: "cargo_watch",
          country: "Indonesia",
          severity: "high",
          title: "Armed gang hijacks a cargo truck and steals its freight",
          summary: "A freight truck was hijacked and its cargo stolen.",
        }),
        baseIncident({
          id: "cw2",
          topic: "cargo_watch",
          country: "Thailand",
          severity: "moderate",
          title: "Warehouse cargo theft strips a logistics depot of goods",
          summary: "Thieves raided a logistics warehouse and stole cargo.",
        }),
      ];
    case "energy":
      return [
        baseIncident({
          id: "e1",
          topic: "energy",
          country: "Indonesia",
          severity: "high",
          title: "Explosion hits oil refinery, halting fuel production",
          summary:
            "A blast and fire struck a refinery, halting fuel production.",
        }),
        baseIncident({
          id: "e2",
          topic: "energy",
          country: "Philippines",
          severity: "moderate",
          title: "Substation fire causes rolling blackout across the grid",
          summary: "A substation fire forced rolling blackouts on the grid.",
        }),
      ];
    case "fertiliser":
      return [
        baseIncident({
          id: "ft1",
          topic: "fertiliser",
          country: "India",
          severity: "high",
          title: "Fertiliser shortage sparks shortage of urea for farmers",
          summary: "A urea fertiliser shortage left farmers unable to buy.",
        }),
        baseIncident({
          id: "ft2",
          topic: "fertiliser",
          country: "Indonesia",
          severity: "moderate",
          title: "Fertiliser plant outage cuts ammonia and urea supply",
          summary: "A plant outage cut ammonia and urea fertiliser output.",
        }),
      ];
    case "fuel":
      return [
        baseIncident({
          id: "fu1",
          topic: "fuel",
          country: "Indonesia",
          severity: "high",
          title: "Fuel shortage triggers long queues at petrol stations",
          summary: "A diesel and petrol shortage caused long station queues.",
        }),
        baseIncident({
          id: "fu2",
          topic: "fuel",
          country: "Philippines",
          severity: "moderate",
          title: "Diesel supply disruption hits transport operators",
          summary: "A diesel supply disruption hit transport operators.",
        }),
      ];
    default:
      return [];
  }
}

const TOPICS = [
  "conflict",
  "shipping",
  "flashpoint",
  "protests",
  "cargo_watch",
  "energy",
  "fertiliser",
  "fuel",
] as const;

describe("ReportEditor — live preview renders non-empty content for every topic", () => {
  it.each(TOPICS)(
    "renders a non-blank preview in the right column (%s)",
    async (topic) => {
      mockReportData = report(topic);
      mockIncidents = incidentsFor(topic);

      const { container } = render(<ReportEditor />);

      // Wait until the preview box (the previewRef container) has rendered its
      // title — proof the REAL topic preview component mounted without throwing.
      await waitFor(() => {
        const box = container.querySelector(
          "div.bg-white.border.border-border.rounded-sm.overflow-hidden",
        );
        expect(box?.textContent ?? "").toContain(TITLE);
      });

      const grid = container.querySelector<HTMLElement>(
        "div.grid.grid-cols-1",
      );
      expect(grid).not.toBeNull();
      const cols = Array.from(grid!.children) as HTMLElement[];
      expect(cols).toHaveLength(2);

      const previewCol = cols[1];

      // The preview box renders inside the SECOND (right) column.
      const previewBox = previewCol.querySelector<HTMLElement>(
        "div.bg-white.border.border-border.rounded-sm.overflow-hidden",
      );
      expect(previewBox).not.toBeNull();

      // ...and it is NOT a blank panel: the real preview emits substantial
      // content (title + section chrome + data-driven prose), well beyond a
      // marker stub.
      const text = (previewBox!.textContent ?? "").trim();
      expect(text).toContain(TITLE);
      expect(text.length).toBeGreaterThan(200);

      // The form still lives in the first column alongside the preview.
      expect(within(previewCol).queryByRole("textbox")).toBeNull();
      expect(cols[0].querySelector("input")).not.toBeNull();
    },
  );
});

// The empty case — zero incidents in the window — is exactly when a preview is
// most likely to blank out or throw (empty arrays, undefined "top" rows,
// divide-by-zero in chart math). Per the STRICT no-fabrication rule, analysts
// opening a report in a quiet week must see a graceful, non-blank scaffold
// ("not reported" labels / section chrome), never a blank panel or a crash.
describe("ReportEditor — live preview degrades gracefully with NO incidents", () => {
  it.each(TOPICS)(
    "renders non-blank preview chrome when the incident list is empty (%s)",
    async (topic) => {
      mockReportData = report(topic);
      mockIncidents = [];

      const { container } = render(<ReportEditor />);

      // The real topic preview component must mount (title present) without
      // throwing, even with an empty dataset.
      await waitFor(() => {
        const box = container.querySelector(
          "div.bg-white.border.border-border.rounded-sm.overflow-hidden",
        );
        expect(box?.textContent ?? "").toContain(TITLE);
      });

      const grid = container.querySelector<HTMLElement>(
        "div.grid.grid-cols-1",
      );
      expect(grid).not.toBeNull();
      const cols = Array.from(grid!.children) as HTMLElement[];
      expect(cols).toHaveLength(2);

      const previewCol = cols[1];
      const previewBox = previewCol.querySelector<HTMLElement>(
        "div.bg-white.border.border-border.rounded-sm.overflow-hidden",
      );
      expect(previewBox).not.toBeNull();

      // Not a blank panel: even with no incidents the preview still emits the
      // report title plus enough section scaffolding / "not reported" chrome to
      // orient an analyst.
      const text = (previewBox!.textContent ?? "").trim();
      expect(text).toContain(TITLE);
      expect(text.length).toBeGreaterThan(200);
    },
  );
});
