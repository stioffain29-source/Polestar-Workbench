// Regression pins for the conflict exclude stack, modelled on
// flashpointTitleExcludes.test.ts (task 449).
//
// The conflict topic layers three interacting gates in
// lib/relevance/src/topicRelevance.ts:
//   1. CONFLICT_HARD_EXCLUDE — op-ed / metaphor / homonym noise that runs
//      BEFORE the violence override (so a metaphorical "ambush" in a
//      think-piece can never re-admit it);
//   2. CONFLICT_EXCLUDE gated by CONFLICT_VIOLENCE_OVERRIDE — relief / peace /
//      diplomacy / governance noise that names a conflict actor word but
//      carries no live armed-violence signal (a real ambush/strike re-admits);
//   3. the conflict REQUIRED gate (actor words + kinetic verbs).
// Every fixture below is a real headline seen in the live incidents table
// (replay source: artifacts/workbench/scripts/auditLiveRelevance.ts and the
// stored relevance_reason column), pinning BOTH directions:
//   - DROP: noise classes that must never re-enter the feed;
//   - KEEP: live kinetic coverage that shares surface vocabulary with a noise
//     class (ambush, insurgent, shootout, talks, surrender-adjacent operations)
//     and must never be collaterally swallowed by a future regex tweak.
import { explainRelevance, type RelevanceInput } from "@workspace/relevance";

function verdict(title: string, summary = ""): { relevant: boolean; reason: string } {
  const input: RelevanceInput = { topic: "conflict", title, summary };
  return explainRelevance("conflict", input);
}

// [class label, headline] — every row must DROP.
const DROP_FIXTURES: Array<[string, string]> = [
  // ---- CONFLICT_HARD_EXCLUDE: op-ed / editorial labels ----
  ["trailing OpEd label", "Why Operation Shaban Matters For Security In Balochistan – OpEd"],
  ["trailing OpEd label 2", "Balochistan's Insurgency Enters A Dangerous New Phase – OpEd"],
  ["leading Opinion label", "Opinion | I Ran for President as an Insurgent. I Support the DNC's New Primary Calendar."],
  ["leading Explained label", "Explained: Why Is Myanmar's Junta Holding An Election During A Civil War"],
  ["leading Analysis label", "Analysis-China embraces Myanmar's president as former junta chief seeks legitimacy"],
  // ---- CONFLICT_HARD_EXCLUDE: political / abstract metaphor ----
  ["political ambush metaphor", "The Ambush Within Kashmir's Politics"],
  ["mango ambush metaphor", "Rataul: Legendary UP mango which battled Pakistan's ambush now facing survival crisis"],
  // ---- CONFLICT_HARD_EXCLUDE: retrospective how-explainer ----
  ["history-lesson explainer", "How ambush of church leaders on a forested road escalated Naga-Kuki conflict across Manipur hills"],
  // ---- CONFLICT_HARD_EXCLUDE: returnee / displacement status frame ----
  ["returnee obstacle frame", "Airstrike Threats Keep Displaced Residents from Returning to Ye Chaung Phyar"],
  // ---- CONFLICT_HARD_EXCLUDE: vehicle-trim / brand homonyms ----
  ["Ram Rebel trim", "2025 Ram Rebel vs. Ram RHO: What's the difference?"],
  ["Ram 1500 poll", "Poll: Ram 1500 Rebel or Ford F-150 Raptor?"],
  ["insurgent-brand marketing", "Insurgent Brands India: $7.5B Revenue, 4x Growth in 5 Years"],
  ["incumbent-insurgent jargon", "10 Takeaways from MMA IMPACT India: CMO-CFO Bridge, Incumbent-Insurgent Growth, AI Maturity & More"],
  ["D2C insurgent metaphor", "I can hurt, but I can't win: The reality of India's D2C insurgents"],
  // ---- CONFLICT_HARD_EXCLUDE: sport shootout / US domestic crime ----
  ["golf senior shootout", "Entries open for 2025 South Point Senior Shootout, Super Senior Shootout"],
  ["mass-shooting trial", "Sacramento mass shooting trial begins. Jurors to decide, shootout or self-defense?"],
  ["campus threat charge", "FGCU student charged with threat to conduct mass shooting or act of terrorism"],
  // ---- CONFLICT_HARD_EXCLUDE: factbox / encyclopedia facet list ----
  ["encyclopedia factbox", "March 23 Movement | Leader, Ideology, Peace Talks, Peace Agreements, Funding, Rebels, AFC, & Congo"],
  // ---- CONFLICT_HARD_EXCLUDE: animal shelter / arts review ----
  ["shelter pet named Rebel", "Shelter Me: Burlington County Animal Shelter's longest resident, Rebel, finally finds a home!"],
  ["theatre review colour", "Adapted social themes paint mature political landscape in 'A Rebel Prayer'"],
  // ---- CONFLICT_HARD_EXCLUDE: Canadian provincial separatism ----
  ["Alberta separatists", "Danielle Smith and the Alberta separatists gather in the UCP tent"],
  // ---- CONFLICT_EXCLUDE: peace / "insurgency-free" declarations ----
  ["Naxal-free declaration", "India is now Naxal-free: Amit Shah declares end of insurgency in Chhattisgarh"],
  ["insurgency-free milestone", "Provinces, municipalities under Eastmincom near insurgency-free"],
  // ---- CONFLICT_EXCLUDE: peace process / diplomacy ----
  ["junta proposes peace talks", "Myanmar junta chief proposes new peace talks with resistance groups"],
  ["envoy meets rebel groups", "Asean envoy meets Myanmar rebel groups in Thailand"],
  ["ex-insurgents preach peace", "Ex-insurgents denounce armed violence, willing to work for peace"],
  ["former insurgent reconciliation interview", "Coexistence is the only sustainable path for Manipur, says former insurgent leader RK Meghen"],
  // ---- CONFLICT_EXCLUDE: governance / legal / censorship ----
  ["court testimony process", "Testimony Of Police Officials Cannot Be Rejected Merely Due To Official Status, Especially In Naxal-Affected Areas: Chhattisgarh High Court"],
  ["insurgency film ban", "India's bans insurgency film Satluj claiming 'propaganda'"],
  ["film-block explainer", "Why is India blocking film on a man who counted Punjab insurgency killings?"],
  ["family release plea", "'They Are Poor, Innocent Peasants, Cattle Rearers, Please Release Them': Families Of Tribals Arrested In Naxal Cases Meet Chhattisgarh Deputy CM"],
  // ---- CONFLICT_EXCLUDE: capability assessment, not an attack ----
  ["covert-recruitment intelligence read", "Pakistan-Based Militant Groups Recruiting Women Through Covert Training, Indian Intelligence Says"],
  // ---- CONFLICT_EXCLUDE: no-contact search operation ----
  ["CCTV-cued search op", "Jammu Kashmir: Security Forces Launch Search Operation After CCTV Spots Suspected Militants"],
  // ---- CONFLICT_EXCLUDE: public-service restoration in ex-insurgency area ----
  ["schools reopen milestone", "Chhattisgarh's Bijapur reopens 37 schools in former Maoist strongholds after 21 years"],
];

