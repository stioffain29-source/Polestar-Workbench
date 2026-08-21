/**
 * Fuel Watch draft/preview/PDF parity — the ONE shared resolver.
 *
 * resolveFuelEffectiveSections is the single authority for the final rendered
 * narrative text (analyst edit -> AI -> canonical deterministic). ReportPreview,
 * exportTopicReportPdf and the ReportEditor prefill all call it with the same
 * inputs, so these tests pin:
 *   1. precedence per tier (row field > AI > canonical),
 *   2. blank = auto (empty/whitespace row fields fall through),
 *   3. the deterministic tier is EXACTLY the canonical sections payload
 *      (no second generator, no legacy proseDraft fallback),
 *   4. reads (marketRead/operationalRead/regionalHighlights) honour pickRead,
 *   5. the prose-tolerant gate validates the FINAL effective text, so a
 *      contradictory analyst/AI claim blocks while ordinary prose passes.
 */
import { buildFuelWatchReportData } from "../fuelWatchReport";
import {
  resolveFuelEffectiveSections,
  validateFuelReportConsistency,
  assertFuelReportConsistent,
  alignFuelProseToMarketFacts,
} from "../fuelReportConsistency";
import type { TopicFastFactsIncident } from "../topicFastFacts";

const ISSUE = "2026-08-05";

let nextId = 1;
function inc(over: Partial<TopicFastFactsIncident> = {}): TopicFastFactsIncident {
  return {
    id: nextId++,
    topic: "fuel",
    title: "Fuel supply disruption after depot attack",
    summary: "Diesel supply halted after an attack on a fuel depot.",
    location: null,
    country: "Pakistan",
    severity: "moderate",
    occurredAt: "2026-08-03T10:00:00Z",
    ...over,
  } as TopicFastFactsIncident;
}

function buildData(incidents: TopicFastFactsIncident[] = [inc(), inc(), inc()]) {
  return buildFuelWatchReportData(
    { issueDate: ISSUE, hardNumbers: { prices: [] } },
    incidents,
  );
}

const PROSE_KEYS = [
  "executiveSummary",
  "situation",
  "whatHappened",
  "whatMatters",
  "polestarView",
] as const;

describe("resolveFuelEffectiveSections precedence", () => {
  const fuelData = buildData();

  it("deterministic tier is EXACTLY the canonical sections (no other generator)", () => {
    const eff = resolveFuelEffectiveSections({ report: {}, aiProse: null, fuelData });
    const canon = fuelData.narrativeData.canonicalSections;
    for (const k of PROSE_KEYS) expect(eff[k]).toBe(canon[k]);
    expect(eff.marketRead).toBe(canon.marketRead);
    expect(eff.operationalRead).toBe(canon.operationalRead);
    expect(eff.regionalHighlights).toBe(canon.regionalHighlights);
  });

  it("AI tier beats canonical for the five prose sections", () => {
    const eff = resolveFuelEffectiveSections({
      report: {},
      aiProse: {
        executiveSummary: "AI exec.",
        situation: "AI situation.",
        whatHappened: "AI what happened.",
        whatMatters: "AI what matters.",
        polestarView: "AI polestar.",
      },
      fuelData,
    });
    expect(eff.executiveSummary).toBe("AI exec.");
    expect(eff.situation).toBe("AI situation.");
    expect(eff.whatHappened).toBe("AI what happened.");
    expect(eff.whatMatters).toBe("AI what matters.");
    expect(eff.polestarView).toBe("AI polestar.");
  });

  it("analyst row field beats AI; blank/whitespace row falls through (blank = auto)", () => {
    const eff = resolveFuelEffectiveSections({
      report: { executiveSummary: "Analyst exec.", situation: "   " },
      aiProse: { executiveSummary: "AI exec.", situation: "AI situation." },
      fuelData,
    });
    expect(eff.executiveSummary).toBe("Analyst exec.");
    expect(eff.situation).toBe("AI situation.");
  });

  it("reads: analyst override wins, blank falls back to canonical auto text", () => {
    const eff = resolveFuelEffectiveSections({
      report: { fuelMarketRead: "Analyst market read.", fuelOperationalRead: "" },
      aiProse: null,
      fuelData,
    });
    expect(eff.marketRead).toBe("Analyst market read.");
    expect(eff.operationalRead).toBe(
      fuelData.narrativeData.canonicalSections.operationalRead,
    );
  });

  it("three call sites resolve identically for identical inputs (draft==preview==PDF)", () => {
    const args = {
      report: { whatMatters: "Analyst what matters." },
      aiProse: { executiveSummary: "AI exec." },
      fuelData,
    };
    expect(resolveFuelEffectiveSections(args)).toEqual(
      resolveFuelEffectiveSections({ ...args }),
    );
  });
});

