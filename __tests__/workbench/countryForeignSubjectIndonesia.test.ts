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
});
