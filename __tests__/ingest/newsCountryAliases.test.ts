import { detectCountry } from "../../lib/ingest/src/newsTopic";
import { COUNTRY_ALIASES } from "../../lib/ingest/src/topicConfigs";

describe("COUNTRY_ALIASES — subnational region feeds (HY-02)", () => {
  it.each([
    ["NEPRA approves new tariff for K-Electric", "Pakistan"],
    ["Gazipur RMG factories face power cuts", "Bangladesh"],
    ["NEA warns of load shedding in Kathmandu valley", "Nepal"],
    ["Meralco announces maintenance outage in Luzon", "Philippines"],
    ["Ashulia garment zone hit by blackout", "Bangladesh"],
    ["Lalitpur residents protest NEA billing", "Nepal"],
  ])("resolves %s → %s", (headline, country) => {
    expect(detectCountry(headline.toLowerCase(), COUNTRY_ALIASES)).toBe(country);
  });

  it("does not mis-tag a generic electrical term without a place anchor", () => {
    expect(detectCountry("brownout tips for households", COUNTRY_ALIASES)).toBeNull();
  });
});
