import { isForeignSubjectForIndonesia } from "../../artifacts/workbench/src/lib/countryMatch";

// The `indonesia_local` topic is fed by Bahasa-first Indonesian outlets that
// also cover OVERSEAS events. The classifier files every record under
// country="Indonesia", so the Indonesia / Jakarta operating-risk brief would
// otherwise fill with foreign "slop". The foreign subject is only visible in
// the ENGLISH translation, so the guard is fed displayTitle + title + summary.
// It drops a record only when foreign-country cues OUTNUMBER Indonesian-place
// cues, so a domestic story that merely names a foreign national is retained.

// Foreign-subject records that flooded the live Indonesia/Jakarta brief.
const SLOP = [
  "Tactical analysis Japan vs Sweden: clash of styles in friendly",
  "Four Israeli soldiers injured in armed clash in southern Lebanon",
  "Magnitude 7.2 earthquake shakes northern Japan, injures eleven people",
  "Knicks victory celebration in New York turns into riot, dozens arrested",
  "Shooting in Montreal, Canada leaves three dead",
  "Strong earthquake hits Venezuela, buildings damaged in Caracas",
  "Wildfires spread across California as thousands evacuate",
  "Nepal protests turn violent in Kathmandu",
  // Foreign CITIES with no country word named — these previously leaked because
  // the guard listed countries/nationalities but no overseas city names.
  "Pilot killed and several injured in a plane crash near Beijing",
  "Building collapse in Saigon traps construction workers",
  "Deadly bus crash on a motorway outside Bangkok",
  // African outbreak/unrest syndicated under a domestic country tag: an Ebola
  // story about the Congo (DRC) that surfaced as a top EXTREME "protest" item.
  "Ebola cases in Congo reach 2,011 with 754 deaths as health workers strike",
  "Clashes in Kinshasa as DRC opposition rallies against the government",
  // Bahasa-first outlets syndicating FOREIGN accidents/disasters under a domestic
  // country tag: the France skydiving-plane crash, the Ubisoft founder killed in
  // that crash, a US (Missouri) crash and French wildfires. Detectable via the
  // translated display_title (foreign country or unambiguous foreign entity).
  "Ubisoft founder dies in plane crash",
  "One of Ubisoft's founders dies in plane crash",
  "Claude Guillemot, Ubisoft founder, dies in plane crash in France",
  "Plane crash kills founder-owner of Assassin's Creed",
  "12 people killed in plane crash in Missouri",
  "Plane crash in Missouri, US kills 11 parachutists and 1 pilot",
  "France hit by severe wildfires as 700 hectares burn during extreme weather",
  "11 killed in plane crash near Tomblaine, France on Sunday",
  // Bahasa-titled coverage of the YEMEN war under a domestic country tag, with no
  // English translation available. The English "yemen" was listed but the Bahasa
  // spelling "Yaman" and the theatre actor/port ("Houthi", "Hodeidah") were not,
  // so this Yemen story leaked into the Indonesia weekly and named "Yemeni
  // soldiers / Houthis near Hodeidah" — a credibility-destroying misclassification.
  "Belasan Tentara Yaman Tewas dalam Bentrokan dengan Houthi di Dekat Hodeidah",
  "Serangan Houthi di Laut Merah hantam kapal tanker dekat Hodeidah",
  "Yemeni forces clash with Houthis near Hodeidah, dozens killed",
];

// Two France-crash duplicates name NO country or foreign entity in any language
// ("Plane crash kills 11", "Photos of a plane crashing into a densely populated
// area"). They are indistinguishable from a domestic accident by content, so the
// guard deliberately does NOT drop them — inventing a foreign tag from zero
// evidence would breach the no-fabrication rule (cross-row event clustering,
// which is out of scope, would be needed to catch them).
const UNATTRIBUTABLE_KEPT = [
  "Plane crash kills 11",
  "Photos of a plane crashing vertically into a densely populated area, fatalities reported",
];

