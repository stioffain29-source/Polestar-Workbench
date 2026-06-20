import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  computeDarkByTheatre,
  isLoitering,
  isWithinDarkWindow,
  type PriorVesselSighting,
} from "@workspace/ingest";

// Nav-status codes used by the loiter rule (AIS spec): 1 = at anchor, 5 = moored.
const AT_ANCHOR = 1;
const MOORED = 5;
const UNDERWAY = 0;

const THEATRES = ["Strait of Hormuz", "Strait of Malacca"] as const;

// A fixed "now" so window arithmetic is deterministic regardless of wall clock.
const NOW = new Date("2026-06-20T12:00:00.000Z");
const MINUTE = 60_000;
const HOUR = 3_600_000;
// A last-seen time comfortably inside the [min-gap, lookback] band (1h ago).
const IN_WINDOW = new Date(NOW.getTime() - HOUR);

function sighting(
  p: Partial<PriorVesselSighting> & { mmsi: number },
): PriorVesselSighting {
  return {
    theatre: THEATRES[0],
    lastSeenAt: IN_WINDOW,
    lastSog: null,
    lastNavStatus: null,
    ...p,
  };
}

describe("isLoitering (dark-candidate eligibility)", () => {
  it("treats an anchored or moored vessel as loitering regardless of speed", () => {
    expect(isLoitering(null, AT_ANCHOR)).toBe(true);
    expect(isLoitering(15, MOORED)).toBe(true); // explicit status wins over speed
  });

  it("treats a near-stationary vessel (SOG <= threshold) as loitering", () => {
    expect(isLoitering(0.2, UNDERWAY)).toBe(true);
    expect(isLoitering(1.0, null)).toBe(true); // exactly at the loiter threshold
  });

  it("excludes a fast-transiting vessel (SOG above the loiter threshold)", () => {
    expect(isLoitering(1.1, UNDERWAY)).toBe(false);
    expect(isLoitering(12, null)).toBe(false);
  });

  it("excludes a vessel with no movement data (never a fabricated candidate)", () => {
    expect(isLoitering(null, null)).toBe(false);
  });
});

describe("isWithinDarkWindow (lookback / min-gap band)", () => {
  it("includes a sighting older than the min-gap but inside the lookback", () => {
    expect(isWithinDarkWindow(new Date(NOW.getTime() - HOUR), NOW)).toBe(true);
  });

  it("excludes a sighting fresher than the min-gap (may simply not have re-sent)", () => {
    // 29 minutes ago — below the 30-minute min-gap.
    expect(isWithinDarkWindow(new Date(NOW.getTime() - 29 * MINUTE), NOW)).toBe(
      false,
    );
  });

  it("includes a sighting exactly at the min-gap boundary", () => {
    expect(isWithinDarkWindow(new Date(NOW.getTime() - 30 * MINUTE), NOW)).toBe(
      true,
    );
  });

  it("excludes a sighting older than the lookback (legitimately moved on)", () => {
    // 25 hours ago — beyond the 24-hour lookback.
    expect(isWithinDarkWindow(new Date(NOW.getTime() - 25 * HOUR), NOW)).toBe(
      false,
    );
  });

  it("includes a sighting exactly at the lookback boundary", () => {
    expect(isWithinDarkWindow(new Date(NOW.getTime() - 24 * HOUR), NOW)).toBe(
      true,
    );
  });
});

