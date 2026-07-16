/**
 * @jest-environment jsdom
 *
 * Rendered-UI guard for the report editor's PROSE STALENESS banner.
 *
 * The server keeps an analyst prose edit across a data-basis change and returns
 * `stale: true` on the prose result; ReportEditor.tsx renders a subdued-red
 * no-print banner ("Saved edit may be out of date.") so the analyst knows their
 * kept edit may no longer match the current incidents. Owner-gated Replit-Auth
 * pages cannot be screenshot/e2e-verified (owner-gated-ui-verification.md), so
 * this render-level assertion is the only thing that proves the banner actually
 * appears in the live UI when proseRes.stale is true — and stays hidden when it
 * is not.
 *
 * It also proves the KEPT edit (proseRes.edited), not the fresh AI draft
 * (proseRes.sections), is what renders while stale: the preview resolves prose
 * as `proseRes.edited ?? proseRes.sections`, so the edited marker must show and
 * the fresh-draft marker must be absent.
 *
 * The REAL ReportEditor + per-topic preview render; only heavy chart/map leaf
 * children (recharts/leaflet) are stubbed via jest.config moduleNameMapper.
 */
import { render, waitFor } from "@testing-library/react";

let mockReportData: Record<string, unknown> | undefined;
let mockIncidents: Array<Record<string, unknown>> = [];
let mockProseResult: Record<string, unknown>;

