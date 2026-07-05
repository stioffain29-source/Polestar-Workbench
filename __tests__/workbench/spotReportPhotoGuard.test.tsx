/**
 * @jest-environment jsdom
 *
 * REGRESSION GUARD: the Spot Report editor's client-side photo pre-check must
 * block a save that would exceed the shared photo ceilings.
 *
 * The editor imports `validateSpotReportPhotos` from the SHARED
 * `@workspace/db/spot-report-limits` module (the same one the api-server route
 * uses) and calls it in `handleSave` BEFORE firing the create/update mutation.
 * That pre-check is the analyst's protection against a surprise 400/413 at save
 * time. A careless refactor could drop the pre-check and nothing would notice
 * until an analyst hit it in production.
 *
 * This test renders the REAL `SpotReportEditor` in edit mode with a fetched
 * report whose photos exceed `MAX_PHOTOS_TOTAL_BYTES` (each photo stays under
 * the per-photo cap and the count stays under `MAX_PHOTOS`, so the total-bytes
 * branch is the one that trips). Clicking Save must:
 *   1. NOT call the update mutation, and
 *   2. surface a destructive "Photos exceed the limit" warning toast.
 *
 * The api-client hooks, router, query client, toast, and heavy preview child
 * are stubbed so the test exercises the editor's guard logic in isolation.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import {
  MAX_PHOTO_DATAURL_BYTES,
  MAX_PHOTOS,
  MAX_PHOTOS_TOTAL_BYTES,
} from "@workspace/db/spot-report-limits";

// Router: pretend we're editing an existing report (id "1"), so `handleSave`
// takes the UPDATE branch.
jest.mock("wouter", () => ({
  __esModule: true,
  useRoute: () => [true, { id: "1" }],
  useLocation: () => ["/spot-reports/1", jest.fn()],
}));

jest.mock("@tanstack/react-query", () => ({
  __esModule: true,
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));

// Capture toast calls so we can assert the warning fired.
const toastMock = jest.fn();
jest.mock("@/hooks/use-toast", () => ({
  __esModule: true,
  useToast: () => ({ toast: toastMock }),
}));

// The preview panel pulls in map/PDF chrome irrelevant to the save-guard;
// replace it with an inert marker.
jest.mock("@/components/SpotReportPreview", () => ({
  __esModule: true,
  default: () => null,
}));

// The editor imports the PDF/DOCX export helpers at module load; those pull in
// `jspdf` (touches `TextEncoder` at import, absent in jsdom) and are irrelevant
// to the save-guard. Stub them (and jspdf, covering any transitive importer).
jest.mock("jspdf", () => ({ __esModule: true, jsPDF: class {} }));
jest.mock("@/lib/exportPdf", () => ({
  __esModule: true,
  exportElementToPdf: jest.fn(async () => {}),
  slugifyForFilename: (s: string) => s,
}));
jest.mock("@/lib/spotReportExport", () => ({
  __esModule: true,
  downloadSpotReportDocx: jest.fn(async () => {}),
  downloadSpotReportText: jest.fn(() => {}),
}));

const createMutate = jest.fn();
const updateMutate = jest.fn();

/**
 * A valid JPEG data URL padded to an exact byte length (a base64 data URL is
 * ASCII, so string length == byte length — mirrors the shared validator).
 */
function jpegOfBytes(bytes: number): string {
  const prefix = "data:image/jpeg;base64,";
  return prefix + "A".repeat(Math.max(0, bytes - prefix.length));
}

// Enough near-max photos to exceed the TOTAL cap while staying under the
// per-photo cap AND under the photo COUNT cap, so the total-bytes branch trips.
const perPhotoBytes = MAX_PHOTO_DATAURL_BYTES;
const oversizedPhotoCount =
  Math.floor(MAX_PHOTOS_TOTAL_BYTES / perPhotoBytes) + 1;
const oversizedPhotos = Array.from({ length: oversizedPhotoCount }, (_, i) => ({
  dataUrl: jpegOfBytes(perPhotoBytes),
  caption: `photo ${i}`,
}));

const seededReport = {
  id: 1,
  title: "Over-limit photo report",
  status: "draft",
  reportDate: "2026-07-01",
  createdBy: "Analyst",
  linkedIncidentIds: [],
  exportHistory: [],
  mapPoints: [],
  photos: oversizedPhotos,
};

jest.mock("@workspace/api-client-react", () => ({
  __esModule: true,
  useGetSpotReport: () => ({ data: seededReport, isLoading: false }),
  useListIncidents: () => ({ data: [] }),
  useCreateSpotReport: () => ({ mutate: createMutate, isPending: false }),
  useUpdateSpotReport: () => ({ mutate: updateMutate, isPending: false }),
  useDeleteSpotReport: () => ({ mutate: jest.fn(), isPending: false }),
  useAppendSpotReportExport: () => ({ mutate: jest.fn(), isPending: false }),
  getGetSpotReportQueryKey: () => ["spot-report", 1],
  getListSpotReportsQueryKey: () => ["spot-reports"],
}));

import SpotReportEditor from "@/pages/SpotReportEditor";

beforeAll(() => {
  if (!window.matchMedia) {
    // @ts-expect-error minimal stub for Radix primitives under jsdom
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
});

beforeEach(() => {
  toastMock.mockClear();
  createMutate.mockClear();
  updateMutate.mockClear();
});

describe("SpotReportEditor — client photo-limit pre-save guard", () => {
  it("sanity: the seeded photos exceed the total cap but not the per-photo or count caps", () => {
    expect(oversizedPhotos.length).toBeLessThanOrEqual(MAX_PHOTOS);
    for (const p of oversizedPhotos) {
      expect(p.dataUrl.length).toBeLessThanOrEqual(MAX_PHOTO_DATAURL_BYTES);
    }
    const total = oversizedPhotos.reduce((n, p) => n + p.dataUrl.length, 0);
    expect(total).toBeGreaterThan(MAX_PHOTOS_TOTAL_BYTES);
  });

  it("blocks Save (no update mutation) and warns when photos exceed the total-bytes ceiling", () => {
    render(<SpotReportEditor />);

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    // The guard must short-circuit: the update mutation is NEVER called, so the
    // analyst never hits a surprise server rejection.
    expect(updateMutate).not.toHaveBeenCalled();
    expect(createMutate).not.toHaveBeenCalled();

    // And a destructive warning toast explains why.
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Photos exceed the limit",
        variant: "destructive",
        description: expect.stringMatching(/total size/i),
      }),
    );
  });
});
