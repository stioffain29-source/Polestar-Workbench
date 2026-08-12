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
