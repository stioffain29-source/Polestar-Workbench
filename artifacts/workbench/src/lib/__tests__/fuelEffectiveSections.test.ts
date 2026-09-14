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
import { buildFuelWatchReportData, finalizeFuelPublication } from "../fuelWatchReport";
import {
  resolveFuelEffectiveSections,
  validateFuelReportConsistency,
  validateFuelJudgementConsistency,
  assertFuelReportConsistent,
  validateFuelFinalEvidenceAudit,
} from "../fuelReportConsistency";
import { auditFinalReportEvidence } from "../finalReportEvidenceAudit";
import type { FuelJudgement } from "../fuelCanonicalFacts";
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

function fullGeneratedProse(
  data: ReturnType<typeof buildFuelWatchReportData>,
  over: Partial<NonNullable<Parameters<typeof resolveFuelEffectiveSections>[0]["aiProse"]>> = {},
) {
  return { ...data.narrativeData.canonicalSections, ...over };
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

  it("AI may draft factual chronology but cannot replace canonical analytical sections", () => {
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
    expect(eff.whatMatters).toBe(fuelData.narrativeData.canonicalSections.whatMatters);
    expect(eff.polestarView).toBe(fuelData.narrativeData.canonicalSections.polestarView);
  });

  it("drops stale generated prose while retaining an explicit stale analyst edit", () => {
    const staleGenerated = fullGeneratedProse(fuelData, {
      situation: "Stale generated situation",
      datasetFingerprint: "fuel-basis-old",
      stale: true,
    });
    const generatedResult = resolveFuelEffectiveSections({
      report: {},
      aiProse: staleGenerated,
      fuelData,
    });
    expect(generatedResult.situation).toBe(fuelData.narrativeData.canonicalSections.situation);

    const retainedEdit = resolveFuelEffectiveSections({
      report: {},
      aiProse: {
        ...staleGenerated,
        situation: "Retained analyst reconciliation text",
        isAnalystEdited: true,
      },
      fuelData,
    });
    expect(retainedEdit.situation).toBe("Retained analyst reconciliation text");
  });

  it("does not render a generated Watch Next item with zero current support", () => {
    const staleWatch = resolveFuelEffectiveSections({
      report: {},
      aiProse: {
        watchNext: "Monitor whether a potential shortage may affect bunkering.",
        provenance: {
          watchNext: [{
            supportingIncidentIds: ["potential-only"],
            supportingEvidenceFamilyIds: ["family-potential"],
            supportingClaim: "A potential shortage may affect bunkering.",
          }],
        },
      },
      fuelData,
    });
    expect(staleWatch.watchNext).toBe(fuelData.narrativeData.canonicalSections.watchNext);
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

  it("reads: legacy saved read fields are ignored in favour of canonical auto text", () => {
    const eff = resolveFuelEffectiveSections({
      report: { fuelMarketRead: "Analyst market read.", fuelOperationalRead: "" },
      aiProse: null,
      fuelData,
    });
    expect(eff.marketRead).toBe(fuelData.narrativeData.canonicalSections.marketRead);
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

  it("shared final evidence audit accepts canonical Fuel text", () => {
    const effective = resolveFuelEffectiveSections({
      report: {},
      aiProse: null,
      fuelData,
    });
    expect(
      validateFuelFinalEvidenceAudit(
        fuelData.reportFacts,
        effective,
        fuelData.canonicalFacts.watchIndicators,
      ),
    ).toEqual([]);
  });

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

const RISING_ROAD_FUEL_JUDGEMENT: FuelJudgement = {
  mainRisk: "Oil Surges Past $99 After Saudi Refinery Attack",
  exposure: { geography: "Saudi Arabia", sector: "road fuel distribution" },
  direction: "upward",
  trigger: "a confirmed change in transit availability",
  evidenceFamilyIds: ["lead-development"],
};

function fuelAudit(
  sections: Record<string, string>,
  marketDirection: "rising" | "falling" | null = "rising",
  topic: "fuel" | "generic-topic" = "fuel",
) {
  return auditFinalReportEvidence({
    topic,
    issueDate: ISSUE,
    window: { start: "2026-07-30", end: ISSUE },
    evidence: [{
      id: "refinery-strikes",
      title: "Repeated refinery strikes affect Russian fuel supply",
      summary: "Russian refinery strikes disrupted fuel supply.",
      country: "Russia",
      occurredAt: "2026-08-03",
    }, {
      id: "brent",
      title: "Brent crude",
      marketComparison: {
        indicator: "Brent crude",
        currentDate: ISSUE,
        referenceDate: "2026-07-29",
        comparisonScope: "reporting-period",
        direction: marketDirection,
        currentValue: 99,
        referenceValue: 94,
        pctChange: 5.3,
        unit: "USD/bbl",
      },
    }],
    sections,
    validatedForwardIndicators: [],
    typedReferences: [{
      id: "refinery-strikes",
      type: "development",
      text: "Repeated refinery strikes affect Russian fuel supply",
      evidenceId: "refinery-strikes",
    }],
  });
}

describe("Fuel semantic judgement and evidence regressions", () => {
  it("accepts a valid paraphrase without source-title, label, direction or trigger repetition", () => {
    const facts = risingJetData().reportFacts;
    expect(validateFuelJudgementConsistency(RISING_ROAD_FUEL_JUDGEMENT, {
      whatMatters: "The principal operational pressure is higher fuel cost combined with increased uncertainty around road supply.",
      polestarView: "Maintain fuel contingency options while distribution conditions remain exposed.",
      implications: "Review delivery resilience.",
      watchNext: "Monitor further changes in transit conditions.",
    }, facts)).toEqual([]);
  });

  it("rejects only unqualified reversals and permits conditional future alternatives", () => {
    const facts = risingJetData().reportFacts;
    const inverted = validateFuelJudgementConsistency(RISING_ROAD_FUEL_JUDGEMENT, {
      whatMatters: "Jet fuel costs are lower and reliable road fuel supply is now established.",
    }, facts);
    expect(inverted.some((issue) => issue.code === "JUDGEMENT_CONSISTENCY")).toBe(true);
    expect(validateFuelJudgementConsistency(RISING_ROAD_FUEL_JUDGEMENT, {
      whatMatters: "Fuel costs could fall if transit availability normalises.",
      watchNext: "Road fuel supply may become reliable if the route reopens.",
    }, facts)).toEqual([]);
  });

  it("requires an explicit current shortage, matching geography and product before rejecting reliable supply", () => {
    const attackOnly = risingJetData().reportFacts;
    expect(validateFuelJudgementConsistency(RISING_ROAD_FUEL_JUDGEMENT, {
      whatMatters: "Road fuel supply in Pakistan is reliable.",
    }, attackOnly)).toEqual([]);

    const shortageData = buildData([inc({
      country: "Pakistan",
      summary: "A diesel shortage is active at Pakistan forecourts.",
    })]);
    expect(validateFuelJudgementConsistency(RISING_ROAD_FUEL_JUDGEMENT, {
      whatMatters: "Diesel supply is reliable in Pakistan.",
    }, shortageData.reportFacts).map((issue) => issue.code)).toContain(
      "JUDGEMENT_CONSISTENCY",
    );
  });

  it("permits a higher-cost synthesis grounded in a current calculated market movement", () => {
    expect(fuelAudit({
      whatMatters: "Higher fuel costs are increasing operating pressure.",
    }).map((issue) => issue.code)).not.toContain("UNSUPPORTED_BOILERPLATE");
    expect(fuelAudit({
      whatMatters: "Higher fuel costs are increasing operating pressure.",
    }, "rising", "generic-topic").map((issue) => issue.code)).not.toContain("UNSUPPORTED_BOILERPLATE");
    expect(fuelAudit({
      whatMatters: "Higher fuel costs are increasing operating pressure and shortages are worsening.",
    }).map((issue) => issue.code)).toContain("UNSUPPORTED_BOILERPLATE");
  });

  it("allows a fuel-specific future watch anchored to one confirmed entity and rejects an invented country", () => {
    expect(fuelAudit({
      watchNext: "Monitor further refinery strikes affecting Russian fuel availability.",
    }).map((issue) => issue.code)).not.toContain("WATCH_NEXT_UNGROUNDED");
    expect(fuelAudit({
      watchNext: "Monitor further refinery strikes affecting Iranian fuel availability.",
    }).map((issue) => issue.code)).toContain("WATCH_NEXT_UNGROUNDED");
  });

  it("retains numeric and direction failures in the existing report-facts gate", () => {
    const data = risingJetData();
    const codes = validateFuelReportConsistency(data.reportFacts, {
      whatMatters: "Jet fuel prices fell 99% this week.",
    }).map((issue) => issue.code);
    expect(codes).toContain("MARKET_DIRECTION");
    expect(codes).toContain("COUNT_TRACEABLE");
  });

  it("treats direction modality and negation per claim, not per sentence", () => {
    const data = risingJetData();
    expect(validateFuelReportConsistency(data.reportFacts, {
      whatMatters: "Jet fuel prices may fall if demand weakens.",
    }).map((issue) => issue.code)).not.toContain("MARKET_DIRECTION");
    expect(validateFuelReportConsistency(data.reportFacts, {
      whatMatters: "Jet fuel prices did not fall this week.",
    }).map((issue) => issue.code)).not.toContain("MARKET_DIRECTION");
    expect(validateFuelReportConsistency(data.reportFacts, {
      whatMatters: "Jet fuel prices fell this week, but may rise later.",
    }).map((issue) => issue.code)).toContain("MARKET_DIRECTION");
    const clauseIssues = validateFuelReportConsistency(data.reportFacts, {
      whatMatters: "Brent prices rose while jet fuel prices fell.",
    });
    expect(clauseIssues.filter((issue) => issue.code === "MARKET_DIRECTION")).toHaveLength(1);
    expect(clauseIssues[0]?.message).toMatch(/JET/);
    expect(validateFuelReportConsistency(data.reportFacts, {
      whatMatters: "Fuel shortages are active, although jet fuel prices could fall.",
    }).map((issue) => issue.code)).toContain("CURRENT_CONDITION");
    expect(validateFuelReportConsistency(data.reportFacts, {
      whatMatters: "Fuel shortages are active if the depot closes.",
    }).map((issue) => issue.code)).not.toContain("CURRENT_CONDITION");
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
            { date: "2026-08-01", value: 2.0 },
            { date: "2026-08-04", value: 2.2 },
          ],
        },
      },
    },
    [inc(), inc(), inc()],
  );
}

describe("AI jet-direction headlines retain the original report text", () => {
  it("flags 'jet fuel costs eased' when the jet series is rising", () => {
    const data = risingJetData();
    const jet = data.reportFacts.market.indicators.find((m) => m.key === "jet");
    expect(jet?.direction).toBe("rising");
    expect(
      validateFuelReportConsistency(data.reportFacts, { whatHappened: JET_EASING_HEADLINE }).some(
        (i) => i.code === "MARKET_DIRECTION",
      ),
    ).toBe(true);

  });

  it("keeps contradictory AI whatHappened visible for the gate", () => {
    const data = risingJetData();
    const fromAi = resolveFuelEffectiveSections({
      report: {},
      aiProse: fullGeneratedProse(data, { whatHappened: JET_EASING_HEADLINE }),
      fuelData: data,
    });
    expect(fromAi.whatHappened).toBe(JET_EASING_HEADLINE);
    expect(validateFuelReportConsistency(data.reportFacts, fromAi).some((i) => i.code === "MARKET_DIRECTION")).toBe(true);

    const fromPrefill = resolveFuelEffectiveSections({
      report: { whatHappened: JET_EASING_HEADLINE },
      aiProse: fullGeneratedProse(data, { whatHappened: JET_EASING_HEADLINE }),
      fuelData: data,
    });
    expect(fromPrefill.whatHappened).toBe(JET_EASING_HEADLINE);
    expect(validateFuelReportConsistency(data.reportFacts, fromPrefill).some((i) => i.code === "MARKET_DIRECTION")).toBe(true);
  });

  it("a genuine analyst override that contradicts jet direction still fail-closes", () => {
    const data = risingJetData();
    const eff = resolveFuelEffectiveSections({
      report: { whatHappened: JET_EASING_HEADLINE },
      aiProse: fullGeneratedProse(data, {
        whatHappened: "Airline pricing talks continued without a market-direction claim.",
      }),
      fuelData: data,
    });
    expect(eff.whatHappened).toBe(JET_EASING_HEADLINE);
    expect(
      validateFuelReportConsistency(data.reportFacts, eff).some((i) => i.code === "MARKET_DIRECTION"),
    ).toBe(true);
  });

  it("atomically rejects a full cached/generated payload that omits the canonical Fuel judgement", () => {
    // This is the production failure mode from report 23: a real, non-null
    // seven-section AI response was loaded, but its generic prose dropped the
    // lead development, road-fuel exposure, upward trajectory and transit
    // trigger. It also asserted ungrounded shortages and an unrelated watch.
    const report = {
      issueDate: ISSUE,
      hardNumbers: {
        prices: [
          { label: "Brent crude", value: 99.4, unit: "USD/bbl", change: "+5.0% 7d", asOf: ISSUE },
          { label: "WTI crude", value: 96.1, unit: "USD/bbl", change: "+4.0% 7d", asOf: ISSUE },
          { label: "Jet fuel", value: 2.3, unit: "USD/gal", change: "+3.0% 7d", asOf: ISSUE },
        ],
        jetFuelTrajectory: {
          benchmark: "US Gulf Coast kerosene-type",
          unit: "USD/gal",
          points: [
            { date: "2026-08-01", value: 2.1 },
            { date: ISSUE, value: 2.3 },
          ],
        },
      },
    };
    const incidents = [inc({
      title: "Oil Surges Past $99 After Saudi Refinery Attack",
      summary: "The Saudi refinery attack disrupted a fuel depot and road fuel distribution, with transit availability through the Strait of Hormuz affected.",
      country: "Saudi Arabia",
      location: "Strait of Hormuz",
      severity: "high",
      sourceUrl: "https://example.com/saudi-refinery-report",
    })];
    const data = buildFuelWatchReportData(report, incidents);
    expect(data.canonicalFacts.judgement).toMatchObject({
      // Canonical risk labels are evidence-grounded analytical categories,
      // never copied source headlines.
      mainRisk: "physical fuel availability and distribution",
      exposure: { sector: "road fuel distribution" },
      direction: "upward",
      trigger: "a confirmed change in transit availability",
    });
    const invalidGenerated = fullGeneratedProse(data, {
      executiveSummary: "Fuel shortages are worsening across the region.",
      situation: "The operating picture remains uncertain.",
      whatHappened: "Refinery disruption is creating a difficult operating environment.",
      whatMatters: "Generic cost pressure is now affecting the market.",
      implications: "Review contingency plans.",
      watchNext: "Monitor unrelated electricity pricing in Jakarta.",
      polestarView: "Maintain a cautious posture while conditions evolve.",
    });

    const finalised = finalizeFuelPublication({
      report,
      incidents,
      aiProse: invalidGenerated,
    });
    expect(finalised.effectiveSections.whatMatters).toBe(
      data.narrativeData.canonicalSections.whatMatters,
    );
    expect(finalised.effectiveSections.watchNext).toBe(
      data.narrativeData.canonicalSections.watchNext,
    );
    expect(finalised.auditIssues.evidence.some((issue) => issue.code === "WATCH_NEXT_UNGROUNDED")).toBe(false);
  });

  it("keeps Implications, Watch Next and Polestar View analytically distinct", () => {
    const report = {
      issueDate: ISSUE,
      hardNumbers: {
        prices: [
          { label: "Brent crude", value: 99.4, unit: "USD/bbl", change: "+5.0% 7d", asOf: ISSUE },
          { label: "WTI crude", value: 96.1, unit: "USD/bbl", change: "+4.0% 7d", asOf: ISSUE },
        ],
      },
    };
    const incidents = [inc({
      title: "Oil Surges Past $99 After Saudi Refinery Attack",
      summary: "The Saudi refinery attack disrupted a fuel depot and road fuel distribution, with transit availability through the Strait of Hormuz affected.",
      country: "Saudi Arabia",
      location: "Strait of Hormuz",
      severity: "high",
    })];
    const finalised = finalizeFuelPublication({ report, incidents, aiProse: null });
    const { whatMatters, implications, watchNext, polestarView } = finalised.effectiveSections;
    const closing = `${implications}\n${watchNext}\n${polestarView}`;
    const fourSections = `${whatMatters}\n${closing}`;

    expect(implications).toContain("Review delivered-cost assumptions");
    expect(implications).not.toMatch(/Saudi Arabia|road fuel distribution|transit availability|watch for|delivery schedules/i);
    expect(watchNext).toMatch(/^Watch for .*transit availability\.$/im);
    expect(watchNext).not.toMatch(/Saudi Arabia|road fuel distribution/i);
    expect(polestarView).not.toMatch(/Saudi Arabia|road fuel distribution|transit availability|fuel-route disruption/i);
    expect(fourSections.match(/transit availability/gi)).toHaveLength(1);
    expect(fourSections.match(/Saudi Arabia/gi)).toHaveLength(1);
    expect(fourSections.match(/road fuel distribution/gi)).toHaveLength(1);
  });

  it("replaces the persisted legacy repeated Implications template", () => {
    const data = risingJetData();
    const effective = resolveFuelEffectiveSections({
      report: {
        implications:
          "Prioritise road fuel distribution in Saudi Arabia; reassess if a confirmed change in transit availability.",
      },
      aiProse: null,
      fuelData: data,
    });

    expect(effective.implications).toBe(
      data.narrativeData.canonicalSections.implications,
    );
    expect(effective.implications).not.toMatch(/prioritise .+reassess if/i);
  });

  it("replaces the persisted rephrased Implications template shown in the report", () => {
    const data = risingJetData();
    const effective = resolveFuelEffectiveSections({
      report: {
        implications:
          "Reprice road fuel distribution in Saudi Arabia against current delivered-cost and availability assumptions.",
      },
      aiProse: null,
      fuelData: data,
    });

    expect(effective.implications).toBe(
      data.narrativeData.canonicalSections.implications,
    );
    expect(effective.implications).not.toMatch(/Saudi Arabia|road fuel distribution/i);
  });

  it("preserves genuinely edited analyst Implications text", () => {
    const data = risingJetData();
    const analystText =
      "Hold additional contracted volume at the eastern depot until the weekly allocation is confirmed.";
    const effective = resolveFuelEffectiveSections({
      report: { implications: analystText },
      aiProse: null,
      fuelData: data,
    });

    expect(effective.implications).toBe(analystText);
  });

  it("keeps an invalid direct analyst edit visible and publication-blocking", () => {
    const data = risingJetData();
    const finalised = finalizeFuelPublication({
      report: {
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
              { date: "2026-08-01", value: 2.0 },
              { date: "2026-08-04", value: 2.2 },
            ],
          },
        },
        whatHappened: JET_EASING_HEADLINE,
      },
      incidents: [inc(), inc(), inc()],
      aiProse: fullGeneratedProse(data),
    });
    expect(finalised.effectiveSections.whatHappened).toBe(JET_EASING_HEADLINE);
    expect(finalised.auditIssues.consistency.some((issue) => issue.code === "MARKET_DIRECTION")).toBe(true);
  });
});

