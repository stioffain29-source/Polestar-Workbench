import {
  buildIncidentTitle,
  buildIncidentSummary,
} from "../../artifacts/api-server/src/routes/socialWatch";

// ANALYST-TEXT INVARIANT under test (see routes/socialWatch.ts): promoting a
// KAMMI/BEM social-watch post also derives the new incident's TITLE and SUMMARY
// from the pasted item. These strings ship as published intelligence, so a
// silent regression (wrong "under way" vs "dispersed" verb, a dropped location
// fallback to city, a missing organiser in the summary, or an over-long caption
// slice) would surface wrong analyst-facing text. This unit-tests both builders
// directly across their branches.

describe("buildIncidentTitle", () => {
  it("active status → 'under way' verb", () => {
    expect(
      buildIncidentTitle({
        issue: "Fuel price",
        city: "Jakarta",
        location: "Merdeka Square",
        status: "active",
      }),
    ).toBe("Fuel price protest under way — Merdeka Square, Indonesia");
  });

  it("dispersed status → 'dispersed' verb", () => {
    expect(
      buildIncidentTitle({
        issue: "Fuel price",
        city: "Jakarta",
        location: "Merdeka Square",
        status: "dispersed",
      }),
    ).toBe("Fuel price protest dispersed — Merdeka Square, Indonesia");
  });

  it("any non-dispersed status falls through to 'under way'", () => {
    expect(
      buildIncidentTitle({
        issue: null,
        city: "Jakarta",
        location: null,
        status: "arrest",
      }),
    ).toBe("Protest under way — Jakarta, Indonesia");
  });

  it("issue present → '<issue> protest' subject; absent → bare 'Protest'", () => {
    expect(
      buildIncidentTitle({
        issue: "Labour law",
        city: "Bandung",
        location: null,
        status: "active",
      }),
    ).toBe("Labour law protest under way — Bandung, Indonesia");
    expect(
      buildIncidentTitle({
        issue: null,
        city: "Bandung",
        location: null,
        status: "active",
      }),
    ).toBe("Protest under way — Bandung, Indonesia");
  });

  it("prefers location, falls back to city when location is absent", () => {
    expect(
      buildIncidentTitle({
        issue: null,
        city: "Surabaya",
        location: "City Hall",
        status: "active",
      }),
    ).toBe("Protest under way — City Hall, Indonesia");
    expect(
      buildIncidentTitle({
        issue: null,
        city: "Surabaya",
        location: null,
        status: "active",
      }),
    ).toBe("Protest under way — Surabaya, Indonesia");
  });
});

describe("buildIncidentSummary", () => {
  it("actor present → uses actor; absent → 'KAMMI' fallback", () => {
    expect(
      buildIncidentSummary({
        caption: null,
        eventTimeText: null,
        location: "Merdeka Square",
        city: "Jakarta",
        actor: "BEM SI",
      }),
    ).toBe("BEM SI protest activity reported at Merdeka Square.");
    expect(
      buildIncidentSummary({
        caption: null,
        eventTimeText: null,
        location: "Merdeka Square",
        city: "Jakarta",
        actor: null,
      }),
    ).toBe("KAMMI protest activity reported at Merdeka Square.");
  });

  it("prefers location, falls back to city when location is absent", () => {
    expect(
      buildIncidentSummary({
        caption: null,
        eventTimeText: null,
        location: null,
        city: "Jakarta",
        actor: "KAMMI Pusat",
      }),
    ).toBe("KAMMI Pusat protest activity reported at Jakarta.");
  });

  it("appends the eventTimeText parenthetical when present", () => {
    expect(
      buildIncidentSummary({
        caption: null,
        eventTimeText: "10:00 WIB",
        location: "Merdeka Square",
        city: "Jakarta",
        actor: "KAMMI",
      }),
    ).toBe("KAMMI protest activity reported at Merdeka Square (10:00 WIB).");
  });

  it("appends the caption after the lead sentence, whitespace-collapsed", () => {
    expect(
      buildIncidentSummary({
        caption: "Massa   berkumpul\n\ndi depan gedung.",
        eventTimeText: null,
        location: "Merdeka Square",
        city: "Jakarta",
        actor: "KAMMI",
      }),
    ).toBe(
      "KAMMI protest activity reported at Merdeka Square. Massa berkumpul di depan gedung.",
    );
  });

  it("caps the appended caption at 400 characters", () => {
    const longCaption = "x".repeat(600);
    const summary = buildIncidentSummary({
      caption: longCaption,
      eventTimeText: null,
      location: "Merdeka Square",
      city: "Jakarta",
      actor: "KAMMI",
    });
    const lead = "KAMMI protest activity reported at Merdeka Square. ";
    expect(summary).toBe(lead + "x".repeat(400));
    expect(summary.length).toBe(lead.length + 400);
  });

  it("omits the caption clause entirely when caption is null or blank", () => {
    expect(
      buildIncidentSummary({
        caption: "   ",
        eventTimeText: null,
        location: "Merdeka Square",
        city: "Jakarta",
        actor: "KAMMI",
      }),
    ).toBe("KAMMI protest activity reported at Merdeka Square.");
  });
});
