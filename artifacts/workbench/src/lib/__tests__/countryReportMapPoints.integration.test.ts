/**
 * End-to-end coordinate path for the country report map (§23):
 * source incident with real coordinates → buildPngReportDataset →
 * engine mapPoints → CountryReport's id-gating → spot-style map dots.
 * Regression: PngSourceIncident/PngReportItem used to strip latitude/longitude,
 * so toMapPoints() rejected every event and the map rendered empty.
 */
import { buildPngReportDataset, type PngSourceIncident } from "../pngReportDataset";
import { buildCountryIncidentMapPoints } from "../countryIncidentMapPoints";
import type { CountryFastFactsIncident } from "../countryFastFacts";

const inc = (over: Partial<PngSourceIncident>): PngSourceIncident => ({
  id: 1,
  title: "Armed clash injures three in Port Moresby settlement",
  summary: "Police reported an armed clash between groups in a Port Moresby settlement; three injured.",
  severity: "High",
  occurredAt: "2026-08-10T08:00:00Z",
  country: "Papua New Guinea",
  location: "Port Moresby",
  province: "National Capital District",
  category: "Crime, theft & robbery",
  businessImpact: "Localised violence near business districts; review movement plans.",
  source: "Test Wire",
  latitude: -9.4438,
  longitude: 147.1803,
  ...over,
});

describe("country report map coordinate path", () => {
  it("carries coordinates through the engine into §23 mapPoints and map dots", () => {
    const dataset = buildPngReportDataset({
      windowIncidents: [inc({})],
      thirtyDay: [inc({})],
      ninetyDay: [inc({})],
      baselineWatchlist: [],
      periodLabel: "6 to 12 August 2026",
      windowStart: new Date("2026-08-06T00:00:00Z"),
    });
    expect(dataset.mapPoints.length).toBeGreaterThan(0);
    const p = dataset.mapPoints[0];
    expect(p.lat).toBeCloseTo(-9.4438);
    expect(p.lng).toBeCloseTo(147.1803);

    // Mirror CountryReport's mapGatedIncidents id-gating, then the dot builder.
    const windowIncidents: CountryFastFactsIncident[] = [
      {
        id: 1,
        topic: "apac_local",
        title: "Armed clash injures three in Port Moresby settlement",
        severity: "High",
        occurredAt: "2026-08-10T08:00:00Z",
        location: "Port Moresby",
        latitude: -9.4438,
        longitude: 147.1803,
      },
    ];
    const plottableIds = new Set(dataset.mapPoints.map((mp) => String(mp.eventId)));
    const gated = windowIncidents.filter((i) => plottableIds.has(String(i.id)));
    const dots = buildCountryIncidentMapPoints(gated);
    expect(dots).toHaveLength(1);
    expect(dots[0]).toMatchObject({ lat: -9.4438, lng: 147.1803, severity: "high" });
  });

  it("emits no map point for a coordinate-less or country-only row", () => {
    const dataset = buildPngReportDataset({
      windowIncidents: [
        // Coordinate-less AND not resolvable by the engine's curated gazetteer
        // (a known town like Port Moresby would legitimately plot via the
        // engine's own geocoding — that path is covered above).
        inc({
          id: 2,
          title: "Armed clash injures three at remote settlement",
          summary: "Police reported an armed clash at a settlement; three injured.",
          location: "Unnamed settlement",
          province: null,
          latitude: null,
          longitude: null,
        }),
        // Coordinates but NO credible sub-national location anywhere (title,
        // summary, location and province are all place-free) → country-only
        // precision, must not plot despite having coords.
        inc({
          id: 3,
          title: "Armed clash injures three at a settlement",
          summary: "Police reported an armed clash between groups; three injured.",
          location: null,
          province: null,
          latitude: -9.4438,
          longitude: 147.1803,
        }),
      ],
      thirtyDay: [],
      ninetyDay: [],
      baselineWatchlist: [],
      periodLabel: "6 to 12 August 2026",
      windowStart: new Date("2026-08-06T00:00:00Z"),
    });
    // Row 2 has credible location but no coords; row 3 has coords but no
    // credible sub-national location. Neither may plot.
    expect(dataset.mapPoints.filter((p) => String(p.eventId) === "2")).toHaveLength(0);
    expect(dataset.mapPoints.filter((p) => String(p.eventId) === "3")).toHaveLength(0);
  });
});
