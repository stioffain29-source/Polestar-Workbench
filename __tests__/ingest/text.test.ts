import { cleanText, hasWord, parseDate } from "../../lib/ingest/src/text";

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
