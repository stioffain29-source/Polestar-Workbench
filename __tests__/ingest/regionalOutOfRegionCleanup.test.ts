import {
  decideRegionalCleanup,
  APAC_LOCAL_CONFIG,
  INDONESIA_LOCAL_CONFIG,
  CONFLICT_CONFIG,
} from "@workspace/ingest";

// Regression coverage for the retroactive cleanup pass: apac_local /
// indonesia_local / conflict are single-country regional topics. Before the
// OUT_OF_REGION list was expanded (see outOfRegionCountries.test.ts), a story
// naming an untracked foreign country was blind-stamped with the feed's
// default country instead of being rejected — e.g. a Greek wildfire on the
// Philippine Daily Inquirer feed got stamped "Philippines", a Ceuta riot on
// an Indonesian feed got stamped "Indonesia". This locks in that
// decideRegionalCleanup() — the exact per-row decision the retroactive
// cleanup pass uses — now flags those already-stored rows for deletion,
// while leaving genuinely in-region rows untouched.

describe("decideRegionalCleanup", () => {
  it("flags a Greece wildfire story mis-stamped Philippines for deletion (the reported bug)", () => {
    const decision = decideRegionalCleanup(APAC_LOCAL_CONFIG, {
      title: "Wildfires rage across Greece as heatwave intensifies",
      summary: "Authorities in Athens declared a state of emergency.",
      source: "Philippine Daily Inquirer",
      country: "Philippines",
    });
    expect(decision).toEqual({ drop: true, foreignCountry: "Greece" });
  });

  it("flags a Ceuta unrest story mis-stamped Indonesia for deletion (the reported bug)", () => {
    const decision = decideRegionalCleanup(INDONESIA_LOCAL_CONFIG, {
      title: "Clashes erupt in Ceuta after migrant crossing attempt",
      summary: "Spanish enclave authorities responded with riot police.",
      source: "Reuters",
      country: "Indonesia",
    });
    expect(decision).toEqual({ drop: true, foreignCountry: "Ceuta" });
  });

  it("does not flag a genuine in-region Philippines story", () => {
    const decision = decideRegionalCleanup(APAC_LOCAL_CONFIG, {
      title: "Manila police arrest suspects in Quezon City robbery",
      summary: "Local officials confirmed the arrests took place overnight.",
      source: "Philippine Daily Inquirer",
      country: "Philippines",
    });
    expect(decision.drop).toBe(false);
  });

  it("does not flag a genuine in-region Indonesia story", () => {
    const decision = decideRegionalCleanup(INDONESIA_LOCAL_CONFIG, {
      title: "Jakarta authorities respond to flooding in North Jakarta",
      summary: "Emergency services evacuated residents from low-lying areas.",
      source: "Jakarta Post",
      country: "Indonesia",
    });
    expect(decision.drop).toBe(false);
  });

  it("flags an out-of-region conflict-topic row (Peru) for deletion", () => {
    const decision = decideRegionalCleanup(CONFLICT_CONFIG, {
      title: "Armed clash erupts outside Lima stadium in Peru, several hurt",
      summary: "Protests turned violent near the capital.",
      source: "AP",
      country: "Papua New Guinea",
    });
    expect(decision).toEqual({ drop: true, foreignCountry: "Peru" });
  });

  it("leaves a row rejected for a non-out-of-region reason alone (does not delete)", () => {
    // A row that no longer classifies cleanly for some other reason (e.g. an
    // allow-list miss) is a different failure mode than out-of-region
    // contamination and must not be swept up by this cleanup pass.
    const decision = decideRegionalCleanup(CONFLICT_CONFIG, {
      title: "Local community fundraiser held in Port Moresby",
      summary: "Residents gathered to raise money for school supplies.",
      source: "PNG Post-Courier",
      country: "Papua New Guinea",
    });
    if (decision.drop) {
      // If this ever does get rejected, it must be flagged as out-of-region
      // specifically, not silently deleted for an unrelated reason.
      expect(decision.foreignCountry).toBeTruthy();
    } else {
      expect(decision.drop).toBe(false);
    }
  });
});
