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
];

// Genuine Indonesian security incidents — including one that names a foreign
// national but is anchored to an Indonesian city, which must be RETAINED.
const GENUINE = [
  "Bentrokan pecah di Jakarta, polisi tembakkan gas air mata",
  "Gempa guncang Sulawesi Tengah, puluhan rumah rusak di Palu",
  "Demonstrasi buruh di Surabaya menuntut kenaikan upah",
  "Chinese investor robbed at gunpoint in Surabaya hotel",
  "Bom meledak di gereja Makassar, beberapa orang terluka",
  "KKB serang pos di Papua",
];

describe("isForeignSubjectForIndonesia", () => {
  it.each(SLOP)("drops the foreign-subject record: %s", (text) => {
    expect(isForeignSubjectForIndonesia(text)).toBe(true);
  });

  it.each(GENUINE)("keeps the genuine Indonesian record: %s", (text) => {
    expect(isForeignSubjectForIndonesia(text)).toBe(false);
  });

  it("keeps a domestic story that names a foreign national (local anchor wins)", () => {
    expect(
      isForeignSubjectForIndonesia(
        "American tourist arrested in Bali drug bust",
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
