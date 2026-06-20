import {
  shouldGenerateProse,
  type ProseEffectGateState,
} from "../../artifacts/workbench/src/lib/countryProseGate";

// Guards the client-side settle gate that prevents the country-report prose
// effect from firing before the incidents query resolves. Firing early grounds
// prose on a transient empty set and races a second fingerprint into the cache
// (the regeneration loop). The core regression: while loading
// (incidentsSuccess=false, incidentsError=false) the gate MUST stay shut.

const READY: ProseEffectGateState = {
  hasCountry: true,
  editing: false,
  incidentsSuccess: true,
  incidentsError: false,
  isStructured: false,
  structuredReady: false,
};

describe("shouldGenerateProse", () => {
  it("fires once the incidents query has settled successfully", () => {
    expect(shouldGenerateProse(READY)).toBe(true);
  });

  it("does NOT fire while the incidents query is still loading", () => {
    expect(
      shouldGenerateProse({ ...READY, incidentsSuccess: false, incidentsError: false }),
    ).toBe(false);
  });

  it("fires when the incidents query settles with an error (degrade to template)", () => {
    expect(
      shouldGenerateProse({ ...READY, incidentsSuccess: false, incidentsError: true }),
    ).toBe(true);
  });

  it("fires for a genuinely empty but settled window", () => {
    // The gate keys off the query state, not the incident count — a quiet week
    // settles with an empty array and is allowed to proceed.
    expect(shouldGenerateProse({ ...READY, incidentsSuccess: true })).toBe(true);
  });

  it("does NOT fire before the country has loaded", () => {
    expect(shouldGenerateProse({ ...READY, hasCountry: false })).toBe(false);
  });

  it("does NOT fire while the analyst is editing", () => {
    expect(shouldGenerateProse({ ...READY, editing: true })).toBe(false);
  });

  it("waits for the structured dataset on a structured brief", () => {
    expect(
      shouldGenerateProse({ ...READY, isStructured: true, structuredReady: false }),
    ).toBe(false);
    expect(
      shouldGenerateProse({ ...READY, isStructured: true, structuredReady: true }),
    ).toBe(true);
  });
});
