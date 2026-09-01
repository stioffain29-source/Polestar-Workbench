import {
  countPatternMatches,
  isForeignSubjectDominant,
} from "@workspace/country-engine";

describe("foreignSubject dominance helpers", () => {
  const FOREIGN = /\b(japan|tokyo|turkey|istanbul|yemen|houthi)\b/i;
  const LOCAL = /\b(indonesia|jakarta|surabaya|medan)\b/i;

  it("countPatternMatches counts each distinct match", () => {
    expect(countPatternMatches(FOREIGN, "Tokyo and Osaka in Japan")).toBe(2);
    expect(countPatternMatches(LOCAL, "Protes di Jakarta dan Surabaya")).toBe(2);
  });

  it("isForeignSubjectDominant drops only when foreign strictly wins", () => {
    expect(isForeignSubjectDominant(FOREIGN, LOCAL, "Japan earthquake hits Tokyo")).toBe(true);
    expect(
      isForeignSubjectDominant(
        FOREIGN,
        LOCAL,
        "Magnitude 6.2 earthquake strikes eastern Turkey, dozens injured",
      ),
    ).toBe(true);
    expect(
      isForeignSubjectDominant(
        FOREIGN,
        LOCAL,
        "Belasan Tentara Yaman Tewas dalam Bentrokan dengan Houthi di Dekat Hodeidah",
      ),
    ).toBe(true);
  });

  it("isForeignSubjectDominant keeps on a tie or local win", () => {
    expect(
      isForeignSubjectDominant(
        FOREIGN,
        LOCAL,
        "Chinese investor robbed at gunpoint in Surabaya hotel",
      ),
    ).toBe(false);
    expect(
      isForeignSubjectDominant(
        FOREIGN,
        LOCAL,
        "Japanese tourists from Tokyo stranded in Jakarta after storm",
      ),
    ).toBe(false);
  });

  it("isForeignSubjectDominant never fires without foreign cues", () => {
    expect(isForeignSubjectDominant(FOREIGN, LOCAL, "Protes pecah di kota")).toBe(false);
    expect(isForeignSubjectDominant(FOREIGN, LOCAL, "")).toBe(false);
    expect(isForeignSubjectDominant(FOREIGN, LOCAL, null)).toBe(false);
  });
});
