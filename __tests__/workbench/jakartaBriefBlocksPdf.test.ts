import { buildJakartaRecommendedActions } from "@/lib/jakartaBrief";
import { buildJakartaCorridorStatuses } from "@/lib/jakartaCorridors";

describe("Jakarta Recommended Actions payload", () => {
  it("is a single flat, non-empty list with no more than five actions", () => {
    const actions = buildJakartaRecommendedActions(
      buildJakartaCorridorStatuses([]).statuses,
      [],
    );
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.length).toBeLessThanOrEqual(5);
    expect(actions.every((action) => action.trim().length > 0)).toBe(true);
    expect(actions.every((action) => !/travellers|security teams|logistics teams/i.test(action))).toBe(true);
  });
});
