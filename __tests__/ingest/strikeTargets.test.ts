import {
  classifyStrikeTarget,
  classifyStrikeInfrastructure,
  hasMilitaryTargetSignal,
  hasVesselSignal,
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

  describe("attacker / responder awareness", () => {
    it("treats the US force as the attacker, not a military target", () => {
      expect(
        classifyStrikeTarget(
          "US Central Command disables a tanker in the Gulf of Oman",
        ),
      ).toBe("vessel");
      expect(
        classifyStrikeTarget("US disables tanker bound for Iran: CENTCOM"),
      ).toBe("vessel");
      expect(
        classifyStrikeTarget(
          "US military fires missile on Gambia-flagged merchant vessel",
        ),
      ).toBe("vessel");
    });

    it("reads 'disable/seize/board ship' as a vessel target", () => {
      expect(
        classifyStrikeTarget(
          "US military fires missile to disable ship in Gulf of Oman, CENTCOM says",
        ),
      ).toBe("vessel");
      expect(classifyStrikeTarget("Ship seized off coast of UAE near Hormuz")).toBe(
        "vessel",
      );
      expect(classifyStrikeTarget("One ship seized, another sunk near Hormuz")).toBe(
        "vessel",
      );
    });

    it("does NOT count a US force that only intercepted as a target", () => {
      expect(
        classifyStrikeTarget("US warship intercepts drone over Red Sea"),
      ).toBe("unknown");
      expect(
        classifyStrikeTarget(
          "US Central Command intercepts Iranian missile attacks on Bahrain",
        ),
      ).toBe("unknown");
    });

    it("still counts a US force that WAS struck (passive) as military", () => {
      expect(
        classifyStrikeTarget("US troops struck by rocket at al-Asad"),
      ).toBe("military_site");
      expect(
        classifyStrikeTarget("US troops killed in drone attack in Jordan"),
      ).toBe("military_site");
    });

    it("treats KC-135 refuelling tankers as military aircraft, not vessels", () => {
      expect(
        classifyStrikeTarget(
          "Iran missile strike damages five KC-135 tankers in Saudi Arabia",
        ),
      ).toBe("military_site");
    });

    it("never reads a generic refuelling-aircraft 'tanker' as a vessel", () => {
      // Not specifically routed to military, but crucially NOT a vessel.
      expect(
        classifyStrikeTarget("Refuelling tanker aircraft seen over the apron"),
      ).not.toBe("vessel");
      expect(
        classifyStrikeTarget("KC-135 tankers refuel fighter jets over the Gulf"),
      ).not.toBe("vessel");
    });

    it("does not read a responding warship as the struck vessel", () => {
      expect(
        classifyStrikeTarget("HMS Lancaster responds to a drone attack"),
      ).toBe("unknown");
      // The actual target (the tanker) still wins.
      expect(
        classifyStrikeTarget(
          "HMS Lancaster first to respond after a drone attack on a tanker",
        ),
      ).toBe("vessel");
    });
  });
});

describe("hasMilitaryTargetSignal", () => {
  it("is true for a struck base or struck force, false for an attacking force", () => {
    expect(hasMilitaryTargetSignal("Saudi air base struck by missile")).toBe(true);
    expect(hasMilitaryTargetSignal("US troops struck by rocket")).toBe(true);
    expect(hasMilitaryTargetSignal("US Central Command disables a tanker")).toBe(
      false,
    );
  });
});

describe("hasVesselSignal", () => {
  it("is true for a struck ship, false for a refuelling aircraft or responder", () => {
    expect(hasVesselSignal("Oil tanker hit by limpet mine")).toBe(true);
    expect(hasVesselSignal("KC-135 tankers refuel fighter jets")).toBe(false);
    expect(hasVesselSignal("US warship intercepts drone over Red Sea")).toBe(false);
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
