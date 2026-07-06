/**
 * @jest-environment jsdom
 *
 * Locks the Cargo Watch report fetch.
 *
 * The server's GENERAL text-relevance gate marks most genuine cargo theft
 * (warehouse / truck / depot loss) "irrelevant"; the authoritative gate for
 * Cargo Watch is the cargo scope classifier (isCargoInScope). The cargo MONITOR
 * and CountryReport both bypass the server gate by fetching includeIrrelevant
 * and trusting the scope classifier. The report editor used a plain,
 * relevance-gated fetch, so those rows never reached the cargo report and its
 * record count collapsed to the handful the general gate let through — the
 * reported bug: "info from the cargo page isn't making it to the report".
 *
 * This test asserts the editor issues the includeIrrelevant cargo fetch so the
 * report is grounded on the same rows the monitor shows. If a future change
 * drops that fetch, the report silently starves again and this fails.
 */
import { render, waitFor } from "@testing-library/react";

const listIncidentsCalls: Array<Record<string, unknown> | undefined> = [];
let mockReportData: Record<string, unknown> | undefined;

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
  useListIncidents: (params?: Record<string, unknown>) => {
    listIncidentsCalls.push(params);
    return { data: [] };
  },
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
  getListIncidentsQueryKey: (p?: unknown) => ["incidents", p],
  getGetReportQueryKey: () => ["report"],
  getListReportsQueryKey: () => ["reports"],
  getGetDashboardOverviewQueryKey: () => ["overview"],
}));

// The PDF exporters pull in jspdf/html2canvas (jsdom lacks TextEncoder/canvas)
// and are only invoked on the Download button, not here; stub them.
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
});

beforeEach(() => {
  listIncidentsCalls.length = 0;
});

it("fetches cargo incidents with includeIrrelevant for a Cargo Watch report", async () => {
  mockReportData = {
    id: 1,
    topic: "cargo_watch",
    title: "Cargo Watch",
    status: "draft",
    issueDate: "2026-07-05",
  };
  render(<ReportEditor />);
  await waitFor(() => {
    expect(
      listIncidentsCalls.some(
        (c) =>
          c != null &&
          c.topic === "cargo_watch" &&
          c.includeIrrelevant === true,
      ),
    ).toBe(true);
  });
});
