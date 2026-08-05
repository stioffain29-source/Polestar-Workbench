import { resolveTheatre } from "../../lib/ingest/src/strikes";

// Regression coverage for the Missile Strike Tracker "land tracker showing
// Maritime targets" bug: a land_gcc feed's country gate only checks that a
// GCC state is NAMED in the headline ("Dubai strikes", "Oman strikes") — it
// never checked what was actually hit. A drone attack on a tanker off Dubai,
// or a vessel seized near an Omani port, satisfied that gate and was stored
// with theatre=land_gcc even though its classified target was a ship or port.
// That put "Maritime" target rows on the Land — GCC Strike Log, which belongs
// on the separate Maritime — Hormuz tracker instead.
describe("resolveTheatre", () => {
  it("moves a land_gcc vessel-target row (e.g. Dubai tanker attack) to maritime_hormuz", () => {
    expect(resolveTheatre("land_gcc", "vessel", "United Arab Emirates")).toBe("maritime_hormuz");
  });

  it("moves a land_gcc port_maritime-target row (e.g. Oman port incident) to maritime_hormuz", () => {
    expect(resolveTheatre("land_gcc", "port_maritime", "Oman")).toBe("maritime_hormuz");
  });

  it("leaves genuinely land targets (military, energy, aviation, civilian) on land_gcc", () => {
    expect(resolveTheatre("land_gcc", "military_site", "Saudi Arabia")).toBe("land_gcc");
    expect(resolveTheatre("land_gcc", "energy_infrastructure", "Saudi Arabia")).toBe("land_gcc");
    expect(resolveTheatre("land_gcc", "airport_aviation", "Kuwait")).toBe("land_gcc");
    expect(resolveTheatre("land_gcc", "civilian_area", "Bahrain")).toBe("land_gcc");
    expect(resolveTheatre("land_gcc", "government_facility", "Qatar")).toBe("land_gcc");
    expect(resolveTheatre("land_gcc", "unknown", "Kuwait")).toBe("land_gcc");
  });

  it("rejects a Jordan land-feed vessel/port story instead of misrouting it onto the Hormuz tracker", () => {
    // Jordan has no Persian Gulf / Strait of Hormuz coastline (only the Gulf
    // of Aqaba, a different waterway), so it is not in MARITIME_COUNTRIES —
    // reassigning it to maritime_hormuz would just trade one wrong-theatre
    // error for another.
    expect(resolveTheatre("land_gcc", "vessel", "Jordan")).toBeNull();
    expect(resolveTheatre("land_gcc", "port_maritime", "Jordan")).toBeNull();
  });

  it("leaves maritime_hormuz feed rows unchanged regardless of target category", () => {
    expect(resolveTheatre("maritime_hormuz", "vessel", "Strait of Hormuz")).toBe("maritime_hormuz");
    expect(resolveTheatre("maritime_hormuz", "military_site", "Iran")).toBe("maritime_hormuz");
  });
});
