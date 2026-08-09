/**
 * Parameterised/property tests for the Fuel Watch canonical facts builder and
 * the consistency gate. Synthetic datasets only — no assertions tied to
 * today's live figures (spec: tests must not hard-code current values).
 */
import {
  buildFuelReportFacts,
  directionForPct,
  serialiseFuelFactsForPrompt,
  MARKET_DIRECTION_NEUTRAL_PCT,
  PRESSURE_LEADER_MARGIN,
} from "../fuelReportFacts";
import type { FuelReportFacts } from "../fuelReportFacts";
import {
  validateFuelReportConsistency,
  assertFuelReportConsistent,
  FuelReportConsistencyError,
} from "../fuelReportConsistency";
import type { TopicFastFactsIncident } from "../topicFastFacts";

const ISSUE = "2026-08-05";

let nextId = 1;
function inc(over: Partial<TopicFastFactsIncident> = {}): TopicFastFactsIncident {
  return {
    id: nextId++,
    topic: "fuel",
    // Must pass the fuel topic-relevance gate (filterTopicReportIncidents
    // applies it): "fuel supply" is an admitted operational phrase.
    title: "Fuel supply disruption after depot attack",
    summary: "Diesel supply halted after an attack on a fuel depot.",
    location: null,
    country: "Pakistan",
    severity: "moderate",
    occurredAt: "2026-08-03T10:00:00Z",
    ...over,
  } as TopicFastFactsIncident;
}

function hardNumbers(opts: {
  brent?: { value: number; change: string };
  wti?: { value: number; change: string };
  jetTrajectory?: { date: string; value: number }[];
}) {
  const prices: unknown[] = [];
  if (opts.brent)
    prices.push({
      label: "Brent crude",
      value: opts.brent.value,
      unit: "USD/bbl",
      change: opts.brent.change,
      asOf: ISSUE,
    });
  if (opts.wti)
    prices.push({
      label: "WTI crude",
      value: opts.wti.value,
      unit: "USD/bbl",
      change: opts.wti.change,
      asOf: ISSUE,
    });
  // parseFuelHardNumbers takes the jsonb OBJECT (not a serialised string).
  return {
    prices,
    ...(opts.jetTrajectory
      ? {
          jetFuelTrajectory: {
            benchmark: "US Gulf Coast kerosene-type",
            unit: "USD/gal",
            points: opts.jetTrajectory,
          },
        }
      : {}),
  };
}

function facts(
  incidents: TopicFastFactsIncident[],
  hn: unknown = hardNumbers({}),
): FuelReportFacts {
  return buildFuelReportFacts({ issueDate: ISSUE, hardNumbers: hn, incidents });
}

describe("directionForPct — the single direction authority", () => {
  const cases: [number, string][] = [
    [5, "rising"],
    [MARKET_DIRECTION_NEUTRAL_PCT, "rising"],
    [-5, "falling"],
    [-MARKET_DIRECTION_NEUTRAL_PCT, "falling"],
    [0.2, "broadly stable"],
    [-0.2, "broadly stable"],
    [0, "unchanged"],
  ];
  it.each(cases)("pct %p → %s", (pct, dir) => {
    expect(directionForPct(pct)).toBe(dir);
  });
  it("null/NaN → null", () => {
    expect(directionForPct(null)).toBeNull();
    expect(directionForPct(Number.NaN)).toBeNull();
  });
  it("property: sign(pct) never contradicts direction", () => {
    for (let pct = -10; pct <= 10; pct += 0.13) {
      const d = directionForPct(pct);
      if (d === "rising") expect(pct).toBeGreaterThan(0);
      if (d === "falling") expect(pct).toBeLessThan(0);
    }
  });
});

