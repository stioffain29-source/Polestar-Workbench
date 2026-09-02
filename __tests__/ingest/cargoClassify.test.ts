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

  it("attributes Singapore Strait theatre from title after masthead strip (CG-02)", () => {
    const item = classifyFeedItem(
      "Container theft reported near Singapore Strait - South China Morning Post",
      "",
    );
    expect(item.result.kept).toBe(true);
    expect(item.result.country).toBe("Singapore");
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

describe("cargo classify — port-only headlines pass the title country gate", () => {
  it("resolves UAE from a port name not in the base country aliases (Jebel Ali)", () => {
    const item = classifyFeedItem("Cargo theft ring busted at Jebel Ali", "");
    expect(item.result.kept).toBe(true);
    expect(item.result.country).toBe("UAE");
  });

  it("resolves Oman from a port name not in the base country aliases (Sohar port)", () => {
    const item = classifyFeedItem("Container theft uncovered at Sohar port", "");
    expect(item.result.kept).toBe(true);
    expect(item.result.country).toBe("Oman");
  });

  it("resolves Malaysia from Port Klang", () => {
    const item = classifyFeedItem("Truck hijacking near Port Klang under investigation", "");
    expect(item.result.kept).toBe(true);
    expect(item.result.country).toBe("Malaysia");
  });

  it("does NOT leak a country from a port name sitting in the source masthead", () => {
    // The masthead is stripped before the country gate, so "Jebel Ali" in the
    // publisher name cannot satisfy the in-scope-country requirement.
    const item = classifyFeedItem("Cargo theft probe widens - Jebel Ali News", "");
    expect(item.sourceName).toBe("Jebel Ali News");
    expect(item.result.kept).toBe(false);
    expect(item.result.country).toBeNull();
  });
});

describe("cargo classify — widened PORT cargo-security scope is kept", () => {
  const kept: Array<[string, string]> = [
    ["Armed robbers boarded a bulk carrier at Singapore anchorage", "Singapore"],
    ["Stowaways found in container at Tanjung Priok", "Indonesia"],
    ["Cocaine in container seized at Port Klang", "Malaysia"],
    ["Port robbery: thieves loot a depot at Colombo port", "Sri Lanka"],
  ];
  it.each(kept)("keeps a port cargo-security event: %s", (title, country) => {
    const item = classifyFeedItem(title, "");
    expect(item.result.kept).toBe(true);
    expect(item.result.country).toBe(country);
  });
});

describe("cargo classify — maritime / kinetic DENY is gated on cargo context", () => {
  it("drops a pure under-way attack with no cargo/port context (routes to Shipping)", () => {
    const item = classifyFeedItem("Houthi missile strikes tanker off Yemen coast", "");
    expect(item.result.kept).toBe(false);
  });

  it("keeps a maritime-worded headline once cargo context is present", () => {
    // 'tanker attack' is a MARITIME_DENY term, but the cargo-theft framing keeps
    // it in Cargo Watch instead of dropping it to Shipping.
    const item = classifyFeedItem("Cargo theft foiled after tanker attack alert at Colombo port", "");
    expect(item.result.kept).toBe(true);
    expect(item.result.country).toBe("Sri Lanka");
  });
});

describe("cargo classify — unambiguous shipping-ops noise stays out", () => {
  const dropped = [
    "Port congestion snarls box terminal in Singapore",
    "Freight rate surge squeezes Jebel Ali importers",
    "Container rate hikes hit Colombo port shippers",
  ];
  it.each(dropped)("drops commercial / port-ops noise: %s", (title) => {
    const item = classifyFeedItem(title, "");
    expect(item.result.kept).toBe(false);
  });
});

describe("cargo classify — security wins over ops/commercial noise (gated, not hard-denied)", () => {
  const kept: Array<[string, string]> = [
    // A genuine theft that merely MENTIONS an ops/commercial word must survive —
    // the ops term is gated on absence of cargo/port context, so it is skipped.
    ["Cargo theft probe at Port Klang amid record throughput", "Malaysia"],
    ["Container theft ring busted at Tanjung Priok despite joint venture deal", "Indonesia"],
    ["Cargo theft surges amid new tariff regime at Jebel Ali", "UAE"],
    // Maritime-deny term + port/vessel context => kept (port-side cargo crime).
    ["Theft from vessel reported at Singapore port after tanker attack scare", "Singapore"],
  ];
  it.each(kept)("keeps a security event that co-mentions ops/commercial/maritime noise: %s", (title, country) => {
    const item = classifyFeedItem(title, "");
    expect(item.result.kept).toBe(true);
    expect(item.result.country).toBe(country);
  });

  it("still drops a pure under-way attack even though it names a vessel (ALLOW gate, no cargo crime)", () => {
    // 'vessel'/'tanker' now count as context (so port-side crime survives), but
    // with no cargo-security ALLOW phrase the headline fails the ALLOW gate and
    // routes to Shipping — the security signal, not the noun, is what keeps it.
    const item = classifyFeedItem("Missile strikes tanker off Yemen as vessel catches fire", "");
    expect(item.result.kept).toBe(false);
  });
});
