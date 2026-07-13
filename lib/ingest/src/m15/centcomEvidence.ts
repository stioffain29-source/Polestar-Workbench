// CENTCOM evidence helpers — image URL capture for M1.5 Step 11.

export const CENTCOM_IMAGE_FOOTER_HEADING = "[Image URLs]";

/** Append deduped image URLs to body text for API retrieval. */
export function appendCentcomImageUrls(
  bodyText: string,
  imageUrls?: string[],
): string {
  if (!imageUrls?.length) return bodyText;
  const unique = [...new Set(imageUrls.map((u) => u.trim()).filter(Boolean))];
  if (unique.length === 0) return bodyText;
  const footer = `${CENTCOM_IMAGE_FOOTER_HEADING}\n${unique.join("\n")}`;
  const base = bodyText.trim();
  return base ? `${base}\n\n${footer}` : footer;
}

/** Parse image URLs previously stored in a CENTCOM bodyText footer. */
export function parseCentcomImageUrlsFromBody(bodyText: string | null | undefined): string[] {
  if (!bodyText?.trim()) return [];
  const marker = CENTCOM_IMAGE_FOOTER_HEADING;
  const idx = bodyText.lastIndexOf(marker);
  if (idx < 0) return [];
  return bodyText
    .slice(idx + marker.length)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("http://") || line.startsWith("https://"));
}
