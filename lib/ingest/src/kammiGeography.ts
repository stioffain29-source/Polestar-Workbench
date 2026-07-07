// KAMMI social-watch geography routing.
//
// A single, PURE (no DB / no external fetch) resolver that maps a KAMMI
// social-watch post to ONE Indonesian theatre using the geography the analyst
// (or the Instagram importer) already captured on the row: `province`, `city`,
// free-text `location`, and the `caption`. It is deliberately import-light so
// BOTH the browser (the read-only "KAMMI protest monitoring context" panel on a
// country report) and the api-server (the manual promote route, which stamps the
// resulting incident's country/province) can share ONE decision — the panel and
// the promoted incident can never disagree about where a post belongs.
//
// It reuses `isJakartaScoped` — the exact gate the Jakarta city brief uses to
// scope INCIDENTS — so a KAMMI post is Jakarta-routed on the same precision-first
// basis as an incident, not on the schema's defaulted `city="Jakarta"`.

import { isJakartaScoped } from "./jakartaExtract";

/** The Indonesian theatre a KAMMI post routes to. */
export type KammiTheatre = "westPapua" | "jakarta" | "indonesia";

/** The structured-report theatres a country report can be (mirrors CountryReport). */
export type ReportTheatre =
  | "png"
  | "westPapua"
  | "indonesia"
  | "jakarta"
  | null;

/** The subset of a social-watch row this resolver reads. */
export interface KammiGeoItem {
  city?: string | null;
  province?: string | null;
  location?: string | null;
  caption?: string | null;
}

// Indonesian West Papua province + city gazetteer. Kept in step with the
// `papua` COUNTRY_GROUPS token set and WEST_PAPUA_CONTEXT_RE in the workbench
// `countryMatch.ts`; a bare `papua` word is included (a KAMMI post naming Papua
// is a genuine West-Papua signal) and disqualified only when a PNG marker also
// appears, so "Papua New Guinea" can never route here.
const WEST_PAPUA_RE =
  /\b(west papua|papua barat|highland papua|papua pegunungan|central papua|papua tengah|south papua|papua selatan|southwest papua|papua barat daya|jayapura|biak|wamena|manokwari|sorong|merauke|nabire|timika|fakfak|intan jaya|nduga|puncak jaya|paniai|ilaga|sugapa|yahukimo|dekai|maybrat|beoga|lanny jaya|tolikara|pegunungan bintang|dogiyai|deiyai|mappi|keerom|sarmi|waropen|supiori|boven digoel|papua)\b/i;

// Papua New Guinea markers — a post naming PNG must never be filed under the
// Indonesian West Papua report. Mirrors PNG_CONTEXT_RE in `countryMatch.ts`.
const PNG_RE =
  /\b(papua new guinea|png|port moresby|bougainville|mount hagen|mt hagen|madang|morobe|marape|pngdf|rpngc|lae)\b/i;

/**
 * Resolve a KAMMI post to a single Indonesian theatre plus the `country` tag a
 * promoted incident must carry to land in the matching country report.
 *
 * Precedence — West Papua BEFORE Jakarta, because `city` defaults to "Jakarta"
 * on every row and a genuine West-Papua post must not be swallowed by that
 * default:
 *  1. West Papua — a province/city/location/caption West-Papua gazetteer hit
 *     with no PNG marker. Country tag "West Papua" (matches the `papua` report
 *     tokens; the national report routes it out by title, as it does today).
 *  2. Jakarta — `isJakartaScoped` over caption/province/location (the same gate
 *     the Jakarta brief uses for incidents), NOT the defaulted `city`. Country
 *     tag "Indonesia" (Jakarta records always carry country "Indonesia").
 *  3. Indonesia (national) — everything else.
 */
export function resolveKammiTheatre(item: KammiGeoItem): {
  theatre: KammiTheatre;
  countryTag: string;
} {
  const geoText = [item.province, item.city, item.location, item.caption]
    .filter(Boolean)
    .join(" ");

  if (WEST_PAPUA_RE.test(geoText) && !PNG_RE.test(geoText)) {
    return { theatre: "westPapua", countryTag: "West Papua" };
  }

  // Content-based Jakarta scope (caption ≈ incident title, province as extra
  // text, location as the geocoded field) — the defaulted `city` is left out on
  // purpose so it cannot force everything to Jakarta.
  if (isJakartaScoped(item.caption ?? null, item.province ?? null, item.location ?? null)) {
    return { theatre: "jakarta", countryTag: "Indonesia" };
  }

  return { theatre: "indonesia", countryTag: "Indonesia" };
}

/**
 * True when a KAMMI post belongs in a given country report's context panel,
 * mirroring how the report scopes INCIDENTS:
 *  - Papua (West Papua) report  → West-Papua posts.
 *  - Jakarta city brief         → Jakarta posts.
 *  - Indonesia national report  → every post EXCEPT West-Papua (national
 *    includes the capital, exactly as the national incident filter does).
 *  - PNG / any other country / generic report / null → none (all KAMMI is
 *    Indonesian, so the panel renders nothing there).
 */
export function kammiItemInReportTheatre(
  item: KammiGeoItem,
  reportTheatre: ReportTheatre,
): boolean {
  const { theatre } = resolveKammiTheatre(item);
  switch (reportTheatre) {
    case "westPapua":
      return theatre === "westPapua";
    case "jakarta":
      return theatre === "jakarta";
    case "indonesia":
      return theatre !== "westPapua";
    default:
      return false;
  }
}
