import {
  MAX_PHOTOS,
  MAX_PHOTO_DATAURL_BYTES,
  MAX_PHOTOS_TOTAL_BYTES,
  PHOTO_DATAURL_RE,
  validateSpotReportPhotos,
} from "@workspace/db/spot-report-limits";

/** A valid JPEG data URL padded to an exact byte length. */
function jpegOfBytes(bytes: number): string {
  const prefix = "data:image/jpeg;base64,";
  const pad = Math.max(0, bytes - prefix.length);
  return prefix + "A".repeat(pad);
}

describe("shared spot-report photo limits — single source of truth", () => {
  it("pins the ceilings so the editor and server can never silently drift", () => {
    // These are the values BOTH the client pre-save guard and the server route
    // now import from this module. A careless edit to any one is caught here.
    expect(MAX_PHOTOS).toBe(24);
    expect(MAX_PHOTO_DATAURL_BYTES).toBe(4 * 1024 * 1024);
    expect(MAX_PHOTOS_TOTAL_BYTES).toBe(28 * 1024 * 1024);
  });

  it("accepts jpeg/png/webp/gif base64 data URLs and rejects others", () => {
    for (const t of ["jpeg", "png", "webp", "gif"]) {
      expect(PHOTO_DATAURL_RE.test(`data:image/${t};base64,AAAA`)).toBe(true);
    }
    expect(PHOTO_DATAURL_RE.test("data:image/bmp;base64,AAAA")).toBe(false);
    expect(PHOTO_DATAURL_RE.test("https://example.com/a.jpg")).toBe(false);
  });

  it("treats undefined photos as valid (PATCH may omit them)", () => {
    expect(validateSpotReportPhotos(undefined)).toBeNull();
  });

  it("accepts an empty array and a small valid photo", () => {
    expect(validateSpotReportPhotos([])).toBeNull();
    expect(
      validateSpotReportPhotos([{ dataUrl: "data:image/jpeg;base64,AAAA" }]),
    ).toBeNull();
  });

  it("rejects a non-array payload", () => {
    expect(validateSpotReportPhotos({} as unknown)).toMatch(/array/i);
  });

  it("rejects too many photos", () => {
    const many = Array.from({ length: MAX_PHOTOS + 1 }, () => ({
      dataUrl: "data:image/jpeg;base64,AAAA",
    }));
    expect(validateSpotReportPhotos(many)).toMatch(/too many/i);
  });

  it("rejects a non-image or malformed data URL", () => {
    expect(validateSpotReportPhotos([{ dataUrl: "not-a-data-url" }])).toMatch(
      /image data URL/i,
    );
    expect(validateSpotReportPhotos([{ dataUrl: 42 }])).toMatch(/image data URL/i);
    expect(validateSpotReportPhotos([{}])).toMatch(/image data URL/i);
  });

  it("rejects a single oversized photo", () => {
    const big = jpegOfBytes(MAX_PHOTO_DATAURL_BYTES + 1);
    expect(validateSpotReportPhotos([{ dataUrl: big }])).toMatch(/too large/i);
  });

  it("rejects when the combined size exceeds the total limit", () => {
    // Each photo is just under the per-photo cap; enough of them exceed the total.
    const per = jpegOfBytes(MAX_PHOTO_DATAURL_BYTES);
    const count = Math.floor(MAX_PHOTOS_TOTAL_BYTES / MAX_PHOTO_DATAURL_BYTES) + 1;
    const photos = Array.from({ length: count }, () => ({ dataUrl: per }));
    // Stay within the count cap so the total-size branch is the one that trips.
    expect(count).toBeLessThanOrEqual(MAX_PHOTOS);
    expect(validateSpotReportPhotos(photos)).toMatch(/total size/i);
  });
});
