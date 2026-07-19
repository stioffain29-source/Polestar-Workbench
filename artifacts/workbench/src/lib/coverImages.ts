// Shared cover-photo registry. Both the on-screen ReportPreview and the
// PDF exporters resolve hero images from these maps so the preview and
// the exported PDF always agree.
import fertiliserCoverUrl from "@assets/image_1779624933984.png";
import cargoWatchCoverUrl from "@assets/image_1779625099169.png";
import energyCoverUrl from "@assets/severin-demchuk-60NulquhzoI-unsplash_1779625300436.jpg";
import fuelCoverUrl from "@assets/image_1779625662270.png";
import flashpointCoverUrl from "@assets/image_1779625725916.png";
import conflictCoverUrl from "@assets/conflict_watch_cover.png";
import shippingCoverUrl from "@assets/william-william-NndKt2kF1L4-unsplash_1779617475306.jpg";
import papuaNewGuineaCoverUrl from "@assets/image_1779624991006.png";
import papuaCoverUrl from "@assets/image_1779625036503.png";
import jakartaCoverUrl from "@assets/pexels-ceharabbani-35498205_1782396454908.jpg";
import indonesiaCoverUrl from "@assets/fikri-rasyid-IBb_Y65z5ZU-unsplash_(1)_1782396477715.jpg";
import philippinesCoverUrl from "@assets/pexels-jefilms-14090049_1784121352267.jpg";
import thailandCoverUrl from "@assets/pexels-redowanmohammad-27866564_1784121372129.jpg";

export const TOPIC_COVER_URLS: Record<string, string> = {
  shipping: shippingCoverUrl,
  fertiliser: fertiliserCoverUrl,
  cargo_watch: cargoWatchCoverUrl,
  energy: energyCoverUrl,
  fuel: fuelCoverUrl,
  conflict: conflictCoverUrl,
  // Both topic keys resolve to the same Flashpoint report in reportNaming.ts,
  // so register both so the cover applies regardless of which key the editor saved.
  flashpoint: flashpointCoverUrl,
  protests: flashpointCoverUrl,
};

export const COUNTRY_COVER_URLS: Record<string, string> = {
  "papua new guinea": papuaNewGuineaCoverUrl,
  "papua": papuaCoverUrl,
  "jakarta": jakartaCoverUrl,
  "indonesia": indonesiaCoverUrl,
  "philippines": philippinesCoverUrl,
  "thailand": thailandCoverUrl,
};

export function topicCoverUrl(topic?: string | null): string | undefined {
  if (!topic) return undefined;
  return TOPIC_COVER_URLS[topic];
}

export function countryCoverUrl(name?: string | null): string | undefined {
  if (!name) return undefined;
  return COUNTRY_COVER_URLS[name.trim().toLowerCase()];
}

// ---------------------------------------------------------------------------
// Special Report front-cover library
// ---------------------------------------------------------------------------
// Special Reports let the analyst CHOOSE a front cover: either one of the
// built-in library images below (persisted as a small, stable KEY) or a custom
// upload (persisted as a resized data URL). Only the key is stored for a library
// pick — the Vite build-hashed asset URL is resolved at render time via
// COVER_LIBRARY, so a stored report survives a rebuild that rehashes filenames.
import coverWorld from "@assets/generated_images/special_cover_world.png";
import coverMaritime from "@assets/generated_images/special_cover_maritime.png";
import coverTerrain from "@assets/generated_images/special_cover_terrain.png";
import coverNetwork from "@assets/generated_images/special_cover_network.png";

export interface CoverLibraryEntry {
  key: string;
  label: string;
  url: string;
}

export const COVER_LIBRARY: CoverLibraryEntry[] = [
  { key: "world", label: "Global", url: coverWorld },
  { key: "maritime", label: "Maritime", url: coverMaritime },
  { key: "terrain", label: "Terrain", url: coverTerrain },
  { key: "network", label: "Network", url: coverNetwork },
];

const COVER_BY_KEY: Record<string, string> = Object.fromEntries(
  COVER_LIBRARY.map((c) => [c.key, c.url]),
);

/**
 * Resolve the cover image to render for a Special Report. A custom upload
 * (coverImageDataUrl) always WINS over a library key, so switching from a
 * library pick to an upload takes effect immediately. Returns null when neither
 * is set (the report then renders with no cover page).
 */
export function resolveCoverUrl(cover: {
  coverImageKey?: string | null;
  coverImageDataUrl?: string | null;
}): string | null {
  const dataUrl = (cover.coverImageDataUrl ?? "").trim();
  if (dataUrl) return dataUrl;
  const key = (cover.coverImageKey ?? "").trim();
  if (key && COVER_BY_KEY[key]) return COVER_BY_KEY[key];
  return null;
}
