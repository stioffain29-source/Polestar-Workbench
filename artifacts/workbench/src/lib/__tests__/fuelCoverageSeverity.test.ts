import { assessFuelOperationalSeverity } from "../fuelCoverage";
import type { CanonicalFuelIncident } from "../fuelCanonicalFacts";

function incident(over: Partial<CanonicalFuelIncident>): CanonicalFuelIncident {
  return {
    id: "fuel-test",
    title: "Fuel market update",
    date: "2026-09-15",
    occurredAt: "2026-09-15T12:00:00Z",
    country: "Saudi Arabia",
    physicalLocation: null,
    routeOrChokepoint: null,
    severity: "Low",
    evidenceStatus: "Current",
    evidenceWeight: 1,
    evidenceFamilyId: "family-test",
    raw: {
      id: 1,
      topic: "fuel",
      title: "Fuel market update",
      summary: "",
      country: "Saudi Arabia",
      location: null,
      severity: "low",
      occurredAt: "2026-09-15T12:00:00Z",
    },
    ...over,
  } as CanonicalFuelIncident;
}

describe("fuel operational severity", () => {
  it("rates major export disruption independently of the legacy incident severity", () => {
    expect(assessFuelOperationalSeverity(incident({
      severity: "Low",
      title: "Saudi East-West Pipeline shut after attack",
      raw: {
        id: 1,
        topic: "fuel",
        title: "Saudi East-West Pipeline shut after attack",
        summary: "Yanbu loadings were suspended and European crude cargoes were cancelled.",
        country: "Saudi Arabia",
        location: "Yanbu",
        severity: "low",
        occurredAt: "2026-09-15T12:00:00Z",
      },
    }))).toBe("S4");
  });

  it("does not turn a high legacy label into operational severity without a measurable effect", () => {
    expect(assessFuelOperationalSeverity(incident({
      severity: "High",
      title: "Officials discuss the regional fuel outlook",
      raw: {
        id: 2,
        topic: "fuel",
        title: "Officials discuss the regional fuel outlook",
        summary: "The meeting ended without a supply, price or operational change.",
        country: "Malaysia",
        location: null,
        severity: "high",
        occurredAt: "2026-09-15T12:00:00Z",
      },
    }))).toBe("S1");
  });
});