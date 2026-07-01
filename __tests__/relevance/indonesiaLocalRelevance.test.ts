import { explainRelevance, type RelevanceInput } from "@workspace/relevance";
import { INDONESIA_LOCAL_CONFIG, classifyNewsItem } from "@workspace/ingest";

// Locks in the `indonesia_local` (broad Google-News-edition RSS) gates across
// BOTH stages, mirroring the sibling `apac_local` fixture:
//
//  1. The RELEVANCE gate (`explainRelevance`) — a broad local-coverage feed for
//     the Indonesia + Jakarta country briefs. There is NO required incident
//     vocabulary here — the gate is purely geographic: keep any in-region local
//     item, drop only a story that POSITIVELY names a non-regional theatre with
//     no Indonesian anchor.
//
//  2. The INGEST allow/deny gate (`classifyNewsItem` over
//     `INDONESIA_LOCAL_CONFIG`) — substring-matches the RAW (Bahasa or English)
//     title + summary against the bilingual allow-list (unrest, crime, natural
//     hazard, fire, transport, government, labour, terrorism) and rejects on the
//     deny-list (sport, entertainment, markets). Broad edition feeds change
//     format/vocab often, so these fixtures catch drift (e.g. a sport / markets /
//     entertainment leak, or a dropped incident cue) as new stories arrive. See
//     `lib/ingest/src/topicConfigs.ts` (INDONESIA_LOCAL).

function build(
  overrides: Partial<RelevanceInput> & Pick<RelevanceInput, "title">,
): RelevanceInput {
  return { topic: "indonesia_local", summary: "", ...overrides };
}

function verdict(title: string) {
  const input = build({ title });
  return explainRelevance("indonesia_local", input);
}

// Run the REAL ingest allow/deny gate. A country match is not required for the
// allow/deny assertions, so most fixtures name an in-region place to keep them
// realistic; the geographic behaviour is asserted separately below.
function classify(title: string, summary = "") {
  return classifyNewsItem(INDONESIA_LOCAL_CONFIG, title, summary);
}

describe("indonesia_local relevance (geographic gate)", () => {
  it("keeps an in-region Indonesian protest", () => {
    expect(verdict("Ribuan buruh demonstrasi tolak upah minimum di Jakarta").relevant).toBe(
      true,
    );
  });

  it("keeps an in-region Indonesian crime story", () => {
    expect(verdict("Police arrest robbery suspects in Surabaya").relevant).toBe(true);
  });

  it("keeps a West Papua security incident", () => {
    expect(verdict("Armed clash reported in Jayapura, Papua").relevant).toBe(true);
  });

  it("keeps a hyperlocal natural-hazard story", () => {
    expect(verdict("Banjir rendam ratusan rumah di Makassar").relevant).toBe(true);
  });

  it("drops foreign wire copy with no Indonesian anchor", () => {
    const r = verdict("Explosion rocks Tehran as Iran blames militants");
    expect(r.relevant).toBe(false);
    expect(r.reason).toMatch(/out-of-region/);
  });

  it("keeps a story that names both a foreign and an Indonesian theatre", () => {
    expect(verdict("Indonesia condemns Gaza strike, holds solidarity rally in Jakarta").relevant).toBe(
      true,
    );
  });
});

describe("indonesia_local ingest allow/deny gate", () => {
  describe("keeps on-topic incidents (English + Bahasa)", () => {
    const kept: Array<[string, string]> = [
      // unrest / protest
      ["EN protest", "Thousands protest fuel price hike in Jakarta"],
      ["ID protest", "Demonstrasi mahasiswa tolak kebijakan baru di Jakarta"],
      // crime
      ["EN crime", "Police arrest robbery suspects in Surabaya"],
      ["ID crime", "Penembakan warga terjadi di Jayapura"],
      // natural hazard / fire
      ["EN hazard", "Landslide buries homes in Central Java"],
      ["ID hazard", "Banjir bandang terjang kawasan Sumatera Barat"],
      ["EN fire", "Massive blaze destroys market in Bandung"],
      ["ID fire", "Kebakaran hebat melanda pasar di Medan"],
      // transport disruption
      ["EN transport", "Ferry capsizes off the coast near Makassar"],
      ["ID transport", "Kapal tenggelam di perairan dekat Ambon"],
      // government stability
      ["EN government", "Minister faces impeachment over corruption scandal"],
      ["ID government", "Kasus korupsi seret pejabat daerah di Jakarta"],
      // labour
      ["EN labour", "Factory workers stage walkout over minimum wage"],
      ["ID labour", "Buruh mogok kerja di kawasan industri Bekasi"],
      // terrorism
      ["EN terrorism", "Suicide bomb blast rocks police station in Surabaya"],
      ["ID terrorism", "Ledakan bom guncang kawasan di Jakarta"],
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
      ["EN sport", "Timnas eye gold in SEA Games football final"],
      ["ID sport", "Timnas Indonesia menang di pertandingan sepak bola"],
      // entertainment / lifestyle
      ["EN entertainment", "Celebrity concert draws huge crowds in Jakarta"],
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
    // Contains the allow cue "kerusuhan" (riot) AND the deny cues "sepak bola" /
    // "pertandingan"; deny is evaluated first, so a football-crowd story never
    // leaks in.
    const c = classify("Kerusuhan usai pertandingan sepak bola di Jakarta");
    expect(c.kept).toBe(false);
    expect(c.reason).toMatch(/^deny:/);
  });

  it("rejects an on-topic-worded but out-of-region story", () => {
    // Allow cue "explosion" matches, but the story names no Indonesian place and
    // positively names a foreign theatre the ingest gate knows (Egypt), so it is
    // dropped rather than blind-stamped onto the feed's default country.
    const c = classify("Explosion rocks Cairo as Egypt blames militants");
    expect(c.kept).toBe(false);
    expect(c.reason).toMatch(/out-of-region/);
  });
});
