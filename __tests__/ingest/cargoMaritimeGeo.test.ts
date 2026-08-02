import { cargoTestHooks } from "../../lib/ingest/src/cargoWatch";

// Locks the bug report: a port/anchorage/vessel-boarding cargo item that
// resolves to a bare country centroid (no in-text city/port match) must
// never be plotted there — a bulk carrier boarded "off Malaysia" cannot be
// sitting in the middle of the Malay jungle. It must fall through to a real
// coastal port instead. Genuine named-port matches (geo.location already
// set) and non-maritime ALLOW terms (warehouse/truck/depot theft — real
// events at real inland places) must be left completely untouched.
const { sanitizeCargoMaritimeGeo } = cargoTestHooks;

describe("cargoWatch maritime geo sanitization", () => {
  it("clamps a bare Malaysia country-centroid vessel-boarding item onto Port Klang, not the jungle", () => {
    const bareCentroid = { latitude: 4.21, longitude: 101.98, location: null };
    const result = sanitizeCargoMaritimeGeo(bareCentroid, "Malaysia", "allow:pirates boarded");
    expect(result?.location).toBe("Port Klang");
    expect(result?.latitude).not.toBe(4.21);
    expect(result?.longitude).not.toBe(101.98);
  });

  it("clamps a bare Saudi Arabia country-centroid anchorage-robbery item onto Jeddah", () => {
    const bareCentroid = { latitude: 23.89, longitude: 45.08, location: null };
    const result = sanitizeCargoMaritimeGeo(bareCentroid, "Saudi Arabia", "allow:anchorage robbery");
    expect(result?.location).toBe("Jeddah");
    expect(result?.latitude).not.toBe(23.89);
  });

  it("keeps a genuine named-port city match (Manila) for a stowaway item untouched", () => {
    const cityMatch = { latitude: 14.6, longitude: 120.98, location: "Manila" };
    const result = sanitizeCargoMaritimeGeo(cityMatch, "Philippines", "allow:stowaway");
    expect(result).toEqual(cityMatch);
  });

  it("leaves the Singapore country centroid alone (island state, already coastal)", () => {
    const singaporeCentroid = { latitude: 1.35, longitude: 103.82, location: null };
    const result = sanitizeCargoMaritimeGeo(singaporeCentroid, "Singapore", "allow:port robbery");
    expect(result?.latitude).toBe(1.35);
    expect(result?.longitude).toBe(103.82);
  });

  it("does not touch a non-maritime ALLOW term (warehouse theft) even with a bare country centroid", () => {
    const bareCentroid = { latitude: 22.59, longitude: 78.96, location: null };
    const result = sanitizeCargoMaritimeGeo(bareCentroid, "India", "allow:warehouse theft");
    expect(result).toEqual(bareCentroid);
  });

  it("does not touch a truck-park robbery item (real roadside location, not open water)", () => {
    const bareCentroid = { latitude: 15.87, longitude: 100.99, location: null };
    const result = sanitizeCargoMaritimeGeo(bareCentroid, "Thailand", "allow:truck park robbery");
    expect(result).toEqual(bareCentroid);
  });

  it("leaves a landlocked-country maritime match unresolved (no honest coastal point to guess)", () => {
    const bareCentroid = { latitude: 19.86, longitude: 102.5, location: null };
    const result = sanitizeCargoMaritimeGeo(bareCentroid, "Laos", "allow:container smuggling");
    expect(result).toEqual(bareCentroid);
  });

  it("passes through a null geo unchanged", () => {
    const result = sanitizeCargoMaritimeGeo(null, "Malaysia", "allow:pirates boarded");
    expect(result).toBeNull();
  });
});
