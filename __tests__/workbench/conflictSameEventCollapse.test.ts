import { describe, it, expect } from "@jest/globals";
import {
  collapseConflictSameEvent,
  groupConflictSameEvent,
  anchorTokens,
  type ConflictSameEventRow,
} from "../../artifacts/workbench/src/lib/conflictSameEventCollapse";

// Rows mirror the shape both call sites pass (title/summary/date/severity/
// country). Titles are the real live-DB Conflict Watch headlines that drove the
// one-killing-counted-thrice over-inflation in Manipur's Kangpokpi.
function row(
  title: string,
  isoDate: string,
  opts: {
    summary?: string | null;
    severity?: string;
    country?: string | null;
  } = {},
): ConflictSameEventRow {
  return {
    title,
    date: new Date(isoDate),
    severity: opts.severity ?? "high",
    summary: opts.summary ?? null,
    country: opts.country ?? "India",
  };
}

function titles(rows: ConflictSameEventRow[]): string[] {
  return rows.map((r) => r.title);
}

// The three live syndications of ONE killing.
const A = "Armed men kill 53-year-old farmer in Manipur's Kangpokpi";
const B = "Man shot dead by suspected militants in Manipur's Kangpokpi";
const C =
  "Kuki farmer shot dead while working in jhum field in Manipur's Kangpokpi";

describe("anchorTokens", () => {
  it("drops casualty/actor/age cruft and the country field, keeps place+victim", () => {
    const a = anchorTokens(A, "India");
    expect(a.has("farmer")).toBe(true);
    expect(a.has("manipur")).toBe(true);
    expect(a.has("kangpokpi")).toBe(true);
    // casualty / actor / age words are excluded
    expect(a.has("kill")).toBe(false);
    expect(a.has("armed")).toBe(false);
    expect(a.has("men")).toBe(false);
    expect(a.has("year")).toBe(false);
    expect(a.has("old")).toBe(false);
    // pure digits are never anchors
    expect(a.has("53")).toBe(false);
  });

  it("excludes the country name even when it appears in the title", () => {
    const a = anchorTokens("Blast rocks India's capital region", "India");
    expect(a.has("india")).toBe(false);
  });

  it("drops generic geographic filler so it can never supply the third anchor", () => {
    const a = anchorTokens(
      "Man shot dead in Manipur's Kangpokpi district",
      "India",
    );
    expect(a.has("kangpokpi")).toBe(true);
    expect(a.has("manipur")).toBe(true);
    // administrative filler carries no discriminating signal
    expect(a.has("district")).toBe(false);
    // and the excluded actor word never anchors either
    expect(a.has("man")).toBe(false);
  });
});

