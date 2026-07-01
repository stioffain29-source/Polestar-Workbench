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
      // natural hazard (English + Bahasa)
      ["EN typhoon", "Typhoon batters northern Luzon, thousands evacuated"],
      ["EN earthquake", "Magnitude 6.2 earthquake jolts Davao region"],
      ["EN flood", "Flood submerges villages in central Thailand"],
      ["EN volcano", "Taal volcano eruption forces evacuations near Manila"],
      ["EN landslide", "Landslide buries homes in Baguio after heavy rain"],
      ["ID hazard flood", "Banjir bandang terjang permukiman di Sulawesi"],
      ["ID hazard quake", "Gempa bumi guncang wilayah dekat Jakarta"],
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

// Direct APAC outlets (esp. the Indonesian desks) increasingly write in informal
// slang and abbreviations rather than the formal bilingual vocabulary above.
// These fixtures lock that coverage so a future allow/deny edit cannot silently
// start dropping genuine slang-worded incidents — or leaking the "demo"
// product-demo homonym. See `lib/ingest/src/topicConfigs.ts` (APAC_LOCAL).
describe("apac_local ingest allow/deny gate — informal slang + abbreviations", () => {
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
      ["begal", "Korban begal motor luka parah di Manila"],
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

// apac_local also ingests Philippine (Inquirer / Rappler / GMA) and Thai
// (Bangkok Post / Khaosod English) outlets. Philippine English desks routinely
// code-switch into Tagalog slang ("rali", "welga", "barilan", "holdap"), and
// Thai outlets report incidents in English. These fixtures lock that coverage
// so a future allow/deny edit cannot silently start dropping genuine Tagalog-
// worded incidents — or leaking the "aust-rali-a" / "patay na baterya" homonym
// traps. See `lib/ingest/src/topicConfigs.ts` (APAC_LOCAL).
describe("apac_local ingest allow/deny gate — Tagalog + Thai wording", () => {
  describe("keeps genuine Tagalog-worded incidents", () => {
    const kept: Array<[string, string]> = [
      // protest / civil unrest
      ["rali", "Rali ng mga estudyante sa Manila laban sa pagtaas ng pamasahe"],
      ["rali laban", "Malaking rali laban sa reklamasyon sa Cebu"],
      ["welga", "Welga ng mga tsuper, paralisado ang biyahe sa Cebu"],
      // crime
      ["barilan", "Barilan sa palengke, dalawa patay sa Davao"],
      ["pamamaril", "Pamamaril sa Quezon City, isa ang sugatan"],
      ["nakawan", "Nakawan sa bahay sa Iloilo, milyon ang nawala"],
      ["holdap", "Holdap sa jeepney sa Manila, tatlong pasahero biktima"],
      ["saksak", "Saksakan sa bar sa Cebu, isa ang patay"],
      ["patayan", "Patayan sa Cotabato, apat ang tinamaan"],
      // security incidents
      ["pananambang", "Pananambang sa sundalo sa Basilan, dalawa ang patay"],
      // terrorism / blast
      ["pagsabog", "Pagsabog ng bomba sa Zamboanga, limang sugatan"],
      // transport disruption
      ["aksidente", "Aksidente sa highway sa Cebu, walong sugatan"],
      ["banggaan", "Banggaan ng bus at truck sa Baguio, tatlong patay"],
    ];
    it.each(kept)("keeps %s", (_label, title) => {
      const c = classify(title);
      expect(c.kept).toBe(true);
      expect(c.reason).toMatch(/^allow:/);
    });
  });

  describe("keeps Thai incidents (reported in English by Thai outlets)", () => {
    const kept: Array<[string, string]> = [
      ["Thai protest", "Anti-government protesters rally in Bangkok"],
      ["Thai deep-south shooting", "Gunmen open fire in Narathiwat, two rangers killed"],
      ["Thai deep-south bombing", "Roadside bomb blast wounds soldiers in Pattani"],
      ["Thai flood", "Flood inundates Chiang Mai as river bursts its banks"],
    ];
    it.each(kept)("keeps %s", (_label, title) => {
      const c = classify(title);
      expect(c.kept).toBe(true);
      expect(c.reason).toMatch(/^allow:/);
    });
  });

  describe("keeps Tagalog-worded natural-hazard incidents", () => {
    const kept: Array<[string, string]> = [
      ["bagyo", "Malakas na bagyo, libong pamilya inilikas sa Bicol"],
      ["lindol", "Magnitude 6 na lindol, naramdaman sa Davao"],
      ["pagbaha", "Malawakang pagbaha sa Marikina, daan-daan inilikas"],
      ["bumaha", "Bumaha sa maraming bahagi ng Maynila matapos ang bagyo"],
      ["bulkan", "Pagputok ng bulkan Taal, ipinag-utos ang paglikas"],
      ["pagguho", "Pagguho ng lupa, tinabunan ang mga bahay sa Baguio"],
    ];
    it.each(kept)("keeps %s", (_label, title) => {
      const c = classify(title);
      expect(c.kept).toBe(true);
      expect(c.reason).toMatch(/^allow:/);
    });
  });

  describe("does not false-match on the bare Tagalog flood substring 'baha'", () => {
    it("does not read 'bahay' (house) or 'Bahasa' as a flood", () => {
      // "baha" is deliberately NOT an allow token — only the bound verb/noun
      // forms are — so a house or language story falls through cleanly.
      expect(classify("Bagong bahay, ipinagmamalaki ng pamilya sa Cebu").kept).toBe(false);
      expect(classify("Kelas Bahasa Indonesia dibuka di universitas Jakarta").kept).toBe(false);
    });
  });

  describe("routes Tagalog / Thai homonym traps correctly", () => {
    it("does not leak an Australia (aust-RALI-a) non-incident story via 'rali'", () => {
      // "australia" contains the substring "rali"; the allow tokens are the
      // bound forms "rali ng" / "rali laban" / "rali kontra", so a plain
      // Australia trade story must fall through to no-allowlist-match.
      const c = classify("Australia to boost trade ties with Manila");
      expect(c.kept).toBe(false);
      expect(c.reason).toBe("no-allowlist-match");
    });

    it("does not read 'patay na baterya' (dead battery) as a killing", () => {
      // "patay" (=dead) is deliberately NOT an allow token; only the incident
      // forms "patayan" / "pagpatay" are, so a dead-battery story is dropped.
      const c = classify("Patay na baterya, dahilan ng pagkaantala ng biyahe sa Manila");
      expect(c.kept).toBe(false);
      expect(c.reason).toBe("no-allowlist-match");
    });

    it("does not read a Songkran water festival as an incident", () => {
      // Thai festival crowds are not an incident; no allow cue matches.
      const c = classify("Songkran water festival draws huge crowds in Bangkok");
      expect(c.kept).toBe(false);
      expect(c.reason).toBe("no-allowlist-match");
    });

    it("lets the deny-list win over a Tagalog crime cue in a sports story", () => {
      // "barilan" (shootout) as a basketball metaphor plus the deny cue
      // "basketball" — deny is evaluated first, so it never leaks in.
      const c = classify("Barilan ng tatlong-puntos sa basketball final sa Manila");
      expect(c.kept).toBe(false);
      expect(c.reason).toMatch(/^deny:/);
    });
  });
});
