import { APAC_LOCAL_CONFIG, INDONESIA_LOCAL_CONFIG, classifyNewsItem } from "@workspace/ingest";

// Regression lock for the cross-country contamination bug: a foreign wire
// story that names NO tracked in-region country used to fall through to the
// feed's defaultCountry because the old OUT_OF_REGION blocklist only covered
// ~38 hand-picked "known foreign" countries. Two real production examples
// slipped through this gap and were shown, mis-stamped, in Top 3 Developments:
//
//   - "Helicopter crew killed in Greece fires" (Philippine Daily Inquirer
//     feed) was stamped Philippines — "Greece" was never on the old list.
//   - "Riot in Ceuta, 90 people dead" (Indonesian direct-outlet feed) was
//     stamped Indonesia — "Ceuta" was never on the old list either.
//
// OUT_OF_REGION now covers essentially every world country/territory not
// already tracked by the system (generated via gen_out_of_region.py), so any
// future foreign wire story is caught the same way instead of needing a
// reactive one-by-one patch. These tests lock the exact two reported cases
// plus a broader sample so this class of bug cannot silently regress.
describe("out-of-region country detection (cross-country contamination fix)", () => {
  it("rejects a Philippines-feed story naming Greece, not the feed default", () => {
    const c = classifyNewsItem(
      APAC_LOCAL_CONFIG,
      "Clash breaks out at Greece migrant camp, several hurt",
      "Athens police intervene after tensions boil over",
      { sourceName: "Philippine Daily Inquirer", defaultCountry: "Philippines" },
    );
    expect(c.kept).toBe(false);
    expect(c.country).toBeNull();
    expect(c.reason).toMatch(/^out-of-region:/i);
  });

  it("rejects an Indonesia-feed story naming Ceuta, not the feed default", () => {
    const c = classifyNewsItem(
      INDONESIA_LOCAL_CONFIG,
      "Riot in Ceuta, 90 people dead",
      "",
      { sourceName: "Indonesia direct outlet", defaultCountry: "Indonesia" },
    );
    expect(c.kept).toBe(false);
    expect(c.country).toBeNull();
    expect(c.reason).toMatch(/^out-of-region:/i);
  });

  // A broader sample of the newly-added entries, so the fix is verified as
  // systemic (the full generated list) rather than only the two reported
  // tokens (which would still leave the underlying "hand-picked list" defect
  // in place for the next uncovered country).
  it.each([
    ["Peru", "Clash erupts outside Lima stadium in Peru, several hurt"],
    ["Finland", "Riot breaks out in Helsinki, Finland city centre"],
    ["Croatia", "Demonstration in Zagreb, Croatia ends in clashes with police"],
    ["Ecuador", "Riot at Quito prison in Ecuador leaves dozens dead"],
  ])("rejects a foreign story naming %s rather than defaulting the feed's country", (_label, title) => {
    const c = classifyNewsItem(APAC_LOCAL_CONFIG, title, "", {
      sourceName: "Philippine Daily Inquirer",
      defaultCountry: "Philippines",
    });
    expect(c.kept).toBe(false);
    expect(c.country).toBeNull();
    expect(c.reason).toMatch(/^out-of-region:/i);
  });

  it("still keeps a genuine in-region story and stamps the correct country", () => {
    const c = classifyNewsItem(
      APAC_LOCAL_CONFIG,
      "Protest turns violent in Manila over fuel prices",
      "",
      { sourceName: "Philippine Daily Inquirer", defaultCountry: "Philippines" },
    );
    expect(c.kept).toBe(true);
    expect(c.country).toBe("Philippines");
  });
});
