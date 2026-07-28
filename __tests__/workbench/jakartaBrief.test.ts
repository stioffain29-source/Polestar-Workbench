import {
  buildJakartaOperationalImpact,
  buildJakartaRecommendedActions,
  buildJakartaRouteTiming,
  buildJakartaEscalationIndicators,
} from "../../artifacts/workbench/src/lib/jakartaBrief";

// Parenthetical record/incident count annotations are banned from report prose
// (counts belong only on Fast Facts tiles and chart captions).
const COUNT_ANNOTATION = /\(\s*\d+\s*(records?|incidents?|of\b)/i;

// Jargon the structured-brief builders must never emit.
const BANNED_JARGON = [
  "operating tempo",
  "standing baseline",
  "reads this period as",
];

function assertClean(text: string) {
  expect(text.trim().length).toBeGreaterThan(0);
  expect(COUNT_ANNOTATION.test(text)).toBe(false);
  const lower = text.toLowerCase();
  for (const phrase of BANNED_JARGON) {
    expect(lower).not.toContain(phrase);
  }
}

describe("jakartaBrief deterministic prose builders", () => {
  it.each([
    ["operational impact", buildJakartaOperationalImpact()],
    ["recommended actions", buildJakartaRecommendedActions()],
    ["route and timing guidance", buildJakartaRouteTiming()],
    ["escalation indicators", buildJakartaEscalationIndicators()],
  ])("%s lines are all non-empty and count-free", (_label, lines) => {
    expect(Array.isArray(lines)).toBe(true);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) assertClean(line);
  });
});
