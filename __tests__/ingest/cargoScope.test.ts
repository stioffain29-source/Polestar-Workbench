import { canonScopeCountry } from "../../lib/ingest/src/cargoWatch";

describe("canonScopeCountry", () => {
  it("normalises known scope aliases", () => {
    expect(canonScopeCountry("uae")).toBe("UAE");
    expect(canonScopeCountry("Hong Kong")).toBe("China");
    expect(canonScopeCountry("papua new guinea")).toBe("Papua New Guinea");
  });

  it("returns null for out-of-scope or missing countries", () => {
    expect(canonScopeCountry("Nigeria")).toBeNull();
    expect(canonScopeCountry(null)).toBeNull();
    expect(canonScopeCountry("")).toBeNull();
  });
});
