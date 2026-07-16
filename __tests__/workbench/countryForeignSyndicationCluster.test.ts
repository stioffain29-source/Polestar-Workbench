import { foreignSyndicationDropIds } from "../../artifacts/workbench/src/lib/countryMatch";

// The single-string isForeignSubjectForIndonesia guard cannot drop a syndicated
// foreign accident whose translated title names no country, city, or foreign
// entity ("Plane crash kills 11") — inventing a foreign tag from zero evidence
// would breach the no-fabrication rule. This cross-row pass links such a
// marker-less row to a foreign-attributed SIBLING row (a copy of the same event
// that DOES name the place) and drops both. A marker-less row with no such
// sibling is never dropped.

const build = (
  rows: { id: string; en: string }[],
): { id: string; en: string }[] => rows;

describe("foreignSyndicationDropIds", () => {
  it("drops a marker-less plane-crash row when a foreign-attributed sibling names the place", () => {
    const drop = foreignSyndicationDropIds(
      build([
        { id: "markerless", en: "Plane crash kills 11" },
        {
          id: "sibling",
          en: "Plane crash in Missouri, US kills 11 parachutists and 1 pilot",
        },
        { id: "domestic", en: "Bentrokan pecah di Jakarta, polisi tembakkan gas" },
      ]),
    );
    expect(drop.has("markerless")).toBe(true);
    // The whole cluster leaves the brief: the attributed sibling is dropped too.
    expect(drop.has("sibling")).toBe(true);
    expect(drop.has("domestic")).toBe(false);
  });

  it("does NOT drop the marker-less row on its own (no foreign sibling present)", () => {
    const drop = foreignSyndicationDropIds(
      build([
        { id: "markerless", en: "Plane crash kills 11" },
        { id: "domestic", en: "Demonstrasi buruh di Surabaya menuntut kenaikan upah" },
      ]),
    );
    expect(drop.has("markerless")).toBe(false);
    expect(drop.size).toBe(0);
  });

  it("does NOT drop when the only similar sibling is itself marker-less", () => {
    // Two copies of the same marker-less accident, neither naming a place. With
    // no foreign-attributed sibling to lend the attribution, both are kept.
    const drop = foreignSyndicationDropIds(
      build([
        { id: "a", en: "Plane crash kills 11" },
        { id: "b", en: "Plane crash kills 11 people" },
      ]),
    );
    expect(drop.size).toBe(0);
  });

  it("does NOT drop a genuine Indonesian story that resembles a foreign sibling", () => {
    // A domestic crash anchored to an Indonesian place carries a local cue, so it
    // is a "local" row (never eligible for clustering) even next to a foreign
    // sibling about a similar accident abroad.
    const drop = foreignSyndicationDropIds(
      build([
        {
          id: "domestic",
          en: "Plane crash kills 11 near Surabaya airport",
        },
        {
          id: "foreign",
          en: "Plane crash in Missouri, US kills 11 parachutists and 1 pilot",
        },
      ]),
    );
    expect(drop.has("domestic")).toBe(false);
  });

  it("does NOT cluster two short generic headlines that share only filler", () => {
    // "Protests break out" vs a foreign "Protests in Nepal turn violent" share no
    // distinctive content token (>=5-char word or number) beyond the stemmed
    // "protest", so the marker-less row is not dropped.
    const drop = foreignSyndicationDropIds(
      build([
        { id: "markerless", en: "Protests break out" },
        { id: "foreign", en: "Nepal protests turn violent in Kathmandu" },
      ]),
    );
    expect(drop.has("markerless")).toBe(false);
  });

  it("links a building-collapse marker-less row to its attributed foreign sibling", () => {
    const drop = foreignSyndicationDropIds(
      build([
        { id: "markerless", en: "Building collapse traps construction workers" },
        {
          id: "sibling",
          en: "Building collapse in Saigon traps construction workers",
        },
      ]),
    );
    expect(drop.has("markerless")).toBe(true);
    expect(drop.has("sibling")).toBe(true);
  });

  it("drops a marker-less plane-crash row that shares only the event signature with its sibling", () => {
    // The weaker-but-real case: the marker-less copy shares only {plane, crash}
    // with its Missouri sibling — thin raw overlap (coeff well below 0.6) — but
    // both tokens belong to the aviation event class, a distinctive signature.
    const drop = foreignSyndicationDropIds(
      build([
        {
          id: "markerless",
          en: "Photos of a plane crashing vertically into a densely populated area, fatalities reported",
        },
        {
          id: "sibling",
          en: "Plane crash in Missouri, US kills 11 parachutists and 1 pilot",
        },
        { id: "domestic", en: "Bentrokan pecah di Jakarta, polisi tembakkan gas" },
      ]),
    );
    expect(drop.has("markerless")).toBe(true);
    expect(drop.has("sibling")).toBe(true);
    expect(drop.has("domestic")).toBe(false);
  });

  it("does NOT drop a domestic accident anchored to an Indonesian place even under the widened matcher", () => {
    // Shares the full aviation signature AND the casualty count with the foreign
    // sibling, but the Medan anchor makes it a "local" row, never eligible for
    // clustering — dominance / no-fabrication preserved.
    const drop = foreignSyndicationDropIds(
      build([
        {
          id: "domestic",
          en: "Plane crash near Medan kills 11 in Indonesia",
        },
        {
          id: "foreign",
          en: "Plane crash in Missouri, US kills 11 parachutists and 1 pilot",
        },
      ]),
    );
    expect(drop.has("domestic")).toBe(false);
    expect(drop.size).toBe(0);
  });

  it("does NOT drop a marker-less row that shares only a single event-class word with the sibling", () => {
    // "Fire reported downtown" vs a foreign "Fire kills 20 in Dhaka" share only
    // the stemmed {fire} — one event-class token, no matching casualty number —
    // which is not a distinctive event signature, so the row is kept.
    const drop = foreignSyndicationDropIds(
      build([
        { id: "markerless", en: "Fire reported downtown overnight" },
        { id: "foreign", en: "Fire in Dhaka apartment tower leaves several dead" },
      ]),
    );
    expect(drop.has("markerless")).toBe(false);
  });

  it("returns an empty set when no rows are supplied", () => {
    expect(foreignSyndicationDropIds([]).size).toBe(0);
  });
});
