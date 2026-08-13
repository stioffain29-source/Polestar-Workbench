import { sanitizeMapMarkers } from "../countrySectionOverrides";

describe("sanitizeMapMarkers", () => {
  it("keeps only rows with finite in-range coordinates", () => {
    const out = sanitizeMapMarkers([
      { id: "a", lat: -6.2, lng: 106.8, label: "Client site", severity: "high" },
      { id: "b", lat: "x", lng: 10 },
      { id: "c", lat: 95, lng: 10 },
      { id: "d", lat: 10, lng: 200 },
      null,
      "junk",
    ]);
    expect(out).toEqual([
      { id: "a", lat: -6.2, lng: 106.8, label: "Client site", severity: "high" },
    ]);
  });

  it("coerces numeric strings and fills a stable id", () => {
    const out = sanitizeMapMarkers([{ lat: "1.5", lng: "2.5" }]);
    expect(out).toEqual([{ id: "1.5,2.5", lat: 1.5, lng: 2.5, label: undefined, severity: undefined }]);
  });

  it("returns [] for non-arrays", () => {
    expect(sanitizeMapMarkers(null)).toEqual([]);
    expect(sanitizeMapMarkers({})).toEqual([]);
  });
});
