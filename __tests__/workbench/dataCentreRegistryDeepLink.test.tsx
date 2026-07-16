/**
 * @jest-environment jsdom
 *
 * Locks in the facility deep-link flow on the Data Centre Registry page.
 * Arriving via `?facility=<id>` must open that facility's edit form, scroll the
 * matching row into view, and briefly highlight it. This behaviour is easy to
 * break silently during future refactors of the registry, so this test renders
 * the REAL `DataCentreRegistry` page (its real deep-link effect, form state and
 * row highlight) and only mocks the network hook (`useListDataCentreFacilities`)
 * and the router (`wouter`'s `useSearch`).
 *
 * The app is owner-gated (Replit Auth), so per the owner-gated UI verification
 * note we exercise the component directly rather than via a live screenshot.
 */
import { render, screen, waitFor } from "@testing-library/react";

// Mutable fixtures the hook mocks close over (must be `mock*`-prefixed so the
// jest.mock factory hoist permits the reference).
let mockFacilities: Array<Record<string, unknown>> = [];
let mockSearch = "";

jest.mock("wouter", () => ({
  __esModule: true,
  useSearch: () => mockSearch,
}));

jest.mock("@tanstack/react-query", () => ({
  __esModule: true,
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));

jest.mock("@workspace/api-client-react", () => ({
  __esModule: true,
  useListDataCentreFacilities: () => ({ data: mockFacilities, isLoading: false }),
  useCreateDataCentreFacility: () => ({ mutate: jest.fn(), isPending: false }),
  useUpdateDataCentreFacility: () => ({ mutate: jest.fn(), isPending: false }),
  useDeleteDataCentreFacility: () => ({ mutate: jest.fn(), isPending: false }),
  getListDataCentreFacilitiesQueryKey: () => ["data-centre-facilities"],
  DataCentreStatus: {
    Unknown: "Unknown",
    Planned: "Planned",
    UnderConstruction: "Under Construction",
    Operational: "Operational",
  },
  DataCentrePlanningRisk: {
    Unknown: "Unknown",
    Low: "Low",
    Moderate: "Moderate",
    High: "High",
  },
  DataCentreType: {
    Hyperscale: "Hyperscale",
    Colocation: "Colocation",
    Enterprise: "Enterprise",
    Edge: "Edge",
    Cloud_region: "Cloud region",
    Carrier_hotel: "Carrier hotel",
    "Unknown_/_not_reported": "Unknown / not reported",
  },
  useListDataCentreEnrichmentProviders: () => ({ data: [], isLoading: false }),
  usePreviewDataCentreEnrichment: () => ({ mutate: jest.fn(), isPending: false }),
  useCommitDataCentreEnrichment: () => ({ mutate: jest.fn(), isPending: false }),
}));

import DataCentreRegistry from "@/pages/DataCentreRegistry";

function makeFacility(id: number, name: string): Record<string, unknown> {
  return {
    id,
    name,
    operator: "Operator " + id,
    country: "Singapore",
    region: null,
    city: "Singapore",
    latitude: null,
    longitude: null,
    status: "Operational",
    planningRisk: "Low",
    capacityMw: 100,
    itLoadMw: null,
    announcedDate: null,
    expectedOnlineDate: null,
    commissionedDate: null,
    notes: null,
    sourceUrl: null,
    linkedIncidentId: null,
    createdBy: null,
    statusChanged: false,
    previousStatus: null,
  };
}

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
  if (typeof window.requestAnimationFrame !== "function")
    window.requestAnimationFrame = (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    };
});

beforeEach(() => {
  mockFacilities = [makeFacility(1, "Alpha DC"), makeFacility(2, "Bravo DC"), makeFacility(3, "Charlie DC")];
  mockSearch = "";
});

// The highlighted row carries the `bg-accent/15` class; find its <tr> ancestor.
function highlightedRow(): HTMLElement | null {
  return document.querySelector("tr.bg-accent\\/15");
}

describe("Data Centre Registry facility deep-link", () => {
  it("opens the edit form for a valid ?facility=<id> and highlights its row", async () => {
    mockSearch = "facility=2";
    render(<DataCentreRegistry />);

    // The edit form opens for the requested facility (heading + populated name).
    await waitFor(() => {
      expect(screen.getByText("Edit Facility")).not.toBeNull();
    });
    const nameInput = screen.getByDisplayValue("Bravo DC");
    expect(nameInput).not.toBeNull();

    // The matching row is marked as highlighted.
    const row = highlightedRow();
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain("Bravo DC");
    expect(row?.textContent).not.toContain("Alpha DC");
  });

  it("does nothing when the ?facility param is absent", () => {
    mockSearch = "";
    render(<DataCentreRegistry />);

    expect(screen.queryByRole("heading", { name: /edit facility/i })).toBeNull();
    expect(highlightedRow()).toBeNull();
  });

  it("does nothing when the ?facility id is unknown", () => {
    mockSearch = "facility=999";
    render(<DataCentreRegistry />);

    expect(screen.queryByRole("heading", { name: /edit facility/i })).toBeNull();
    expect(highlightedRow()).toBeNull();
  });

  it("does nothing for a non-numeric / non-positive ?facility id", () => {
    mockSearch = "facility=abc";
    render(<DataCentreRegistry />);

    expect(screen.queryByRole("heading", { name: /edit facility/i })).toBeNull();
    expect(highlightedRow()).toBeNull();
  });
});
