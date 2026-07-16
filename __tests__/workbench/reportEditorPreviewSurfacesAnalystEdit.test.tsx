/**
 * @jest-environment jsdom
 *
 * Blank-preview guard for the report editor's live preview panel — the
 * ANALYST-EDIT path (the highest-precedence layer).
 *
 * Two sibling tests already cover the lower layers:
 *   - `reportEditorPreviewRenders.test.tsx` — the AI-ABSENT path renders the
 *     deterministic template for every topic.
 *   - `reportEditorPreviewRendersAi.test.tsx` — the AI-AVAILABLE path renders
 *     the cached AI narrative for every topic.
 *
 * Neither proves the TOP of the precedence stack: a genuine saved analyst edit
 * must outrank BOTH the AI narrative AND the deterministic template and render
 * verbatim in the preview. A regression in the edit-precedence resolution
 * (`resolveSimpleProse` for saved-only-seeded topics, or `pickProse` for the
 * conflict/flashpoint generic-seed topics) could silently drop analyst-written
 * prose in production — substituting the AI sentinel or the template — and no
 * test would catch it.
 *
 * This test renders the REAL `ReportEditor` for every report topic with a
 * non-empty saved analyst edit in the `whatMatters` / `polestarView` report
 * fields AND a populated AI `sections` payload mocked. It asserts the preview
 * surfaces the analyst edit text and does NOT surface the AI sentinel for those
 * two sections (proving the edit won, not the AI).
 *
 * The conflict and flashpoint previews resolve via `pickProse`: a saved edit
 * only fully replaces the fallback when it carries substance (>= 240 chars) and
 * is not a recognised generic seed — a short genuine note is APPENDED ahead of
 * the auto-prose instead. The analyst-edit fixtures below are deliberately well
 * over 240 chars and use bespoke wording, so the edit fully wins on every topic
 * and the AI sentinel must be absent.
 *
 * Per-topic preview components render FOR REAL; only the heavy chart/map leaf
 * children (recharts/leaflet) are stubbed via jest.config `moduleNameMapper`.
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

// Sentinel AI narrative — each section carries a unique phrase. A genuine
// analyst edit must OUTRANK these, so the whatMatters / polestarView AI
// sentinels must be ABSENT from the preview once the edit fields are filled.
const AI_SECTIONS = {
  executiveSummary: "Zephyrine executive briefing sentinel alpha narrative.",
  situation: "Zephyrine situation sentinel bravo narrative.",
  whatHappened: "Zephyrine what-happened sentinel charlie narrative.",
  whatMatters: "Zephyrine what-matters sentinel delta narrative.",
  implications: "Zephyrine implications sentinel echo narrative.",
  watchNext: "Zephyrine watch-next sentinel foxtrot narrative.",
  polestarView: "Zephyrine polestar-view sentinel golf narrative.",
} as const;

// Saved analyst edits — bespoke wording (no generic-seed phrase) and well over
// the 240-char substance bar that conflict/flashpoint's pickProse enforces, so
// the edit fully replaces both the AI narrative and the deterministic template
// on EVERY topic.
const ANALYST_WHAT_MATTERS =
  "Analyst override marker whiskey: this paragraph is a genuine hand-written " +
  "editorial judgement that an operator typed into the What Matters field, and " +
  "it must render verbatim in the preview because a real analyst edit outranks " +
  "both the cached AI narrative and the deterministic template fallback beneath " +
  "it in the resolution precedence stack for every report topic.";
const ANALYST_POLESTAR_VIEW =
  "Analyst override marker yankee: this paragraph is a genuine hand-written " +
  "Polestar View that an operator typed into the editor field, and it must " +
  "render verbatim in the preview because a real analyst edit outranks both " +
  "the cached AI narrative and the deterministic template fallback beneath it " +
  "in the resolution precedence stack for every report topic without exception.";

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
  // The OpenAI prose engine IS configured: a 200 {available:true} returns the
  // full 7-section narrative. A saved analyst edit must still beat it.
  useGenerateReportProse: () => ({
    mutate: (
      _vars: unknown,
      opts?: { onSuccess?: (res: unknown) => void },
    ) => {
      opts?.onSuccess?.({
        available: true,
        sections: { ...AI_SECTIONS },
        edited: null,
      });
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

let ReportEditor: React.ComponentType;

beforeAll(() => {
  // jsPDF's Node build needs TextEncoder/TextDecoder at import time.
  if (
    typeof (globalThis as Record<string, unknown>).TextEncoder === "undefined"
  ) {
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

const TITLE = "Workbench Analyst Edit Render Test";

// The issue date sits AFTER every incident below so the records all fall inside
// the report's reporting window (and no stale-prose reseed fires).
const ISSUE_DATE = "2026-06-20";

// whatMatters + polestarView carry a SAVED analyst edit; the rest stay empty so
// the AI narrative occupies them (proving the edit, not blanket suppression, is
// what wins on the edited sections).
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
    whatMatters: ANALYST_WHAT_MATTERS,
    implications: "",
    polestarView: ANALYST_POLESTAR_VIEW,
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
// dataset relevance/window filter and reaches the data-driven sections. Mirrors
// the sibling reportEditorPreviewRendersAi.test.tsx fixtures.
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
          location: "Singapore Strait",
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

// Every preview renders whatMatters and polestarView from the resolved prose,
// so they are the portable cross-topic assertion: the analyst edit must show
// and the corresponding AI sentinel must NOT.
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

describe("ReportEditor — a saved analyst edit outranks the AI narrative in the preview", () => {
  it.each(TOPICS)(
    "renders the saved analyst edit (not the AI sentinel) in the right column (%s)",
    async (topic) => {
      mockReportData = report(topic);
      mockIncidents = incidentsFor(topic);

      const { container } = render(<ReportEditor />);

      // Wait until the preview box has rendered its title — proof the REAL
      // topic preview component mounted without throwing.
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

      // The preview must surface the saved analyst edit verbatim. waitFor
      // because the prose mutation resolves async via onSuccess after the first
      // render (the AI fills the unedited sections in the same pass).
      await waitFor(() => {
        const text = previewBox!.textContent ?? "";
        expect(text).toContain(ANALYST_WHAT_MATTERS);
        expect(text).toContain(ANALYST_POLESTAR_VIEW);
      });

      // ...and the analyst edit must OUTRANK the AI narrative: the AI sentinels
      // for the two edited sections must be absent (the edit won, not the AI).
      const finalText = previewBox!.textContent ?? "";
      expect(finalText).not.toContain(AI_SECTIONS.whatMatters);
      expect(finalText).not.toContain(AI_SECTIONS.polestarView);

      // The form still lives in the first column alongside the preview.
      expect(within(previewCol).queryByRole("textbox")).toBeNull();
      expect(cols[0].querySelector("input")).not.toBeNull();
    },
  );
});
