/**
 * @jest-environment jsdom
 */
import {
  JAKARTA_CORRIDOR_AREAS,
  JAKARTA_EXPOSURE_RANK,
  corridorIndexForIncident,
  buildJakartaCorridorStatuses,
  hazardSummaryLabel,
  severityToExposure,
  maxExposure,
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

describe("severityToExposure / maxExposure — exposure model", () => {
  it("maps severities to exposure levels (live only ever raises)", () => {
    expect(severityToExposure("extreme")).toBe("high");
    expect(severityToExposure("high")).toBe("high");
    expect(severityToExposure("moderate")).toBe("elevated");
    expect(severityToExposure("low")).toBe("monitored");
    expect(severityToExposure("insignificant")).toBe("low");
    expect(severityToExposure("")).toBeNull();
    expect(severityToExposure("nonsense")).toBeNull();
  });

  it("returns the higher-ranked exposure level", () => {
    expect(maxExposure("monitored", "high")).toBe("high");
    expect(maxExposure("elevated", "monitored")).toBe("elevated");
    expect(maxExposure("low", "not-assessed")).toBe("low");
    expect(maxExposure("high", "high")).toBe("high");
  });

  it("ranks levels high > elevated > monitored > low > not-assessed", () => {
    expect(JAKARTA_EXPOSURE_RANK.high).toBeGreaterThan(
      JAKARTA_EXPOSURE_RANK.elevated,
    );
    expect(JAKARTA_EXPOSURE_RANK.elevated).toBeGreaterThan(
      JAKARTA_EXPOSURE_RANK.monitored,
    );
    expect(JAKARTA_EXPOSURE_RANK.monitored).toBeGreaterThan(
      JAKARTA_EXPOSURE_RANK.low,
    );
    expect(JAKARTA_EXPOSURE_RANK.low).toBeGreaterThan(
      JAKARTA_EXPOSURE_RANK["not-assessed"],
    );
  });
});

describe("jakartaCorridors — area baselines", () => {
  it("gives every area a standing baseline exposure", () => {
    for (const a of JAKARTA_CORRIDOR_AREAS) {
      expect(JAKARTA_EXPOSURE_RANK[a.baselineExposure]).toBeGreaterThanOrEqual(
        0,
      );
    }
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
      // No live reporting: live is null, display falls back to baseline.
      expect(s.liveExposure).toBeNull();
      expect(s.displayExposure).toBe(s.baselineExposure);
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
    // A high record raises the live exposure to "high"; display = max(baseline, live).
    expect(central.liveExposure).toBe("high");
    expect(central.displayExposure).toBe("high");
    // Other areas stay standing (display == baseline, no live).
    expect(statuses[COMMUTER_IDX].elevated).toBe(false);
    expect(statuses[COMMUTER_IDX].liveExposure).toBeNull();
    expect(statuses[COMMUTER_IDX].displayExposure).toBe(
      statuses[COMMUTER_IDX].baselineExposure,
    );
  });

  it("never lowers the displayed level below the standing baseline", () => {
    // An insignificant record maps to live="low"; central baseline is "elevated",
    // so display must stay at the higher baseline, not drop to "low".
    const { statuses } = buildJakartaCorridorStatuses([
      incident({ location: "Menteng", severity: "insignificant" }),
    ]);
    const central = statuses[CENTRAL_IDX];
    expect(central.elevated).toBe(true);
    expect(central.liveExposure).toBe("low");
    expect(central.baselineExposure).toBe("elevated");
    expect(central.displayExposure).toBe("elevated");
  });

  it("counts records that match no area as unattributed", () => {
    const { statuses, unattributed } = buildJakartaCorridorStatuses([
      incident({ location: "Surabaya", title: "Unrelated upcountry item" }),
    ]);
    expect(unattributed).toBe(1);
    expect(statuses.every((s) => s.count === 0)).toBe(true);
  });
});

describe("dynamic hazard prose — names a hazard ONLY when reported", () => {
  it("names no hazard for an empty window (neutral standing line)", () => {
    const { statuses } = buildJakartaCorridorStatuses([]);
    for (const s of statuses) {
      expect(s.count).toBe(0);
      expect(hazardSummaryLabel(s)).toBe("Standing profile");
      expect(s.relevance).toContain("No specific incidents were reported");
      expect(s.relevance).not.toMatch(/flood|protest|crime|\bfire\b|traffic/i);
    }
  });

  it("names protest only where a protest was reported", () => {
    const { statuses } = buildJakartaCorridorStatuses([
      incident({
        location: "Menteng",
        title: "Large demonstration outside ministry",
        severity: "high",
      }),
    ]);
    const central = statuses[CENTRAL_IDX];
    expect(hazardSummaryLabel(central)).toBe("Protest");
    expect(central.relevance).toContain("Protest activity was reported");
    // An unaffected area must not inherit the protest claim.
    expect(hazardSummaryLabel(statuses[COMMUTER_IDX])).toBe("Standing profile");
    expect(statuses[COMMUTER_IDX].relevance).not.toMatch(/protest/i);
  });

  it("names flooding disjunctively when flooding or heavy rain is reported", () => {
    const { statuses } = buildJakartaCorridorStatuses([
      incident({
        location: "Bekasi",
        title: "Heavy rain floods commuter routes",
        severity: "moderate",
      }),
    ]);
    const commuter = statuses[COMMUTER_IDX];
    expect(commuter.count).toBe(1);
    expect(hazardSummaryLabel(commuter)).toBe("Flooding / heavy rain");
    expect(commuter.relevance).toContain("Flooding or heavy rain was reported");
  });

  it("does NOT claim flooding for a landslide-only record", () => {
    const { statuses } = buildJakartaCorridorStatuses([
      incident({
        location: "Bekasi",
        title: "Landslide damages homes",
        severity: "moderate",
      }),
    ]);
    const commuter = statuses[COMMUTER_IDX];
    expect(commuter.count).toBe(1);
    expect(commuter.relevance).not.toMatch(/flood/i);
    expect(commuter.relevance).toContain("Security-relevant activity was reported");
    expect(hazardSummaryLabel(commuter)).toBe("Security-relevant activity");
  });
});
