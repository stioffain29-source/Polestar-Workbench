import { evaluateIncidentRelevance } from "@workspace/relevance";

describe("evaluateIncidentRelevance", () => {
  it("scores irrelevant records as zero", () => {
    const verdict = evaluateIncidentRelevance("flashpoint", {
      topic: "flashpoint",
      title: "Stocks extend rally as markets surge",
    });
    expect(verdict.relevant).toBe(false);
    expect(verdict.status).toBe("irrelevant");
    expect(verdict.score).toBe(0);
  });

  it("scores title-rescued records as one", () => {
    const verdict = evaluateIncidentRelevance("flashpoint", {
      topic: "flashpoint",
      title: "Workers stage a demonstration outside parliament",
    });
    expect(verdict.relevant).toBe(true);
    expect(verdict.score).toBe(1);
    expect(verdict.version).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });

  it("scores ambiguous-token keeps below certainty", () => {
    const verdict = evaluateIncidentRelevance("flashpoint", {
      topic: "flashpoint",
      title: "Nationwide rally builds in capital",
      summary: "Trade union leaders detained by police",
    });
    expect(verdict.relevant).toBe(true);
    expect(verdict.reason).toContain("ambiguous token");
    expect(verdict.score).toBe(0.7);
  });

  // A Levant land-conflict story (IDF / Hezbollah / a southern-Lebanon village)
  // carries a kinetic keyword ("hostage") that satisfies the conflict REQUIRED
  // gate, but names no APAC place — foreign syndication that the geocoder filed
  // under a default APAC country. The off-region gate must drop it even though
  // it is genuinely violent (the armed-violence override deliberately does not
  // rescue an out-of-region clash).
  it("drops a Levant land-conflict story misfiled as conflict (no APAC anchor)", () => {
    const verdict = evaluateIncidentRelevance("conflict", {
      topic: "conflict",
      title: "IDF seals Hezbollah tunnel system in Tebnit amid hostage risk concerns",
      summary: "IDF seals Hezbollah tunnel system in Tebnit amid hostage risk concerns",
      source: "The Jerusalem Post",
    });
    expect(verdict.relevant).toBe(false);
    expect(verdict.status).toBe("irrelevant");
    expect(verdict.reason).toContain("out-of-region theatre");
  });

  // The APAC-anchor rescue must keep a genuine in-region clash that merely
  // references a Levant actor by name — the actor token alone must not drop it.
  it("keeps an APAC clash that only references a Levant actor", () => {
    const verdict = evaluateIncidentRelevance("conflict", {
      topic: "conflict",
      title: "Pakistan army ambush kills three militants near Quetta",
      summary: "Officials likened the cell's tunnelling to Hezbollah tactics",
    });
    expect(verdict.relevant).toBe(true);
  });

  // FP_OFFSHORE_THEATRE_RE is SHARED by flashpoint/protests and indonesia_local.
  // Adding actor tokens (idf/hamas) must not over-drop a genuine in-region story:
  // the anchor rescue keeps it when an APAC / Indonesia place is named, even when
  // the ONLY offshore signal is the new actor token (no country word present).
  it("keeps an APAC-anchored flashpoint protest that only names Levant actors", () => {
    const verdict = evaluateIncidentRelevance("flashpoint", {
      topic: "flashpoint",
      title: "Thousands join Sydney demonstration; protesters condemn IDF and Hamas",
    });
    expect(verdict.relevant).toBe(true);
  });

  it("keeps an Indonesia-anchored local story that only names Levant actors", () => {
    const verdict = evaluateIncidentRelevance("indonesia_local", {
      topic: "indonesia_local",
      title: "Jakarta students rally against IDF and Hamas outside the embassy",
    });
    expect(verdict.relevant).toBe(true);
  });
});
