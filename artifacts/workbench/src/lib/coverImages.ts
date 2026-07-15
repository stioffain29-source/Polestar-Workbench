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
};

export function topicCoverUrl(topic?: string | null): string | undefined {
  if (!topic) return undefined;
  return TOPIC_COVER_URLS[topic];
}

export function countryCoverUrl(name?: string | null): string | undefined {
  if (!name) return undefined;
  return COUNTRY_COVER_URLS[name.trim().toLowerCase()];
}
