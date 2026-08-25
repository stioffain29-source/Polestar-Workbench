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

describe("indonesia_local relevance (incident-first, then geographic scope)", () => {
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

  it.each([
    "Umat Muslim Jayawijaya Galang Dana Bantu Korban Gempa NTT di Momen Maulid Nabi Muhammad",
    "Umat Muslim Jayawijaya bantu korban gempa NTT",
    "Jayawijaya Muslims raise funds for NTT earthquake victims during Prophet Muhammad's birthday",
  ])("drops community fundraising coverage: %s", (title) => {
    const result = verdict(title);
    expect(result.relevant).toBe(false);
    expect(result.reason).toMatch(/fundraising|charity/);
  });

  it("keeps the underlying disaster incident rather than its charity aftermath", () => {
    expect(verdict("Gempa rusak ratusan rumah dan melukai warga di NTT").relevant).toBe(true);
  });

  it.each([
    "Umat Muslim Jayawijaya memperingati Maulid Nabi Muhammad",
    "Papua government distributes school aid to local students",
    "Biak airport hosts community preparedness seminar",
    "Tourism activity grows across Raja Ampat",
  ])("drops local general-news coverage with no operational incident: %s", (title) => {
    const result = verdict(title);
    expect(result.relevant).toBe(false);
    expect(result.reason).toMatch(/no approved operational incident family/);
  });

  it("does not let incident vocabulary in the summary rescue a non-incident headline", () => {
    const result = verdict(
      "Jayawijaya community marks religious holiday",
      "Residents later discussed assistance for earthquake victims.",
    );
    expect(result.relevant).toBe(false);
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

// Indonesian local outlets increasingly write in informal slang and
// abbreviations rather than the formal bilingual vocabulary above. These
// fixtures lock that coverage so a future allow/deny edit cannot silently start
// dropping genuine slang-worded incidents — or leaking the "demo" product-demo
// homonym. See `lib/ingest/src/topicConfigs.ts` (INDONESIA_LOCAL allow/deny).
describe("indonesia_local ingest allow/deny gate — informal slang + abbreviations", () => {
  describe("keeps genuine slang-worded incidents", () => {
    const kept: Array<[string, string]> = [
      // protest slang ("demo" bound to actor/verb, "unras" = unjuk rasa, brawl)
      ["demo mahasiswa", "Demo mahasiswa ricuh di depan gedung DPR Jakarta"],
      ["demo buruh", "Demo buruh tolak UU Cipta Kerja di Bekasi"],
      ["aksi demo", "Aksi demo warga tolak tambang di Sulawesi"],
      ["unras", "Unras tolak kenaikan BBM digelar di Makassar"],
      ["tawuran", "Tawuran antar kelompok pemuda pecah di Jakarta Timur"],
      // crime slang / abbreviations
      ["curanmor", "Pelaku curanmor ditangkap polisi di Surabaya"],
      ["geng motor", "Geng motor serang warga di Bandung"],
      ["begal", "Korban begal motor luka parah di Medan"],
      // security abbreviation (Papua)
      ["kkb", "KKB serang pos aparat di pedalaman Papua"],
      // transport abbreviation
      ["laka lantas", "Laka lantas maut di tol Cikampek tewaskan tiga orang"],
    ];
    it.each(kept)("keeps %s", (_label, title) => {
      const c = classify(title);
      expect(c.kept).toBe(true);
      expect(c.reason).toMatch(/^allow:/);
    });
  });

  describe("routes the 'demo' homonym correctly", () => {
    it("keeps a student demonstration ('demo mahasiswa')", () => {
      const c = classify("Demo mahasiswa tolak kebijakan baru di Jakarta");
      expect(c.kept).toBe(true);
      expect(c.reason).toMatch(/^allow:/);
    });

    it("drops a product demo ('demo produk')", () => {
      const c = classify("Demo produk gadget terbaru meriah di Jakarta");
      expect(c.kept).toBe(false);
      expect(c.reason).toMatch(/^deny:/);
    });

    it("drops a cooking demo ('demo masak' / 'demo memasak')", () => {
      expect(classify("Demo masak bareng chef selebriti di Jakarta").kept).toBe(false);
      expect(classify("Demo memasak ramaikan festival kuliner Bandung").kept).toBe(false);
    });

    it("does not false-match 'demo' inside 'demokrasi' / 'demografi'", () => {
      // Bare "demo" is deliberately NOT an allow token; these non-incident
      // stories must fall through to no-allowlist-match, not leak in.
      expect(classify("Diskusi soal demokrasi digelar di kampus Jakarta").kept).toBe(false);
      expect(classify("Seminar demografi penduduk Indonesia di Jakarta").kept).toBe(false);
    });
  });
});
