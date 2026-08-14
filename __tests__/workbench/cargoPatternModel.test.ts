import {
  buildCargoPatternModel,
  buildCargoExecutiveSummary,
  isWeeklyRising,
  selectIncidents,
  MAX_SELECTED_INCIDENTS,
  type CargoPatternModelInput,
  type CargoSelectionCandidate,
  type CargoAppendixRow,
} from "../../artifacts/workbench/src/lib/cargoPatternModel";
import {
  STAGE_ORDER,
  MAX_PATTERN_CARDS,
} from "../../artifacts/workbench/src/lib/cargoPatternConfig";

const ISSUE = "2026-06-28";

function inc(p: Partial<CargoPatternModelInput>): CargoPatternModelInput {
  return {
    title: "",
    summary: "",
    occurredAt: "2026-06-24",
    topic: "cargo_watch",
    severity: "moderate",
    country: "Malaysia",
    ...p,
  };
}

function totalRecordsValue(m: ReturnType<typeof buildCargoPatternModel>): number {
  const card = m.fastFacts.find((c) => /records|incidents/i.test(c.label));
  return card ? Number(card.value.replace(/[^0-9]/g, "")) : NaN;
}

describe("cargo pattern model — single-source reconciliation", () => {
  it("Fast Facts total equals the deduped cluster count", () => {
    const rows = [
      inc({ id: 1, title: "Armed robbers hijack container truck on the North-South highway in Malaysia", severity: "high", occurredAt: "2026-06-24" }),
      inc({ id: 2, title: "Thieves raid a bonded warehouse in Jakarta, Indonesia overnight", severity: "moderate", occurredAt: "2026-06-23" }),
      inc({ id: 3, title: "Thieves break into a bonded warehouse depot in Singapore overnight", severity: "low", occurredAt: "2026-06-22" }),
    ];
    const m = buildCargoPatternModel(rows, { issueDate: ISSUE });
    // The reconciliation property: the Fast Facts "Total Records" card always
    // equals the deduped cluster count, whatever survives the scope gate.
    expect(m.totalUnique).toBeGreaterThan(0);
    expect(totalRecordsValue(m)).toBe(m.totalUnique);
  });

  it("collapses syndicated duplicates so raw input exceeds the deduped set", () => {
    const a = inc({ id: 1, title: "Thieves raid bonded warehouse depot at Port Klang", source: "Reuters", sourceUrl: "https://r/1", occurredAt: "2026-06-20" });
    const b = inc({ id: 2, title: "Thieves raid bonded warehouse depot at Port Klang overnight", source: "Local Daily", sourceUrl: "https://l/2", occurredAt: "2026-06-21" });
    const m = buildCargoPatternModel([a, b], { issueDate: "2026-06-24" });
    expect(m.totalUnique).toBe(1);
    expect(m.clusters[0].clusterSize).toBe(2);
  });

  it("keeps the highest severity when it collapses a syndicated cluster", () => {
    // The same event carried by two outlets at different severities collapses to
    // ONE canonical row that inherits the WORST tier (spec: canonical = highest).
    const a = inc({ id: 1, title: "Armed robbers hijack container truck of electronics on the North-South highway in Malaysia", severity: "high", source: "Reuters", sourceUrl: "https://r/1", occurredAt: "2026-06-20" });
    const b = inc({ id: 2, title: "Robbers hijack container truck of electronics on the North-South highway, Malaysia", severity: "low", source: "Local Daily", sourceUrl: "https://l/2", occurredAt: "2026-06-21" });
    const m = buildCargoPatternModel([a, b], { issueDate: "2026-06-24" });
    expect(m.totalUnique).toBe(1);
    expect(m.clusters[0].clusterSize).toBe(2);
    // The rendered canonical row (appendix) inherits the worst tier.
    expect(m.appendix).toHaveLength(1);
    expect(m.appendix[0].severityKey).toBe("high");
  });

  it("does not merge same-story headlines from different countries", () => {
    const a = inc({ id: 1, title: "Robbers hijack container truck of electronics on the highway", country: "Malaysia", severity: "high", occurredAt: "2026-06-20" });
    const b = inc({ id: 2, title: "Robbers hijack container truck of electronics on the highway", country: "Thailand", severity: "high", occurredAt: "2026-06-20" });
    const m = buildCargoPatternModel([a, b], { issueDate: "2026-06-24" });
    expect(m.totalUnique).toBe(2);
  });

  it("does not merge similar headlines more than four days apart", () => {
    const a = inc({ id: 1, title: "Robbers hijack container truck of electronics on the North-South highway in Malaysia", severity: "high", occurredAt: "2026-06-10" });
    const b = inc({ id: 2, title: "Robbers hijack container truck of electronics on the North-South highway in Malaysia", severity: "high", occurredAt: "2026-06-20" });
    const m = buildCargoPatternModel([a, b], { issueDate: "2026-06-24" });
    expect(m.totalUnique).toBe(2);
  });

  it("collapses heavily-syndicated enforcement rewrites that a Jaccard-only gate misses", () => {
    // Two outlet copies of ONE Malaysia bonded-lorry syndicate bust on the same
    // day (real report-11 data). Jaccard is only ~0.29 because the longer copy
    // carries force-name and attribution tokens ("Royal Malaysia Police …
    // according to Astro Awani"), but the two share four distinctive tokens
    // (bonded, syndicate, seven, dismantled) and the concise copy is >half
    // contained (overlap ~0.57), so the containment path must merge them into a
    // single enforcement row (both are arrests → the enforcement panel, not the
    // operational totals).
    const a = inc({
      id: 1,
      title: "Royal Malaysia Police dismantle bonded lorry theft syndicate; seven arrested",
      summary:
        "Royal Malaysia Police dismantled a syndicate involved in stealing bonded lorries. Seven suspects were arrested, according to Astro Awani.",
      source: "Astro Awani",
      sourceUrl: "https://a/1",
      occurredAt: "2026-07-01",
    });
    const b = inc({
      id: 2,
      title: "Syndicate Stealing Bonded Lorries Busted, 7 Including Mastermind Detained - JSJ",
      summary:
        "Police (JSJ) dismantled a syndicate that stole bonded lorries; seven people detained, including the mastermind.",
      source: "Bernama",
      sourceUrl: "https://b/2",
      occurredAt: "2026-07-01",
    });
    const m = buildCargoPatternModel([a, b], { issueDate: "2026-07-05" });
    expect(m.clusters).toHaveLength(1);
    expect(m.clusters[0].clusterSize).toBe(2);
    // Both copies are arrests → one merged row in the enforcement panel.
    expect(m.enforcement.total).toBe(1);
  });

  it("containment path leaves a different-facet copy sharing only two tokens separate", () => {
    // A same-day, same-country copy that emphasises a DIFFERENT facet ("operating
    // in four states") shares only {bonded, syndicate} with the bust copy — two
    // distinctive tokens, below the containment path's three-token floor — so it
    // must NOT be over-merged; the two stay separate clusters.
    const bust = inc({
      id: 1,
      title: "Syndicate Stealing Bonded Lorries Busted, 7 Including Mastermind Detained - JSJ",
      summary:
        "Police (JSJ) dismantled a syndicate that stole bonded lorries; seven people detained, including the mastermind.",
      occurredAt: "2026-07-01",
    });
    const facet = inc({
      id: 2,
      title: "'Bonded lorry' theft syndicate operating in four states",
      summary:
        "A syndicate stealing 'bonded lorries' is operating across four states, report Berita Harian.",
      occurredAt: "2026-07-01",
    });
    const m = buildCargoPatternModel([bust, facet], { issueDate: "2026-07-05" });
    expect(m.clusters).toHaveLength(2);
  });

  it("chains a heavily-attributed copy into the event via a strong intermediate", () => {
    // Real report-11 data: three outlet copies of ONE Selangor bonded-lorry
    // bust. The concise Astro Awani copy (seed) and the MalaysiaGazette copy
    // under-share DIRECTLY — the Gazette summary carries "according to …,
    // Location: Selangor" framing that inflates its token set (overlap ~0.44,
    // below the containment floor). But the Bernama copy names the mastermind and
    // suspect count, sharing a STRONG link with both. Bounded transitive chaining
    // must therefore collapse all three into one enforcement row.
    const astro = inc({
      id: 33905,
      title: "Royal Malaysia Police dismantle bonded lorry theft syndicate; seven arrested",
      summary:
        "Royal Malaysia Police dismantled a syndicate involved in stealing bonded lorries. Seven suspects were arrested, according to Astro Awani.",
      occurredAt: "2026-07-01",
    });
    const bernama = inc({
      id: 33898,
      title: "Syndicate Stealing Bonded Lorries Busted, 7 Including Mastermind Detained - JSJ",
      summary:
        "Police (JSJ) dismantled a syndicate that stole bonded lorries; seven people detained, including the mastermind.",
      occurredAt: "2026-07-01",
    });
    const gazette = inc({
      id: 33901,
      title: "Syndicate stealing bonded lorries in Selangor busted, mastermind arrested",
      summary:
        "A syndicate that stole bonded lorries in Selangor was dismantled and the ringleader arrested, according to MalaysiaGazette. Location: Selangor.",
      occurredAt: "2026-07-01",
    });
    const m = buildCargoPatternModel([astro, bernama, gazette], {
      issueDate: "2026-07-05",
    });
    expect(m.clusters).toHaveLength(1);
    expect(m.clusters[0].clusterSize).toBe(3);
    expect(m.enforcement.total).toBe(1);
  });

  it("stage counts sum to the total unique count", () => {
    const rows = [
      inc({ id: 1, title: "Truck hijacking on the highway in Malaysia", severity: "high" }),
      inc({ id: 2, title: "Warehouse theft in Jakarta, Indonesia", severity: "moderate" }),
      inc({ id: 3, title: "Thieves raid a warehouse depot in Singapore overnight", severity: "low" }),
      inc({ id: 4, title: "Police arrest a cargo theft syndicate in the Philippines", severity: "moderate" }),
    ];
    const m = buildCargoPatternModel(rows, { issueDate: ISSUE });
    const sum = m.stages.reduce((s, st) => s + st.count, 0);
    expect(sum).toBe(m.totalUnique);
    expect(m.stages.map((s) => s.key)).toEqual(STAGE_ORDER);
  });

  it("activity matrix cells reconcile with the total unique count", () => {
    const rows = [
      inc({ id: 1, title: "Truck hijacking on the highway in Malaysia", severity: "high", occurredAt: "2026-06-24" }),
      inc({ id: 2, title: "Warehouse theft in Jakarta, Indonesia", severity: "moderate", occurredAt: "2026-06-17" }),
      inc({ id: 3, title: "Thieves raid a warehouse depot in Singapore overnight", severity: "low", occurredAt: "2026-06-10" }),
    ];
    const m = buildCargoPatternModel(rows, { issueDate: ISSUE });
    // Every unique incident lands in exactly one cell: weekly totals plus the
    // date-unconfirmed bucket reconcile with the deduped set.
    const weekSum = m.activity.weeklyTotals.reduce((s, n) => s + n, 0);
    expect(weekSum + m.activity.unconfirmedTotal).toBe(m.totalUnique);
    // The per-row totals also reconcile with the deduped set.
    const rowSum = m.activity.rows.reduce((s, r) => s + r.total, 0);
    expect(rowSum).toBe(m.totalUnique);
    expect(m.activity.total).toBe(m.totalUnique);
    // Multi-week period spans at least two Monday-anchored columns.
    expect(m.activity.weeks.length).toBeGreaterThanOrEqual(2);
  });

  it("appendix has exactly one row per unique incident", () => {
    const rows = [
      inc({ id: 1, title: "Truck hijacking on the highway in Malaysia", severity: "high" }),
      inc({ id: 2, title: "Warehouse theft in Jakarta, Indonesia", severity: "moderate" }),
    ];
    const m = buildCargoPatternModel(rows, { issueDate: ISSUE });
    expect(m.appendix).toHaveLength(m.totalUnique);
    // Summary is a single cleaned sentence, no wire cruft prefix.
    for (const r of m.appendix) {
      expect(r.summary.length).toBeGreaterThan(0);
    }
  });

  it("caps pattern dashboard cards and ranks by significance", () => {
    const rows: CargoPatternModelInput[] = [];
    // Five distinct high-frequency categories -> more than the card cap.
    const specs = [
      "Truck hijacking on the highway in Malaysia",
      "Warehouse theft in Jakarta, Indonesia",
      "Thieves raid a warehouse depot in Singapore overnight",
      "Theft from container at Port Klang terminal, Malaysia",
      "Pilferage and seal tampering at a yard in Thailand",
    ];
    let id = 0;
    for (const s of specs) {
      for (let k = 0; k < 3; k++) {
        rows.push(inc({ id: ++id, title: s, occurredAt: `2026-06-${10 + id}`, severity: "moderate" }));
      }
    }
    const m = buildCargoPatternModel(rows, { issueDate: ISSUE });
    expect(m.patterns.length).toBeLessThanOrEqual(MAX_PATTERN_CARDS);
    for (let i = 1; i < m.patterns.length; i++) {
      expect(m.patterns[i - 1].significance).toBeGreaterThanOrEqual(
        m.patterns[i].significance,
      );
    }
  });

  it("matrix is marked insufficient for sparse periods", () => {
    const m1 = buildCargoPatternModel([], { issueDate: ISSUE });
    expect(m1.isEmpty).toBe(true);
    expect(m1.matrix.sufficient).toBe(false);
    expect(m1.appendix).toHaveLength(0);
    expect(m1.stages.reduce((s, st) => s + st.count, 0)).toBe(0);

    const one = buildCargoPatternModel(
      [inc({ id: 1, title: "Truck hijacking on the highway in Malaysia", severity: "high" })],
      { issueDate: ISSUE },
    );
    expect(one.totalUnique).toBe(1);
    expect(one.matrix.sufficient).toBe(false);
  });

  it("handles an enforcement-only period without inflating operational totals", () => {
    const rows = [
      inc({
        id: 1,
        title: "Police arrest a cargo theft syndicate in the Philippines",
        severity: "moderate",
        country: "Philippines",
      }),
      inc({
        id: 2,
        title: "Authorities dismantle a truck-hijacking gang in Malaysia",
        severity: "moderate",
        country: "Malaysia",
      }),
    ];
    const m = buildCargoPatternModel(rows, { issueDate: ISSUE });
    // Enforcement outcomes are partitioned into their OWN panel and EXCLUDED from
    // every operational total (spec pt1), so no movement stage is inflated.
    expect(m.enforcement.total).toBe(2);
    expect(m.enforcement.rows).toHaveLength(2);
    expect(m.totalUnique).toBe(0);
    for (const s of m.stages) expect(s.count).toBe(0);
  });

  it("country intensity totals never exceed the deduped set", () => {
    const rows = [
      inc({ id: 1, title: "Truck hijacking on the highway in Malaysia", severity: "high" }),
      inc({ id: 2, title: "Warehouse theft in Jakarta, Indonesia", severity: "moderate" }),
      inc({ id: 3, title: "Thieves raid a warehouse depot in Singapore overnight", severity: "low" }),
    ];
    const m = buildCargoPatternModel(rows, { issueDate: ISSUE });
    const intensityTotal = [...m.intensity.values()].reduce(
      (s, v) => s + (v.count ?? 0),
      0,
    );
    expect(intensityTotal).toBeLessThanOrEqual(m.totalUnique);
  });
});