describe("computeDarkByTheatre", () => {
  it("flags a prior loitering vessel that has disappeared from the current sample", () => {
    const prior = [sighting({ mmsi: 111, lastNavStatus: AT_ANCHOR })];
    const out = computeDarkByTheatre(prior, new Set<number>(), THEATRES, NOW);
    expect(out.get(THEATRES[0])).toBe(1);
  });

  it("does NOT flag a loitering vessel still transmitting in the current sample", () => {
    const prior = [sighting({ mmsi: 111, lastNavStatus: MOORED })];
    const out = computeDarkByTheatre(prior, new Set([111]), THEATRES, NOW);
    // Candidate existed but is still visible -> genuine 0, not NULL.
    expect(out.get(THEATRES[0])).toBe(0);
  });

  it("counts every candidate as dark when zero vessels are currently visible", () => {
    const prior = [
      sighting({ mmsi: 1, lastNavStatus: AT_ANCHOR }),
      sighting({ mmsi: 2, lastSog: 0.2 }),
      sighting({ mmsi: 3, lastNavStatus: MOORED }),
    ];
    const out = computeDarkByTheatre(prior, new Set<number>(), THEATRES, NOW);
    expect(out.get(THEATRES[0])).toBe(3);
  });

  it("excludes fast-transiting vessels from candidacy (a normal departure is not dark)", () => {
    const prior = [sighting({ mmsi: 111, lastSog: 12, lastNavStatus: UNDERWAY })];
    const out = computeDarkByTheatre(prior, new Set<number>(), THEATRES, NOW);
    // No loitering candidates at all -> not measurable -> NULL, never a 0.
    expect(out.get(THEATRES[0])).toBeNull();
  });

  it("excludes a vessel with no movement data (no speed, no anchored status)", () => {
    const prior = [sighting({ mmsi: 111, lastSog: null, lastNavStatus: null })];
    const out = computeDarkByTheatre(prior, new Set<number>(), THEATRES, NOW);
    expect(out.get(THEATRES[0])).toBeNull();
  });

  it("treats SOG exactly at the loiter threshold as a candidate", () => {
    const prior = [sighting({ mmsi: 111, lastSog: 1.0 })];
    const out = computeDarkByTheatre(prior, new Set<number>(), THEATRES, NOW);
    expect(out.get(THEATRES[0])).toBe(1);
  });

  it("returns NULL (not 0) for a theatre that had no candidates this run", () => {
    const prior = [
      sighting({ mmsi: 1, theatre: THEATRES[0], lastNavStatus: AT_ANCHOR }),
    ];
    const out = computeDarkByTheatre(prior, new Set<number>(), THEATRES, NOW);
    expect(out.get(THEATRES[0])).toBe(1);
    // The second theatre saw no candidates -> not measurable -> NULL.
    expect(out.get(THEATRES[1])).toBeNull();
  });

  it("scopes dark counts to the theatre each candidate was last seen in", () => {
    const prior = [
      sighting({ mmsi: 1, theatre: THEATRES[0], lastNavStatus: AT_ANCHOR }), // dark
      sighting({ mmsi: 2, theatre: THEATRES[1], lastNavStatus: MOORED }), // still visible
    ];
    const out = computeDarkByTheatre(prior, new Set([2]), THEATRES, NOW);
    expect(out.get(THEATRES[0])).toBe(1);
    expect(out.get(THEATRES[1])).toBe(0);
  });

  it("defaults to the real board theatres when none are supplied", () => {
    const out = computeDarkByTheatre([], new Set<number>());
    // Every real theatre with no candidates is NULL (not measurable).
    expect(out.size).toBeGreaterThan(0);
    for (const v of out.values()) expect(v).toBeNull();
  });

  describe("lookback / min-gap windowing", () => {
    it("ignores a sighting fresher than the min-gap (not yet a dark signal)", () => {
      const prior = [
        sighting({
          mmsi: 111,
          lastNavStatus: AT_ANCHOR,
          lastSeenAt: new Date(NOW.getTime() - 10 * MINUTE),
        }),
      ];
      const out = computeDarkByTheatre(prior, new Set<number>(), THEATRES, NOW);
      // The only candidate is outside the window -> no candidates -> NULL.
      expect(out.get(THEATRES[0])).toBeNull();
    });

    it("ignores a sighting older than the lookback (legitimately moved on)", () => {
      const prior = [
        sighting({
          mmsi: 111,
          lastNavStatus: AT_ANCHOR,
          lastSeenAt: new Date(NOW.getTime() - 25 * HOUR),
        }),
      ];
      const out = computeDarkByTheatre(prior, new Set<number>(), THEATRES, NOW);
      expect(out.get(THEATRES[0])).toBeNull();
    });

    it("counts only the in-window loitering candidate when mixed with out-of-window rows", () => {
      const prior = [
        sighting({ mmsi: 1, lastNavStatus: AT_ANCHOR, lastSeenAt: IN_WINDOW }), // dark
        sighting({
          mmsi: 2,
          lastNavStatus: AT_ANCHOR,
          lastSeenAt: new Date(NOW.getTime() - 5 * MINUTE), // too fresh
        }),
        sighting({
          mmsi: 3,
          lastNavStatus: AT_ANCHOR,
          lastSeenAt: new Date(NOW.getTime() - 48 * HOUR), // too stale
        }),
      ];
      const out = computeDarkByTheatre(prior, new Set<number>(), THEATRES, NOW);
      expect(out.get(THEATRES[0])).toBe(1);
    });
  });
});

// The upsert that preserves last-known movement is pure SQL (an atomic
// onConflictDoUpdate), so it is guarded by a source assertion rather than a
// live-DB round-trip: a future edit that drops the COALESCE would silently
// erase a loitering vessel's last speed/nav-status to NULL (so it stops being a
// dark candidate), and dropping the `excluded.*` assignment for theatre would
// break "move-in-place" (re-flagging a relocated vessel as dark in its old
// theatre). Both are exactly the regressions this task exists to catch.
describe("sighting upsert (move-in-place + COALESCE preservation)", () => {
  const src = readFileSync(
    join(__dirname, "..", "..", "lib", "ingest", "src", "maritimeMovement.ts"),
    "utf8",
  );
  const normalised = src.replace(/\s+/g, " ");

  it("updates theatre and last-seen in place from the new sample", () => {
    expect(normalised).toContain("theatre: sql`excluded.theatre`");
    expect(normalised).toContain("lastSeenAt: sql`excluded.last_seen_at`");
  });

  it("COALESCEs last speed/nav-status so a static-only report cannot erase loiter state", () => {
    expect(normalised).toMatch(
      /lastSog: sql`COALESCE\(excluded\.last_sog,/,
    );
    expect(normalised).toMatch(
      /lastNavStatus: sql`COALESCE\(excluded\.last_nav_status,/,
    );
  });

  it("prunes sightings older than the lookback window to keep the table bounded", () => {
    expect(normalised).toContain(
      "delete(maritimeVesselSightingTable)",
    );
    expect(normalised).toContain("lt(maritimeVesselSightingTable.lastSeenAt, lookbackCutoff)");
  });
});
