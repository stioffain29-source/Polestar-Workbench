/**
 * @jest-environment jsdom
 *
 * Layout-regression guard for the report editor's two-column body.
 *
 * The right-hand live preview silently collapsed into an empty panel whenever a
 * notice banner ("AI narrative unavailable" when the OpenAI integration is
 * absent, or "Saved prose was stale") was present, because those banners had
 * been rendered as EXTRA direct children of the editor's CSS grid
 * (`grid grid-cols-1 xl:grid-cols-2`). A third grid cell pushes the preview into
 * a new row, leaving the right column blank.
 *
 * This test renders the REAL `ReportEditor` page with a notice banner present
 * (the OpenAI prose engine reports `{available:false}`, plus an issue date older
 * than the latest record so the stale-prose banner also shows) and asserts:
 *   1. the two-column grid still has EXACTLY two direct children, and
 *   2. the live preview renders inside the SECOND (right) column, alongside the
 *      form in the first column — never pushed onto its own grid row.
 *
 * It runs for shipping plus a second topic (energy) so a regression on either
 * preview branch is caught. The page is rendered as the owner-authenticated
 * editor would see it (all auth/data hooks are mocked to return owner data).
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
  // deterministic template and raises the "AI narrative unavailable" banner.
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

// The preview children pull in recharts/leaflet that do not render under jsdom.
// Stub each to an identifiable marker so we can assert WHERE in the grid the
// live preview lands (the regression was the preview ending up in the wrong
// grid cell, so its DOM position is exactly what we verify).
jest.mock("@/components/ConflictReportPreview", () => ({
  __esModule: true,
  default: () => <div data-testid="preview-content">conflict preview</div>,
}));
jest.mock("@/components/ShippingReportPreview", () => ({
  __esModule: true,
  default: () => <div data-testid="preview-content">shipping preview</div>,
}));
jest.mock("@/components/FlashpointReportPreview", () => ({
  __esModule: true,
  default: () => <div data-testid="preview-content">flashpoint preview</div>,
}));
jest.mock("@/components/ReportPreview", () => ({
  __esModule: true,
  default: () => <div data-testid="preview-content">generic preview</div>,
}));

import ReportEditor from "@/pages/ReportEditor";

beforeAll(() => {
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

// The issue date sits BEFORE the latest incident below so the stale-prose
// banner also renders alongside the "AI narrative unavailable" banner — the two
// notices most likely to be (re)introduced as stray grid children.
function report(topic: string): Record<string, unknown> {
  return {
    id: 1,
    topic,
    status: "published",
    issueDate: "2026-06-01",
    title: "Test report",
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

function incidentsFor(topic: string): Array<Record<string, unknown>> {
  if (topic === "shipping") {
    return [
      {
        id: "ship-1",
        topic: "shipping",
        title: "Commercial tanker attacked by drone in Red Sea",
        summary:
          "A crude oil tanker was attacked by a one-way attack drone in the Red Sea and diverted from its route.",
        location: "Red Sea",
        country: "Yemen",
        severity: "high",
        occurredAt: "2026-06-17T08:00:00Z",
        source: "Reuters",
        sourceUrl: "https://example.com/ship-1",
      },
    ];
  }
  // energy — a generic topic that renders via the shared ReportPreview branch.
  return [
    {
      id: "en-1",
      topic: "energy",
      title: "Explosion hits oil refinery in Gujarat",
      summary:
        "A blast and fire struck a crude oil refinery in Gujarat, halting fuel production and cutting power supply to the grid.",
      location: "Gujarat",
      country: "India",
      severity: "high",
      occurredAt: "2026-06-17T10:00:00Z",
      source: "Reuters",
      sourceUrl: "https://example.com/en-1",
    },
  ];
}

describe("ReportEditor — preview survives notice banners (layout guard)", () => {
  it.each(["shipping", "energy"] as const)(
    "keeps the live preview in the right column when notice banners are present (%s)",
    async (topic) => {
      mockReportData = report(topic);
      mockIncidents = incidentsFor(topic);

      const { container } = render(<ReportEditor />);

      // The banners are conditional on async prose state — wait for at least the
      // "AI narrative unavailable" notice to appear before asserting layout.
      await waitFor(() =>
        expect(container.textContent).toMatch(/AI narrative unavailable/i),
      );

      const grid = container.querySelector<HTMLElement>(
        "div.grid.grid-cols-1",
      );
      expect(grid).not.toBeNull();
      const cols = Array.from(grid!.children) as HTMLElement[];

      // The grid must have EXACTLY two cells: the form column and the preview
      // column. A stray banner rendered as a third grid child is the regression.
      expect(cols).toHaveLength(2);

      const [formCol, previewCol] = cols;

      // The live preview renders inside the SECOND (right) column...
      const preview = within(previewCol).getByTestId("preview-content");
      expect(preview).toBeTruthy();

      // ...and not in the first (form) column.
      expect(
        within(formCol).queryByTestId("preview-content"),
      ).toBeNull();

      // The form lives in the first column (its Title input), confirming the
      // preview sits ALONGSIDE the form rather than below it.
      expect(formCol.querySelector("input")).not.toBeNull();
    },
  );
});
