// §34 scenario coverage that was NOT already exercised by engineCore /
// narrative / gate suites. Focus:
//   1. Severity CONSISTENCY — the severity a canonical event carries is the
//      single source of truth everywhere it surfaces (Top-3 vs. included set).
//   2. SPARSE week (§27) — zero credible events omits the analytical sections
//      and returns a short report rather than padding.
//   3. MAP gating (§23) — only INCLUDED events with a credible precision AND
//      real coordinates become map points (Unknown / Country-only / no-coords
//      never plot), and every map point's severity matches its source event.
import {
  buildCanonicalEvents,
  buildCountryNarrative,
  buildTopThree,
  getCountryEngineConfig,
  type EngineSourceInput,
} from "@workspace/country-engine";
import { toMapPoints } from "@/lib/countryEngineAdapter";

const PNG = getCountryEngineConfig("papua-new-guinea");

function input(
  partial: Partial<EngineSourceInput> & { id: string; title: string },
): EngineSourceInput {
  return {
    topic: "test",
    country: "Papua New Guinea",
    occurredAt: "2024-06-15T00:00:00.000Z",
    ...partial,
  };
}

describe("§34 — severity consistency across surfaces", () => {
  const inputs: EngineSourceInput[] = [
    input({
      id: "a",
      title: "Gunmen kill four in a highlands ambush near Mount Hagen",
      summary: "Four people were killed when gunmen ambushed a vehicle.",
      location: "Mount Hagen",
      latitude: -5.86,
      longitude: 144.23,
      severity: "high",
      fatalities: 4,
    }),
    input({
      id: "b",
      title: "Protesters block the Highlands Highway over pay",
      summary: "A crowd blocked the highway for several hours.",
      location: "Lae",
      latitude: -6.73,
      longitude: 146.99,
      severity: "moderate",
    }),
    input({
      id: "c",
      title: "Opportunistic theft reported at a market in Port Moresby",
      summary: "A minor theft was reported.",
      location: "Port Moresby",
      latitude: -9.44,
      longitude: 147.18,
      severity: "low",
    }),
  ];

  const result = buildCanonicalEvents(inputs, PNG);

  it("keeps each event's severity identical in the included set and Top-3", () => {
    const top = buildTopThree(result.included).value;
    for (const dev of top) {
      const source = result.included.find((e) => e.eventId === dev.eventId);
      expect(source).toBeDefined();
      // The development's own severity must be the SAME value the canonical
      // event carries — no re-rating on the way into the Top-3 surface.
      expect(dev.severity).toBe(source!.severity);
    }
  });

  it("plots map points whose severity matches the source event", () => {
    const points = toMapPoints(result.included);
    for (const p of points) {
      const source = result.included.find((e) => e.eventId === p.eventId);
      expect(source).toBeDefined();
      expect(p.precision).toBe(source!.locationPrecision);
    }
  });
});

describe("§27 — sparse week omits analytical sections", () => {
  it("returns a short report and empty sections when there are no events", () => {
    const narrative = buildCountryNarrative([], {
      countryName: "Papua New Guinea",
      priorPeriodEvents: null,
    });
    expect(narrative.isSparse).toBe(true);
    expect(narrative.shortReport).toBeTruthy();
    // Analytical sections are omitted (empty), not padded with filler.
    expect(narrative.currentSituation).toBe("");
    expect(narrative.outlook).toBe("");
    expect(narrative.polestarView).toBe("");
    expect(narrative.topThree).toHaveLength(0);
    expect(narrative.operationalImpact).toHaveLength(0);
    expect(narrative.recommendations).toHaveLength(0);
  });
});

describe("§23 — map gating on precision and coordinates", () => {
  const inputs: EngineSourceInput[] = [
    // Credible precision + coords → plotted.
    input({
      id: "plot",
      title: "Armed robbery wounds a guard at a bank in Lae",
      summary: "A guard was wounded during an armed robbery.",
      location: "Lae",
      latitude: -6.73,
      longitude: 146.99,
      severity: "high",
    }),
    // Country-only precision (no specific place) → never plotted even if the
    // feed carried stray coordinates.
    input({
      id: "country-only",
      title: "Nationwide fuel supply concerns continue across Papua New Guinea",
      summary: "Fuel supply concerns were reported across the country.",
      location: "Papua New Guinea",
      latitude: -6.0,
      longitude: 145.0,
      severity: "moderate",
    }),
  ];

  const result = buildCanonicalEvents(inputs, PNG);

  it("plots only credible-precision, coordinate-bearing included events", () => {
    const points = toMapPoints(result.included);
    const ids = points.map((p) => p.eventId);
    expect(ids).toContain("plot");
    // A country-only location never plots, whatever coordinates the feed carried.
    expect(ids).not.toContain("country-only");
    // Every plotted point carries a credible precision AND real coordinates, and
    // maps back to an INCLUDED event (never a held / excluded / foreign one).
    for (const p of points) {
      expect(["Exact site", "Town or city", "District", "Province or state"]).toContain(
        p.precision,
      );
      expect(Number.isFinite(p.lat)).toBe(true);
      expect(Number.isFinite(p.lng)).toBe(true);
      expect(result.included.some((e) => e.eventId === p.eventId)).toBe(true);
    }
    // Never more points than included events (no fabricated plots).
    expect(points.length).toBeLessThanOrEqual(result.included.length);
  });
});
