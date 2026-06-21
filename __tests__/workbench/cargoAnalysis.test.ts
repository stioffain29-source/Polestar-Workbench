import {
  cargoScope,
  classifyScope,
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