// [class label, headline] — every row must KEEP. Each shares vocabulary with a
// DROP class above and pins that the exclude stack stays precision-bound (the
// violence override must keep re-admitting genuine kinetic events).
const KEEP_FIXTURES: Array<[string, string]> = [
  // Real ambushes — same "ambush" token as the metaphor/history excludes.
  ["militant ambush kills soldiers", "Two Assam Rifles soldiers killed, several injured in ambush by militants in Manipur"],
  ["ambush on convoy kills judge", "Suspected militants kill judge, security guard in ambush in restive southwest Pakistan - ABC News"],
  // Real strikes — same "airstrike" token as the returnee-status hard exclude.
  ["junta airstrike injures civilians", "Junta Airstrikes Injure 7 and Damage Resort near Ngapali Beach, AA Says"],
  // Real attacks naming actor words shared with peace/brand/marketing noise.
  ["suicide attack on check post", "15 security personnel killed, 12 militants dead in suicide attack on Pakistan check post"],
  ["militant attack toll", "Pakistan Says Death Toll From Militant Attacks in Southwest Rises to 42"],
  ["armed attack on rangers", "Five Thai Rangers Killed In Armed Attack In Narathiwat"],
  ["foiled suicide assault", "Security Forces Foil Suicide Attack on South Waziristan Check Post, Four Militants Killed"],
  ["suicide bombing", "Suicide Bomb Blast Kills 27 in Northwest Pakistan, TTP Claims Responsibility"],
  // Kinetic event during / despite diplomatic framing in the same story — the
  // violence override must beat the talks/diplomacy exclude.
  [
    "clashes despite peace-process backdrop",
    "Humanitarian crisis worsens as Myanmar junta commits daily atrocities amid armed clashes",
  ],
  // Insurgent-force analysis with a live armed-group kinetic frame — shares
  // "insurgent" with the brand-metaphor excludes.
  ["insurgent shooting of civilians", "Why Did TPNPB-OPM Shoot Three Civilians in Yahukimo?"],
  ["militant attack with curfew response", "Pakistan imposes partial curfew in northwestern district after militant attack"],
];

describe("conflict exclude stack (op-ed/metaphor + relief/peace regression pins)", () => {
  describe.each(DROP_FIXTURES)("DROP: %s", (_label, title) => {
    it(`drops: ${title}`, () => {
      const v = verdict(title);
      expect(v.relevant).toBe(false);
    });
  });

  describe.each(KEEP_FIXTURES)("KEEP: %s", (_label, title) => {
    it(`keeps: ${title}`, () => {
      const v = verdict(title);
      expect(v.relevant).toBe(true);
    });
  });

  it("hard excludes beat the violence override (metaphor with kinetic summary still drops)", () => {
    // A political-metaphor piece whose SUMMARY recounts real past violence must
    // still drop — CONFLICT_HARD_EXCLUDE runs before the override can rescue.
    const v = verdict(
      "The Ambush Within Kashmir's Politics",
      "The valley has seen militants attack convoys and airstrike responses over three decades.",
    );
    expect(v.relevant).toBe(false);
  });

  it("the violence override re-admits a relief story derailed by a real ambush", () => {
    // Relief/peace vocabulary + a genuine kinetic event: CONFLICT_EXCLUDE is
    // skipped when CONFLICT_VIOLENCE_OVERRIDE fires, so this must KEEP.
    const v = verdict(
      "Militants ambush relief convoy carrying aid for flood victims, three killed",
    );
    expect(v.relevant).toBe(true);
  });
});