describe("flagged automatic-claim regressions", () => {
  it("runs rising aviation-price inputs through the builder and effective resolver", () => {
    const data = buildFuelWatchReportData(
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
      [
        inc({
          title: "Air India warns jet fuel prices are rising",
          summary: "Jet fuel prices rose; the airline is reviewing operating costs.",
          country: "India",
        }),
      ],
    );

    expect(data.reportFacts.market.indicators.find((m) => m.key === "jet")?.direction).toBe(
      "rising",
    );
    const effective = resolveFuelEffectiveSections({
      report: {},
      aiProse: fullGeneratedProse(data, {
        whatHappened:
          "Air India warns jet fuel costs eased while reviewing operating costs.",
      }),
      fuelData: data,
    });

    expect(effective.whatHappened).toMatch(/jet fuel costs eased/i);
    expect(effective.marketRead).toMatch(/jet fuel series is rising/i);
    expect(validateFuelReportConsistency(data.reportFacts, effective).some(
      (issue) => issue.code === "MARKET_DIRECTION",
    )).toBe(true);
  });

  it("does not restore fixed sustained-pressure or next-operating-month wording", () => {
    const data = risingJetData();
    const canonical = resolveFuelEffectiveSections({
      report: {},
      aiProse: null,
      fuelData: data,
    });

    expect(canonical.marketRead).not.toMatch(/sustained cost pressure/i);
    expect(canonical.marketRead).toMatch(/reporting-period benchmarks rose/i);
    expect(canonical.watchNext).not.toMatch(/next operating month/i);
  });

  it("keeps the legacy aviation fare/surcharge claim blocked by the final gate", () => {
    const data = risingJetData();
    const legacy =
      "Sustained jet-fuel cost pressure is feeding into airline fares and surcharge negotiations in the next operating month.";
    const effective = resolveFuelEffectiveSections({
      report: { whatMatters: legacy },
      aiProse: null,
      fuelData: data,
    });

    expect(effective.whatMatters).toBe(legacy);
    const evidenceIssues = validateFuelFinalEvidenceAudit(
      data.reportFacts,
      effective,
      data.canonicalFacts.watchIndicators,
    );
    expect(evidenceIssues.some((issue) => issue.code === "UNSUPPORTED_BOILERPLATE")).toBe(true);
    expect(() =>
      assertFuelFinalEvidenceAudit(
        data.reportFacts,
        effective,
        data.canonicalFacts.watchIndicators,
      ),
    ).toThrow();
  });
});