describe("collapseConflictSameEvent", () => {
  it("merges A and C — they share {farmer, manipur, kangpokpi} = 3", () => {
    const out = collapseConflictSameEvent([
      row(A, "2026-07-12T04:57:00Z"),
      row(C, "2026-07-11T17:13:00Z"),
    ]);
    expect(out).toHaveLength(1);
  });

  it("keeps B separate on titles alone (shares only the two place tokens)", () => {
    const out = collapseConflictSameEvent([
      row(A, "2026-07-12T04:57:00Z"),
      row(B, "2026-07-12T03:00:00Z"),
    ]);
    expect(out).toHaveLength(2);
  });

  it("IGNORES the summary — a rich summary never folds B (masthead-injection guard)", () => {
    // In live data the summary is the title + a space-appended source masthead,
    // so it is deliberately not read. Even a summary that repeats the shared
    // content words must not fold B: only the title is tokenised.
    const out = collapseConflictSameEvent([
      row(A, "2026-07-12T04:57:00Z"),
      row(B, "2026-07-12T03:00:00Z", {
        summary:
          "The victim was a Kuki farmer working in his jhum field near Kangpokpi.",
      }),
    ]);
    expect(out).toHaveLength(2);
  });

  it("folds A and C but keeps B (summary ignored) across all three", () => {
    const out = collapseConflictSameEvent([
      row(A, "2026-07-12T04:57:00Z"),
      row(B, "2026-07-12T03:00:00Z", {
        summary: "The slain man was a Kuki farmer from Kangpokpi.",
      }),
      row(C, "2026-07-11T17:13:00Z"),
    ]);
    // A+C merge on title anchors; B stays as the mandated under-merge.
    expect(out).toHaveLength(2);
    expect(titles(out)).toEqual([A, B]);
  });

  it("NEVER merges a mis-districted copy (Kangpokpi vs Tamenglong)", () => {
    // With age/old excluded, A ∩ D = {farmer, manipur} = 2 → stays separate.
    const D =
      "53-Year-Old Farmer Shot Dead In Suspected Militant Attack In Manipur's Tamenglong";
    const out = collapseConflictSameEvent([
      row(A, "2026-07-12T04:57:00Z"),
      row(D, "2026-07-12T06:00:00Z"),
    ]);
    expect(out).toHaveLength(2);
  });

  it("NEVER merges two distinct same-day same-district killings", () => {
    // Different victims — share only {manipur, kangpokpi} = 2.
    const out = collapseConflictSameEvent([
      row("Teacher shot dead in Manipur's Kangpokpi", "2026-07-12T08:00:00Z"),
      row("Trader killed by gunmen in Manipur's Kangpokpi", "2026-07-12T09:00:00Z"),
    ]);
    expect(out).toHaveLength(2);
  });

  it("NEVER merges two distinct killings sharing only place + the filler word 'district'", () => {
    // "…Kangpokpi district" is the standard South-Asian headline shape. "man"/
    // "woman" are excluded actor words, so without dropping the geographic
    // filler both rows would anchor to {manipur, kangpokpi, district} = 3 and
    // merge two DIFFERENT killings. Excluding the filler keeps them apart.
    const out = collapseConflictSameEvent([
      row("Man shot dead in Manipur's Kangpokpi district", "2026-07-12T08:00:00Z"),
      row("Woman killed by gunmen in Manipur's Kangpokpi district", "2026-07-12T09:00:00Z"),
    ]);
    expect(out).toHaveLength(2);
  });

  it("digit-conflict veto blocks a merge on disagreeing casualty counts", () => {
    // Both share {farmer, manipur, kangpokpi} = 3 but carry different counts.
    const out = collapseConflictSameEvent([
      row("2 farmers killed in Manipur's Kangpokpi", "2026-07-12T04:00:00Z"),
      row("5 farmers shot dead in Manipur's Kangpokpi", "2026-07-12T05:00:00Z"),
    ]);
    expect(out).toHaveLength(2);
  });

  it("does not merge across the 48h window", () => {
    const out = collapseConflictSameEvent([
      row(A, "2026-07-09T04:00:00Z"),
      row(C, "2026-07-12T04:00:00Z"),
    ]);
    expect(out).toHaveLength(2);
  });

  it("never merges rows from different countries even with shared anchors", () => {
    const out = collapseConflictSameEvent([
      row("Farmer shot dead in Kangpokpi border area", "2026-07-12T04:00:00Z", {
        country: "India",
      }),
      row("Farmer shot dead in Kangpokpi border area", "2026-07-12T05:00:00Z", {
        country: "Myanmar",
      }),
    ]);
    expect(out).toHaveLength(2);
  });

  it("never links rows with unknown/blank country", () => {
    const out = collapseConflictSameEvent([
      row("Kuki farmer shot dead in jhum field Kangpokpi", "2026-07-12T04:00:00Z", {
        country: "",
      }),
      row("Kuki farmer shot dead in jhum field Kangpokpi", "2026-07-12T05:00:00Z", {
        country: "",
      }),
    ]);
    expect(out).toHaveLength(2);
  });

  it("keeps the highest-severity copy as the survivor", () => {
    const out = collapseConflictSameEvent([
      row(A, "2026-07-12T04:57:00Z", { severity: "moderate" }),
      row(C, "2026-07-11T17:13:00Z", { severity: "high" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toBe(C);
    expect(out[0]!.severity).toBe("high");
  });

  it("preserves first-occurrence order and passes non-candidates through", () => {
    const other = row(
      "Soldiers ambushed on Imphal highway, three injured",
      "2026-07-12T02:00:00Z",
    );
    const out = collapseConflictSameEvent([
      row(A, "2026-07-12T04:57:00Z"),
      other,
      row(C, "2026-07-11T17:13:00Z"),
    ]);
    // A+C fold to one row at A's position; the unrelated ambush is untouched.
    expect(out).toHaveLength(2);
    expect(titles(out)).toEqual([A, other.title]);
  });

  it("leaves a militant running-tally list untouched (handled elsewhere)", () => {
    // Personnel/militant tallies carry disagreeing digits and differing anchors,
    // so this pass never folds them — collapseConflictOperations owns that.
    const out = collapseConflictSameEvent([
      row(
        "Pakistan says 88 militants killed in Balochistan operations since July 5",
        "2026-07-12T04:00:00Z",
        { country: "Pakistan" },
      ),
      row(
        "102 militants killed in Balochistan since July 5, army says",
        "2026-07-12T06:00:00Z",
        { country: "Pakistan" },
      ),
    ]);
    expect(out).toHaveLength(2);
  });

  it("returns the input unchanged for lists shorter than two", () => {
    expect(collapseConflictSameEvent([])).toHaveLength(0);
    const single = [row(A, "2026-07-12T04:57:00Z")];
    expect(collapseConflictSameEvent(single)).toHaveLength(1);
  });
});

// The event-CLASS gate: an attack and its follow-on coverage recite the SAME
// named entities ("Assam Rifles ... Ukhrul ambush"), so anchor overlap alone
// clears the bar between them. Only same-class candidate rows may fold; meta
// classes (reaction/aftermath/policy/explainer), named operations and running
// tallies are permanent singletons. Each pairing below shares >= 3 anchors and
// the same country/window, so the ONLY thing keeping them apart is the class.
describe("collapseConflictSameEvent — event-class gate", () => {
  const ATTACK = "Two Assam Rifles personnel killed in Ukhrul ambush, Manipur";

  it("never folds an attack with its TRIBUTE (reaction class)", () => {
    const out = collapseConflictSameEvent([
      row(ATTACK, "2026-07-06T06:00:00Z"),
      row(
        "Assam Rifles pay tribute to two personnel killed in Ukhrul ambush, Manipur",
        "2026-07-06T12:00:00Z",
      ),
    ]);
    expect(out).toHaveLength(2);
  });

  it("never folds an attack with the MANHUNT that follows (aftermath class)", () => {
    const out = collapseConflictSameEvent([
      row(ATTACK, "2026-07-06T06:00:00Z"),
      row(
        "Manhunt launched in Manipur's Ukhrul after Assam Rifles convoy ambush",
        "2026-07-06T14:00:00Z",
      ),
    ]);
    expect(out).toHaveLength(2);
  });

  it("never folds an attack with a POLICY response (policy class)", () => {
    const out = collapseConflictSameEvent([
      row(ATTACK, "2026-07-06T06:00:00Z"),
      row(
        "Government to review counter-insurgency strategy after Ukhrul ambush on Assam Rifles in Manipur",
        "2026-07-06T18:00:00Z",
      ),
    ]);
    expect(out).toHaveLength(2);
  });

  it("never folds an attack with an ARREST over it (different candidate classes)", () => {
    const out = collapseConflictSameEvent([
      row(ATTACK, "2026-07-06T06:00:00Z"),
      row(
        "Two militants arrested over Ukhrul ambush on Assam Rifles in Manipur",
        "2026-07-07T06:00:00Z",
      ),
    ]);
    expect(out).toHaveLength(2);
  });

  it("defers a NAMED OPERATION to collapseConflictOperations (never folds here)", () => {
    const out = collapseConflictSameEvent([
      row("Operation Sindoor: soldier killed in Pulwama ambush, Kashmir", "2026-07-06T06:00:00Z"),
      row("Operation Sindoor leaves a soldier dead in Pulwama, Kashmir", "2026-07-06T09:00:00Z"),
    ]);
    expect(out).toHaveLength(2);
  });
});

// The digit-conflict veto is SUBSET-based, not "share no number": it blocks a
// merge only when EACH side has a small number the other lacks (conflicting
// counts), but ALLOWS a merge when one side's numbers are a subset of the
// other's (added detail from the same event). Spelled-out counts feed the veto.
describe("collapseConflictSameEvent — subset digit veto", () => {
  it("vetoes disagreeing SPELLED-OUT counts (seven vs four) on identical anchors", () => {
    const out = collapseConflictSameEvent([
      row("Seven Maoists killed in Bijapur encounter near Gangaloor, Chhattisgarh", "2026-07-06T06:00:00Z"),
      row("Four Maoists killed in Bijapur encounter near Gangaloor, Chhattisgarh", "2026-07-06T08:00:00Z"),
    ]);
    expect(out).toHaveLength(2);
  });

  it("folds the SAME spelled count (control — proves the veto, not anchors, split the pair above)", () => {
    const out = collapseConflictSameEvent([
      row("Seven Maoists killed in Bijapur encounter near Gangaloor, Chhattisgarh", "2026-07-06T06:00:00Z"),
      row("Seven Maoists shot dead in Bijapur encounter near Gangaloor, Chhattisgarh", "2026-07-06T08:00:00Z"),
    ]);
    expect(out).toHaveLength(1);
  });

  it("ALLOWS a subset — a toll-rises follow-on {21} ⊆ {21,30} is added detail", () => {
    const out = collapseConflictSameEvent([
      row("21 abducted police officers found in Balochistan's Kalat", "2026-07-09T06:00:00Z", {
        country: "Pakistan",
      }),
      row("21 abducted police officers found dead in Balochistan's Kalat, toll rises to 30", "2026-07-09T10:00:00Z", {
        country: "Pakistan",
      }),
    ]);
    expect(out).toHaveLength(1);
  });

  it("VETOES a partial-overlap conflict — {8,30} vs {2,8} share 8 but each has an unshared count", () => {
    // The real borderline: "8 killed, 30 buildings" vs "2 killed, 8 injured".
    // The shared "8" is a killed-vs-injured coincidence, so these are plausibly
    // two distinct airstrikes and must NOT merge under the zero-collateral rule.
    const out = collapseConflictSameEvent([
      row("Junta airstrikes kill 8 civilians, destroy 30 buildings in Kyauktaw, Rakhine", "2026-07-06T06:00:00Z", {
        country: "Myanmar",
      }),
      row("Junta airstrikes kill 2 civilians, injure 8 others in Arakan", "2026-07-05T18:00:00Z", {
        country: "Myanmar",
      }),
    ]);
    expect(out).toHaveLength(2);
  });
});

// Complete-linkage is the architectural core: a row joins a cluster only if it
// pairwise-links to EVERY member. Single-linkage would transitively chain
// A–B–C (A links B, B links C) even when A and C do not link, fusing distinct
// events through a shared hub. groupConflictSameEvent exposes the cluster shape.
describe("groupConflictSameEvent — complete-linkage clustering", () => {
  it("does NOT transitively chain A–B–C when A and C do not directly link", () => {
    // Contrived place-only anchors give exact overlaps: A∩B=3, B∩C=3, A∩C=2.
    const rows: ConflictSameEventRow[] = [
      row("Rebels attack alphatown, betatown, gammatown and deltatown", "2026-07-06T06:00:00Z"),
      row("Rebels attack betatown, gammatown, deltatown and epsilontown", "2026-07-06T07:00:00Z"),
      row("Rebels attack gammatown, deltatown, epsilontown and zetatown", "2026-07-06T08:00:00Z"),
    ];
    const clusters = groupConflictSameEvent(rows);
    // A+B fold; C cannot join because it fails to link A, so it stays a singleton.
    expect(clusters).toEqual([[0, 1], [2]]);
    expect(collapseConflictSameEvent(rows)).toHaveLength(2);
  });

  it("returns singleton clusters for a sub-two list", () => {
    expect(groupConflictSameEvent([])).toEqual([]);
    expect(groupConflictSameEvent([row(A, "2026-07-12T04:57:00Z")])).toEqual([[0]]);
  });
});
