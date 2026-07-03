// Spot-report photo ceilings — the SINGLE source of truth shared by the
// workbench editor's client-side pre-save guard AND the api-server route's
// server-side validation, so the two can never drift apart. If they disagreed,
// the editor could accept a payload the server then rejects (the analyst sees a
// confusing save failure for something the UI said was fine) or block an upload
// the server would have accepted.
//
// This module is intentionally PURE: it imports nothing from pg/drizzle, so it
// is safe to bundle into the browser via the `@workspace/db/spot-report-limits`
// subpath export (importing the `@workspace/db` root barrel would pull the
// Postgres client into the client bundle).

/** Maximum number of photos a single spot report may hold. */
export const MAX_PHOTOS = 24;
/** Maximum size of one photo's base64 data URL. */
export const MAX_PHOTO_DATAURL_BYTES = 4 * 1024 * 1024;
/** Maximum combined size of all photo data URLs on one report. */
export const MAX_PHOTOS_TOTAL_BYTES = 28 * 1024 * 1024;
/** Accepted image data-URL prefixes (stored in jsonb, rasterised into the PDF). */
export const PHOTO_DATAURL_RE = /^data:image\/(jpeg|png|webp|gif);base64,/;

type PhotoLike = { dataUrl?: unknown };

/**
 * Measure the byte length of a photo data URL. A base64 data URL is ASCII-only
 * (the `data:image/...;base64,` prefix plus the `[A-Za-z0-9+/=]` payload), so
 * the JS string length equals the UTF-8 byte length. Using `.length` keeps this
 * module free of Node's `Buffer`, so it runs unchanged in the browser and on the
 * server.
 */
function dataUrlBytes(dataUrl: string): number {
  return dataUrl.length;
}

/**
 * Validate a photos payload against the shared ceilings. Returns an error
 * message string, or null when the payload is valid or absent (a PATCH may omit
 * photos). Both the client pre-save guard and the server route call this so the
 * accepted types, counts and sizes can never disagree.
 */
export function validateSpotReportPhotos(photos: unknown): string | null {
  if (photos === undefined) return null;
  if (!Array.isArray(photos)) return "photos must be an array";
  if (photos.length > MAX_PHOTOS) {
    return `Too many photos (max ${MAX_PHOTOS}).`;
  }
  let total = 0;
  for (const p of photos as PhotoLike[]) {
    const dataUrl = p?.dataUrl;
    if (typeof dataUrl !== "string" || !PHOTO_DATAURL_RE.test(dataUrl)) {
      return "Each photo must be an image data URL (jpeg, png, webp or gif).";
    }
    const bytes = dataUrlBytes(dataUrl);
    if (bytes > MAX_PHOTO_DATAURL_BYTES) {
      return "A photo is too large; please use a smaller image.";
    }
    total += bytes;
  }
  if (total > MAX_PHOTOS_TOTAL_BYTES) {
    return "Photos exceed the total size limit; please remove or shrink some.";
  }
  return null;
}
