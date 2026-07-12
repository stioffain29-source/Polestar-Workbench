import { isCountryRelevant, type RelevanceInput } from "@workspace/relevance";

// Locks in the country-report relevance drops added for the PNG brief cleanup.
// Country reports treat `isCountryRelevant` as the SOLE relevance authority
// (they fetch raw with `includeIrrelevant` and ignore the stored
// `relevance_status`), so these gates live here, not in `explainRelevance`, and
// need no `RELEVANCE_RULE_VERSION` bump. Two non-event classes must stop
// surfacing as incidents:
//
//   1. MILITARY EXERCISE / DRILL — a scheduled joint / naval / live-fire
//      exercise or war-game is training, not an incident. Dropped UNLESS a fresh
//      attack word is present (a real ambush DURING an exercise still passes).
//   2. THEMATIC op-ed / analysis / explainer / essay — dropped OUTRIGHT, even
//      when it carries security words, because a think-piece names
//      militancy / attacks / a crackdown while reporting no fresh dated event.
//
// Real dated incidents — including a bare "analysis" mid-headline — must remain
// relevant.

function build(title: string, overrides: Partial<RelevanceInput> = {}): RelevanceInput {
  return { topic: "flashpoint", title, summary: "", ...overrides };
}

function relevant(title: string, overrides: Partial<RelevanceInput> = {}): boolean {
  return isCountryRelevant(build(title, overrides));
}

describe("isCountryRelevant — military exercise / drill drop", () => {
  it("drops a joint military exercise with no fresh attack", () => {
    expect(
      relevant("Papua New Guinea and Australia begin joint military exercise near Port Moresby"),
    ).toBe(false);
  });

  it("drops a naval live-fire drill", () => {
    expect(relevant("Navy holds live-fire drills off the coast this week")).toBe(false);
  });

  it("drops a standalone war-game", () => {
    expect(relevant("Regional war games raise tension in the Pacific")).toBe(false);
  });

  it("drops an Indonesian-language joint exercise (latihan gabungan)", () => {
    expect(relevant("TNI gelar latihan gabungan di wilayah Papua")).toBe(false);
  });

  it("KEEPS a real ambush that happens during an exercise (fresh-attack rescue)", () => {
    expect(
      relevant("Gunmen ambush soldiers during a military exercise in Enga, three killed"),
    ).toBe(true);
  });

  it("does NOT drop the oil-drilling homonym (no military qualifier)", () => {
    // "drilling" carries no military qualifier, so the exercise gate must not
    // fire; the record stays available to the country report.
    expect(relevant("Security stepped up as offshore oil drilling resumes in Gulf province")).toBe(
      true,
    );
  });

  it("does NOT drop 'exercise' used as a verb (exercise caution/vigilance)", () => {
    expect(relevant("Residents told to exercise vigilance amid rising crime in Port Moresby")).toBe(
      true,
    );
  });
});

describe("isCountryRelevant — thematic op-ed / explainer / essay drop", () => {
  it("drops a labelled opinion piece despite security words", () => {
    expect(relevant("Opinion: why Papua New Guinea's security forces keep failing")).toBe(false);
  });

  it("drops a labelled analysis piece despite naming militancy", () => {
    expect(relevant("Analysis: the militancy driving unrest in West Papua")).toBe(false);
  });

  it("drops a labelled explainer despite naming violence", () => {
    expect(relevant("Explainer: what is behind the violence in Enga")).toBe(false);
  });

  it("drops a 'Beyond …:' thematic essay", () => {
    expect(relevant("Beyond the ceasefire: mapping Bougainville's fragile peace")).toBe(false);
  });

  it("drops a 'the politics of …' thematic framing", () => {
    expect(relevant("The politics of land conflict in Papua New Guinea")).toBe(false);
  });

  it("drops an Indonesian-language op-ed (Opini:)", () => {
    expect(relevant("Opini: keamanan Papua kian memburuk")).toBe(false);
  });
});

describe("isCountryRelevant — real incidents still pass", () => {
  it("keeps a fresh attack", () => {
    expect(relevant("Gunmen kill three in an ambush near Wabag, Enga")).toBe(true);
  });

  it("keeps a clash with police", () => {
    expect(relevant("Police clash with protesters in Port Moresby")).toBe(true);
  });

  it("keeps a mid-headline 'analysis' on a real incident (label not at the start)", () => {
    // The op-ed drop anchors the label to the headline START, so a forensic
    // 'analysis' inside a hard-news headline must NOT be dropped.
    expect(relevant("Forensic analysis confirms explosives used in Lae blast")).toBe(true);
  });
});