function appendixRow(p: Partial<CargoAppendixRow>): CargoAppendixRow {
  return {
    id: "x",
    date: "2026-06-24",
    location: "",
    category: "Theft",
    summary: "Cargo stolen.",
    severityLabel: "Moderate",
    severityKey: "moderate",
    confidence: "",
    country: "Malaysia",
    confidenceLabel: "",
    status: "",
    cargoType: "",
    company: "",
    source: "",
    sourceUrl: "",
    ...p,
  };
}

function cand(p: Partial<CargoSelectionCandidate>): CargoSelectionCandidate {
  const id = p.id ?? "1";
  return {
    id,
    date: "2026-06-24",
    category: "Theft",
    stage: "in_transit",
    consequence: 0.3,
    country: "Malaysia",
    signalText: "cargo stolen",
    row: appendixRow({ id, ...(p.row ?? {}) }),
    ...p,
  };
}

describe("cargo Selected Incidents picker — selectIncidents", () => {
  it("caps the selection at MAX_SELECTED_INCIDENTS (6)", () => {
    const candidates = Array.from({ length: 12 }, (_, i) =>
      cand({
        id: String(i + 1),
        category: `Category ${i}`,
        consequence: (i % 5) / 10,
        country: i % 2 === 0 ? "Malaysia" : "Indonesia",
      }),
    );
    const picked = selectIncidents(candidates);
    expect(picked.length).toBe(MAX_SELECTED_INCIDENTS);
    expect(picked.length).toBeLessThanOrEqual(candidates.length);
  });

  it("never returns two cards for the same incident id", () => {
    const candidates = [
      cand({ id: "1", category: "Hijacking", consequence: 0.9 }),
      cand({ id: "1", category: "Hijacking", consequence: 0.9 }),
      cand({ id: "2", category: "Warehouse theft", consequence: 0.5 }),
      cand({ id: "3", category: "Pilferage", consequence: 0.2 }),
    ];
    const picked = selectIncidents(candidates);
    const ids = picked.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is consequence/criteria-led, not recency-led (a recent trivial row is not guaranteed)", () => {
    // One high-consequence older incident vs. five most-recent trivial ones of
    // the SAME category/geography (so only the frequency slot could admit them).
    const highOld = cand({
      id: "hi",
      category: "Armed hijacking",
      consequence: 0.95,
      date: "2026-06-10",
      country: "Malaysia",
      signalText: "armed gang hijack container truck",
    });
    const recentTrivial = Array.from({ length: 6 }, (_, i) =>
      cand({
        id: `r${i}`,
        category: "Pilferage",
        consequence: 0.05,
        date: `2026-06-2${i + 1}`,
        country: "Indonesia",
        signalText: "minor pilferage reported",
      }),
    );
    const picked = selectIncidents([highOld, ...recentTrivial]);
    // The high-consequence older incident must be selected despite being oldest.
    expect(picked.some((r) => r.id === "hi")).toBe(true);
    // And the newest trivial row is NOT automatically the top card.
    expect(picked[0]?.id).not.toBe("r5");
  });

  it("returns an empty array for no candidates (no fabrication)", () => {
    expect(selectIncidents([])).toEqual([]);
  });
});

