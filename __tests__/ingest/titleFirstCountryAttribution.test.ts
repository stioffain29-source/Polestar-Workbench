import { classifyNewsItem, ENERGY_CONFIG } from "@workspace/ingest";

// Locks the WRITE-TIME fix for cross-syndicated foreign stories: when a story's
// TITLE unambiguously names exactly one tracked country that differs from the
// feed's default, the incident is attributed to the title-named country — not
// blind-stamped with the feed default and not overridden by an incidental
// country mention in the summary. Previously this class of defect could only be
// repaired retroactively by one-time marker-gated relocate migrations; the fix
// now happens at ingest so no further relocate migrations are needed for new
// rows. Multi-country titles stay conservative (region-first, no guessing).

describe("title-first country attribution at ingest", () => {
  it("stamps a single-country title over the feed default", () => {
    // "Australia fuel crisis" mis-stamped onto an in-region default before.
    const c = classifyNewsItem(
      ENERGY_CONFIG,
      "Australia power grid strained as blackout risk grows",
      "",
      { defaultCountry: "Myanmar" },
    );
    expect(c.kept).toBe(true);
    expect(c.country).toBe("Australia");
  });

  it("lets the single-country title beat an incidental summary mention", () => {
    // The summary names an in-region country (region-ordered first in the
    // gazetteer), but the TITLE clearly names France, so France must win.
    const c = classifyNewsItem(
      ENERGY_CONFIG,
      "Paris hit by nationwide power outage as French grid fails",
      "Comparisons drawn with earlier Pakistan load shedding",
      { defaultCountry: "Pakistan" },
    );
    expect(c.kept).toBe(true);
    expect(c.country).toBe("France");
  });

  it("stays conservative for a multi-country title (region-first)", () => {
    const c = classifyNewsItem(
      ENERGY_CONFIG,
      "Pakistan load shedding worsens as Turkey offers electricity supply help",
      "",
      { defaultCountry: "Unknown" },
    );
    expect(c.kept).toBe(true);
    expect(c.country).toBe("Pakistan");
  });

  it("does NOT relocate an in-region story that only names a foreign place in passing", () => {
    const c = classifyNewsItem(
      ENERGY_CONFIG,
      "Iraq-Turkey Pipeline sabotage cuts crude flow after pipeline attack",
      "",
      { defaultCountry: "Unknown" },
    );
    expect(c.kept).toBe(true);
    expect(c.country).toBe("Iraq");
  });

  it("falls back to the feed default when the title names no tracked country", () => {
    const c = classifyNewsItem(
      ENERGY_CONFIG,
      "Nationwide power outage plunges the country into darkness",
      "",
      { defaultCountry: "Pakistan" },
    );
    expect(c.kept).toBe(true);
    expect(c.country).toBe("Pakistan");
  });
});
