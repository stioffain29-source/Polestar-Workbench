import { classifyNewsItem, ENERGY_CONFIG } from "@workspace/ingest";

// Locks the world-scope energy attribution added when Turkey, the United
// Kingdom and Venezuela joined GLOBAL_EXTRA_ALIASES. These assert the REAL
// ingest `classify` / `detectCountry` path over GLOBAL_TOPIC_ALIASES so a
// future gazetteer or ordering change can't silently re-break attribution
// (e.g. re-stamping "Iraq-Turkey Pipeline sabotage" onto Turkey, or dropping
// a Venezuela outage on an in-region centroid). The feed defaultCountry is set
// to an in-region value on purpose so a failure to detect the foreign country
// would surface as the wrong (default) attribution rather than Unknown.

describe("energy foreign-country attribution", () => {
  it("attributes a Turkey-only energy headline to Turkey", () => {
    const c = classifyNewsItem(
      ENERGY_CONFIG,
      "Ankara power outage hits Turkish grid amid electricity crisis",
      "",
      { defaultCountry: "Pakistan" },
    );
    expect(c.kept).toBe(true);
    expect(c.country).toBe("Turkey");
  });

  it("attributes a United Kingdom-only energy headline to the United Kingdom", () => {
    const c = classifyNewsItem(
      ENERGY_CONFIG,
      "Scotland faces blackout risk as British grid warns of power shortage",
      "",
      { defaultCountry: "India" },
    );
    expect(c.kept).toBe(true);
    expect(c.country).toBe("United Kingdom");
  });

  it("attributes a Venezuela-only energy headline to Venezuela", () => {
    const c = classifyNewsItem(
      ENERGY_CONFIG,
      "Caracas hit by nationwide blackout as Venezuela power grid fails",
      "",
      { defaultCountry: "Indonesia" },
    );
    expect(c.kept).toBe(true);
    expect(c.country).toBe("Venezuela");
  });

  it("keeps region-first ordering when an in-scope theatre is named alongside a foreign one", () => {
    const c = classifyNewsItem(
      ENERGY_CONFIG,
      "Pakistan load shedding worsens as Turkey offers electricity supply help",
      "",
      { defaultCountry: "Unknown" },
    );
    expect(c.kept).toBe(true);
    expect(c.country).toBe("Pakistan");
  });

  it("does NOT relocate an in-region story that also names a foreign place", () => {
    // "Iraq-Turkey Pipeline sabotage" — Iraq is the in-region subject; the
    // pipeline is only named for the route. Region-first ordering must keep
    // this on Iraq, never re-stamp it onto Turkey.
    const c = classifyNewsItem(
      ENERGY_CONFIG,
      "Iraq-Turkey Pipeline sabotage cuts crude flow after pipeline attack",
      "",
      { defaultCountry: "Unknown" },
    );
    expect(c.kept).toBe(true);
    expect(c.country).toBe("Iraq");
  });
});
