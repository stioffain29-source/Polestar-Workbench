import { cleanText, hasWord, parseDate, stripAttributionMentions } from "../../lib/ingest/src/text";

describe("text helpers", () => {
  describe("hasWord", () => {
    it("matches whole words only", () => {
      expect(hasWord("protest march in delhi", "delhi")).toBe(true);
      expect(hasWord("model village", "delhi")).toBe(false);
    });

    it("is case insensitive", () => {
      expect(hasWord("Protest in DELHI", "delhi")).toBe(true);
    });
  });

  describe("cleanText", () => {
    it("strips HTML and normalises entities", () => {
      expect(cleanText("<p>Fuel &amp; power outage</p>")).toBe("Fuel & power outage");
    });

    it("returns empty string for nullish input", () => {
      expect(cleanText(null)).toBe("");
      expect(cleanText(undefined)).toBe("");
    });
  });

  describe("stripAttributionMentions", () => {
    it("strips a Sydney-based attribution phrase from an India headline", () => {
      const title =
        '"India\'s Gen Z Protest Not Organic," Claims Sydney-Based Political Scientist Salvatore Babones';
      const stripped = stripAttributionMentions(title);
      expect(stripped.toLowerCase()).not.toContain("sydney-based");
      expect(stripped.toLowerCase()).toContain("india");
    });

    it("strips other city-based attribution phrases generically", () => {
      expect(stripAttributionMentions("Singapore-based analyst said")).not.toContain("Singapore-based");
      expect(stripAttributionMentions("a New York-based think tank")).not.toContain("New York-based");
      expect(stripAttributionMentions("Manila-based correspondent reports")).not.toContain("Manila-based");
    });

    it("does not remove the country/city name itself, only the -based phrase", () => {
      const stripped = stripAttributionMentions("Karachi-based analyst on India's protests");
      expect(stripped.toLowerCase()).toContain("india");
      expect(stripped.toLowerCase()).not.toContain("karachi-based");
    });

    it("leaves text with no attribution phrase unchanged in substance", () => {
      expect(stripAttributionMentions("Protests erupt across Jakarta")).toContain("Jakarta");
    });
  });

  describe("parseDate", () => {
    it("parses ISO dates", () => {
      const parsed = parseDate("2026-05-23T12:00:00.000Z");
      expect(parsed).toBeInstanceOf(Date);
      expect(parsed?.toISOString()).toBe("2026-05-23T12:00:00.000Z");
    });

    it("returns null for invalid dates", () => {
      expect(parseDate("not-a-date")).toBeNull();
      expect(parseDate(null)).toBeNull();
    });
  });
});
