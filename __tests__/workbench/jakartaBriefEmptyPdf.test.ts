import { buildJakartaTacticalBrief } from "@/lib/jakartaBrief";

describe("Jakarta compact brief empty-week fallback", () => {
  it("returns prose for every approved section instead of an empty table or bullet list", () => {
    const brief = buildJakartaTacticalBrief([], []);
    expect(brief.operatingPicture.rows).toEqual([]);
    expect(brief.operatingPicture.emptyNote.trim()).not.toBe("");
    expect(brief.crimeEscalationWatch.crime).toContain("No fresh crime-specific reporting this period");
    expect(brief.crimeEscalationWatch.escalationTriggers.trim()).not.toBe("");
    expect(brief.recommendedActions.every((action) => action.trim().length > 0)).toBe(true);
    expect(brief.mapCaption.trim()).not.toBe("");
  });
});
