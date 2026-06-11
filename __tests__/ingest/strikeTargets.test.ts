import {
  classifyStrikeTarget,
  classifyStrikeInfrastructure,
} from "@workspace/strike-targets";

describe("classifyStrikeTarget", () => {
  it("classifies military bases as military_site", () => {
    expect(classifyStrikeTarget("Missile hits air base in the south")).toBe(
      "military_site",
    );
    expect(classifyStrikeTarget("Strike on Al-Udeid airbase")).toBe(
      "military_site",
    );
    expect(classifyStrikeTarget("US forces targeted at naval base")).toBe(
      "military_site",
    );
  });

  it("classifies oil & gas targets as energy_infrastructure", () => {
    expect(classifyStrikeTarget("Drone strike on oil refinery")).toBe(
      "energy_infrastructure",
    );
    expect(classifyStrikeTarget("Aramco facility hit by missile")).toBe(
      "energy_infrastructure",
    );
  });

  it("classifies power targets as energy_infrastructure", () => {
    expect(classifyStrikeTarget("Power plant knocked offline by strike")).toBe(
      "energy_infrastructure",
    );
    expect(classifyStrikeTarget("Substation damaged in attack")).toBe(
      "energy_infrastructure",
    );
  });

  it("classifies vessels as vessel", () => {
    expect(classifyStrikeTarget("Oil tanker struck in the gulf")).toBe(
      "vessel",
    );
    expect(classifyStrikeTarget("Cargo ship attacked off the coast")).toBe(
      "vessel",
    );
  });

  it("classifies aviation targets as airport_aviation", () => {
    expect(classifyStrikeTarget("International airport runway hit")).toBe(
      "airport_aviation",
    );
    expect(classifyStrikeTarget("Strike damages civil aviation terminal")).toBe(
      "airport_aviation",
    );
  });

  it("classifies ports as port_maritime", () => {
    expect(classifyStrikeTarget("Attack on the commercial port")).toBe(
      "port_maritime",
    );
    expect(classifyStrikeTarget("Jetty destroyed by drone")).toBe(
      "port_maritime",
    );
  });

  it("classifies government facilities as government_facility", () => {
    expect(classifyStrikeTarget("Missile hits government building")).toBe(
      "government_facility",
    );
    expect(classifyStrikeTarget("Presidential palace struck")).toBe(
      "government_facility",
    );
  });

  it("classifies civilian areas as civilian_area", () => {
    expect(classifyStrikeTarget("Residential neighbourhood shelled")).toBe(
      "civilian_area",
    );
    expect(classifyStrikeTarget("Aluminium smelter hit by strike")).toBe(
      "civilian_area",
    );
  });

  it("returns unknown when no signal matches", () => {
    expect(classifyStrikeTarget("Reports of an explosion in the area")).toBe(
      "unknown",
    );
    expect(classifyStrikeTarget("")).toBe("unknown");
  });

  describe("precedence edge cases", () => {
    it("rates a military airbase as military_site, not airport_aviation", () => {
      expect(
        classifyStrikeTarget("Interception over US military air base"),
      ).toBe("military_site");
    });

    it("rates 'energy facilities' as energy_infrastructure (Oil & Gas)", () => {
      expect(classifyStrikeTarget("Strike on energy facilities")).toBe(
        "energy_infrastructure",
      );
    });

    it("rates an aluminium smelter as civilian_area, not energy", () => {
      expect(classifyStrikeTarget("Aluminium smelter damaged in raid")).toBe(
        "civilian_area",
      );
    });

    it("does NOT treat 'civilians injured' as a civilian-area target", () => {
      expect(classifyStrikeTarget("Two civilians injured in the blast")).toBe(
        "unknown",
      );
    });

    it("prefers energy over vessel for an oil refinery near a port", () => {
      expect(
        classifyStrikeTarget("Oil refinery beside the port was struck"),
      ).toBe("energy_infrastructure");
    });

    it("prefers vessel over port for a tanker in harbour", () => {
      expect(classifyStrikeTarget("Tanker hit while berthed at harbour")).toBe(
        "vessel",
      );
    });
  });
});

describe("classifyStrikeInfrastructure", () => {
  it("classifies power infrastructure as power", () => {
    expect(classifyStrikeInfrastructure("Power grid hit by drone")).toBe(
      "power",
    );
    expect(classifyStrikeInfrastructure("Nuclear reactor targeted")).toBe(
      "power",
    );
  });

  it("classifies oil & gas infrastructure as oil_gas", () => {
    expect(classifyStrikeInfrastructure("Oil depot set ablaze")).toBe(
      "oil_gas",
    );
    expect(classifyStrikeInfrastructure("Gas pipeline ruptured")).toBe(
      "oil_gas",
    );
  });

  it("classifies airports as airport", () => {
    expect(classifyStrikeInfrastructure("Airfield runway cratered")).toBe(
      "airport",
    );
  });

  it("classifies military infrastructure as military", () => {
    expect(classifyStrikeInfrastructure("Army base barracks hit")).toBe(
      "military",
    );
  });

  it("classifies ports as port", () => {
    expect(classifyStrikeInfrastructure("Dock workers flee after strike")).toBe(
      "port",
    );
  });

  it("classifies government buildings as government", () => {
    expect(classifyStrikeInfrastructure("Ministry building shelled")).toBe(
      "government",
    );
  });

  it("classifies residential targets as civilian_residential", () => {
    expect(classifyStrikeInfrastructure("Housing block destroyed")).toBe(
      "civilian_residential",
    );
  });

  it("returns unknown when no signal matches", () => {
    expect(classifyStrikeInfrastructure("Loud blast reported overnight")).toBe(
      "unknown",
    );
  });

  describe("precedence edge cases", () => {
    it("prefers power over oil_gas when both present", () => {
      expect(
        classifyStrikeInfrastructure("Power plant at the oil refinery hit"),
      ).toBe("power");
    });

    it("prefers airport over military when both present", () => {
      expect(
        classifyStrikeInfrastructure("Military airfield runway struck"),
      ).toBe("airport");
    });
  });
});
