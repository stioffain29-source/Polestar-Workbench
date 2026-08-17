/**
 * Global sports-fixture gate (owner ruling: no sport in any report).
 *
 * Controls, per architect review:
 *  - routine fixture coverage drops — including "injury time" / player-injury
 *    idiom that must NOT rescue via the unrest override;
 *  - riot-at-fixture, police-action and crowd-crush venue incidents KEEP;
 *  - labour stoppages KEEP (the "stoppage time" lookahead must not damage
 *    real industrial-action matching).
 * All three enforcement surfaces are exercised: explainRelevance,
 * hitsSlopExclude, isCountryRelevant.
 */
import {
  explainRelevance,
  hitsSlopExclude,
  isCountryRelevant,
} from "../../lib/relevance/src/topicRelevance";

function input(title: string, summary = ""): {
  topic: string; title: string; summary: string;
} {
  return { topic: "flashpoint", title, summary };
}

const SPORTS_DROPS: Array<[string, string]> = [
  [
    "Harimau Malaya fall to Vietnam in Asean Cup semis, face tough return leg",
    "Nguyen Xuan Son scored in stoppage time before an own goal helped Vietnam take the advantage into Wednesday's return leg.",
  ],
  ["Nepal held to a draw by Bangladesh in SAFF Women's Championship semi-final", ""],
  // "injury time" and a player injury must not rescue the fixture.
  ["Late injury-time winner sends Thailand into the Sea Games final", ""],
  [
    "Vietnam beat Singapore in AFF Cup opener",
    "The striker limped off with a hamstring injury in the second half; the injury-time goal sealed the win.",
  ],
  // Sports idioms that historically defeated naive overrides.
  ["Indonesia crushed rivals 5-0 in the Asian Cup qualifiers", ""],
  ["Australia win dead rubber as tournament group stage closes", ""],
  ["Keeper saves last-minute shot as Malaysia edge past Laos in Suzuki Cup semi-final", ""],
];

const SECURITY_KEEPS: Array<[string, string]> = [
  ["One dead as fans riot after Asean Cup semi-final in Hanoi", ""],
  [
    "Police fire tear gas as crowd trouble erupts at Jakarta league final",
    "Riot police dispersed supporters outside the stadium; several fans were injured.",
  ],
  ["Stadium crush at cup final leaves dozens injured, police deploy reinforcements", ""],
];

describe("global sports-fixture gate", () => {
  describe.each(SPORTS_DROPS)("drops: %s", (title, summary) => {
    const i = input(title, summary);
    it("explainRelevance drops it", () => {
      const v = explainRelevance("flashpoint", i);
      expect(v.relevant).toBe(false);
      expect(v.reason).toMatch(/sports-fixture/);
    });
    it("hitsSlopExclude drops it", () => {
      expect(hitsSlopExclude("flashpoint", i).relevant).toBe(false);
    });
    it("isCountryRelevant drops it", () => {
      expect(isCountryRelevant(i)).toBe(false);
    });
  });

  describe.each(SECURITY_KEEPS)("security override keeps: %s", (title, summary) => {
    const i = input(title, summary);
    it("is never dropped as sports-fixture noise", () => {
      const v = explainRelevance("flashpoint", i);
      if (!v.relevant) expect(v.reason).not.toMatch(/sports-fixture/);
      const s = hitsSlopExclude("flashpoint", i);
      if (!s.relevant) expect(s.reason).not.toMatch(/sports-fixture/);
      expect(isCountryRelevant(i)).toBe(true);
    });
  });

  it("labour stoppage still keeps (stoppage-time lookahead is scoped)", () => {
    const i = input("Garment workers begin stoppage at Dhaka factory over unpaid wages");
    expect(explainRelevance("flashpoint", i).relevant).toBe(true);
    expect(isCountryRelevant(i)).toBe(true);
  });

  it("'stoppage time' alone never counts as a public-order cue", () => {
    const i = input(
      "Hosts progress after tense second half",
      "The winner came deep in stoppage time of the Asean Cup semi-final.",
    );
    expect(explainRelevance("flashpoint", i).relevant).toBe(false);
  });

  it("pre-match security colour is untouched (no result verb, no idiom)", () => {
    const i = input(
      "Fireworks go off near Vietnam national team's hotel in Indonesia ahead of crucial ASEAN Cup clash",
    );
    // Not dropped by the sports gate on any surface (flashpoint may still
    // drop it for lacking a public-order signal — that is a different rule).
    expect(hitsSlopExclude("flashpoint", i).reason).not.toMatch(/sports-fixture/);
    expect(isCountryRelevant(i)).toBe(true);
  });
});
