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

  it("rejects a UK riot mis-stamped to an APAC country via the source masthead", () => {
    // The publisher name "Japan Today" leaks into both title AND summary, so
    // the only "Japan" signal is the masthead — but the event is in Belfast.
    const result = classify(
      "Thousands rally in Belfast to condemn anti-immigrant rioting that followed stabbing - Japan Today",
      "Thousands rally in Belfast to condemn anti-immigrant rioting that followed stabbing Japan Today",
    );
    expect(result.kept).toBe(false);
    expect(result.country).toBeNull();
    expect(result.reason).toBe("out-of-region:uk-ireland");
  });

  it("rejects a diaspora protest held abroad even when it names an APAC country", () => {
    const result = classify(
      "Sri Lankan Tamil groups protest in London - Daily Mirror",
      "",
    );
    expect(result.kept).toBe(false);
    expect(result.country).toBeNull();
    expect(result.reason).toBe("out-of-region:uk-ireland");
  });

  it("rejects a protest at an APAC high commission located in London", () => {
    const result = classify(
      "Khalistanis Disrupt Hindus' Protests At Bangladesh High Commission In London - NDTV",
      "",
    );
    expect(result.kept).toBe(false);
    expect(result.reason).toBe("out-of-region:uk-ireland");
  });

  it("rejects a venue with an optional locality modifier (in central London)", () => {
    const result = classify("Activists clash with police in central London", "");
    expect(result.kept).toBe(false);
    expect(result.reason).toBe("out-of-region:uk-ireland");
  });

  it("rejects an event located 'in the United Kingdom'", () => {
    const result = classify("Tamil groups stage a protest in the United Kingdom", "");
    expect(result.kept).toBe(false);
    expect(result.reason).toBe("out-of-region:uk-ireland");
  });

  it("keeps an in-region protest that only cites the UK as an actor", () => {
    // "United Kingdom" here is the SUBJECT, not the venue (no preposition), so
    // the venue gate must not reject this genuinely Jakarta-located event.
    const result = classify("Protesters rally in Jakarta against United Kingdom trade deal", "");
    expect(result.kept).toBe(true);
    expect(result.country).toBe("Indonesia");
    expect(result.reason).toMatch(/^allow:/);
  });

  it("does NOT treat an English football club as an out-of-region location", () => {
    // "with Liverpool" is club membership, not a venue — the preposition gate
    // must keep this sports wire out of the foreign-location reject path.
    const result = classify(
      "Japan captain Wataru Endo retires after injury-plagued season with Liverpool",
      "Endo has been replaced in the national team squad",
    );
    expect(result.reason).not.toBe("out-of-region:uk-ireland");
  });

  it("still accepts a genuine in-region protest", () => {
    const result = classify("Workers rally over wages", "Mass demonstration in Manila");
    expect(result.kept).toBe(true);
    expect(result.country).toBe("Philippines");
    expect(result.reason).toMatch(/^allow:/);
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
