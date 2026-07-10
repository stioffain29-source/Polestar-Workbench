import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  loadTriggerTerms,
  TRIGGER_TERMS,
  matchesTerms,
  matchRegionTags,
} from "../../lib/ingest/src/m15";

describe("M1.5 trigger terms config", () => {
  it("loads triggerTerms.json with all required sections", () => {
    const terms = loadTriggerTerms();
    expect(terms.centcom.maritimeTerms.length).toBeGreaterThan(0);
    expect(terms.centcom.regionTags.length).toBeGreaterThan(0);
    expect(terms.ukmto.escalationTerms.length).toBeGreaterThan(0);
    expect(terms.partners.escalationTerms.length).toBeGreaterThan(0);
  });

  it("exposes the cached TRIGGER_TERMS singleton", () => {
    expect(TRIGGER_TERMS.centcom.maritimeTerms).toContain("strait of hormuz");
    expect(TRIGGER_TERMS.ukmto.escalationTerms).toContain("houthis");
    expect(TRIGGER_TERMS.partners.escalationTerms).toContain("jmic");
  });

  it("reads the JSON file from disk (externalised config)", () => {
    const raw = readFileSync(
      join(__dirname, "../../lib/ingest/src/m15/triggerTerms.json"),
      "utf8",
    );
    const parsed = JSON.parse(raw) as { centcom: { maritimeTerms: string[] } };
    expect(parsed.centcom.maritimeTerms).toEqual(
      expect.arrayContaining(["red sea", "bab al-mandeb"]),
    );
  });

  it("matches multi-word maritime phrases with word boundaries", () => {
    expect(
      matchesTerms(
        "Attacks against merchant vessels in the Strait of Hormuz",
        TRIGGER_TERMS.centcom.maritimeTerms,
      ),
    ).toBe(true);
    expect(matchesTerms("Food prices and Hormuz commentary", ["hormuz"])).toBe(true);
  });

  it("extracts CENTCOM region tags from text", () => {
    const tags = matchRegionTags(
      "CENTCOM forces conducted strikes in Yemen near the Red Sea",
      TRIGGER_TERMS.centcom.regionTags,
    );
    expect(tags).toEqual(expect.arrayContaining(["yemen", "red sea"]));
  });
});