describe("buildFuelReportFacts", () => {
  it("counts, distinct dates and countries come from the windowed set", () => {
    const f = facts([
      inc({ occurredAt: "2026-08-03T10:00:00Z", country: "Pakistan" }),
      inc({ occurredAt: "2026-08-03T15:00:00Z", country: "Pakistan" }),
      inc({ occurredAt: "2026-08-01T08:00:00Z", country: "India" }),
      // Out of window — must be excluded from every fact.
      inc({ occurredAt: "2025-01-01T08:00:00Z", country: "France" }),
    ]);
    expect(f.incidentCount).toBe(3);
    expect(f.distinctDates).toEqual(["2026-08-01", "2026-08-03"]);
    expect(f.countries.map((c) => c.name)).not.toContain("France");
  });

  it("entity fields are carried verbatim, never inferred from one another", () => {
    const f = facts([
      inc({
        title: "Fuel supply disruption after Karachi depot fire",
        country: "Pakistan",
        location: null,
        severity: "high",
      }),
    ]);
    const r = f.incidents[0];
    expect(r.location).toBeNull(); // never back-filled from country
    expect(r.severity).toBe("high");
  });

  it("overall severity uses the capped tier, five tiers only", () => {
    // Speculative market commentary rated high must be capped for the
    // OVERALL call (capFuelMarketSeverity demote-only semantics). The title
    // still passes the fuel relevance gate via "fuel prices".
    const f = facts([
      inc({
        title: "Fuel prices expected to climb, analysts say",
        summary: "Analysts expect fuel prices could rise further.",
        severity: "high",
      }),
    ]);
    expect(f.incidentCount).toBe(1);
    expect(f.highestSeverity).toBe("high"); // raw distribution keeps stored tier
    expect(f.overallSeverity).not.toBe("high"); // capped for the overall call
    expect(["insignificant", "low", "moderate"]).toContain(f.overallSeverity);
  });

  it("overall severity is hedged one tier down on low confidence + falling crude + no live shortage/unrest", () => {
    // A single contained high-severity event, thin reporting (<3 records →
    // low confidence), crude falling, no shortage/unrest condition observed:
    // the OVERALL call must not headline High.
    const hedged = facts(
      [
        inc({
          title: "Refinery fire halts fuel supply at Baiji plant",
          summary: "Fire at the refinery disrupted fuel supply; contained.",
          severity: "high",
          country: "Iraq",
        }),
      ],
      hardNumbers({
        brent: { value: 66, change: "-7.0%" },
        wti: { value: 63, change: "-6.5%" },
      }),
    );
    expect(hedged.evidenceConfidence).toBe("low");
    expect(hedged.market.crudeDirection).toBe("falling");
    expect(hedged.overallSeverity).toBe("moderate");

    // Same event with a live shortage condition keeps the High call.
    const kept = facts(
      [
        inc({
          title: "Refinery fire halts fuel supply at Baiji plant",
          summary: "Fuel shortage reported as the refinery outage bites.",
          severity: "high",
          country: "Iraq",
        }),
      ],
      hardNumbers({
        brent: { value: 66, change: "-7.0%" },
        wti: { value: 63, change: "-6.5%" },
      }),
    );
    expect(kept.currentConditionSignals).toContain("shortage");
    expect(kept.overallSeverity).toBe("high");
  });

  it("pressure is distributed when no country clears the leader margin", () => {
    const f = facts([
      inc({ country: "Pakistan", severity: "moderate" }),
      inc({ country: "India", severity: "moderate" }),
    ]);
    expect(f.pressure.distributed).toBe(true);
    expect(f.pressure.primary).toBeNull();
  });

  it("a clear leader is named primary; margin rule honoured", () => {
    const f = facts([
      inc({ country: "Pakistan", severity: "extreme" }),
      inc({ country: "Pakistan", severity: "high" }),
      inc({ country: "Pakistan", severity: "high" }),
      inc({ country: "India", severity: "low" }),
    ]);
    expect(f.pressure.distributed).toBe(false);
    expect(f.pressure.primary?.country).toBe("Pakistan");
    // Documented invariant: primary score beats runner-up by the margin.
    const runner = f.pressure.secondary[0];
    if (runner) {
      expect(f.pressure.primary!.score).toBeGreaterThanOrEqual(
        runner.score * PRESSURE_LEADER_MARGIN - 1e-9,
      );
    }
  });

  it("market indicators derive previous from the change string and direction from the shared rule", () => {
    const f = facts([], hardNumbers({ brent: { value: 80, change: "-4.0%" }, wti: { value: 76, change: "+2.0%" } }));
    const brent = f.market.indicators.find((m) => m.key === "brent")!;
    expect(brent.pctChange).toBeCloseTo(-4, 5);
    expect(brent.previous).toBeCloseTo(80 / 0.96, 3);
    expect(brent.direction).toBe("falling");
    const wti = f.market.indicators.find((m) => m.key === "wti")!;
    expect(wti.direction).toBe("rising");
    expect(f.market.avgCrudePctChange).toBeCloseTo(-1, 5);
    expect(f.market.crudeDirection).toBe("falling");
  });

  it("jet direction comes from the trajectory first-vs-last", () => {
    const f = facts(
      [],
      hardNumbers({
        jetTrajectory: [
          { date: "2026-07-01", value: 2.0 },
          { date: "2026-08-01", value: 2.2 },
        ],
      }),
    );
    const jet = f.market.indicators.find((m) => m.key === "jet")!;
    expect(jet.basis).toBe("trajectory");
    expect(jet.direction).toBe("rising");
    expect(jet.previous).toBe(2.0);
  });

  it("current-condition signals only include classes observed in the window", () => {
    const f = facts([
      inc({ title: "Fuel shortage hits Lahore as depots run dry" }),
    ]);
    expect(f.currentConditionSignals).toContain("shortage");
    const g = facts([
      inc({
        title: "Diesel supply review announced by regulator",
        summary: "Regulator opens a diesel supply review.",
      }),
    ]);
    expect(g.currentConditionSignals).not.toContain("shortage");
  });

  it("prompt serialisation is deterministic for identical data", () => {
    const rows = [inc({ id: 1 }), inc({ id: 2, country: "India" })];
    const a = serialiseFuelFactsForPrompt(facts(rows));
    const b = serialiseFuelFactsForPrompt(facts(rows.map((r) => ({ ...r }))));
    expect(a).toBe(b);
  });
});

