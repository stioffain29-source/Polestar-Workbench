// Country baseline type re-export.
//
// Baselines now live in the database (`country_baselines` table) and
// are fetched via the API (useGetCountryBaseline). The static
// per-country content that used to live here was seeded into the DB
// on first run by `artifacts/api-server/src/lib/countryBaselineSeed.ts`.
//
// This file remains as the source of the client-side `CountryBaseline`
// type so that the multi-window layering helpers in
// `countryReportLayers.ts` and the on-screen baseline block keep a
// stable shape independent of any future tweak to the generated
// OpenAPI types.

export interface CountryBaselineWatchlistEntry {
  label: string;
  note: string;
  match: string[];
}

export interface CountryBaseline {
  operatingEnvironment: string;
  securityContext: string;
  knownRiskAreas: string[];
  keyCitiesProvinces: string[];
  movementConstraints: string;
  infrastructureLimits: string;
  medicalEvac: string;
  resourceSectorExposure: string;
  locationWatchlist: CountryBaselineWatchlistEntry[];
}
