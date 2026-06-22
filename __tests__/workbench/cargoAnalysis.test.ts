import {
  cargoScope,
  classifyScope,
  classifyRegion,
  IN_SCOPE_COUNTRIES,
} from "../../artifacts/workbench/src/lib/cargoAnalysis";

// The product owner asked Cargo Watch to keep ONLY real cargo / goods incidents
// (containers, shipments, freight in transit, depots, named commodities) and to
// drop generic warehouse / truck / cash thefts with no goods involved. These
// tests lock in that scope decision (hasGenuineCargo) for attributed rows and
// the unattributed-country recovery path.

describe("cargoScope — genuine cargo is kept", () => {
  it("keeps a container/depot theft (strong cargo noun)", () => {
    expect(
      cargoScope({ title: "Container of goods stolen from a depot", country: "Malaysia" }),
    ).toBe("in_scope");
  });

  it("keeps a cargo-specific action (hijack) on its own", () => {
    expect(
      cargoScope({ title: "Cargo lorry hijacked on the highway", country: "Thailand" }),
    ).toBe("in_scope");
  });

  it("keeps a named-commodity theft even from a truck (load is the target)", () => {
    expect(
      cargoScope({ title: "Truck robbery of scrap iron under investigation", country: "Malaysia" }),
    ).toBe("in_scope");
  });

  it("keeps a commodity theft with quantity (12 tonnes of chocolate)", () => {
    expect(
      cargoScope({ title: "More than 12 tonnes of Kit Kat chocolate stolen", country: "Malaysia" }),
    ).toBe("in_scope");
  });

  it("keeps a cigarette-distributor warehouse theft (singular commodity)", () => {
    expect(
      cargoScope({ title: "Theft at cigarette distributor warehouse that killed a guard", country: "Indonesia" }),
    ).toBe("in_scope");
  });

  it("keeps a Bahasa container warehouse break-in (noun + crime verb)", () => {
    expect(
      cargoScope({ title: "Pencurian di gudang, kontainer dibobol", country: "Indonesia" }),
    ).toBe("in_scope");
  });
});

describe("cargoScope — generic crime is dropped", () => {
  it("drops a generic warehouse burglary with no goods named", () => {
    expect(
      cargoScope({ title: "Warehouse burglary in Bekasi, thieves break in and steal cash", country: "Indonesia" }),
    ).toBe("excluded_non_cargo");
  });

  it("drops a plain truck (vehicle) theft", () => {
    expect(
      cargoScope({ title: "Thieves stole a truck in Surabaya overnight", country: "Indonesia" }),
    ).toBe("excluded_non_cargo");
  });

  it("drops a cash-in-transit / armoured van robbery", () => {
    expect(
      cargoScope({ title: "Armoured van robbery, millions taken in daylight heist", country: "India" }),
    ).toBe("excluded_non_cargo");
  });

  it("drops generic Bahasa vehicle theft (no cargo vocabulary)", () => {
    expect(
      cargoScope({ title: "Pencurian motor di Bekasi", country: "Indonesia" }),
    ).toBe("excluded_non_cargo");
  });
});

describe("classifyScope — unattributed-country recovery uses the genuine-cargo gate", () => {
  it("recovers an in-scope country for a genuine cargo theft naming a place", () => {
    expect(
      classifyScope(
        { title: "Container theft in Penang industrial zone", country: null },
        "Country not identified",
      ),
    ).toBe("in_scope");
  });

  it("sends a generic (non-cargo) crime naming a place to needs-review, not in-scope", () => {
    expect(
      classifyScope(
        { title: "Motorcycle theft in Penang", country: null },
        "Country not identified",
      ),
    ).toBe("country_review");
  });
});

// "Add to lane" on the Needs Review queue persists analystInScope:true together
// with the analyst-assigned country. That human decision is authoritative: it
// promotes the row past the heuristic cargo-vocab gate (the analyst read the
// source; the classifier only sees the headline) — but it can never override the
// hard non-cargo rejects, and it can never force a row into geography the
// classifier does not recognize as APAC/Middle East.
describe("classifyScope — analyst Needs Review override", () => {
  it("promotes a row the heuristic would have dropped, once a country is assigned", () => {
    // No cargo vocabulary at all → excluded without the override…
    expect(cargoScope({ title: "Three men arrested after a street brawl" })).toBe(
      "excluded_non_cargo",
    );
    // …but in_scope once the analyst assigns an in-scope country and resolves it.
    expect(
      cargoScope({
        title: "Three men arrested after a street brawl",
        country: "Singapore",
        analystInScope: true,
      }),
    ).toBe("in_scope");
  });

  it("promotes a Middle East assignment too", () => {
    expect(
      cargoScope({
        title: "Goods reported missing from the yard",
        country: "United Arab Emirates",
        analystInScope: true,
      }),
    ).toBe("in_scope");
  });

  it("does nothing without the explicit flag (heuristic still governs)", () => {
    expect(
      cargoScope({ title: "Three men arrested after a street brawl", country: "Singapore" }),
    ).toBe("excluded_non_cargo");
  });

  it("cannot force an out-of-scope country into the lane", () => {
    expect(
      cargoScope({
        title: "Container theft at a depot",
        country: "Germany",
        analystInScope: true,
      }),
    ).toBe("out_of_scope_geo");
  });

  it("cannot promote a blank/unidentified country (override needs a recognized region)", () => {
    expect(
      classifyScope(
        { title: "Container theft at a depot", country: null, analystInScope: true },
        "Country not identified",
      ),
    ).toBe("country_review");
  });

  it("never overrides a hard non-cargo reject (port congestion stays excluded)", () => {
    expect(
      cargoScope({
        title: "Port congestion snarls the terminal",
        country: "Singapore",
        analystInScope: true,
      }),
    ).toBe("excluded_non_cargo");
  });
});

// The country picker only offers values the override is allowed to accept, so
// every entry must resolve to an in-scope region — otherwise an analyst could
// pick a country that the override then silently refuses to promote.
describe("IN_SCOPE_COUNTRIES — every picker option is a recognized in-scope region", () => {
  it.each(IN_SCOPE_COUNTRIES)("%s resolves to APAC or Middle East", (country) => {
    expect(["APAC", "Middle East"]).toContain(classifyRegion(country));
  });
});
