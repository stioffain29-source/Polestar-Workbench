import {
  classifyNewsItem,
  FUEL_CONFIG,
  FERTILISER_CONFIG,
} from "@workspace/ingest";

// Locks the world-scope FUEL and FERTILISER attribution. These two monitors
// share the same GLOBAL_TOPIC_ALIASES gazetteer and the same ingest
// `classify` / `detectCountry` path as ENERGY (see energyForeignCountry.test.ts),
// but their attribution was previously verified only by hand. These assert the
// REAL ingest path so a future gazetteer or ordering change can't silently
// re-break attribution — mis-stamping a foreign fuel/fertiliser story onto an
// in-region centroid, or relocating an in-region story onto a foreign place
// named only in passing. The feed defaultCountry is set to an in-region value
// on purpose so a failure to detect the foreign country would surface as the
// wrong (default) attribution rather than Unknown.

describe("fuel foreign-country attribution", () => {
  it("attributes a Nigeria-only fuel headline to Nigeria", () => {
    const c = classifyNewsItem(
      FUEL_CONFIG,
      "Lagos fuel queue lengthens as Nigeria petrol shortage deepens",
      "",
      { defaultCountry: "Pakistan" },
    );
    expect(c.kept).toBe(true);
    expect(c.country).toBe("Nigeria");
  });

  it("attributes a United Kingdom-only fuel headline to the United Kingdom", () => {
    const c = classifyNewsItem(
      FUEL_CONFIG,
      "British forecourts hit by petrol shortage as London fuel supply tightens",
      "",
      { defaultCountry: "India" },
    );
    expect(c.kept).toBe(true);
    expect(c.country).toBe("United Kingdom");
  });

  it("keeps region-first ordering when an in-scope theatre is named alongside a foreign one", () => {
    const c = classifyNewsItem(
      FUEL_CONFIG,
      "Pakistan fuel crisis worsens as Nigeria offers crude supply help",
      "",
      { defaultCountry: "Unknown" },
    );
    expect(c.kept).toBe(true);
    expect(c.country).toBe("Pakistan");
  });

  it("does NOT relocate an in-region fuel story that also names a foreign place", () => {
    // Pakistan is the in-region subject; Russia is named only as the crude
    // source. Region-first ordering must keep this on Pakistan.
    const c = classifyNewsItem(
      FUEL_CONFIG,
      "Pakistan refinery outage cuts diesel supply despite Russia crude imports",
      "",
      { defaultCountry: "Unknown" },
    );
    expect(c.kept).toBe(true);
    expect(c.country).toBe("Pakistan");
  });
});

describe("fertiliser foreign-country attribution", () => {
  it("attributes a Nigeria-only fertiliser headline to Nigeria", () => {
    const c = classifyNewsItem(
      FERTILISER_CONFIG,
      "Nigeria fertiliser shortage hits Lagos farmers as urea price soars",
      "",
      { defaultCountry: "Pakistan" },
    );
    expect(c.kept).toBe(true);
    expect(c.country).toBe("Nigeria");
  });

  it("attributes a Germany-only fertiliser headline to Germany", () => {
    const c = classifyNewsItem(
      FERTILISER_CONFIG,
      "Berlin warns of fertiliser price surge as German ammonia supply falls",
      "",
      { defaultCountry: "India" },
    );
    expect(c.kept).toBe(true);
    expect(c.country).toBe("Germany");
  });

  it("keeps region-first ordering when an in-scope theatre is named alongside a foreign one", () => {
    const c = classifyNewsItem(
      FERTILISER_CONFIG,
      "India fertiliser subsidy strained as Russia urea export ban bites",
      "",
      { defaultCountry: "Unknown" },
    );
    expect(c.kept).toBe(true);
    expect(c.country).toBe("India");
  });

  it("does NOT relocate an in-region fertiliser story that also names a foreign place", () => {
    // Pakistan is the in-region subject; Russia is named only as the import
    // source. Region-first ordering must keep this on Pakistan.
    const c = classifyNewsItem(
      FERTILISER_CONFIG,
      "Pakistan urea shortage worsens despite Russia fertiliser imports",
      "",
      { defaultCountry: "Unknown" },
    );
    expect(c.kept).toBe(true);
    expect(c.country).toBe("Pakistan");
  });
});
