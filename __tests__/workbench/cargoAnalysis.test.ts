import {
  cargoScope,
  cargoCountry,
  recoverCargoCountryFromText,
  type CargoIncidentLike,
} from "../../artifacts/workbench/src/lib/cargoAnalysis";

// Minimal record factory — only the fields cargoAnalysis reads.
function rec(p: Partial<CargoIncidentLike>): CargoIncidentLike {
  return { title: "", summary: null, source: null, location: null, country: null, ...p };
}

describe("recoverCargoCountryFromText", () => {
  it("recovers Indonesian sub-national places", () => {
    expect(recoverCargoCountryFromText(rec({ title: "Pencurian gudang di Tuban" }))).toBe("Indonesia");
    expect(recoverCargoCountryFromText(rec({ title: "Truk dibobol di Sragen" }))).toBe("Indonesia");
  });
  it("recovers Malaysia / Philippines / Hong Kong places", () => {
    expect(recoverCargoCountryFromText(rec({ title: "Warehouse raid in Penang" }))).toBe("Malaysia");
    expect(recoverCargoCountryFromText(rec({ title: "Cargo theft in Bulacan" }))).toBe("Philippines");
    expect(recoverCargoCountryFromText(rec({ title: "Container stolen in Fo Tan" }))).toBe("China");
  });
  it("does NOT recover out-of-scope / unattributed commentary", () => {
    expect(recoverCargoCountryFromText(rec({ title: "Cargo theft surges across the US, says FreightWaves" }))).toBeNull();
    expect(recoverCargoCountryFromText(rec({ title: "LAPD recovers stolen freight in Los Angeles" }))).toBeNull();
    expect(recoverCargoCountryFromText(rec({ title: "ATA warns of rising trailer theft" }))).toBeNull();
    expect(recoverCargoCountryFromText(rec({ title: "Truckers hit by cargo crime in Canada" }))).toBeNull();
    expect(recoverCargoCountryFromText(rec({ title: "Lorry hijacked on UK motorway" }))).toBeNull();
  });
  it("never reads the source / feed label", () => {
    // The feed name carries a misleading region; only title+summary count.
    expect(recoverCargoCountryFromText(rec({ title: "Warehouse break-in reported", source: "Australia Freight & Truck Theft" }))).toBeNull();
  });
});

describe("classifyScope — country recovery via text", () => {
  it("pulls a genuine APAC record with no stored country into scope", () => {
    expect(cargoScope(rec({ title: "Pencurian gudang logistik di Tuban", country: "Unknown" }))).toBe("in_scope");
    expect(cargoScope(rec({ title: "Container stolen from depot in Fo Tan", country: null }))).toBe("in_scope");
  });
  it("leaves unattributed US / global cargo commentary in needs-review", () => {
    expect(cargoScope(rec({ title: "Cargo theft surges across the US, says FreightWaves", country: "Unknown" }))).toBe("country_review");
    expect(cargoScope(rec({ title: "LAPD recovers stolen freight worth millions", country: null }))).toBe("country_review");
  });
  it("does not reclassify an explicit out-of-scope location", () => {
    expect(cargoScope(rec({ title: "Cargo truck hijacked in Canada", country: "Canada" }))).toBe("out_of_scope_geo");
  });
});

describe("classifyScope — recovery requires cargo-anchored vocab, not a bare place + generic crime", () => {
  it("does NOT admit generic non-cargo crime that merely names a recovered place", () => {
    // Place matches the gazetteer but the crime is not cargo/logistics.
    expect(cargoScope(rec({ title: "Motorcycle theft in Penang, two arrested", country: "Unknown" }))).toBe("country_review");
    expect(cargoScope(rec({ title: "Robbery at a Bulacan jewellery shop", country: null }))).toBe("country_review");
  });
  it("still admits cargo-NOUN-anchored crime at a recovered place", () => {
    expect(cargoScope(rec({ title: "Cigarettes seized in Penang warehouse raid", country: "Unknown" }))).toBe("in_scope");
    expect(cargoScope(rec({ title: "Smuggled goods uncovered in Bulacan warehouse", country: null }))).toBe("in_scope");
    expect(cargoScope(rec({ title: "Container stolen from a Fo Tan depot", country: "Unknown" }))).toBe("in_scope");
  });
});

describe("classifyScope — Bahasa cargo vocabulary gate", () => {
  it("accepts a Bahasa cargo noun + theft verb", () => {
    expect(cargoScope(rec({ title: "Gudang ekspedisi dibobol maling", country: "Indonesia" }))).toBe("in_scope");
    expect(cargoScope(rec({ title: "Kontainer kargo dijarah di pelabuhan", country: "Indonesia" }))).toBe("in_scope");
  });
  it("rejects generic Indonesian theft with no cargo noun", () => {
    // pencurian motor = motorcycle theft — not cargo crime.
    expect(cargoScope(rec({ title: "Pencurian motor di perumahan", country: "Indonesia" }))).toBe("excluded_non_cargo");
  });
});

describe("cargoCountry — effective display country", () => {
  it("prefers the stored country", () => {
    expect(cargoCountry(rec({ title: "Warehouse theft", country: "Malaysia" }))).toBe("Malaysia");
    expect(cargoCountry(rec({ title: "Theft in Hong Kong", country: "Hong Kong" }))).toBe("China");
  });
  it("falls back to a recovered country when none stored", () => {
    expect(cargoCountry(rec({ title: "Truk dibobol di Sragen", country: "Unknown" }))).toBe("Indonesia");
  });
  it("returns null when nothing recoverable", () => {
    expect(cargoCountry(rec({ title: "Cargo theft surges in the US", country: "Unknown" }))).toBeNull();
  });
});
