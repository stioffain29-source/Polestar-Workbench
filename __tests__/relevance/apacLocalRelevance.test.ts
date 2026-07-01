import { explainRelevance, type RelevanceInput } from "@workspace/relevance";
import { APAC_LOCAL_CONFIG, classifyNewsItem } from "@workspace/ingest";

// Locks in the `apac_local` (direct-outlet RSS) gates across BOTH stages:
//
//  1. The RELEVANCE gate (`explainRelevance`) — a broad local-coverage feed
//     across Indonesia + Jakarta, West Papua, the Philippines, Thailand and
//     Papua New Guinea. There is NO required incident vocabulary here — the
//     gate is purely geographic: keep any in-region local item, drop only a
//     story that POSITIVELY names a non-regional theatre with no APAC anchor.
//
//  2. The INGEST allow/deny gate (`classifyNewsItem` over `APAC_LOCAL_CONFIG`)
//     — substring-matches the RAW (Bahasa or English) title + summary against
//     the bilingual allow-list (protest, crime, terrorism, security, transport)
//     and rejects on the deny-list (sport, entertainment, markets). Direct
//     outlet feeds change format/vocab often, so these fixtures catch drift
//     (e.g. a sport/markets/entertainment leak, or a dropped incident cue) as
//     new stories arrive. See `lib/ingest/src/topicConfigs.ts` (APAC_LOCAL).

function build(
  overrides: Partial<RelevanceInput> & Pick<RelevanceInput, "title">,
): RelevanceInput {
  return { topic: "apac_local", summary: "", ...overrides };
}

function verdict(title: string) {
  const input = build({ title });
  return explainRelevance("apac_local", input);
}

// Run the REAL ingest allow/deny gate. A country match is not required for the
// allow/deny assertions, so most fixtures name an in-region place to keep them
// realistic; the geographic behaviour is asserted separately below.
function classify(title: string, summary = "") {
  return classifyNewsItem(APAC_LOCAL_CONFIG, title, summary);
}

describe("apac_local relevance (geographic gate)", () => {
  it("keeps an in-region Philippine protest", () => {
    expect(verdict("Thousands protest fuel price hike in Manila").relevant).toBe(true);
  });

  it("keeps an in-region Indonesian crime story", () => {
    expect(verdict("Police arrest robbery suspects in Jakarta").relevant).toBe(true);
  });

  it("keeps a West Papua security incident", () => {
    expect(verdict("Armed clash reported in Jayapura, Papua").relevant).toBe(true);
  });

  it("keeps a Papua New Guinea transport-disruption story", () => {
    expect(
      verdict("Highlands Highway blocked after landslide near Port Moresby").relevant,
    ).toBe(true);
  });

  it("drops foreign wire copy with no APAC anchor", () => {
    const r = verdict("Explosion rocks Tehran as Iran blames militants");
    expect(r.relevant).toBe(false);
    expect(r.reason).toMatch(/out-of-region/);
  });

  it("keeps a story that names both a foreign and an APAC theatre", () => {
    expect(verdict("US envoy meets officials in Manila over security ties").relevant).toBe(
      true,
    );
  });
});

describe("apac_local ingest allow/deny gate", () => {
  describe("keeps on-topic incidents (English + Bahasa)", () => {
    const kept: Array<[string, string]> = [
      // protest / civil unrest
      ["EN protest", "Thousands protest fuel price hike in Manila"],
      ["ID protest", "Demonstrasi mahasiswa tolak kebijakan baru di Jakarta"],
      ["ID labour strike", "Buruh mogok kerja di kawasan industri Bekasi"],
      // crime
      ["EN crime", "Police arrest robbery suspects in Cebu"],
      ["ID crime", "Penembakan warga terjadi di Jayapura"],
      // terrorism
      ["EN terrorism", "Abu Sayyaf militants stage bombing in Sulu"],
      ["ID terrorism", "Ledakan bom guncang kawasan di Jakarta"],
      // security incidents
      ["EN security", "Gunmen ambush security forces in Maguindanao"],
      ["ID security", "Baku tembak aparat keamanan di Papua"],
      // transport disruption
      ["EN transport", "Ferry capsizes off the coast near Bangkok"],
      ["ID transport", "Kapal tenggelam di perairan dekat Jakarta"],
    ];
    it.each(kept)("keeps %s", (_label, title) => {
      const c = classify(title);
      expect(c.kept).toBe(true);
      expect(c.reason).toMatch(/^allow:/);
    });
  });

  describe("drops off-topic leakage (English + Bahasa)", () => {
    const dropped: Array<[string, string]> = [
      // sport
      ["EN sport", "Philippines eye gold in SEA Games football final"],
      ["ID sport", "Timnas Indonesia menang di pertandingan sepak bola"],
      // entertainment / lifestyle
      ["EN entertainment", "Celebrity concert draws huge crowds in Manila"],
      ["ID entertainment", "Selebriti gelar konser besar di Jakarta"],
      // markets / finance
      ["EN markets", "Jakarta stock market rises on strong earnings"],
      ["ID markets", "Bursa saham Jakarta menguat pagi ini"],
    ];
    it.each(dropped)("drops %s", (_label, title) => {
      const c = classify(title);
      expect(c.kept).toBe(false);
    });
  });

  it("rejects a generic non-incident local story (no allowlist match)", () => {
    const c = classify("President opens new hospital in Jakarta");
    expect(c.kept).toBe(false);
    expect(c.reason).toBe("no-allowlist-match");
  });

  it("lets the deny-list win over an allow-list match (mixed story)", () => {
    // Contains the allow cue "riot" AND the deny cues "football" / "match";
    // deny is evaluated first, so a football-crowd story never leaks in.
    const c = classify("Fans riot after football match in Bangkok");
    expect(c.kept).toBe(false);
    expect(c.reason).toMatch(/^deny:/);
  });

  it("rejects an on-topic-worded but out-of-region story", () => {
    // Allow cue "explosion" matches, but the story names no APAC country and
    // positively names a foreign theatre the ingest gate knows (Egypt), so it
    // is dropped rather than blind-stamped onto the feed's default country.
    const c = classify("Explosion rocks Cairo as Egypt blames militants");
    expect(c.kept).toBe(false);
    expect(c.reason).toMatch(/out-of-region/);
  });
});
