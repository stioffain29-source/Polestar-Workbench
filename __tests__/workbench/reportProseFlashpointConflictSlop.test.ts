/**
 * Regression: Flashpoint + Conflict reader-facing prose must paraphrase
 * events (type / place / date) and never paste article headlines.
 */
import { shortSignalLabel } from "../../artifacts/workbench/src/lib/upcomingSignals";
import {
  buildConflictReportDataset,
  describeConflictEvent,
  isGenericConflictProse,
  type ConflictReportIncident,
} from "../../artifacts/workbench/src/lib/conflictReportDataset";
import {
  buildFlashpointReportDataset,
  validateFlashpointReportDataset,
  type FlashpointReportIncident,
} from "../../artifacts/workbench/src/lib/flashpointReportDataset";

describe("shortSignalLabel — never returns a clipped raw headline", () => {
  it("paraphrases known protest cues", () => {
    const label = shortSignalLabel({
      title: "Thousands join opposition rally in Lahore against fuel prices",
      country: "Pakistan",
    });
    // Cue-based paraphrase (fuel/levy, opposition, protest…) — never the raw title.
    expect(label.toLowerCase()).toMatch(
      /protest|rally|mobilisation|opposition|fuel|levy|political/,
    );
    expect(label).not.toContain("Thousands join");
  });

  it("falls back to a typed public-order label, not the title text", () => {
    const title =
      "Unusual municipal scheduling notice sparks local debate overnight - City Desk";
    const label = shortSignalLabel({ title, country: "Indonesia" });
    expect(label).toMatch(/Public-order disruption/i);
    expect(label).not.toContain("Unusual municipal");
    expect(label).not.toContain(title);
  });
});

describe("conflict event paraphrase — no headline paste", () => {
  const ISSUE_DATE = "2026-06-15";
  const KINETIC = "Militants attack an army base, six soldiers killed";

  function inc(
    over: Partial<ConflictReportIncident> & {
      id: number | string;
      severity: string;
      country: string;
      title: string;
    },
  ): ConflictReportIncident {
    return {
      topic: "conflict",
      occurredAt: "2026-06-14T08:00:00+00:00",
      summary: null,
      source: "Test Wire",
      sourceUrl: `https://example.com/${over.id}`,
      location: null,
      ...over,
    };
  }

  it("describeConflictEvent paraphrases without quoting the title", () => {
    const ds = buildConflictReportDataset(
      [inc({ id: 1, country: "Philippines", severity: "high", title: KINETIC })],
      "conflict",
      ISSUE_DATE,
    );
    const lead = ds.topActivityAreas[0]?.incidents[0];
    expect(lead).toBeTruthy();
    const phrase = describeConflictEvent(lead!);
    expect(phrase).toMatch(/military or police base/i);
    expect(phrase).toMatch(/casualties reported/i);
    expect(phrase).not.toContain('"');
    expect(phrase).not.toContain(KINETIC);
  });

  it("auto Situation / area paragraphs never paste the raw headline", () => {
    const ds = buildConflictReportDataset(
      [inc({ id: 1, country: "Philippines", severity: "high", title: KINETIC })],
      "conflict",
      ISSUE_DATE,
    );
    const narrative = [
      ds.autoSituation,
      ds.autoOtherWatched,
      ...ds.topActivityAreas.map((a) => a.paragraph),
    ].join("\n");
    expect(narrative).not.toContain(KINETIC);
    expect(narrative).not.toMatch(/"[^"]{25,}"/);
    expect(isGenericConflictProse(ds.autoSituation)).toBe(false);
  });
});

describe("flashpoint auto-prose — no headline paste", () => {
  const ISSUE_DATE = "2026-08-10";
  const ODD_TITLE =
    "Unusual municipal scheduling notice sparks local debate overnight - City Desk";

  function fpInc(
    over: Partial<FlashpointReportIncident> & {
      id: number | string;
      title: string;
    },
  ): FlashpointReportIncident {
    return {
      topic: "flashpoint",
      severity: "moderate",
      occurredAt: "2026-08-08T10:00:00.000Z",
      country: "Indonesia",
      summary: "Local organisers discussed a gathering near the city centre.",
      ...over,
    };
  }

  it("activism / civil-unrest reads do not paste odd titles", () => {
    const ds = buildFlashpointReportDataset(
      [
        fpInc({
          id: 1,
          title: "Opposition rally fills central Jakarta streets",
        }),
        fpInc({ id: 2, title: ODD_TITLE }),
      ],
      "flashpoint",
      ISSUE_DATE,
    );
    const prose = [
      ds.autoExecutiveSummary,
      ds.activismRead,
      ds.civilUnrestRead,
      ds.autoWatchNext,
      ds.autoPolestarView,
    ].join("\n");
    expect(prose).not.toContain(ODD_TITLE);
    expect(prose).not.toContain("Unusual municipal scheduling");
    expect(prose).not.toMatch(/"[^"]{25,}"/);
    expect(validateFlashpointReportDataset(ds)).toEqual([]);
  });
});
