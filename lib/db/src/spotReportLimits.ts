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

// ---------------------------------------------------------------------------
// Special-report front cover ceiling — shared by the workbench cover picker's
// client-side guard AND the api-server route's server-side validation, so a
// custom-uploaded cover can never be accepted by one and rejected by the other.
// Library covers travel as a small key string and need no size check; only the
// custom-uploaded data URL is bounded here.
// ---------------------------------------------------------------------------

/** Maximum size of a custom-uploaded cover's base64 data URL. */
export const MAX_COVER_DATAURL_BYTES = 5 * 1024 * 1024;
/** Accepted cover image data-URL prefixes (stored in a text column). */
export const COVER_DATAURL_RE = /^data:image\/(jpeg|png|webp);base64,/;

/**
 * Validate a custom cover data URL against the shared ceiling. Returns an error
 * message string, or null when the value is valid or absent (a report may have
 * no custom cover, or use a library key instead). Both the client guard and the
 * server route call this so the accepted type and size can never disagree.
 */
export function validateCoverDataUrl(dataUrl: unknown): string | null {
  if (dataUrl === undefined || dataUrl === null || dataUrl === "") return null;
  if (typeof dataUrl !== "string" || !COVER_DATAURL_RE.test(dataUrl)) {
    return "The cover must be an image data URL (jpeg, png or webp).";
  }
  if (dataUrl.length > MAX_COVER_DATAURL_BYTES) {
    return "The cover image is too large; please use a smaller image.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Special-report BODY blocks — the free-form ordered block list. Only inline
// image blocks carry a heavy payload, so this reuses the photo data-URL
// ceilings above to bound them (an image block IS a photo, byte-for-byte).
// Shared by the client editor's pre-save guard AND the api-server route so the
// accepted block types, image types, count and sizes can never disagree.
// ---------------------------------------------------------------------------

/** The seven recognised block types. Kept in lockstep with SpecialReportBlockType. */
export const SPECIAL_REPORT_BLOCK_TYPES = [
  "heading",
  "text",
  "bullets",
  "chart",
  "image",
  "map",
  "incidents",
] as const;

const SPECIAL_BLOCK_TYPE_SET = new Set<string>(SPECIAL_REPORT_BLOCK_TYPES);

type BlockLike = { id?: unknown; type?: unknown; dataUrl?: unknown };

/**
 * Validate a Special Report blocks payload. Returns an error message string, or
 * null when the payload is valid or absent (a PATCH may omit blocks). Image
 * blocks are bounded by the same per-image and total ceilings as photos.
 */
export function validateSpecialReportBlocks(blocks: unknown): string | null {
  if (blocks === undefined) return null;
  if (!Array.isArray(blocks)) return "blocks must be an array";
  let imageCount = 0;
  let total = 0;
  for (const b of blocks as BlockLike[]) {
    if (!b || typeof b !== "object") return "Each block must be an object.";
    if (typeof b.id !== "string" || !b.id) return "Each block needs an id.";
    if (typeof b.type !== "string" || !SPECIAL_BLOCK_TYPE_SET.has(b.type)) {
      return "A block has an unrecognised type.";
    }
    if (b.type === "image") {
      const dataUrl = b.dataUrl;
      if (typeof dataUrl !== "string" || !PHOTO_DATAURL_RE.test(dataUrl)) {
        return "Each image block must be an image data URL (jpeg, png, webp or gif).";
      }
      if (dataUrl.length > MAX_PHOTO_DATAURL_BYTES) {
        return "An image is too large; please use a smaller image.";
      }
      imageCount += 1;
      total += dataUrl.length;
    }
  }
  if (imageCount > MAX_PHOTOS) return `Too many images (max ${MAX_PHOTOS}).`;
  if (total > MAX_PHOTOS_TOTAL_BYTES) {
    return "Images exceed the total size limit; please remove or shrink some.";
  }
  return null;
}
