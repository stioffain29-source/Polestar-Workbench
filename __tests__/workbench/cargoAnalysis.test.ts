import {
  cargoScope,
  classifyScope,
  classifyRegion,
  recoverCargoPortName,
  classifyCategory,
  classifyCargoCategory,
  cargoCategoryGroup,
  hasPortCargoSecurity,
  CARGO_FLOOR_LABEL,
  CARGO_NOT_RELEVANT,
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

  it("keeps a Bahasa staple-food warehouse theft (CG-01 audit FN)", () => {
    expect(
      cargoScope({
        title: "Pencurian Gudang Sembako di Selomerto Wonosobo Terungkap",
        country: "Indonesia",
      }),
    ).toBe("in_scope");
  });

  it("keeps a Bahasa truck-robber headline naming truk + perampok (CG-01 audit FN)", () => {
    expect(
      cargoScope({
        title: "Polrestabes Medan Didesak Tangkap Perampok Truk Milik Pengusaha Eksped",
        country: "Indonesia",
      }),
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

  it("drops a retail salted-fish parcel theft (seafood, no freight anchor)", () => {
    expect(
      cargoScope({
        title:
          "Police fire to stop vehicle of disruptive drunk woman who stole a 7-kg parcel of salted fish and broke guard barrier to escape",
        country: "Thailand",
      }),
    ).toBe("excluded_non_cargo");
  });

  it("still keeps a genuine seafood FREIGHT theft (freight anchor present)", () => {
    expect(
      cargoScope({
        title: "Reefer container of frozen fish stolen from cold storage depot",
        country: "Thailand",
      }),
    ).toBe("in_scope");
  });

  it("drops an official oversight / follow-up tour that recounts a truck robbery", () => {
    expect(
      cargoScope({
        title:
          "'Big Tai' flies urgently south to monitor petrol-station bombing and robbery of goods transport truck",
        country: "Thailand",
      }),
    ).toBe("excluded_non_cargo");
  });

  it("still keeps a real cargo-truck robbery with no oversight-tour framing", () => {
    expect(
      cargoScope({
        title: "Goods transport truck robbed of its consignment on the southern highway",
        country: "Thailand",
      }),
    ).toBe("in_scope");
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

// Named Port Breakdown depends on a STRICT port extractor: it must name a port
// only when the incident's OWN text (title/summary/location) names exactly one,
// never from the source masthead, never from a bare city, and never when two
// ports appear (that is an origin→destination route, attributing it would be a
// guess).
describe("recoverCargoPortName — strict, no-fabrication port extraction", () => {
  it("names the single port in the title", () => {
    expect(
      recoverCargoPortName({ title: "Container theft ring busted at Port Klang", country: "Malaysia" }),
    ).toEqual({ port: "Port Klang", country: "Malaysia" });
  });

  it("recovers a port named only in the summary", () => {
    expect(
      recoverCargoPortName({
        title: "Cargo theft probe widens",
        summary: "The stolen containers were lifted at Jebel Ali before transfer.",
        country: "UAE",
      }),
    ).toEqual({ port: "Jebel Ali", country: "UAE" });
  });

  it("does NOT read a port from the source masthead", () => {
    expect(
      recoverCargoPortName({
        title: "Warehouse theft suspect arrested",
        source: "Port Klang Daily",
        country: "Malaysia",
      }),
    ).toBeNull();
  });

  it("does NOT match a bare city without the port phrase", () => {
    expect(
      recoverCargoPortName({ title: "Jewellery theft reported in Mumbai", country: "India" }),
    ).toBeNull();
  });

  it("returns null when two distinct ports are named (route story)", () => {
    expect(
      recoverCargoPortName({
        title: "Containers stolen in transit from Port Klang to Singapore",
        summary: "Goods left Port Klang bound for the Port of Singapore.",
        country: "Malaysia",
      }),
    ).toBeNull();
  });

  it("collapses repeated mentions of the same port to a single match", () => {
    expect(
      recoverCargoPortName({
        title: "Laem Chabang theft",
        summary: "Police at Laem Chabang said the Laem Chabang depot was targeted.",
        country: "Thailand",
      }),
    ).toEqual({ port: "Laem Chabang", country: "Thailand" });
  });
});

// The display scope was widened from land-only cargo theft to also keep PORT
// cargo-SECURITY events (stowaways, port/vessel robbery, container narcotics
// seizures) while still dropping commercial-shipping / port-OPERATIONS noise
// (congestion, throughput, freight rates). These tests lock that widening in.
describe("classifyScope — land/warehouse focus (ship theft out)", () => {
  it("excludes armed vessel boarding at anchorage (Shipping Watch territory)", () => {
    expect(
      cargoScope({ title: "Armed robbers boarded a bulk carrier at Singapore anchorage", country: "Singapore" }),
    ).toBe("excluded_non_cargo");
  });

  it("excludes theft from ships at Chittagong without a land logistics node", () => {
    expect(
      cargoScope({
        title: "Thieves steal cargo from ships at Chittagong port",
        country: "Bangladesh",
      }),
    ).toBe("excluded_non_cargo");
  });

  it("keeps a stowaway-in-container report", () => {
    expect(
      cargoScope({ title: "Stowaways discovered inside a shipping container", country: "Malaysia" }),
    ).toBe("in_scope");
  });

  it("keeps a container narcotics seizure at a port", () => {
    expect(
      cargoScope({ title: "Cocaine concealed in a cargo container seized at the port", country: "India" }),
    ).toBe("in_scope");
  });

  it("keeps container theft at a land terminal", () => {
    expect(
      cargoScope({
        title: "Containers stolen from the terminal yard at Port Klang",
        country: "Malaysia",
      }),
    ).toBe("in_scope");
  });

  it("recovers an unattributed port cargo-security event naming an in-scope place", () => {
    expect(
      classifyScope(
        { title: "Stowaways found in a container at Tanjung Priok", country: null },
        "Country not identified",
      ),
    ).toBe("in_scope");
  });
});

describe("classifyScope — shipping-ops / commercial noise is dropped", () => {
  it("drops port congestion even with cargo vocabulary present", () => {
    expect(
      cargoScope({ title: "Port congestion delays containers at Singapore", country: "Singapore" }),
    ).toBe("excluded_non_cargo");
  });

  it("drops freight-rate commercial reporting", () => {
    expect(
      cargoScope({ title: "Container freight rates surge at Port Klang", country: "Malaysia" }),
    ).toBe("excluded_non_cargo");
  });

  it("still keeps a genuine theft reported amid ops-noise wording (security wins)", () => {
    expect(
      cargoScope({ title: "Containers stolen amid record port throughput at Port Klang", country: "Malaysia" }),
    ).toBe("in_scope");
  });
});

// The 30-category taxonomy is the shared classification authority for the
// regrouped monitor + report output. PORT rules must win over the generic land
// rules (a port armed robbery is not a generic warehouse theft), the cargo floor
// catches a real cargo-security event with no finer match, and the NOT_RELEVANT
// sentinel is reserved for records with no cargo-security signal at all.
describe("classifyCargoCategory — 30-category taxonomy", () => {
  const cases: Array<[string, string]> = [
    ["Stowaways found in a container at Tanjung Priok", "Stowaway incident"],
    ["Cocaine seized in a cargo container at the port", "Narcotics seizure (cargo / port)"],
    ["Truck hijacking on the highway near the depot", "Truck hijacking"],
    ["Warehouse theft in Tokyo overnight", "Warehouse theft"],
  ];
  it.each(cases)("classifies %s as %s", (title, label) => {
    expect(classifyCargoCategory({ title })).toBe(label);
  });

  it("falls through to the cargo floor for a real-but-unclassified cargo event", () => {
    expect(classifyCargoCategory({ title: "New cargo security measures announced at the depot" })).toBe(
      CARGO_FLOOR_LABEL,
    );
  });

  it("returns the NOT_RELEVANT sentinel when no cargo-security signal exists", () => {
    expect(classifyCargoCategory({ title: "City council debates a new park bylaw" })).toBe(
      CARGO_NOT_RELEVANT,
    );
  });
});

describe("cargoCategoryGroup — land / port / other grouping", () => {
  it("groups a land label as land", () => {
    expect(cargoCategoryGroup("Truck hijacking")).toBe("land");
  });
  it("groups a port label as port", () => {
    expect(cargoCategoryGroup("Port armed robbery")).toBe("port");
    expect(cargoCategoryGroup("Stowaway incident")).toBe("port");
  });
  it("groups the floor and sentinel as other", () => {
    expect(cargoCategoryGroup(CARGO_FLOOR_LABEL)).toBe("other");
    expect(cargoCategoryGroup(CARGO_NOT_RELEVANT)).toBe("other");
  });
  it("defaults an unknown label to other", () => {
    expect(cargoCategoryGroup("some unmapped label")).toBe("other");
  });
});

describe("hasPortCargoSecurity — port-security anchor gate", () => {
  it("matches a stowaway report", () => {
    expect(hasPortCargoSecurity("Stowaways found at the terminal")).toBe(true);
  });
  it("matches port-side robbery", () => {
    expect(hasPortCargoSecurity("Thieves robbed a depot at the port overnight")).toBe(true);
  });
  it("does not match a bare city robbery with no port/cargo anchor", () => {
    expect(hasPortCargoSecurity("Robbery reported in the city centre")).toBe(false);
  });
});

// The commodity taxonomy (classifyCategory / CATEGORY_RULES) drives the "By
// Cargo Category" chart. A dedicated "Metals / Precious Metals" category now
// captures base and precious metal theft; precious-metal tokens (gold, silver,
// bullion) moved OUT of "Cash / High Value Goods" into it. "Other" stays
// reserved for genuinely unclassified text.
describe("classifyCategory — commodity taxonomy", () => {
  it("classifies base-metal theft (copper) as Metals / Precious Metals", () => {
    expect(classifyCategory({ title: "Copper cable theft ring busted at the depot" })).toBe(
      "Metals / Precious Metals",
    );
  });

  it("classifies scrap-metal / steel loads as Metals / Precious Metals", () => {
    expect(classifyCategory({ title: "Truck of scrap steel stolen on the highway" })).toBe(
      "Metals / Precious Metals",
    );
  });

  it("classifies a gold/silver bullion theft as Metals, not Cash / High Value Goods", () => {
    expect(classifyCategory({ title: "Gold and silver bullion stolen from armoured cargo" })).toBe(
      "Metals / Precious Metals",
    );
  });

  it("keeps cash / currency / ATM in Cash / High Value Goods", () => {
    expect(classifyCategory({ title: "Cash and currency taken in ATM heist" })).toBe(
      "Cash / High Value Goods",
    );
  });

  it("keeps jewellery and diamonds in Cash / High Value Goods", () => {
    expect(classifyCategory({ title: "Jewellery and diamonds seized from the consignment" })).toBe(
      "Cash / High Value Goods",
    );
  });

  it("returns Other only for genuinely unclassified cargo text", () => {
    expect(classifyCategory({ title: "Unknown item reported missing" })).toBe("Other");
  });
});

describe("classifyScope — trade-press commentary / non-incident slop is excluded", () => {
  const SLOP: string[] = [
    "Cargo Theft Costs Trucking $18M Daily",
    "Cargo Theft Up 17 Percent in 2025",
    "SAFER Transport Act takes aim at cargo theft",
    "Why cargo theft is exploding across the country",
    "LPM Webinar now on-demand: cargo theft trends",
    "AI Drives New Wave of Cargo Theft",
    "LAPD recovers nearly $4 million in stolen freight",
    "Cargo Theft in Latin America: A Persistent Threat",
  ];
  it.each(SLOP)("marks commentary as excluded_non_cargo: %s", (title) => {
    expect(classifyScope({ title, country: null }, "Country not identified")).toBe(
      "excluded_non_cargo",
    );
  });

  it("does not let a US-token think-piece survive on an analyst override", () => {
    // The slop check runs ahead of every rescue, so even an analyst-flagged row
    // cannot promote a commentary piece into the lane.
    expect(
      classifyScope(
        { title: "LAPD recovers $4 million in stolen freight", country: "USA", analystInScope: true },
        "APAC",
      ),
    ).toBe("excluded_non_cargo");
  });

  it("still keeps a genuine in-region incident that quotes a loss figure", () => {
    expect(
      classifyScope(
        { title: "Container truck robbery on Pemalang Ring Road, loss of Rp1.8 billion", country: "Indonesia" },
        "APAC",
      ),
    ).toBe("in_scope");
  });
});

// Owner scope ruling: livestock / cattle-truck theft is OUT of Cargo Watch
// UNLESS there is a clear material impact on commercial supply chains,
// logistics, food distribution or business continuity. Routine rural or
// isolated livestock crime is excluded entirely.
describe("classifyScope — livestock scope ruling", () => {
  it("drops a routine highway cattle-truck robbery (no commercial anchor)", () => {
    expect(
      classifyScope(
        { title: "Robbers steal cattle from a truck on a rural road", country: "Bangladesh" },
        "APAC",
      ),
    ).toBe("excluded_non_cargo");
  });

  it("drops rural cattle rustling reported as a truck theft", () => {
    expect(
      classifyScope(
        { title: "Gang loots buffaloes and goats from a village, flees by lorry", country: "India" },
        "APAC",
      ),
    ).toBe("excluded_non_cargo");
  });

  it("keeps livestock theft with a cold-chain / commercial logistics anchor", () => {
    expect(
      classifyScope(
        { title: "Reefer container of frozen poultry stolen from a logistics hub in Malaysia", country: "Malaysia" },
        "APAC",
      ),
    ).toBe("in_scope");
  });

  it("keeps a livestock export consignment theft (commercial supply chain)", () => {
    expect(
      classifyScope(
        { title: "Cattle export consignment hijacked from a port terminal", country: "Indonesia" },
        "APAC",
      ),
    ).toBe("in_scope");
  });

  it("does not let an analyst override re-admit routine livestock theft", () => {
    expect(
      classifyScope(
        { title: "Cows stolen from a farm truck overnight", country: "India", analystInScope: true },
        "APAC",
      ),
    ).toBe("excluded_non_cargo");
  });

  it("leaves non-livestock cargo theft untouched", () => {
    expect(
      classifyScope(
        { title: "Container truck of electronics hijacked on the highway", country: "Thailand" },
        "APAC",
      ),
    ).toBe("in_scope");
  });
});