describe("cargo executive summary — buildCargoExecutiveSummary (spec TASK A)", () => {
  // Six banned crutch phrases the spec forbids in the summary prose.
  const BANNED = [
    "Cargo loss this month was shaped by",
    "The most serious reached",
    "There is little to go on",
    "Most consistent reporting",
    "Alongside",
    "Treat this as a rough guide",
  ];

  // A comfortably-populated period: eight clearly distinct in-scope cargo events
  // (different country/day/source) so the deduped, scope-passing set lands well
  // above the five-incident indicative-note threshold.
  const RICH: CargoPatternModelInput[] = [
    inc({ id: 1, title: "Armed robbers hijack a container truck on a highway in Malaysia", severity: "high", occurredAt: "2026-06-24", source: "A", sourceUrl: "https://x/1", country: "Malaysia" }),
    inc({ id: 2, title: "Thieves raid a bonded warehouse in Jakarta, Indonesia", severity: "moderate", occurredAt: "2026-06-23", source: "B", sourceUrl: "https://x/2", country: "Indonesia" }),
    inc({ id: 3, title: "Cargo truck looted after an ambush on a trunk road in Thailand", severity: "high", occurredAt: "2026-06-22", source: "C", sourceUrl: "https://x/3", country: "Thailand" }),
    inc({ id: 4, title: "Freight consignment stolen from a logistics depot in the Philippines", severity: "moderate", occurredAt: "2026-06-21", source: "D", sourceUrl: "https://x/4", country: "Philippines" }),
    inc({ id: 5, title: "Container cargo theft reported at a port yard in Vietnam", severity: "low", occurredAt: "2026-06-20", source: "E", sourceUrl: "https://x/5", country: "Vietnam" }),
    inc({ id: 6, title: "Goods-in-transit robbery on a highway in India", severity: "moderate", occurredAt: "2026-06-19", source: "F", sourceUrl: "https://x/6", country: "India" }),
    inc({ id: 7, title: "Warehouse break-in and cargo theft in Bangladesh", severity: "low", occurredAt: "2026-06-18", source: "G", sourceUrl: "https://x/7", country: "Bangladesh" }),
    inc({ id: 8, title: "Truck hijacking with cargo stolen near Karachi, Pakistan", severity: "high", occurredAt: "2026-06-17", source: "H", sourceUrl: "https://x/8", country: "Pakistan" }),
  ];

  // A thin period: two events, below the five-incident threshold.
  const SPARSE: CargoPatternModelInput[] = [
    inc({ id: 1, title: "Thieves raid a bonded warehouse in Jakarta, Indonesia", severity: "moderate", occurredAt: "2026-06-24", source: "A", sourceUrl: "https://y/1", country: "Indonesia" }),
    inc({ id: 2, title: "Armed robbers hijack a container truck on a highway in Malaysia", severity: "high", occurredAt: "2026-06-23", source: "B", sourceUrl: "https://y/2", country: "Malaysia" }),
  ];

  it("produces a single analytical paragraph with no numerals or record counts", () => {
    const m = buildCargoPatternModel(RICH, { issueDate: ISSUE });
    expect(m.totalUnique).toBeGreaterThanOrEqual(5);
    const s = m.executiveSummary;
    // One paragraph: no line breaks, ends on a full stop.
    expect(s).not.toContain("\n");
    expect(s.trim().endsWith(".")).toBe(true);
    // No numerals anywhere (rules out "(3 records)" and any digit leakage).
    expect(/\d/.test(s)).toBe(false);
    // Comfortably analytical length, not a one-liner or a runaway.
    const words = s.trim().split(/\s+/).length;
    expect(words).toBeGreaterThanOrEqual(55);
    expect(words).toBeLessThanOrEqual(130);
  });

  it("uses none of the banned crutch phrases", () => {
    const m = buildCargoPatternModel(RICH, { issueDate: ISSUE });
    for (const phrase of BANNED) {
      expect(m.executiveSummary).not.toContain(phrase);
    }
  });

  it("appends the indicative-reporting note if and only if fewer than five unique incidents", () => {
    const NOTE = "Reporting remains indicative rather than comprehensive.";
    const rich = buildCargoPatternModel(RICH, { issueDate: ISSUE });
    expect(rich.totalUnique).toBeGreaterThanOrEqual(5);
    expect(rich.executiveSummary).not.toContain(NOTE);
    const sparse = buildCargoPatternModel(SPARSE, { issueDate: ISSUE });
    expect(sparse.totalUnique).toBeLessThan(5);
    expect(sparse.executiveSummary).toContain(NOTE);
    // The invariant itself: note presence tracks the totalUnique<5 threshold.
    for (const m of [rich, sparse]) {
      expect(m.executiveSummary.includes(NOTE)).toBe(m.totalUnique < 5);
    }
  });

  it("names the empty period without fabricating rows", () => {
    const m = buildCargoPatternModel([], { issueDate: ISSUE });
    expect(m.totalUnique).toBe(0);
    expect(m.executiveSummary).toContain("No qualifying cargo-security incidents");
    expect(m.executiveSummary).toContain("Reporting remains indicative rather than comprehensive.");
    expect(/\d/.test(m.executiveSummary)).toBe(false);
  });
});

describe("cargo weekly-rising gate — isWeeklyRising", () => {
  it("is true only for a genuine non-decreasing rise over the last three weeks", () => {
    expect(isWeeklyRising([1, 2, 3])).toBe(true);
    expect(isWeeklyRising([0, 0, 0, 1, 1, 2])).toBe(true); // reads the last three
  });
  it("is false for flat, falling, or too-short series", () => {
    expect(isWeeklyRising([2, 2, 2])).toBe(false); // no real increase
    expect(isWeeklyRising([3, 2, 1])).toBe(false); // falling
    expect(isWeeklyRising([1, 3, 2])).toBe(false); // mid dip then below peak
    expect(isWeeklyRising([1, 2])).toBe(false); // fewer than three weeks
  });
});
