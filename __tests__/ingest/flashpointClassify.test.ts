import { flashpointTestHooks } from "../../lib/ingest/src/flashpoint";

const { classify, resolvePapuaPng, titleSimilarity, eventSignatureTrigrams } = flashpointTestHooks;

describe("resolvePapuaPng", () => {
  it("routes West Papua insurgency context away from PNG", () => {
    expect(resolvePapuaPng("Rebels in Papua region kill 8, Indonesian military responds")).toBe(
      "West Papua",
    );
  });

  it("tags cross-border records with both theatres", () => {
    expect(resolvePapuaPng("Clash near Jayapura and Port Moresby border area")).toBe(
      "West Papua; Papua New Guinea",
    );
  });

  it("returns Papua New Guinea for PNG markers", () => {
    expect(resolvePapuaPng("Armed robbery in Port Moresby")).toBe("Papua New Guinea");
  });
});

describe("classify", () => {
  it("accepts Pacific civilian crime without protest cues", () => {
    const result = classify("Armed robbery in Port Moresby", "Raskol gang hold-up");
    expect(result).toEqual({
      kept: true,
      reason: "allow:pacific-crime",
      country: "Papua New Guinea",
    });
  });

  it("accepts standard protest incidents with APAC country context", () => {
    const result = classify("Students protest fee hike", "Demonstration in Delhi");
    expect(result.kept).toBe(true);
    expect(result.country).toBe("India");
    expect(result.reason).toMatch(/^allow:/);
  });

  it("denies kinetic armed conflict outside the Pacific", () => {
    const result = classify("Gunmen kill three in Manila market", "Police investigate shooting");
    expect(result).toEqual({
      kept: false,
      reason: "deny:kinetic-nonpacific",
      country: null,
    });
  });

  it("denies global drone-strike signatures everywhere", () => {
    const result = classify(
      "Drone strike kills militants in Mindanao",
      "Philippine military confirms operation",
    );
    expect(result.kept).toBe(false);
    expect(result.country).toBeNull();
    expect(result.reason).toMatch(/^deny:/);
  });
});

describe("rehash helpers", () => {
  it("extracts casualty trigrams with digits", () => {
    const sig = eventSignatureTrigrams("PNG declares emergency after 15 killed in riots");
    expect(sig.has("15 killed in")).toBe(true);
  });

  it("treats distinct PNG riot headlines as different events", () => {
    const a = "PNG declares state of emergency after 15 killed in riots";
    const b = "PNG vows crackdown after 15 killed in riots";
    expect(titleSimilarity(a, b)).toBeLessThan(0.6);
  });

  it("treats near-identical headlines as the same syndicated rehash", () => {
    const headline = "PNG declares state of emergency after 15 killed in riots";
    expect(titleSimilarity(headline, headline)).toBe(1);
  });
});
