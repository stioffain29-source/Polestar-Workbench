import { describe, it, expect } from "@jest/globals";
import {
  collapseConflictOperations,
  militantKillFigure,
  detectTheatre,
  operationAnchor,
  type ConflictCollapseRow,
} from "../../artifacts/workbench/src/lib/conflictOperationCollapse";

// Rows mirror the shape both call sites pass (title/date/severity, optional
// displayTitle). Titles are the real live-DB Conflict Watch headlines that
// drove the Balochistan over-inflation.
function row(
  title: string,
  isoDate: string,
  severity = "high",
): ConflictCollapseRow {
  return { title, date: new Date(isoDate), severity };
}

function titles(rows: ConflictCollapseRow[]): string[] {
  return rows.map((r) => r.title);
}

describe("candidacy helpers", () => {
  it("extracts the militant figure from a militant-direction tally", () => {
    expect(
      militantKillFigure(
        "Pakistan says 114 militants killed in air, ground operations in Balochistan since July 5",
      ),
    ).toBe(114);
    expect(
      militantKillFigure(
        "Pakistan says security forces killed 102 militants in Balochistan operations since July 5",
      ),
    ).toBe(102);
    expect(
      militantKillFigure(
        "Operation Shaban kills 71 rebels as Pakistan steps up Balochistan crackdown",
      ),
    ).toBe(71);
  });

  it("never reads a non-militant number as the figure", () => {
    // "since July 5" — the 5 must not be picked; the militant figure is 114.
    expect(
      militantKillFigure(
        "Pakistan says 114 militants killed in Balochistan since July 5",
      ),
    ).toBe(114);
  });

  it("VETOes personnel-direction victims (the attack side)", () => {
    expect(
      militantKillFigure("9 police officers killed in Balochistan attack"),
    ).toBeNull();
    expect(
      militantKillFigure("42 personnel killed in militant attacks this week"),
    ).toBeNull();
    expect(
      militantKillFigure(
        "Bodies of 21 abducted police officers found in Balochistan",
      ),
    ).toBeNull();
    expect(
      militantKillFigure("Nine police officers killed in Balochistan ambush"),
    ).toBeNull();
  });

  it("VETOes mixed roundups that name BOTH sides", () => {
    expect(
      militantKillFigure(
        "54 militants, 38 security personnel killed in Balochistan attacks this week",
      ),
    ).toBeNull();
    expect(
      militantKillFigure(
        "Pakistan says 19 militants, 11 soldiers killed in Balochistan operation",
      ),
    ).toBeNull();
  });

  it("leaves spelled-out counts uncollapsed (digits only)", () => {
    expect(
      militantKillFigure(
        "Operation Shaban: security forces kill four more terrorists in Balochistan",
      ),
    ).toBeNull();
  });

  it("detects the theatre and does not false-match substrings", () => {
    expect(detectTheatre("...crackdown in Balochistan since July 5")).toBe(
      "balochistan",
    );
    expect(detectTheatre("...in Baluchistan operations")).toBe("balochistan");
    expect(detectTheatre("Fighting flares in Khyber Pakhtunkhwa")).toBeNull();
  });

  it("normalises operation anchors (named op precedence, then since-date)", () => {
    expect(
      operationAnchor("Operation Shaban kills 71 rebels in Balochistan"),
    ).toBe("op:shaban");
    expect(operationAnchor("114 militants killed since July 5")).toBe(
      "since:7-5",
    );
    expect(operationAnchor("militants killed since 5 July")).toBe("since:7-5");
    // A generic "operations" plural is not a named operation.
    expect(
      operationAnchor("102 militants killed in Balochistan operations"),
    ).toBeNull();
  });
});