// Genuine Indonesian security incidents — including one that names a foreign
// national but is anchored to an Indonesian city, which must be RETAINED.
const GENUINE = [
  "Bentrokan pecah di Jakarta, polisi tembakkan gas air mata",
  "Gempa guncang Sulawesi Tengah, puluhan rumah rusak di Palu",
  "Demonstrasi buruh di Surabaya menuntut kenaikan upah",
  "Chinese investor robbed at gunpoint in Surabaya hotel",
  // A genuine Indonesian maritime accident (Labuan Bajo, Flores) that happens to
  // name a foreign victim's nationality — the local place anchors it, so KEEP.
  "Ship sinks in Labuan Bajo, Russian national among the victims",
  "Bom meledak di gereja Makassar, beberapa orang terluka",
  "KKB serang pos di Papua",
  // Names a foreign city in passing but is anchored to TWO Indonesian places, so
  // the local cue count dominates and the record is RETAINED.
  "Garuda flight from Jakarta to Tokyo diverted back to Surabaya",
  // A genuine Indonesian search-and-rescue operation (Banyuwangi, the state
  // airport operator Angkasa Pura) names no foreign country, so it is KEPT even
  // though its own city is not in the local-anchor list.
  "Banyuwangi SAR and Angkasa Pura strengthen search and rescue operation",
];

