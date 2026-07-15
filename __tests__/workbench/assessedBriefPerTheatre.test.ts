import {
  isForeignDominantContext,
  isForeignSubjectForIndonesia,
  isForeignSubjectNoHomeAnchor,
} from "../../artifacts/workbench/src/lib/countryMatch";

// LOCKSTEP per-theatre coverage of the assessed-brief foreign-country guard.
//
// The country/city briefs each strip a record whose headline is about a FOREIGN
// country when the record carries no home anchor, so an overseas story that was
// filed under this country only by a stray free-text tag never populates the
// brief. The GENERIC branch (Thailand / Philippines) does this via
// `isForeignSubjectNoHomeAnchor`; the four CURATED theatres — Papua New Guinea,
// Indonesian Papua (West Papua), Indonesia and Jakarta — use their OWN dedicated
// guards instead. Scattered suites cover each guard, but a regression in one
// curated guard could slip past. This suite pins ALL of them in one place, each
// exercising the SAME guard the theatre actually wires in `CountryReport.tsx`:
//   - PNG            -> isForeignDominantContext(title, fullText, country, name)
//   - West Papua     -> isForeignDominantContext(title, fullText, country, name)
//   - Indonesia      -> isForeignSubjectForIndonesia(englishText)
//   - Jakarta        -> isForeignSubjectForIndonesia(englishText)
//   - Generic (T/PH) -> isForeignSubjectNoHomeAnchor(title, displayTitle, loc, name)
//
// Each theatre proves BOTH directions: a foreign-subject headline with no home
// anchor is DROPPED, and a genuinely domestic headline is KEPT.

describe("assessed-brief foreign-country guard — per theatre (lockstep)", () => {
  // -----------------------------------------------------------------------
  // Papua New Guinea -> isForeignDominantContext
  // -----------------------------------------------------------------------
  describe("Papua New Guinea (isForeignDominantContext)", () => {
    const name = "Papua New Guinea";
    // A Myanmar/Thailand conflict story mis-filed under PNG (the geocoder city
    // substring "Lae" matched "Thicha Lae camp"). Saturated with foreign cues,
    // no strict PNG marker.
    const foreign =
      "Myanmar junta clashes with Karen fighters near Thai border as Thailand seals crossing";
    const foreignText = `${foreign} Fighting between the Myanmar military and Thai-based rebels intensified.`;

    it("drops a foreign-subject headline with no PNG home anchor", () => {
      expect(
        isForeignDominantContext(foreign, foreignText, "Papua New Guinea", name),
      ).toBe(true);
    });

    it("keeps a genuinely domestic PNG headline", () => {
      const local = "Chinese investor robbed at Lae market as Port Moresby police respond";
      const localText = `${local} RPNGC officers detained two suspects in Morobe.`;
      expect(
        isForeignDominantContext(local, localText, "Papua New Guinea", name),
      ).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Indonesian Papua / West Papua -> isForeignDominantContext
  // -----------------------------------------------------------------------
  describe("West Papua (isForeignDominantContext)", () => {
    const name = "Papua";
    const foreign =
      "India and Pakistan trade fire across Kashmir as China warns of escalation";
    const foreignText = `${foreign} Indian and Pakistani troops exchanged shelling overnight.`;

    it("drops a foreign-subject headline with no West Papua home anchor", () => {
      expect(
        isForeignDominantContext(foreign, foreignText, "Papua", name),
      ).toBe(true);
    });

    it("keeps a genuinely domestic West Papua headline", () => {
      const local = "TPNPB rebels attack security post in Nduga as Jayapura tightens patrols";
      const localText = `${local} Fighting continued in Wamena and Timika.`;
      expect(
        isForeignDominantContext(local, localText, "Papua", name),
      ).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Indonesia (national operating-risk brief) -> isForeignSubjectForIndonesia
  // -----------------------------------------------------------------------
  describe("Indonesia (isForeignSubjectForIndonesia)", () => {
    it("drops a foreign-subject headline with no Indonesian home anchor", () => {
      const en =
        "Powerful earthquake strikes Japan's Honshu near Tokyo, tsunami warning issued";
      expect(isForeignSubjectForIndonesia(en)).toBe(true);
    });

    it("keeps a genuinely domestic Indonesia headline (foreign national in passing)", () => {
      const en =
        "Japanese tourist robbed in Bali as Jakarta and Surabaya police tighten Indonesia patrols";
      expect(isForeignSubjectForIndonesia(en)).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Jakarta (capital brief) -> isForeignSubjectForIndonesia
  // -----------------------------------------------------------------------
  describe("Jakarta (isForeignSubjectForIndonesia)", () => {
    it("drops a foreign-subject headline with no Jakarta/Indonesia home anchor", () => {
      const en =
        "Riot erupts in New York after game as California and Texas brace for unrest";
      expect(isForeignSubjectForIndonesia(en)).toBe(true);
    });

    it("keeps a genuinely domestic Jakarta headline", () => {
      const en =
        "Protesters clash with police in Jakarta as Indonesia braces for more demonstrations";
      expect(isForeignSubjectForIndonesia(en)).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Generic branch (Thailand / Philippines) -> isForeignSubjectNoHomeAnchor
  // Re-pinned here so the lockstep suite covers every branch in one place.
  // -----------------------------------------------------------------------
  describe("Generic branch — Thailand (isForeignSubjectNoHomeAnchor)", () => {
    const name = "Thailand";
    it("drops a foreign-subject headline with no Thai home anchor", () => {
      expect(
        isForeignSubjectNoHomeAnchor(
          "US launches fresh Iran strikes as Washington warns Tehran",
          null,
          null,
          name,
        ),
      ).toBe(true);
    });

    it("keeps a genuinely domestic Thailand headline", () => {
      expect(
        isForeignSubjectNoHomeAnchor(
          "Bangkok protest turns violent as Thai police move in",
          null,
          null,
          name,
        ),
      ).toBe(false);
    });
  });

  describe("Generic branch — Philippines (isForeignSubjectNoHomeAnchor)", () => {
    const name = "Philippines";
    it("drops a foreign-subject headline with no Philippine home anchor", () => {
      expect(
        isForeignSubjectNoHomeAnchor(
          "China warns of response as Beijing rejects tribunal ruling",
          null,
          null,
          name,
        ),
      ).toBe(true);
    });

    it("keeps a genuinely domestic Philippines headline", () => {
      expect(
        isForeignSubjectNoHomeAnchor(
          "Manila floods displace thousands as Luzon storm intensifies",
          null,
          null,
          name,
        ),
      ).toBe(false);
    });
  });
});