describe("consistency gate over the FINAL effective text", () => {
  const fuelData = buildData();

  it("builder honours caller-resolved implications/watchNext (analyst/AI) instead of discarding them", () => {
    const edited = buildFuelWatchReportData(
      {
        issueDate: ISSUE,
        hardNumbers: { prices: [] },
        implications: "Analyst implication: reroute Karachi fuel convoys.",
        watchNext: "Analyst watch: Jet A-1 price notification in Dhaka.",
      },
      [inc(), inc(), inc()],
    );
    expect(edited.narrativeData.implications).toBe(
      "Analyst implication: reroute Karachi fuel convoys.",
    );
    expect(edited.narrativeData.watchNext).toBe(
      "Analyst watch: Jet A-1 price notification in Dhaka.",
    );
    // Blank input = canonical auto text (blank=auto rule).
    expect(fuelData.narrativeData.implications).toBe(
      fuelData.narrativeData.canonicalSections.implications,
    );
    expect(fuelData.narrativeData.watchNext).toBe(
      fuelData.narrativeData.canonicalSections.watchNext,
    );
  });

  it("builder exposes reportFacts for the effective-text gate", () => {
    expect(fuelData.reportFacts.incidentCount).toBeGreaterThan(0);
  });

  it("reportFacts severity/pressure are reconciled to canonicalFacts (gate never contradicts canonical prose)", () => {
    expect(fuelData.reportFacts.overallSeverity).toBe(
      fuelData.canonicalFacts.overallSeverity.toLowerCase(),
    );
    const canonPrimary = fuelData.canonicalFacts.primaryPressurePoint;
    if (canonPrimary.kind === "distributed") {
      expect(fuelData.reportFacts.pressure.distributed).toBe(true);
    } else {
      expect(fuelData.reportFacts.pressure.primary?.country.toLowerCase()).toBe(
        canonPrimary.label.toLowerCase(),
      );
    }
  });

  it("capped market-commentary severity cannot false-block canonical auto text", () => {
    // A high-severity record whose text reads as market commentary is capped
    // by buildFuelReportFacts but NOT by the canonical builder; the canonical
    // prose asserts the uncapped overall severity. The reconciled reportFacts
    // must let that canonical text pass the tolerant gate.
    const data = buildData([
      inc({
        severity: "high",
        title: "Fuel price surge as Brent rallies on market outlook",
        summary: "Analysts see fuel prices climbing on the crude market rally forecast.",
      }),
      inc(),
      inc(),
    ]);
    const eff = resolveFuelEffectiveSections({ report: {}, aiProse: null, fuelData: data });
    expect(validateFuelReportConsistency(data.reportFacts, eff)).toEqual([]);
    expect(() => assertFuelReportConsistent(data.reportFacts, eff)).not.toThrow();
  });

  it("canonical (auto) effective text passes the tolerant gate", () => {
    const eff = resolveFuelEffectiveSections({ report: {}, aiProse: null, fuelData });
    expect(() => assertFuelReportConsistent(fuelData.reportFacts, eff)).not.toThrow();
  });

  it("ordinary analyst prose without contradictory claims passes", () => {
    const eff = resolveFuelEffectiveSections({
      report: {
        executiveSummary:
          "Fuel pressure remained concentrated this week, with depot attacks disrupting supply.",
      },
      aiProse: null,
      fuelData,
    });
    expect(validateFuelReportConsistency(fuelData.reportFacts, eff)).toEqual([]);
  });

  it("a contradictory count claim in the WINNING tier blocks (no silent fallback)", () => {
    const eff = resolveFuelEffectiveSections({
      report: {
        executiveSummary:
          "Fuel Watch records 999 qualifying incidents this week across the region.",
      },
      aiProse: null,
      fuelData,
    });
    const issues = validateFuelReportConsistency(fuelData.reportFacts, eff);
    expect(issues.some((i) => i.code === "COUNT_TRACEABLE")).toBe(true);
    expect(() => assertFuelReportConsistent(fuelData.reportFacts, eff)).toThrow();
  });

  it("a contradictory claim in a LOSING tier does not block (only rendered text is gated)", () => {
    const eff = resolveFuelEffectiveSections({
      report: { executiveSummary: "Analyst exec with no numeric claims." },
      aiProse: { executiveSummary: "Fuel Watch records 999 qualifying incidents." },
      fuelData,
    });
    expect(eff.executiveSummary).toBe("Analyst exec with no numeric claims.");
    expect(validateFuelReportConsistency(fuelData.reportFacts, eff)).toEqual([]);
  });
});

