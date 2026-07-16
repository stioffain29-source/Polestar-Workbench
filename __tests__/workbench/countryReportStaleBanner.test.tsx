/**
 * @jest-environment jsdom
 *
 * Rendered-UI guard for the COUNTRY report's PROSE STALENESS banner.
 *
 * The server keeps an analyst prose edit across a data-basis change and returns
 * `stale: true` on the prose result; CountryReport.tsx renders a subdued-red
 * no-print banner ("Your saved narrative edit is being kept, but the underlying
 * data has changed since it was written...") so the analyst knows their kept
 * edit may no longer match the current incidents. Owner-gated Replit-Auth pages
 * cannot be screenshot/e2e-verified (owner-gated-ui-verification.md), so this
 * render-level assertion is the only thing that proves the banner actually
 * appears when proseResult.stale is true — and stays hidden when it is not.
 *
 * It also proves the KEPT edit (proseResult.edited), not the fresh AI draft
 * (proseResult.sections), is what renders while stale: the report resolves prose
 * as `proseResult.edited ?? proseResult.sections`.
 *
 * The REAL CountryReport page renders; only heavy chart/map leaf children are
 * stubbed via jest.config moduleNameMapper.
 */
import { render, waitFor } from "@testing-library/react";

let mockCountry: Record<string, unknown> | undefined;
let mockIncidents: Array<Record<string, unknown>> = [];
let mockProseResult: Record<string, unknown>;

jest.mock("wouter", () => ({
  __esModule: true,
  useRoute: () => [true, { slug: "papua-new-guinea" }],
  Link: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("@tanstack/react-query", () => ({
  __esModule: true,
  useQueryClient: () => ({ invalidateQueries: jest.fn(), setQueryData: jest.fn() }),
}));

const KEPT_EDIT = {
  executiveSummary: "Kept-edit country exec marker uniform preserved narrative.",
  situation:
    "Kept-edit country marker victor: this situation paragraph is the " +
    "analyst's own hand-written judgement that the server has KEPT across a " +
    "data-basis change, and it must keep rendering verbatim in the brief while " +
    "the staleness banner warns the operator the incidents moved on after this " +
    "narrative was written and saved to the country report record for review.",
  whatHappened: "Kept-edit country marker whiskey what-happened preserved.",
  whatMatters: "Kept-edit country marker xray what-matters preserved.",
  implications: ["Kept-edit country marker yankee implication one preserved."],
  watchNext: ["Kept-edit country marker zulu watch-next one preserved."],
  polestarView:
    "Kept-edit country marker alpha: the Polestar View the analyst saved is " +
    "preserved verbatim while the staleness banner warns the operator the data " +
    "changed after this narrative was written, so the analyst keeps control.",
} as const;

const FRESH_DRAFT = {
  executiveSummary: "Freshdraft country sentinel bravo executive narrative.",
  situation: "Freshdraft country sentinel charlie situation narrative.",
  whatHappened: "Freshdraft country sentinel delta what-happened narrative.",
  whatMatters: "Freshdraft country sentinel echo what-matters narrative.",
  implications: ["Freshdraft country sentinel foxtrot implication one."],
  watchNext: ["Freshdraft country sentinel golf watch-next one."],
  polestarView: "Freshdraft country sentinel hotel polestar narrative.",
} as const;

jest.mock("@workspace/api-client-react", () => ({
  __esModule: true,
  useGetCountryReport: () => ({ data: mockCountry, isLoading: false }),
  useListIncidents: () => ({
    data: mockIncidents,
    isSuccess: true,
    isError: false,
  }),
  useListSources: () => ({ data: [] }),
  useListReliefWebReports: () => ({ data: [] }),
  useUpdateCountryReport: () => ({ mutate: jest.fn(), isPending: false }),
  useGetCountryBaseline: () => ({ data: null }),
  useUpsertCountryBaseline: () => ({ mutate: jest.fn(), isPending: false }),
  useDeleteCountryBaseline: () => ({ mutate: jest.fn(), isPending: false }),
  useEditCountryProse: () => ({ mutateAsync: jest.fn() }),
  useGenerateCountryProse: () => ({
    mutateAsync: () => Promise.resolve(mockProseResult),
  }),
  getGetCountryReportQueryKey: () => ["country-report"],
  getGetCountryBaselineQueryKey: () => ["country-baseline"],
}));

jest.mock("@/lib/exportPdf", () => ({
  __esModule: true,
  exportElementToPdf: jest.fn(),
  slugifyForFilename: (s: string) => s,
}));

let CountryReport: React.ComponentType;

beforeAll(() => {
  if (
    typeof (globalThis as Record<string, unknown>).TextEncoder === "undefined"
  ) {
    const { TextEncoder, TextDecoder } = require("util");
    (globalThis as Record<string, unknown>).TextEncoder = TextEncoder;
    (globalThis as Record<string, unknown>).TextDecoder = TextDecoder;
  }
  CountryReport = require("@/pages/CountryReport").default;

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
});

const COUNTRY_NAME = "Papua New Guinea";

function country(): Record<string, unknown> {
  return {
    slug: "papua-new-guinea",
    name: COUNTRY_NAME,
    region: "Southeast Asia",
    overview: "",
    trendSummary: "",
    implications: "",
    watchlist: [],
  };
}

function incidents(): Array<Record<string, unknown>> {
  return [
    {
      id: "p1",
      topic: "flashpoint",
      country: "Papua New Guinea",
      severity: "high",
      occurredAt: "2026-06-16T08:00:00Z",
      summary: "Armed clashes between troops and militants near the outpost.",
      source: "Test Wire",
      sourceUrl: "https://example.com/p1",
      location: "Port Moresby",
      title: "Armed clashes between troops and militants near the outpost",
      relevanceStatus: "relevant",
    },
  ];
}

const BANNER_TEXT = "Your saved narrative edit is being kept";

async function renderReport() {
  mockCountry = country();
  mockIncidents = incidents();
  const { container } = render(<CountryReport />);
  await waitFor(() => {
    expect(container.textContent ?? "").toContain(COUNTRY_NAME);
  });
  return container;
}

describe("CountryReport — prose staleness banner", () => {
  it("shows the stale banner and renders the KEPT edit (not the fresh draft) when proseResult.stale is true", async () => {
    mockProseResult = {
      available: true,
      fingerprint: "fp-stale",
      sections: { ...FRESH_DRAFT },
      edited: { ...KEPT_EDIT },
      stale: true,
      model: "test",
      generatedAt: new Date().toISOString(),
    };

    const container = await renderReport();

    await waitFor(() => {
      expect(container.textContent ?? "").toContain(BANNER_TEXT);
    });

    // The KEPT edit renders; the fresh AI draft does not.
    await waitFor(() => {
      expect(container.textContent ?? "").toContain(KEPT_EDIT.executiveSummary);
    });
    const finalText = container.textContent ?? "";
    expect(finalText).toContain(KEPT_EDIT.polestarView);
    expect(finalText).not.toContain(FRESH_DRAFT.executiveSummary);
    expect(finalText).not.toContain(FRESH_DRAFT.polestarView);
  });

  it("does NOT show the stale banner when proseResult.stale is false", async () => {
    mockProseResult = {
      available: true,
      fingerprint: "fp-fresh",
      sections: { ...FRESH_DRAFT },
      edited: null,
      stale: false,
      model: "test",
      generatedAt: new Date().toISOString(),
    };

    const container = await renderReport();

    await waitFor(() => {
      expect(container.textContent ?? "").toContain(FRESH_DRAFT.executiveSummary);
    });
    expect(container.textContent ?? "").not.toContain(BANNER_TEXT);
  });
});
