/**
 * @jest-environment jsdom
 *
 * Interactive UI test for the Related Incident Summaries section of the report
 * editor. Renders the REAL `ReportEditor` page (its real summary-generation
 * memo, edit state, save handler and fingerprint-bound payload) for the three
 * topics that carry a Related Incidents table — conflict, shipping and a
 * generic topic (cargo_watch) — and exercises:
 *   1. an AI summary line renders under each related incident row,
 *   2. editing a line and clicking "Save summaries" sends a fingerprint-bound
 *      payload to the edit endpoint and the edited line is reflected on screen,
 *   3. a stale-fingerprint (409) edit surfaces the "regenerate" error state.
 *
 * Only the network hooks (`@workspace/api-client-react`), the router (`wouter`)
 * and react-query's `useQueryClient` are mocked; the heavy preview children are
 * stubbed (their summary-line rendering is covered by
 * `incidentSummaryRender.test.tsx`). The editor's own summary selection,
 * effective-summary merge and save wiring run for real.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Mutable fixtures the hook mocks close over (must be `mock*`-prefixed so the
// jest.mock factory hoist permits the reference).
let mockReportData: Record<string, unknown> | undefined;
let mockIncidents: Array<Record<string, unknown>> = [];
let mockLastSummaries: Record<string, string> = {};
let mockLastRelated: Array<{ id: string; title: string }> = [];
const mockGenerateMutate = jest.fn();
const mockEditMutate = jest.fn();

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
    mutate: mockGenerateMutate,
    isPending: false,
  }),
  useEditReportIncidentSummaries: () => ({
    mutate: mockEditMutate,
    isPending: false,
  }),
  useGenerateReportProse: () => ({ mutate: jest.fn(), isPending: false }),
  getListMaritimeMovementQueryKey: () => ["maritime-movement"],
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

// The preview children pull in recharts/leaflet that do not render under jsdom
// and are not the subject of this test; stub them to inert nodes.
jest.mock("@/components/ConflictReportPreview", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/components/ShippingReportPreview", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/components/FlashpointReportPreview", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/components/ReportPreview", () => ({
  __esModule: true,
  default: () => null,
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

function report(topic: string): Record<string, unknown> {
  return {
    id: 1,
    topic,
    status: "published",
    issueDate: "2026-06-18",
    title: "",
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

// Topic-tuned incidents that survive each topic's real selection pipeline
// (kinetic+casualty for conflict, operational+maritime for shipping,
// cargo-scope APAC for cargo_watch). Dates sit inside the report window.
function incidentsFor(topic: string): Array<Record<string, unknown>> {
  if (topic === "conflict") {
    return [
      {
        id: "conf-1",
        topic: "conflict",
        title: "Five soldiers killed in IED blast in Manipur",
        summary:
          "Militants attacked a military convoy with an improvised explosive device, killing five soldiers in the ambush.",
        location: "Manipur",
        country: "India",
        severity: "high",
        occurredAt: "2026-06-16T10:00:00Z",
        source: "Reuters",
        sourceUrl: "https://example.com/conf-1",
      },
      {
        id: "conf-2",
        topic: "conflict",
        title: "Gun battle kills three in Kachin clash",
        summary:
          "A clash between armed groups left three dead after a firefight near the border.",
        location: "Kachin",
        country: "Myanmar",
        severity: "high",
        occurredAt: "2026-06-17T09:00:00Z",
        source: "AFP",
        sourceUrl: "https://example.com/conf-2",
      },
    ];
  }
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
        occurredAt: "2026-06-16T08:00:00Z",
        source: "Reuters",
        sourceUrl: "https://example.com/ship-1",
      },
      {
        id: "ship-2",
        topic: "shipping",
        title: "Container vessel seized near Strait of Hormuz",
        summary:
          "Armed forces boarded and seized a container vessel transiting near the Strait of Hormuz, halting the ship.",
        location: "Strait of Hormuz",
        country: "Iran",
        severity: "high",
        occurredAt: "2026-06-17T07:00:00Z",
        source: "AP",
        sourceUrl: "https://example.com/ship-2",
      },
    ];
  }
  // energy — a generic topic that flows through the shared
  // filterTopicReportIncidents + selectRelatedIncidents pipeline.
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
      occurredAt: "2026-06-16T10:00:00Z",
      source: "Reuters",
      sourceUrl: "https://example.com/en-1",
    },
    {
      id: "en-2",
      topic: "energy",
      title: "Gas pipeline sabotaged in Balochistan",
      summary:
        "Militants bombed a natural gas pipeline in Balochistan, disrupting energy supply to power plants.",
      location: "Balochistan",
      country: "Pakistan",
      severity: "high",
      occurredAt: "2026-06-15T09:00:00Z",
      source: "Dawn",
      sourceUrl: "https://example.com/en-2",
    },
  ];
}

beforeEach(() => {
  mockGenerateMutate.mockReset();
  mockEditMutate.mockReset();
  mockLastSummaries = {};
  mockLastRelated = [];
  // Generate: build an AI summary keyed by the EXACT related set the editor
  // sent, mirroring the live cache contract, and call onSuccess synchronously.
  mockGenerateMutate.mockImplementation(
    (
      vars: { id: number; data: { incidents: Array<{ id: string; title: string }> } },
      opts?: { onSuccess?: (res: unknown) => void },
    ) => {
      const summaries: Record<string, string> = {};
      for (const it of vars.data.incidents) summaries[it.id] = `AI: ${it.title}`;
      mockLastSummaries = summaries;
      mockLastRelated = vars.data.incidents.map((it) => ({
        id: it.id,
        title: it.title,
      }));
      opts?.onSuccess?.({
        available: true,
        fingerprint: "fp-1",
        summaries,
        edited: null,
      });
    },
  );
  // Edit: success echo — keep the generated map, return the submitted edits.
  mockEditMutate.mockImplementation(
    (
      vars: { id: number; data: { fingerprint: string; summaries: Record<string, string> } },
      opts?: { onSuccess?: (res: unknown) => void },
    ) => {
      opts?.onSuccess?.({
        available: true,
        fingerprint: vars.data.fingerprint,
        summaries: mockLastSummaries,
        edited: vars.data.summaries,
      });
    },
  );
});

describe("ReportEditor — Related Incident Summaries (interactive)", () => {
  it.each(["conflict", "shipping", "energy"] as const)(
    "renders an editable AI summary line under each related incident row (%s)",
    async (topic) => {
      mockReportData = report(topic);
      mockIncidents = incidentsFor(topic);

      render(<ReportEditor />);

      // The editor selected its related incidents (via the real conflict /
      // shipping / generic pipelines) and requested summaries for that set.
      await waitFor(() => expect(mockGenerateMutate).toHaveBeenCalled());
      expect(mockLastRelated.length).toBeGreaterThan(0);

      // Every related incident the editor produced shows an editable textarea
      // pre-filled with its AI summary line.
      for (const it of mockLastRelated) {
        const ta = await screen.findByDisplayValue(`AI: ${it.title}`);
        expect((ta as HTMLTextAreaElement).tagName).toBe("TEXTAREA");
      }
    },
  );

  it("editing a summary and saving sends a fingerprint-bound payload and reflects the edit", async () => {
    mockReportData = report("conflict");
    mockIncidents = incidentsFor("conflict");

    render(<ReportEditor />);
    await waitFor(() => expect(mockGenerateMutate).toHaveBeenCalled());

    const textarea = await screen.findByDisplayValue(
      "AI: Five soldiers killed in IED blast in Manipur",
    );
    fireEvent.change(textarea, {
      target: { value: "Analyst-edited conflict summary line." },
    });

    fireEvent.click(
      screen.getByRole("button", { name: /save summaries/i }),
    );

    await waitFor(() => expect(mockEditMutate).toHaveBeenCalledTimes(1));
    const payload = mockEditMutate.mock.calls[0][0] as {
      id: number;
      data: { fingerprint: string; summaries: Record<string, string> };
    };
    expect(payload.id).toBe(1);
    expect(payload.data.fingerprint).toBe("fp-1");
    expect(payload.data.summaries["conf-1"]).toBe(
      "Analyst-edited conflict summary line.",
    );

    // The edited line is reflected on screen after the save round-trips.
    expect(
      screen.getByDisplayValue("Analyst-edited conflict summary line."),
    ).toBeTruthy();
  });

  it("a stale-fingerprint (409) edit surfaces the regenerate error state", async () => {
    mockReportData = report("conflict");
    mockIncidents = incidentsFor("conflict");
    // Make the edit endpoint reject (the route returns 409 on a stale
    // fingerprint; the hook surfaces that as onError).
    mockEditMutate.mockImplementation(
      (_vars: unknown, opts?: { onError?: (e: unknown) => void }) => {
        opts?.onError?.(new Error("stale"));
      },
    );

    render(<ReportEditor />);
    await waitFor(() => expect(mockGenerateMutate).toHaveBeenCalled());

    const textarea = await screen.findByDisplayValue(
      "AI: Five soldiers killed in IED blast in Manipur",
    );
    fireEvent.change(textarea, { target: { value: "Edited while stale." } });
    fireEvent.click(screen.getByRole("button", { name: /save summaries/i }));

    expect(
      await screen.findByText(/out of date — regenerate before editing/i),
    ).toBeTruthy();
  });
});