describe("validateFuelReportConsistency — the gate catches seeded contradictions", () => {
  const risingCrude = hardNumbers({
    brent: { value: 84, change: "+5.0%" },
    wti: { value: 80, change: "+4.0%" },
  });

  it("flags direction wording that opposes the calculated direction", () => {
    const f = facts([inc()], risingCrude);
    const issues = validateFuelReportConsistency(f, {
      marketRead: "Brent declined over the week as demand softened.",
    });
    expect(issues.some((i) => i.code === "MARKET_DIRECTION")).toBe(true);
  });

  it("passes wording that agrees with the calculated direction", () => {
    const f = facts([inc()], risingCrude);
    const issues = validateFuelReportConsistency(f, {
      marketRead: "Brent climbed on the week, sustaining cost pressure.",
    });
    expect(issues.filter((i) => i.code === "MARKET_DIRECTION")).toHaveLength(0);
  });

  it("flags a stability claim when the calculated move is material — and vice versa", () => {
    const stable = facts([inc()], hardNumbers({ brent: { value: 80, change: "+0.2%" }, wti: { value: 76, change: "-0.1%" } }));
    const issues = validateFuelReportConsistency(stable, {
      marketRead: "Brent surged this week.",
    });
    expect(issues.some((i) => i.code === "MARKET_DIRECTION")).toBe(true);
  });

  it("bans leader phrasing when pressure is distributed", () => {
    const f = facts([
      inc({ country: "Pakistan" }),
      inc({ country: "India" }),
    ]);
    expect(f.pressure.distributed).toBe(true);
    const issues = validateFuelReportConsistency(f, {
      regionalHighlights: "Pakistan is the clearest pressure point right now.",
    });
    expect(issues.some((i) => i.code === "PRIMARY_PRESSURE")).toBe(true);
  });

  it("flags a leader claim naming the wrong country", () => {
    const f = facts([
      inc({ country: "Pakistan", severity: "extreme" }),
      inc({ country: "Pakistan", severity: "high" }),
      inc({ country: "India", severity: "low" }),
    ]);
    expect(f.pressure.primary?.country).toBe("Pakistan");
    const issues = validateFuelReportConsistency(f, {
      regionalHighlights: "India is the clearest pressure point right now.",
    });
    expect(issues.some((i) => i.code === "PRIMARY_PRESSURE")).toBe(true);
    // …and the canonical leader passes.
    const ok = validateFuelReportConsistency(f, {
      regionalHighlights: "Pakistan is the clearest pressure point right now.",
    });
    expect(ok.filter((i) => i.code === "PRIMARY_PRESSURE")).toHaveLength(0);
  });

  it("flags an untraceable count claim and passes a traceable one", () => {
    const f = facts([inc(), inc(), inc()]);
    const bad = validateFuelReportConsistency(f, {
      situation: "We logged 9 incidents this week.",
    });
    expect(bad.some((i) => i.code === "COUNT_TRACEABLE")).toBe(true);
    const good = validateFuelReportConsistency(f, {
      situation: `We logged ${f.incidentCount} incidents this week.`,
    });
    expect(good.filter((i) => i.code === "COUNT_TRACEABLE")).toHaveLength(0);
  });

  it("flags an overall severity assertion that disagrees with the computed tier", () => {
    const f = facts([inc({ severity: "moderate" })]);
    expect(f.overallSeverity).toBe("moderate");
    const issues = validateFuelReportConsistency(f, {
      whatMatters: "We rate this period extreme overall severity for operators.",
    });
    expect(issues.some((i) => i.code === "SEVERITY_TERMS")).toBe(true);
  });

  it("flags an unsupported live-shortage claim; allows it in Watch Next / when supported", () => {
    const noShortage = facts([
      inc({
        title: "Diesel supply review announced by regulator",
        summary: "Regulator opens a diesel supply review.",
      }),
    ]);
    const bad = validateFuelReportConsistency(noShortage, {
      situation: "Fuel shortages are widespread across the north.",
    });
    expect(bad.some((i) => i.code === "CURRENT_CONDITION")).toBe(true);
    // Watch Next is exempt (forward-looking by design).
    const watch = validateFuelReportConsistency(noShortage, {
      watchNext: "Shortages are possible if the strike spreads.",
    });
    expect(watch.filter((i) => i.code === "CURRENT_CONDITION")).toHaveLength(0);
    // Supported claim passes.
    const withShortage = facts([inc({ title: "Fuel shortage hits Lahore as depots run dry" })]);
    const ok = validateFuelReportConsistency(withShortage, {
      situation: "Fuel shortages are hitting Lahore.",
    });
    expect(ok.filter((i) => i.code === "CURRENT_CONDITION")).toHaveLength(0);
  });

  it("flags market percentages that match no calculated change", () => {
    const f = facts([], risingCrude);
    const issues = validateFuelReportConsistency(f, {
      marketRead: "Brent climbed 12.5% this week.",
    });
    expect(issues.some((i) => i.code === "COUNT_TRACEABLE")).toBe(true);
  });

  it("assertFuelReportConsistent throws a typed error listing every issue", () => {
    const f = facts([inc({ country: "Pakistan" }), inc({ country: "India" })]);
    expect(() =>
      assertFuelReportConsistent(f, {
        regionalHighlights: "India is the clearest pressure point right now.",
      }),
    ).toThrow(FuelReportConsistencyError);
  });

  it("property: deterministic Market Read wording built from the facts always passes the gate", () => {
    // Sweep crude change across the range; the wording chosen from the
    // calculated direction must never trip the direction check.
    for (let pct = -8; pct <= 8; pct += 0.5) {
      const f = facts(
        [inc()],
        hardNumbers({
          brent: { value: 80, change: `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%` },
          wti: { value: 76, change: `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%` },
        }),
      );
      const dir = f.market.crudeDirection;
      const sentence =
        dir === "rising"
          ? "Crude climbed over this window."
          : dir === "falling"
            ? "Crude pulled back over this window."
            : "Crude was broadly flat over this window.";
      const issues = validateFuelReportConsistency(f, { marketRead: sentence });
      expect(
        issues.filter((i) => i.code === "MARKET_DIRECTION"),
      ).toHaveLength(0);
    }
  });
});
