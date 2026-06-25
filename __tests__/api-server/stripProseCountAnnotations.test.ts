import { stripProseCountAnnotations } from "../../artifacts/api-server/src/lib/countryProse";

// Defence-in-depth for the hard "no incident counts in prose" rule
// (replit.md). The AI prompt forbids parenthetical count annotations like
// "(2 records)" or "(12 of 30 incidents)", but the model can still slip one in.
// stripProseCountAnnotations is applied at the parse choke point (coerceStr /
// coerceList / coerceJoined) so every AI-generated narrative field is cleaned
// before it reaches the cache, editor, preview, or PDF.
//
// The same forbidden shape the deterministic guard asserts against, applied to
// the AI path here so neither side can leak a count.
const FORBIDDEN_COUNT =
  /\(\s*\d+(\s+of\s+\d+)?\s+(records?|incidents?|events?)\s*\)/i;

describe("stripProseCountAnnotations", () => {
  it("removes a trailing record count annotation", () => {
    const out = stripProseCountAnnotations(
      "Maritime tension rose sharply this week (2 records).",
    );
    expect(out).toBe("Maritime tension rose sharply this week.");
    expect(out).not.toMatch(FORBIDDEN_COUNT);
  });

  it("removes a mid-sentence 'N of M incidents' annotation", () => {
    const out = stripProseCountAnnotations(
      "Protests (12 of 30 incidents) dominated the period.",
    );
    expect(out).toBe("Protests dominated the period.");
    expect(out).not.toMatch(FORBIDDEN_COUNT);
  });

  it("removes count nouns beyond records/incidents/events", () => {
    for (const noun of [
      "3 reports",
      "4 cases",
      "2 entries",
      "5 articles",
      "6 items",
      "7 data points",
    ]) {
      const out = stripProseCountAnnotations(`Activity escalated (${noun}).`);
      expect(out).toBe("Activity escalated.");
    }
  });

  it("preserves parentheticals without a count noun (years, places)", () => {
    expect(
      stripProseCountAnnotations("The 2014 ruling (since 2023) still applies."),
    ).toBe("The 2014 ruling (since 2023) still applies.");
    expect(
      stripProseCountAnnotations("Unrest centred on Papua (West Papua)."),
    ).toBe("Unrest centred on Papua (West Papua).");
  });

  it("preserves parentheticals with a count noun but no digit", () => {
    expect(
      stripProseCountAnnotations("Several incidents (see annex) were noted."),
    ).toBe("Several incidents (see annex) were noted.");
  });

  it("preserves newlines so bullet lists keep their line breaks", () => {
    const out = stripProseCountAnnotations(
      "Tighten convoy escort (3 incidents).\nReview port security (2 records).",
    );
    expect(out).toBe("Tighten convoy escort.\nReview port security.");
    expect(out.split("\n")).toHaveLength(2);
  });

  it("tidies the spacing left behind after a removal", () => {
    expect(
      stripProseCountAnnotations("Strikes rose (4 events) , then eased."),
    ).toBe("Strikes rose, then eased.");
  });

  it("is a no-op on clean prose and empty input", () => {
    const clean = "Risk remained elevated across the Strait of Malacca.";
    expect(stripProseCountAnnotations(clean)).toBe(clean);
    expect(stripProseCountAnnotations("")).toBe("");
  });
});
