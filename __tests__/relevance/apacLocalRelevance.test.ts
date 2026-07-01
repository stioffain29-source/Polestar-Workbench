import { explainRelevance, type RelevanceInput } from "@workspace/relevance";

// Locks in the `apac_local` (direct-outlet RSS) relevance gate: a broad
// local-coverage feed across Indonesia + Jakarta, West Papua, the Philippines,
// Thailand and Papua New Guinea. There is NO required incident vocabulary — the
// gate is purely geographic: keep any in-region local item, drop only a story
// that POSITIVELY names a non-regional theatre with no APAC anchor.

function build(
  overrides: Partial<RelevanceInput> & Pick<RelevanceInput, "title">,
): RelevanceInput {
  return { topic: "apac_local", summary: "", ...overrides };
}

function verdict(title: string) {
  const input = build({ title });
  return explainRelevance("apac_local", input);
}

describe("apac_local relevance", () => {
  it("keeps an in-region Philippine protest", () => {
    expect(verdict("Thousands protest fuel price hike in Manila").relevant).toBe(true);
  });

  it("keeps an in-region Indonesian crime story", () => {
    expect(verdict("Police arrest robbery suspects in Jakarta").relevant).toBe(true);
  });

  it("keeps a West Papua security incident", () => {
    expect(verdict("Armed clash reported in Jayapura, Papua").relevant).toBe(true);
  });

  it("keeps a Papua New Guinea transport-disruption story", () => {
    expect(
      verdict("Highlands Highway blocked after landslide near Port Moresby").relevant,
    ).toBe(true);
  });

  it("drops foreign wire copy with no APAC anchor", () => {
    const r = verdict("Explosion rocks Tehran as Iran blames militants");
    expect(r.relevant).toBe(false);
    expect(r.reason).toMatch(/out-of-region/);
  });

  it("keeps a story that names both a foreign and an APAC theatre", () => {
    expect(verdict("US envoy meets officials in Manila over security ties").relevant).toBe(
      true,
    );
  });
});
