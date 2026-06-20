import { computeDarkByTheatre, type PriorVesselSighting } from "@workspace/ingest";

// Nav-status codes used by the loiter rule (AIS spec): 1 = at anchor, 5 = moored.
const AT_ANCHOR = 1;
const MOORED = 5;
const UNDERWAY = 0;

const THEATRES = ["Strait of Hormuz", "Strait of Malacca"] as const;

function sighting(p: Partial<PriorVesselSighting> & { mmsi: number }): PriorVesselSighting {
  return {
    theatre: THEATRES[0],
    lastSog: null,
    lastNavStatus: null,
    ...p,
  };
}

describe("computeDarkByTheatre", () => {
  it("flags a prior loitering vessel that has disappeared from the current sample", () => {
    const prior = [sighting({ mmsi: 111, lastNavStatus: AT_ANCHOR })];
    const out = computeDarkByTheatre(prior, new Set<number>(), THEATRES);
    expect(out.get(THEATRES[0])).toBe(1);
  });

  it("does NOT flag a loitering vessel still transmitting in the current sample", () => {
    const prior = [sighting({ mmsi: 111, lastNavStatus: MOORED })];
    const out = computeDarkByTheatre(prior, new Set([111]), THEATRES);
    // Candidate existed but is still visible -> genuine 0, not NULL.
    expect(out.get(THEATRES[0])).toBe(0);
  });

  it("counts every candidate as dark when zero vessels are currently visible", () => {
    const prior = [
      sighting({ mmsi: 1, lastNavStatus: AT_ANCHOR }),
      sighting({ mmsi: 2, lastSog: 0.2 }),
      sighting({ mmsi: 3, lastNavStatus: MOORED }),
    ];
    const out = computeDarkByTheatre(prior, new Set<number>(), THEATRES);
    expect(out.get(THEATRES[0])).toBe(3);
  });

  it("excludes fast-transiting vessels from candidacy (a normal departure is not dark)", () => {
    const prior = [sighting({ mmsi: 111, lastSog: 12, lastNavStatus: UNDERWAY })];
    const out = computeDarkByTheatre(prior, new Set<number>(), THEATRES);
    // No loitering candidates at all -> not measurable -> NULL, never a 0.
    expect(out.get(THEATRES[0])).toBeNull();
  });

  it("excludes a vessel with no movement data (no speed, no anchored status)", () => {
    const prior = [sighting({ mmsi: 111, lastSog: null, lastNavStatus: null })];
    const out = computeDarkByTheatre(prior, new Set<number>(), THEATRES);
    expect(out.get(THEATRES[0])).toBeNull();
  });

  it("treats SOG exactly at the loiter threshold as a candidate", () => {
    const prior = [sighting({ mmsi: 111, lastSog: 1.0 })];
    const out = computeDarkByTheatre(prior, new Set<number>(), THEATRES);
    expect(out.get(THEATRES[0])).toBe(1);
  });

  it("returns NULL (not 0) for a theatre that had no candidates this run", () => {
    const prior = [sighting({ mmsi: 1, theatre: THEATRES[0], lastNavStatus: AT_ANCHOR })];
    const out = computeDarkByTheatre(prior, new Set<number>(), THEATRES);
    expect(out.get(THEATRES[0])).toBe(1);
    // The second theatre saw no candidates -> not measurable -> NULL.
    expect(out.get(THEATRES[1])).toBeNull();
  });

  it("scopes dark counts to the theatre each candidate was last seen in", () => {
    const prior = [
      sighting({ mmsi: 1, theatre: THEATRES[0], lastNavStatus: AT_ANCHOR }), // dark
      sighting({ mmsi: 2, theatre: THEATRES[1], lastNavStatus: MOORED }), // still visible
    ];
    const out = computeDarkByTheatre(prior, new Set([2]), THEATRES);
    expect(out.get(THEATRES[0])).toBe(1);
    expect(out.get(THEATRES[1])).toBe(0);
  });

  it("defaults to the real board theatres when none are supplied", () => {
    const out = computeDarkByTheatre([], new Set<number>());
    // Every real theatre with no candidates is NULL (not measurable).
    expect(out.size).toBeGreaterThan(0);
    for (const v of out.values()) expect(v).toBeNull();
  });
});
