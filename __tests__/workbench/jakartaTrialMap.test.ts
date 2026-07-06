import {
  JAKARTA_TRIAL_CORRIDORS,
  JAKARTA_TRIAL_ZONES,
  TRIAL_EXPOSURE_LABEL,
  buildJakartaTrialModel,
} from "../../artifacts/workbench/src/lib/jakartaTrialMap";
import type { CountryFastFactsIncident } from "../../artifacts/workbench/src/lib/countryFastFacts";

// Pins the TRIAL Jakarta operational-exposure map model (Task #290) — SEPARATE
// from the live Jakarta city report. Proves: the seven zones render in the fixed
// task order (1–7), ratings derive from the shared honest exposure model (a
// quiet zone never alarms above "Monitored"), live reporting elevates the right
// zone with live-derived reason/action, and the four route corridors are the
// required set.

function inc(p: Partial<CountryFastFactsIncident>): CountryFastFactsIncident {
  return {
    topic: "flashpoint",
    title: "",
    severity: "moderate",
    occurredAt: "2026-06-28T03:00:00Z",
    country: "Indonesia",
    ...p,
  };
}

describe("Jakarta trial exposure map model", () => {
  it("emits the seven zones in the fixed task order 1–7", () => {
    expect(JAKARTA_TRIAL_ZONES.map((z) => z.number)).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);
    expect(JAKARTA_TRIAL_ZONES.map((z) => z.id)).toEqual([
      "govt",
      "priok",
      "north-access",
      "sudirman-thamrin",
      "scbd-senayan",
      "kuningan",
      "airport",
    ]);
  });

  it("offers the four required route corridors", () => {
    expect(JAKARTA_TRIAL_CORRIDORS.map((c) => c.label)).toEqual([
      "Airport corridor",
      "Port corridor",
      "CBD business corridor",
      "North Jakarta access",
    ]);
  });

  it("uses the exact five rating labels", () => {
    expect(Object.values(TRIAL_EXPOSURE_LABEL).sort()).toEqual(
      ["Elevated", "High", "Low", "Monitored", "Not assessed"].sort(),
    );
  });

  it("keeps a quiet map capped at Monitored (no fabricated alarm)", () => {
    const model = buildJakartaTrialModel([]);
    expect(model.zones).toHaveLength(7);
    for (const z of model.zones) {
      expect(["monitored", "low", "not-assessed"]).toContain(z.rating);
      expect(z.elevated).toBe(false);
      // Falls back to the standing profile text when no live reporting.
      expect(z.reason).toBe(z.standingReason);
      expect(z.action).toBe(z.standingAction);
    }
  });

  it("elevates the government district on a live high-severity protest", () => {
    const model = buildJakartaTrialModel([
      inc({
        title:
          "Protesters rally near Monas in Central Jakarta government district",
        location: "Central Jakarta",
        severity: "high",
      }),
    ]);
    const govt = model.zones.find((z) => z.id === "govt")!;
    expect(govt.number).toBe(1);
    expect(govt.elevated).toBe(true);
    expect(["high", "elevated"]).toContain(govt.rating);
    // Live-derived reason/action replace the standing text when elevated.
    expect(govt.reason).not.toBe(govt.standingReason);
  });

  it("gives every zone distinct standing wording (no generic repetition)", () => {
    const reasons = JAKARTA_TRIAL_ZONES.map((z) => z.standingReason);
    const actions = JAKARTA_TRIAL_ZONES.map((z) => z.standingAction);
    expect(new Set(reasons).size).toBe(reasons.length);
    expect(new Set(actions).size).toBe(actions.length);
  });

  it("keeps wording zone-specific even when zones share a corridor tie", () => {
    // Zones 4/5/6 all tie to the commercial-hotels corridor; a live commercial
    // incident must NOT collapse them to identical panel text.
    const model = buildJakartaTrialModel([
      inc({
        title: "Robbery reported near offices in SCBD business district",
        location: "SCBD",
      }),
    ]);
    const shared = model.zones.filter(
      (z) => z.corridorAreaId === "commercial-hotels",
    );
    expect(shared.length).toBeGreaterThanOrEqual(3);
    const reasons = shared.map((z) => z.reason);
    const actions = shared.map((z) => z.action);
    expect(new Set(reasons).size).toBe(reasons.length);
    expect(new Set(actions).size).toBe(actions.length);
  });

  it("plots a marker only for a resolvable-location record", () => {
    const withLoc = buildJakartaTrialModel([
      inc({ title: "Robbery near Sudirman offices", location: "Sudirman" }),
    ]);
    expect(withLoc.map.points.length).toBeGreaterThanOrEqual(1);

    const noLoc = buildJakartaTrialModel([
      inc({ title: "Nationwide policy update reported across Jakarta" }),
    ]);
    expect(noLoc.map.points).toHaveLength(0);
    expect(noLoc.map.notMapped.total).toBeGreaterThanOrEqual(1);
  });
});