describe("isForeignSubjectForIndonesia", () => {
  it.each(SLOP)("drops the foreign-subject record: %s", (text) => {
    expect(isForeignSubjectForIndonesia(text)).toBe(true);
  });

  it.each(GENUINE)("keeps the genuine Indonesian record: %s", (text) => {
    expect(isForeignSubjectForIndonesia(text)).toBe(false);
  });

  it.each(UNATTRIBUTABLE_KEPT)(
    "keeps a marker-less record the guard cannot attribute (no-fabrication): %s",
    (text) => {
      expect(isForeignSubjectForIndonesia(text)).toBe(false);
    },
  );

  it("keeps a domestic story that names a foreign national (local anchor wins)", () => {
    expect(
      isForeignSubjectForIndonesia(
        "American tourist arrested in Bali drug bust",
      ),
    ).toBe(false);
  });

  it("keeps a domestic story that merely names the Houthi/Red Sea theatre (local anchor wins)", () => {
    expect(
      isForeignSubjectForIndonesia(
        "Kapal Indonesia hindari serangan Houthi, tiba dengan selamat di Jakarta",
      ),
    ).toBe(false);
  });

  it("drops a foreign story even when it names Indonesia, when foreign cues dominate", () => {
    expect(
      isForeignSubjectForIndonesia(
        "Japan earthquake: Tokyo and Osaka rocked as China and Korea send aid",
      ),
    ).toBe(true);
  });

  it("never fires when no foreign subject is present", () => {
    expect(isForeignSubjectForIndonesia("Protes pecah di kota")).toBe(false);
    expect(isForeignSubjectForIndonesia("")).toBe(false);
    expect(isForeignSubjectForIndonesia(null)).toBe(false);
    expect(isForeignSubjectForIndonesia(undefined)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Dominance boundary — the exact drop cutoff.
  // ---------------------------------------------------------------------------
  // The guard drops ONLY when foreign cues strictly OUTNUMBER local cues
  // (foreignCount > localCount). A tie is NOT dominance, so a domestic story
  // with a sparse local anchor is retained even against an equal foreign cue
  // count. These tests pin that boundary so a future refactor to `>=` (which
  // would silently drop real domestic incidents) fails loudly.

  it("keeps on an exact 1-vs-1 tie: one local anchor, one foreign nationality", () => {
    // foreign: "chinese" (1); local: "surabaya" (1) → tie → KEEP.
    expect(
      isForeignSubjectForIndonesia(
        "Chinese investor robbed at gunpoint in Surabaya hotel",
      ),
    ).toBe(false);
  });

  it("keeps on an exact 2-vs-2 tie", () => {
    // foreign: "japanese", "tokyo" (2); local: "jakarta", "bali" (2) → tie → KEEP.
    expect(
      isForeignSubjectForIndonesia(
        "Japanese tourists from Tokyo stranded in Jakarta and Bali after storm",
      ),
    ).toBe(false);
  });

  it("keeps when the local anchor wins by one (2 local vs 1 foreign)", () => {
    // foreign: "korean" (1); local: "medan", "aceh" (2) → local wins → KEEP.
    expect(
      isForeignSubjectForIndonesia(
        "Korean national detained in Medan smuggling case linked to Aceh port",
      ),
    ).toBe(false);
  });

  it("drops only when foreign wins by one (2 foreign vs 1 local)", () => {
    // foreign: "japan", "korea" (2); local: "jakarta" (1) → foreign wins → DROP.
    expect(
      isForeignSubjectForIndonesia(
        "Japan and Korea summit overshadows Jakarta trade talks",
      ),
    ).toBe(true);
  });

  it("keeps a single-local-anchor domestic story naming one foreign nationality", () => {
    // The core task edge: exactly ONE local anchor + ONE foreign nationality.
    // foreign: "australian" (1); local: "lombok" (1) → tie → KEEP.
    expect(
      isForeignSubjectForIndonesia(
        "Australian diver missing off Lombok after boat capsizes",
      ),
    ).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Gazetteer coverage — small regencies / cities absent from the old list, and
  // the Indonesian administrative / security-force fallback anchors.
  // ---------------------------------------------------------------------------
  // Previously the local-anchor gazetteer listed only major cities, so a genuine
  // domestic incident in a smaller regency that also named a foreign national was
  // silently dropped (foreign cue outnumbered zero local cues). These records
  // must now be RETAINED via the expanded city list or the Bahasa admin anchors.

  const NEWLY_COVERED_LOCAL = [
    // Named regencies/cities newly added to the gazetteer, each alongside a
    // foreign nationality that previously won the dominance test 1-vs-0.
    "Chinese worker injured in factory blast in Cilegon",
    "Japanese tourist robbed in Banyuwangi guesthouse",
    "Korean fishing crew detained off Sibolga",
    "American missionary questioned in Poso over permit dispute",
    "Australian surfer rescued near Sumbawa",
    // Administrative / security-force fallback: the dateline city (Dompu,
    // Ketapang, Sinjai, Enrekang) is NOT in the gazetteer, but the Bahasa admin
    // or police term anchors the record to Indonesia.
    "Polres Dompu tangkap warga negara asing terkait narkoba",
    "Bupati Ketapang temui investor asal Malaysia",
    "Kapolda gelar operasi di kecamatan terpencil, satu warga China diamankan",
    "Kodim bantu evakuasi korban banjir di kabupaten terdampak",
  ];

  it.each(NEWLY_COVERED_LOCAL)(
    "keeps a domestic story in a smaller/unlisted Indonesian location: %s",
    (text) => {
      expect(isForeignSubjectForIndonesia(text)).toBe(false);
    },
  );

  // ---------------------------------------------------------------------------
  // Foreign-dominant stories that name ONE Indonesian place in passing.
  // ---------------------------------------------------------------------------
  // With the local-anchor gazetteer now much larger, a foreign story that also
  // mentions a single Indonesian place in passing (e.g. aid dispatched FROM
  // Indonesia to a foreign disaster) must still be dropped: the foreign cues
  // outnumber the lone local anchor, so dominance still resolves to DROP. These
  // pin that direction so a widened gazetteer can never tip a clearly-foreign
  // story into being retained on the strength of one incidental Indonesian word.

  const FOREIGN_DOMINANT_WITH_ONE_LOCAL = [
    // Aid dispatched from Indonesia to a foreign disaster: 1 local vs many foreign.
    "Indonesia sends aid to earthquake victims in Beijing, Shanghai and Chengdu",
    "Jakarta pledges relief as Tokyo and Osaka reel from twin quakes in Japan",
    "Indonesian rescuers join search after building collapse in Manila and Cebu",
    // Foreign cities only (no country word) beating one Indonesian anchor.
    "Bandung team flies to Bangkok as floods swamp Chiang Mai and Phuket",
    "Surabaya envoy visits Saigon and Hanoi after deadly Vietnam storm",
  ];

  it.each(FOREIGN_DOMINANT_WITH_ONE_LOCAL)(
    "drops a foreign-dominant story that names one Indonesian place in passing: %s",
    (text) => {
      expect(isForeignSubjectForIndonesia(text)).toBe(true);
    },
  );

  // ---------------------------------------------------------------------------
  // Dominance boundary against the newly added admin / police anchors.
  // ---------------------------------------------------------------------------
  // The Bahasa administrative / security-force anchors (polres, kapolda, bupati,
  // kodim, ...) must count as EXACTLY ONE local cue each, no more. A single such
  // anchor therefore cannot rescue a foreign-dominant story, but it must still
  // hold a genuine domestic story on a tie. These pin both sides of that line so
  // the enlarged anchor set never over- or under-fires.

  it("drops a foreign-dominant story that happens to quote one Indonesian official/agency", () => {
    // foreign: tokyo, osaka, japan (3); local: kapolda (1) → foreign wins → DROP.
    expect(
      isForeignSubjectForIndonesia(
        "Kapolda comments as earthquake devastates Tokyo and Osaka in Japan",
      ),
    ).toBe(true);
  });

  it("keeps a domestic story anchored only by an admin term on a 1-vs-1 tie", () => {
    // foreign: chinese (1); local: polres (1) → tie → KEEP.
    expect(
      isForeignSubjectForIndonesia(
        "Polres tangkap warga negara China terkait kasus narkoba",
      ),
    ).toBe(false);
  });
});
