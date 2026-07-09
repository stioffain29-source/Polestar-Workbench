import { buildFuelGulfChokepointWatch } from "@/lib/fuelNarratives";
import type { TopicFastFactsIncident } from "@/lib/topicFastFacts";

// The Fuel Watch "Gulf and Hormuz Chokepoint Watch" section is auto-derived
// from live fuel incidents whose TITLE names a Gulf/Hormuz chokepoint. These
// tests lock the two no-fabrication gates that keep the deterministic prose
// honest on sparse or out-of-sequence future windows:
//   1. The "dominant / marked concentration" opener may fire ONLY when
//      coverage is broad (several distinct deduped events across several days);
//      a stray headline or two gets a neutral opener instead.
//   2. "The strait subsequently reopened" may fire ONLY when a reopen-vocabulary
//      record actually post-dates the peak anchor — never when the only reopen
//      headlines predate the peak.

const PERIOD_END = "2026-07-08"; // 60-day lookback → window opens ~9 May 2026

function mk(
  id: number,
  title: string,
  occurredAt: string,
  severity: string,
): TopicFastFactsIncident {
  return {
    id,
    topic: "fuel",
    title,
    severity,
    occurredAt: `${occurredAt}T12:00:00+00:00`,
    sourceUrl: `https://example.test/${id}`,
  };
}

describe("buildFuelGulfChokepointWatch — no-fabrication gates", () => {
  it("returns null when no title names a Gulf/Hormuz chokepoint", () => {
    const incidents = [
      mk(1, "Pump prices rise across Jakarta amid subsidy debate", "2026-06-10", "low"),
      mk(2, "Diesel shortage eases as supply arrivals resume", "2026-06-12", "low"),
    ];
    expect(
      buildFuelGulfChokepointWatch({ periodEnd: PERIOD_END, incidents }),
    ).toBeNull();
  });

  it("uses the neutral opener on sparse coverage (few events / few days)", () => {
    const incidents = [
      mk(1, "Tanker attacked near Strait of Hormuz", "2026-06-10", "moderate"),
      mk(2, "Persian Gulf oil terminal disrupted by drone", "2026-06-12", "moderate"),
    ];
    const built = buildFuelGulfChokepointWatch({ periodEnd: PERIOD_END, incidents });
    expect(built).not.toBeNull();
    expect(built!.read).toMatch(/featured in the period's fuel-route reporting/i);
    expect(built!.read).not.toMatch(/dominant fuel-route risk/i);
    expect(built!.read).not.toMatch(/marked concentration/i);
  });

  it("uses the dominant opener when coverage is broad", () => {
    const incidents = [
      mk(1, "Strait of Hormuz closure halts tanker traffic", "2026-06-02", "high"),
      mk(2, "Persian Gulf refinery struck in drone attack", "2026-06-05", "high"),
      mk(3, "Bab el-Mandeb shipping disrupted amid Red Sea tensions", "2026-06-08", "moderate"),
      mk(4, "Arabian Gulf crude flows cut by Hormuz crisis", "2026-06-11", "moderate"),
    ];
    const built = buildFuelGulfChokepointWatch({ periodEnd: PERIOD_END, incidents });
    expect(built).not.toBeNull();
    expect(built!.read).toMatch(/dominant fuel-route risk/i);
    expect(built!.read).toMatch(/marked concentration/i);
  });

  it("omits the reopening clause when reopen headlines predate the peak anchor", () => {
    const incidents = [
      mk(1, "Persian Gulf refinery struck in missile attack", "2026-06-15", "high"),
      mk(2, "Tankers reopen transit through Strait of Hormuz", "2026-05-20", "moderate"),
    ];
    const built = buildFuelGulfChokepointWatch({ periodEnd: PERIOD_END, incidents });
    expect(built).not.toBeNull();
    expect(built!.read).not.toMatch(/subsequently reopened/i);
  });

  it("asserts the reopening clause only when a reopen record post-dates the peak", () => {
    const incidents = [
      mk(1, "Persian Gulf refinery struck in missile attack", "2026-06-01", "high"),
      mk(2, "Tankers resume passage through Strait of Hormuz", "2026-06-20", "moderate"),
    ];
    const built = buildFuelGulfChokepointWatch({ periodEnd: PERIOD_END, incidents });
    expect(built).not.toBeNull();
    expect(built!.read).toMatch(/subsequently reopened/i);
  });
});
