/**
 * @jest-environment jsdom
 */
import {
  JAKARTA_CORRIDOR_AREAS,
  corridorIndexForIncident,
  buildJakartaCorridorStatuses,
} from "../../artifacts/workbench/src/lib/jakartaCorridors";
import type { CountryFastFactsIncident } from "../../artifacts/workbench/src/lib/countryFastFacts";

// Mirrors jakartaMapZones.test.ts. The corridor model attributes a Jakarta
// incident to one of six fixed functional areas via keyword match over its
// location text + masthead-stripped headline. The airport corridor runs as a
// pre-pass so an airport-specific token wins over a generic district token.

const AIRPORT_IDX = JAKARTA_CORRIDOR_AREAS.findIndex((a) => a.airportPrePass);
const CENTRAL_IDX = JAKARTA_CORRIDOR_AREAS.findIndex(
  (a) => a.id === "central-government",
);
const COMMUTER_IDX = JAKARTA_CORRIDOR_AREAS.findIndex(
  (a) => a.id === "commuter-belt",
);

function incident(
  fields: Partial<CountryFastFactsIncident>,
): CountryFastFactsIncident {
  return {
    topic: "flashpoint",
    title: "Untitled",
    severity: "low",
    occurredAt: "2026-06-20T00:00:00.000Z",
    ...fields,
  };
}

describe("jakartaCorridors — six fixed areas", () => {
  it("defines exactly six areas with one airport pre-pass", () => {
    expect(JAKARTA_CORRIDOR_AREAS).toHaveLength(6);
    expect(
      JAKARTA_CORRIDOR_AREAS.filter((a) => a.airportPrePass),
    ).toHaveLength(1);
    expect(AIRPORT_IDX).toBeGreaterThanOrEqual(0);
  });
});

describe("corridorIndexForIncident — attribution", () => {
  it("routes 'Cengkareng, West Jakarta' to the airport corridor (pre-pass)", () => {
    const idx = corridorIndexForIncident(
      incident({ location: "Cengkareng, West Jakarta" }),
    );
    expect(idx).toBe(AIRPORT_IDX);
  });

  it("routes explicit airport tokens to the airport corridor", () => {
    for (const loc of ["Soekarno-Hatta", "Soetta terminal 3", "CGK"]) {
      expect(corridorIndexForIncident(incident({ location: loc }))).toBe(
        AIRPORT_IDX,
      );
    }
  });

  it("routes a government-district headline to central government", () => {
    const idx = corridorIndexForIncident(
      incident({
        location: null,
        title: "Protesters mass outside Monas in central Jakarta",
      }),
    );
    expect(idx).toBe(CENTRAL_IDX);
  });

  it("routes a flood headline to the commuter belt", () => {
    const idx = corridorIndexForIncident(
      incident({ location: "Bekasi", title: "Banjir cuts commuter routes" }),
    );
    expect(idx).toBe(COMMUTER_IDX);
  });

  it("strips a masthead tail so a publisher name supplies no false match", () => {
    // "Port" appears only in the masthead, which must be stripped before match.
    const idx = corridorIndexForIncident(
      incident({
        location: null,
        title: "Toll road gridlock snarls morning commute - Jakarta Port Times",
      }),
    );
    const crossCity = JAKARTA_CORRIDOR_AREAS.findIndex(
      (a) => a.id === "cross-city-routes",
    );
    expect(idx).toBe(crossCity);
  });

  it("returns null when no area matches", () => {
    const idx = corridorIndexForIncident(
      incident({ location: "Surabaya", title: "Unrelated upcountry item" }),
    );
    expect(idx).toBeNull();
  });
});

describe("buildJakartaCorridorStatuses — this-week elevation", () => {
  it("returns all six areas standing/monitored for an empty window", () => {
    const { statuses, unattributed } = buildJakartaCorridorStatuses([]);
    expect(statuses).toHaveLength(6);
    expect(unattributed).toBe(0);
    for (const s of statuses) {
      expect(s.count).toBe(0);
      expect(s.elevated).toBe(false);
      expect(s.worstKey).toBe("");
    }
    expect(statuses.map((s) => s.number)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("flips a matched area to elevated and tracks worst severity", () => {
    const { statuses } = buildJakartaCorridorStatuses([
      incident({ location: "Menteng", severity: "moderate" }),
      incident({ location: "Gambir", severity: "high" }),
    ]);
    const central = statuses[CENTRAL_IDX];
    expect(central.count).toBe(2);
    expect(central.elevated).toBe(true);
    expect(central.worstKey).toBe("high");
    // Other areas stay standing.
    expect(statuses[COMMUTER_IDX].elevated).toBe(false);
  });

  it("counts records that match no area as unattributed", () => {
    const { statuses, unattributed } = buildJakartaCorridorStatuses([
      incident({ location: "Surabaya", title: "Unrelated upcountry item" }),
    ]);
    expect(unattributed).toBe(1);
    expect(statuses.every((s) => s.count === 0)).toBe(true);
  });
});