const JET_EASING_HEADLINE =
  "The same window also carried repeated reporting on a stand-off over airline pricing as jet fuel costs eased, while Pakistan saw diesel price rises.";

function risingJetData() {
  return buildFuelWatchReportData(
    {
      issueDate: ISSUE,
      hardNumbers: {
        prices: [
          { label: "Brent crude", value: 80, unit: "USD/bbl", change: "+1.2%", asOf: ISSUE },
          { label: "WTI crude", value: 76, unit: "USD/bbl", change: "+0.9%", asOf: ISSUE },
          { label: "Jet fuel", value: 2.2, unit: "USD/gal", change: "+10.0%", asOf: ISSUE },
        ],
        jetFuelTrajectory: {
          benchmark: "US Gulf Coast kerosene-type",
          unit: "USD/gal",
          points: [
            { date: "2026-07-01", value: 2.0 },
            { date: "2026-08-01", value: 2.2 },
          ],
        },
      },
    },
    [inc(), inc(), inc()],
  );
}

describe("AI jet-direction headlines are aligned to the calculated series", () => {
  it("rewrites 'jet fuel costs eased' when the jet series is rising", () => {
    const data = risingJetData();
    const jet = data.reportFacts.market.indicators.find((m) => m.key === "jet");
    expect(jet?.direction).toBe("rising");
    expect(
      validateFuelReportConsistency(data.reportFacts, { whatHappened: JET_EASING_HEADLINE }).some(
        (i) => i.code === "MARKET_DIRECTION",
      ),
    ).toBe(true);

    const aligned = alignFuelProseToMarketFacts(JET_EASING_HEADLINE, data.reportFacts);
    expect(aligned).toMatch(/jet fuel costs climbed/i);
    expect(aligned).not.toMatch(/\beased\b/i);
    expect(
      validateFuelReportConsistency(data.reportFacts, { whatHappened: aligned }).filter(
        (i) => i.code === "MARKET_DIRECTION",
      ),
    ).toHaveLength(0);
  });

  it("aligns AI whatHappened (and the editor prefill copy of it) so the gate stays green", () => {
    const data = risingJetData();
    const fromAi = resolveFuelEffectiveSections({
      report: {},
      aiProse: { whatHappened: JET_EASING_HEADLINE },
      fuelData: data,
    });
    expect(fromAi.whatHappened).toMatch(/jet fuel costs climbed/i);
    expect(validateFuelReportConsistency(data.reportFacts, fromAi).filter((i) => i.code === "MARKET_DIRECTION")).toHaveLength(0);

    // Fuel Watch prefill copies the AI text into the editor box; that must
    // still be treated as AI, not as a genuine analyst override.
    const fromPrefill = resolveFuelEffectiveSections({
      report: { whatHappened: JET_EASING_HEADLINE },
      aiProse: { whatHappened: JET_EASING_HEADLINE },
      fuelData: data,
    });
    expect(fromPrefill.whatHappened).toBe(fromAi.whatHappened);
    expect(
      validateFuelReportConsistency(data.reportFacts, fromPrefill).filter(
        (i) => i.code === "MARKET_DIRECTION",
      ),
    ).toHaveLength(0);
  });

  it("a genuine analyst override that contradicts jet direction still fail-closes", () => {
    const data = risingJetData();
    const eff = resolveFuelEffectiveSections({
      report: { whatHappened: JET_EASING_HEADLINE },
      aiProse: { whatHappened: "Airline pricing talks continued without a market-direction claim." },
      fuelData: data,
    });
    expect(eff.whatHappened).toBe(JET_EASING_HEADLINE);
    expect(
      validateFuelReportConsistency(data.reportFacts, eff).some((i) => i.code === "MARKET_DIRECTION"),
    ).toBe(true);
  });
});