jest.mock("wouter", () => ({
  __esModule: true,
  useRoute: () => [true, { id: "1" }],
  Link: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("@tanstack/react-query", () => ({
  __esModule: true,
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));

// The kept analyst edit (survives the data-basis change) vs the fresh AI draft.
// Each carries a unique marker; while stale, the KEPT edit must render and the
// fresh draft must NOT. Well over conflict's 240-char pickProse substance bar so
// the resolved fallback prose is the edited text on this topic.
const KEPT_EDIT = {
  executiveSummary:
    "Kept-edit marker uniform: this executive summary is the analyst's own " +
    "hand-written judgement that the server has KEPT across a data-basis " +
    "change, and it must keep rendering verbatim in the preview while the " +
    "staleness banner warns the operator that the underlying incidents moved " +
    "on after this narrative was written and saved to the report record.",
  situation:
    "Kept-edit marker victor: the situation paragraph the analyst saved is " +
    "preserved rather than silently replaced by a fresh regeneration, so the " +
    "operator retains editorial control while being told the data has shifted.",
  whatHappened: "Kept-edit marker whiskey what-happened preserved narrative.",
  whatMatters: "Kept-edit marker xray what-matters preserved narrative.",
  implications: "Kept-edit marker yankee implications preserved narrative.",
  watchNext: "Kept-edit marker zulu watch-next preserved narrative.",
  polestarView:
    "Kept-edit marker alpha: the Polestar View the analyst saved is preserved " +
    "verbatim while the staleness banner warns the operator the data changed " +
    "after this narrative was written, so the analyst keeps full control.",
} as const;

const FRESH_DRAFT = {
  executiveSummary: "Freshdraft sentinel bravo executive narrative.",
  situation: "Freshdraft sentinel charlie situation narrative.",
  whatHappened: "Freshdraft sentinel delta what-happened narrative.",
  whatMatters: "Freshdraft sentinel echo what-matters narrative.",
  implications: "Freshdraft sentinel foxtrot implications narrative.",
  watchNext: "Freshdraft sentinel golf watch-next narrative.",
  polestarView: "Freshdraft sentinel hotel polestar narrative.",
} as const;

jest.mock("@workspace/api-client-react", () => ({
  __esModule: true,
  useGetReport: () => ({ data: mockReportData, isLoading: false }),
  useUpdateReport: () => ({ mutate: jest.fn(), isPending: false }),
  useListIncidents: () => ({ data: mockIncidents }),
  useListLatestMaritimeMovement: () => ({ data: [] }),
  useListMaritimeMovement: () => ({ data: [] }),
  useListMaritimeSecurityEvents: () => ({ data: [] }),
  useListReliefWebReports: () => ({ data: [] }),
  useListMarketPrices: () => ({ data: [] }),
  getListMarketPricesQueryKey: (p?: unknown) => ["market-prices", p],
  useGenerateReportIncidentSummaries: () => ({
    mutate: jest.fn(),
    isPending: false,
  }),
  useEditReportIncidentSummaries: () => ({
    mutate: jest.fn(),
    isPending: false,
  }),
  // The prose engine returns a KEPT analyst edit flagged stale:true.
  useGenerateReportProse: () => ({
    mutate: (
      _vars: unknown,
      opts?: { onSuccess?: (res: unknown) => void },
    ) => {
      opts?.onSuccess?.(mockProseResult);
    },
    isPending: false,
  }),
  getListMaritimeMovementQueryKey: () => ["maritime-movement"],
  getListIncidentsQueryKey: (p?: unknown) => ["incidents", p],
  getGetReportQueryKey: () => ["report"],
  getListReportsQueryKey: () => ["reports"],
  getGetDashboardOverviewQueryKey: () => ["overview"],
}));

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
  if (
    typeof (globalThis as Record<string, unknown>).TextEncoder === "undefined"
  ) {
    const { TextEncoder, TextDecoder } = require("util");
    (globalThis as Record<string, unknown>).TextEncoder = TextEncoder;
    (globalThis as Record<string, unknown>).TextDecoder = TextDecoder;
  }
  ReportEditor = require("@/pages/ReportEditor").default;

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

const TITLE = "Workbench Stale Banner Render Test";
// The issue date sits AFTER every incident so records fall inside the window
// (no stale-prose RESEED fires — this test exercises the SERVER stale flag).
const ISSUE_DATE = "2026-06-20";

// Report fields stay empty so the preview's fallback prose comes from the
// resolved AI/edited layer (proving the KEPT edit renders, not a form value).
function report(): Record<string, unknown> {
  return {
    id: 1,
    topic: "conflict",
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

function conflictIncidents(): Array<Record<string, unknown>> {
  return [
    {
      id: "c1",
      topic: "conflict",
      country: "Philippines",
      severity: "high",
      occurredAt: "2026-06-16T08:00:00Z",
      summary: "Troops exchanged fire with militants near the outpost.",
      source: "Test Wire",
      sourceUrl: "https://example.com/c1",
      location: null,
      title: "Armed clashes between troops and militants near the outpost",
    },
    {
      id: "c2",
      topic: "conflict",
      country: "Myanmar",
      severity: "moderate",
      occurredAt: "2026-06-16T08:00:00Z",
      summary: "An army patrol was ambushed on the highway.",
      source: "Test Wire",
      sourceUrl: "https://example.com/c2",
      location: null,
      title: "Militants ambush an army patrol on the highway",
    },
  ];
}

const BANNER_TEXT = "Saved edit may be out of date.";

async function renderPreview() {
  mockReportData = report();
  mockIncidents = conflictIncidents();
  const { container } = render(<ReportEditor />);
  await waitFor(() => {
    const box = container.querySelector(
      "div.bg-white.border.border-border.rounded-sm.overflow-hidden",
    );
    expect(box?.textContent ?? "").toContain(TITLE);
  });
  return container;
}

describe("ReportEditor — prose staleness banner", () => {
  it("shows the stale banner and renders the KEPT edit (not the fresh draft) when proseRes.stale is true", async () => {
    mockProseResult = {
      available: true,
      fingerprint: "fp-stale",
      sections: { ...FRESH_DRAFT },
      edited: { ...KEPT_EDIT },
      stale: true,
      model: "test",
      generatedAt: new Date().toISOString(),
    };

    const container = await renderPreview();

    await waitFor(() => {
      expect(container.textContent ?? "").toContain(BANNER_TEXT);
    });

    // The KEPT edit renders in the preview; the fresh AI draft does not.
    const previewBox = container.querySelector<HTMLElement>(
      "div.bg-white.border.border-border.rounded-sm.overflow-hidden",
    );
    await waitFor(() => {
      const text = previewBox!.textContent ?? "";
      expect(text).toContain(KEPT_EDIT.polestarView);
    });
    const finalText = previewBox!.textContent ?? "";
    expect(finalText).toContain(KEPT_EDIT.situation);
    expect(finalText).not.toContain(FRESH_DRAFT.polestarView);
    expect(finalText).not.toContain(FRESH_DRAFT.situation);
  });

  it("does NOT show the stale banner when proseRes.stale is false", async () => {
    mockProseResult = {
      available: true,
      fingerprint: "fp-fresh",
      sections: { ...FRESH_DRAFT },
      edited: null,
      stale: false,
      model: "test",
      generatedAt: new Date().toISOString(),
    };

    const container = await renderPreview();

    // Give the async prose onSuccess a chance to land, then assert absence.
    await waitFor(() => {
      const previewBox = container.querySelector<HTMLElement>(
        "div.bg-white.border.border-border.rounded-sm.overflow-hidden",
      );
      expect(previewBox!.textContent ?? "").toContain(FRESH_DRAFT.polestarView);
    });
    expect(container.textContent ?? "").not.toContain(BANNER_TEXT);
  });
});