describe("collapseConflictOperations", () => {
  it("Pass B collapses one operation's running tally to the highest figure", () => {
    const rows = [
      row(
        "Pakistan says security forces killed 102 militants in Balochistan operations since July 5",
        "2026-07-11T09:00:00Z",
        "extreme",
      ),
      row(
        "Pakistan says 105 militants killed in Balochistan counterterror operations since July 5",
        "2026-07-12T09:00:00Z",
        "extreme",
      ),
      row(
        "Pakistan says 114 militants killed in air, ground operations in Balochistan since July 5",
        "2026-07-13T09:00:00Z",
        "extreme",
      ),
    ];
    const out = collapseConflictOperations(rows);
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toContain("114 militants killed");
  });

  it("Pass A collapses same-day, same-figure snapshot syndications", () => {
    const rows = [
      row(
        "Pakistani forces say they killed 75 insurgents after attacks in Balochistan",
        "2026-07-10T06:00:00Z",
        "extreme",
      ),
      row(
        "Pakistan troops claim to have killed 75 separatists in Balochistan in days-long operations",
        "2026-07-10T11:00:00Z",
        "high",
      ),
      row(
        "Pakistan claims 75 BLA militants killed in Balochistan crackdown",
        "2026-07-10T15:00:00Z",
        "high",
      ),
    ];
    const out = collapseConflictOperations(rows);
    expect(out).toHaveLength(1);
    // Highest severity wins the tie on identical figure/day.
    expect(out[0]!.severity).toBe("extreme");
  });

  it("does NOT merge the same operation across DIFFERENT anchors (no chaining)", () => {
    const rows = [
      row(
        "Pakistan says 114 militants killed in Balochistan since July 5",
        "2026-07-13T09:00:00Z",
        "extreme",
      ),
      row(
        "Operation Shaban kills 71 rebels as Pakistan steps up Balochistan crackdown",
        "2026-07-12T09:00:00Z",
        "high",
      ),
    ];
    const out = collapseConflictOperations(rows);
    expect(out).toHaveLength(2);
  });

  it("does NOT merge two operations with DIFFERENT since-dates", () => {
    const rows = [
      row(
        "Pakistan says 40 militants killed in Balochistan since July 5",
        "2026-07-11T09:00:00Z",
      ),
      row(
        "Pakistan says 60 militants killed in Balochistan since August 2",
        "2026-08-05T09:00:00Z",
      ),
    ];
    const out = collapseConflictOperations(rows);
    expect(out).toHaveLength(2);
  });

  it("does NOT merge two distinct small same-day encounters sharing a figure", () => {
    // Two genuinely different Balochistan encounters on one day, each reporting
    // the same low militant figure. Pass A's key cannot tell them apart, so the
    // figure floor must leave both — under-merge over collateral.
    const rows = [
      row("3 militants killed in a Quetta raid in Balochistan", "2026-07-10T06:00:00Z"),
      row("3 militants killed in a Kech gunbattle in Balochistan", "2026-07-10T15:00:00Z"),
    ];
    const out = collapseConflictOperations(rows);
    expect(out).toHaveLength(2);
  });

  it("does NOT merge same-since-date tallies from DIFFERENT years", () => {
    // The monitor collapses the full list before windowing, so a "since July 5"
    // operation from 2025 must not fold into the 2026 one of the same theatre.
    const rows = [
      row("Pakistan says 40 militants killed in Balochistan since July 5", "2025-07-11T09:00:00Z", "extreme"),
      row("Pakistan says 60 militants killed in Balochistan since July 5", "2026-07-11T09:00:00Z", "extreme"),
    ];
    const out = collapseConflictOperations(rows);
    expect(out).toHaveLength(2);
  });

  it("NEVER merges militant-kill tallies with the attacks that triggered them", () => {
    const attacks = [
      row("9 police officers killed in Balochistan attack", "2026-07-08T09:00:00Z"),
      row("42 personnel killed in militant attacks this week", "2026-07-09T09:00:00Z"),
      row(
        "Bodies of 21 abducted police officers found in Balochistan",
        "2026-07-10T09:00:00Z",
      ),
      row(
        "54 militants, 38 security personnel killed in Balochistan attacks this week",
        "2026-07-12T09:00:00Z",
      ),
      row(
        "Pakistan says 19 militants, 11 soldiers killed in Balochistan operation",
        "2026-07-12T10:00:00Z",
      ),
    ];
    const operation = row(
      "Pakistan says 114 militants killed in Balochistan since July 5",
      "2026-07-13T09:00:00Z",
      "extreme",
    );
    const out = collapseConflictOperations([...attacks, operation]);
    // Every attack survives untouched; only the operation row is a candidate.
    expect(out).toHaveLength(attacks.length + 1);
    for (const a of attacks) expect(titles(out)).toContain(a.title);
    expect(titles(out)).toContain(operation.title);
  });

  it("collapses the full live Balochistan cluster to a small residual, zero collateral", () => {
    const rows = [
      // since July 5 running tally (3 → 1)
      row("Pakistan says 114 militants killed in air, ground operations in Balochistan since July 5", "2026-07-13T09:00:00Z", "extreme"),
      row("Pakistan says 105 militants killed in Balochistan counterterror operations since July 5", "2026-07-12T09:00:00Z", "extreme"),
      row("Pakistan says security forces killed 102 militants in Balochistan operations since July 5", "2026-07-11T09:00:00Z", "extreme"),
      // 75 snapshot syndications, same day (3 → 1)
      row("Pakistani forces say they killed 75 insurgents after attacks in Balochistan", "2026-07-10T06:00:00Z", "extreme"),
      row("Pakistan troops claim to have killed 75 separatists in Balochistan in days-long operations", "2026-07-10T11:00:00Z", "high"),
      row("Pakistan claims 75 BLA militants killed in Balochistan crackdown", "2026-07-10T15:00:00Z", "high"),
      // no-anchor / named-op residuals (kept)
      row("Pakistan claims 88 militants killed in ongoing Balochistan crackdown", "2026-07-11T12:00:00Z", "high"),
      row("Operation Shaban kills 71 rebels as Pakistan steps up Balochistan crackdown", "2026-07-12T09:00:00Z", "high"),
      // attacks that must survive (3)
      row("9 police officers killed in Balochistan attack", "2026-07-08T09:00:00Z"),
      row("42 personnel killed in militant attacks this week", "2026-07-09T09:00:00Z"),
      row("54 militants, 38 security personnel killed in Balochistan attacks this week", "2026-07-12T13:00:00Z"),
    ];
    const out = collapseConflictOperations(rows);
    // 3 attacks + 88 + Op-Shaban-71 + since-July-5 winner + 75-snapshot winner
    expect(out).toHaveLength(7);
    expect(titles(out)).toContain("Pakistan says 114 militants killed in air, ground operations in Balochistan since July 5");
    expect(titles(out)).toContain("Pakistan claims 88 militants killed in ongoing Balochistan crackdown");
    expect(titles(out)).toContain("Operation Shaban kills 71 rebels as Pakistan steps up Balochistan crackdown");
    // No 105/102 survivors — folded into 114.
    expect(titles(out)).not.toContain("Pakistan says 105 militants killed in Balochistan counterterror operations since July 5");
  });

  it("leaves non-conflict-theatre militant tallies untouched", () => {
    const rows = [
      row("Army says 30 militants killed in Waziristan operation since July 5", "2026-07-11T09:00:00Z"),
      row("Army says 40 militants killed in Waziristan operation since July 5", "2026-07-12T09:00:00Z"),
    ];
    // Not a curated theatre → no collapse.
    expect(collapseConflictOperations(rows)).toHaveLength(2);
  });

  it("preserves first-occurrence order", () => {
    const rows = [
      row("Fighting reported near Quetta in Balochistan", "2026-07-10T09:00:00Z"),
      row("Pakistan says 102 militants killed in Balochistan since July 5", "2026-07-11T09:00:00Z", "extreme"),
      row("Aid convoy delayed in Balochistan", "2026-07-11T10:00:00Z"),
      row("Pakistan says 114 militants killed in Balochistan since July 5", "2026-07-13T09:00:00Z", "extreme"),
    ];
    const out = collapseConflictOperations(rows);
    expect(titles(out)).toEqual([
      "Fighting reported near Quetta in Balochistan",
      "Pakistan says 114 militants killed in Balochistan since July 5",
      "Aid convoy delayed in Balochistan",
    ]);
  });
});
