import { cargoTestHooks } from "../../lib/ingest/src/cargoWatch";

const { classify, classifyFeedItem } = cargoTestHooks;

describe("cargo classifyFeedItem — Google News masthead must not leak country", () => {
  it("would mis-tag via the raw masthead, but the feed-item path strips it first", () => {
    // Documents the latent trap: the country gate is title-only, so the bare
    // classifier tags China purely from the "South China Morning Post" masthead.
    const raw = classify("Police probe warehouse theft - South China Morning Post", "");
    expect(raw.kept).toBe(true);
    expect(raw.country).toBe("China");

    // classifyFeedItem strips the masthead before classifying, so no in-scope
    // country remains in the headline and the row is dropped.
    const item = classifyFeedItem("Police probe warehouse theft - South China Morning Post", "");
    expect(item.sourceName).toBe("South China Morning Post");
    expect(item.result.kept).toBe(false);
    expect(item.result.country).toBeNull();
  });

  it("does not leak Japan from the 'Japan Today' masthead", () => {
    const item = classifyFeedItem("Warehouse theft suspect arrested - Japan Today", "");
    expect(item.result.kept).toBe(false);
    expect(item.result.country).toBeNull();
  });

  it("keeps a genuine in-country China cargo-theft headline", () => {
    const item = classifyFeedItem("Major cargo theft ring busted in Shanghai, China - Reuters", "");
    expect(item.result.kept).toBe(true);
    expect(item.result.country).toBe("China");
  });

  it("keeps a genuine in-country Japan warehouse-theft headline", () => {
    const item = classifyFeedItem("Former employee arrested over warehouse theft in Tokyo - Kyodo News", "");
    expect(item.result.kept).toBe(true);
    expect(item.result.country).toBe("Japan");
  });
});

describe("cargo classify — piracy belongs to shipping unless cargo-related", () => {
  it("keeps cargo-related piracy (a cargo ALLOW phrase is present)", () => {
    const item = classifyFeedItem("Pirates steal container cargo in freight theft raid in Manila", "");
    expect(item.result.kept).toBe(true);
    expect(item.result.country).toBe("Philippines");
  });

  it("drops non-cargo piracy (no cargo ALLOW phrase) so it routes to shipping", () => {
    const item = classifyFeedItem("Pirates hijack tanker off Singapore in armed robbery", "");
    expect(item.result.kept).toBe(false);
  });
});

describe("cargo classify — Middle East scope must match the frontend (cargoAnalysis MIDDLE_EAST)", () => {
  const cases: Array<[string, string]> = [
    ["Major cargo theft ring busted in Tehran, Iran - Reuters", "Iran"],
    ["Truck hijack gang arrested in Baghdad, Iraq - AP", "Iraq"],
    ["Warehouse theft at Aden port, Yemen - AFP", "Yemen"],
    ["Cargo theft ring busted at Haifa port, Israel - Haaretz", "Israel"],
    ["Freight theft reported in Beirut, Lebanon - Al Jazeera", "Lebanon"],
    ["Warehouse robbery in Damascus, Syria - SANA", "Syria"],
  ];
  it.each(cases)("keeps in-country cargo crime: %s", (title, country) => {
    const item = classifyFeedItem(title, "");
    expect(item.result.kept).toBe(true);
    expect(item.result.country).toBe(country);
  });
});

describe("cargo classify — North Korea must not be mis-tagged South Korea", () => {
  it("rejects a DPRK story even though 'korea' matches the South Korea alias", () => {
    const item = classifyFeedItem("Cargo theft ring uncovered in North Korea", "");
    expect(item.result.kept).toBe(false);
    expect(item.result.country).toBeNull();
  });

  it("still keeps a genuine South Korea cargo-theft headline", () => {
    const item = classifyFeedItem("Cargo theft at Busan port, South Korea - Yonhap", "");
    expect(item.result.kept).toBe(true);
    expect(item.result.country).toBe("South Korea");
  });
});
