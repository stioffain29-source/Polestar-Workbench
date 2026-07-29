import { explainRelevance, hitsSlopExclude, type RelevanceInput } from "@workspace/relevance";

function input(overrides: Partial<RelevanceInput> & Pick<RelevanceInput, "topic" | "title">): RelevanceInput {
  return {
    summary: "",
    ...overrides,
  };
}

describe("explainRelevance", () => {
  describe("flashpoint", () => {
    it("rescues unmistakable protest headlines even when the summary mentions air strike", () => {
      const result = explainRelevance(
        "flashpoint",
        input({
          topic: "flashpoint",
          title: "Teachers protest abduction of colleague",
          summary: "Background mentions an air strike elsewhere",
        }),
      );
      expect(result.relevant).toBe(true);
      expect(result.reason).toMatch(/title-rescue|civil-unrest 'protest'/);
    });

    it("drops sports headlines that misuse the word protest", () => {
      const result = explainRelevance(
        "flashpoint",
        input({
          topic: "flashpoint",
          title: "Malaysia awarded takraw title after Thailand protest referee's call",
        }),
      );
      expect(result.relevant).toBe(false);
      expect(result.reason).toContain("homonym in headline");
    });

    it("drops market rally headlines without public-order context", () => {
      const result = explainRelevance(
        "flashpoint",
        input({
          topic: "flashpoint",
          title: "Stocks extend rally as markets surge",
        }),
      );
      expect(result.relevant).toBe(false);
      expect(result.reason).toMatch(/homonym|ambiguous token/);
    });

    it("keeps genuine protest records with unambiguous cues", () => {
      const result = explainRelevance(
        "flashpoint",
        input({
          topic: "flashpoint",
          title: "Thousands march in Dhaka over wage dispute",
          summary: "Police deploy tear gas as protesters clash with security forces",
        }),
      );
      expect(result.relevant).toBe(true);
      expect(result.reason).toMatch(/unambiguous|ambiguous token/);
    });

    it("drops think-piece / retrospective essays about past unrest", () => {
      const drops = [
        "Nepal’s Gen Z protests are a call for democratic renewal",
        "Nepal’s youth protests: A warning for South Asian democracies",
        "The questions emerging from Nepal’s Gen Z protests",
        "What Authoritarians May Learn About Censorship From Nepal’s Protests",
        "Nepal’s Protest-Fueled Transition",
        "Post-Protest Bangladesh: Restoration More than Renewal",
        "Who was Sharif Osman Hadi? The rise and killing of Bangladesh’s protest icon",
        "Can Nepal actually enforce its Human Rights Commission’s findings?",
      ];
      for (const title of drops) {
        const result = explainRelevance("flashpoint", input({ topic: "flashpoint", title }));
        expect(result.relevant).toBe(false);
        expect(result.reason).toContain("homonym in headline");
      }
    });

    it("drops commission/inquiry aftermath items (inquiry noun + procedural verb)", () => {
      const drops = [
        "Nepal commission submits September protest probe report",
        "Commission probing Nepal’s Gen Z protests submits report to PM Karki",
        "Inquiry commission seeks extra month to probe Nepal’s Gen Z protest crackdown",
        "Nepal probe finds security lapses during Gen-Z protest, submits report to interim PM",
        "University of Melbourne ‘sharply’ changed protest policies after pro-Palestine sit-ins, commission hears",
      ];
      for (const title of drops) {
        const result = explainRelevance("flashpoint", input({ topic: "flashpoint", title }));
        expect(result.relevant).toBe(false);
        expect(result.reason).toContain("homonym in headline");
      }
    });

    it("keeps live protests that merely mention a commission or report submission", () => {
      const keeps = [
        "Gen Z Alliance Protests in Kathmandu, Demands Release of Karki Commission Report and Revocation of Appointments",
        "Hindutva protest at Bangladesh High Commission over lynching of Hindu man",
        "Police clash with protesters near Bangladesh Deputy High Commission in Kolkata",
        "Protesters march to parliament and submit report to speaker over police crackdown",
        "Filipinos protest corruption on anniversary of Marcos's ouster",
        "Police Commissioner apologises to Muslim worshippers over actions at Sydney protest",
      ];
      for (const title of keeps) {
        const result = explainRelevance("flashpoint", input({ topic: "flashpoint", title }));
        expect(result.relevant).toBe(true);
      }
    });

    it("drops student crime stories that are not mobilisation", () => {
      const result = explainRelevance(
        "flashpoint",
        input({
          topic: "flashpoint",
          title: "Student raped near campus in provincial town",
        }),
      );
      expect(result.relevant).toBe(false);
      expect(result.reason).toContain("student non-mobilisation");
    });
  });

  describe("cargo_watch", () => {
    it("drops retail shoplifting noise", () => {
      const result = explainRelevance(
        "cargo_watch",
        input({
          topic: "cargo_watch",
          title: "Retail shoplifting wave hits stores nationwide",
          summary: "Cargo theft trends discussed in commentary",
        }),
      );
      expect(result.relevant).toBe(false);
      expect(result.reason).toContain("cargo off-topic");
    });

    it("keeps concrete hijack events", () => {
      const result = explainRelevance(
        "cargo_watch",
        input({
          topic: "cargo_watch",
          title: "Truck hijacked on Malaysia-Thailand route",
          summary: "Armed men seized container load at checkpoint",
        }),
      );
      expect(result.relevant).toBe(true);
      expect(result.reason).toContain("required topic phrase");
    });
  });

  describe("shipping", () => {
    it("drops vessel sale-and-purchase commentary", () => {
      const result = explainRelevance(
        "shipping",
        input({
          topic: "shipping",
          title: "Owner cashes in on ageing suezmax pair",
        }),
      );
      expect(result.relevant).toBe(false);
      expect(result.reason).toContain("shipping off-topic");
    });

    it("keeps maritime seizure incidents", () => {
      const result = explainRelevance(
        "shipping",
        input({
          topic: "shipping",
          title: "Tanker seized by naval forces in Gulf",
          summary: "Vessel boarded and diverted to port",
        }),
      );
      expect(result.relevant).toBe(true);
      expect(result.reason).toContain("required topic phrase");
    });
  });

  describe("fuel", () => {
    it("drops bank price-call commentary", () => {
      const result = explainRelevance(
        "fuel",
        input({
          topic: "fuel",
          title: "Goldman forecasts Brent crude to reach $120 per barrel",
        }),
      );
      expect(result.relevant).toBe(false);
      expect(result.reason).toContain("fuel off-topic");
    });
  });

  describe("conflict", () => {
    it("drops former-combatant humanitarian relief stories", () => {
      const result = explainRelevance(
        "conflict",
        input({
          topic: "conflict",
          title: "Ex-rebels help in relief operations for Mindanao quake victims",
          summary: "Former combatants joined aid groups distributing relief to earthquake victims.",
        }),
      );
      expect(result.relevant).toBe(false);
      expect(result.reason).toContain("relief/peace");
    });

    it("drops former-rebel reintegration/livelihood stories", () => {
      const result = explainRelevance(
        "conflict",
        input({
          topic: "conflict",
          title: "Former rebels turn to farming under reintegration program",
          summary: "Ex-combatants received livelihood support and started planting crops.",
        }),
      );
      expect(result.relevant).toBe(false);
      expect(result.reason).toContain("relief/peace");
    });

    it("keeps a relief convoy that is ambushed (violence override)", () => {
      const result = explainRelevance(
        "conflict",
        input({
          topic: "conflict",
          title: "Relief convoy ambushed while aiding earthquake victims",
          summary: "Gunmen opened fire on the aid trucks in a firefight.",
        }),
      );
      expect(result.relevant).toBe(true);
      expect(result.reason).toContain("required topic phrase");
    });

    it("keeps a peace process with former rebels that collapses after an ambush", () => {
      const result = explainRelevance(
        "conflict",
        input({
          topic: "conflict",
          title: "Peace process with former rebels collapses after ambush",
          summary: "An ambush on a patrol derailed the talks.",
        }),
      );
      expect(result.relevant).toBe(true);
      expect(result.reason).toContain("required topic phrase");
    });

    it("keeps genuine armed-clash incidents", () => {
      const result = explainRelevance(
        "conflict",
        input({
          topic: "conflict",
          title: "Rebels ambush army patrol, three soldiers killed",
          summary: "Insurgents opened fire in a gun battle, killing three soldiers.",
        }),
      );
      expect(result.relevant).toBe(true);
      expect(result.reason).toContain("required topic phrase");
    });

    it("keeps reversed-order state violence against civilians (casualty leads the actor)", () => {
      // The actor->casualty REQUIRED line only fires when the state force
      // PRECEDES the kill word; here the civilian casualty leads and the
      // military + operation trail it. Same unambiguous event, must be kept.
      const result = explainRelevance(
        "conflict",
        input({
          topic: "conflict",
          title: "Five civilians killed in Indonesian military operation at Kali Kabur gold panning area",
          summary: "A military sweep killed five civilian gold miners and injured a toddler; thousands fled.",
        }),
      );
      expect(result.relevant).toBe(true);
      expect(result.reason).toContain("required topic phrase");
    });

    it("drops a civilian road-accident toll with no armed actor or operation", () => {
      // Guards the reversed-order pattern: civilian + killed alone is not
      // enough — it requires a state military force AND an operation context.
      const result = explainRelevance(
        "conflict",
        input({
          topic: "conflict",
          title: "Five civilians killed in road accident on national highway",
          summary: "A bus crash killed five people travelling to a market town.",
        }),
      );
      expect(result.relevant).toBe(false);
    });

    it("drops sports penalty-shootout features (shootout homonym)", () => {
      const result = explainRelevance(
        "conflict",
        input({
          topic: "conflict",
          title: "Inside the nail-biting drama of the US-Sweden penalty shootout",
        }),
      );
      expect(result.relevant).toBe(false);
      expect(result.reason).toContain("general-news");
    });

    it("drops opinion letters that open with 'Dear Editor'", () => {
      const result = explainRelevance(
        "conflict",
        input({
          topic: "conflict",
          title: "Dear Editor: Shootout or assassination? Does the service serve the public?",
        }),
      );
      expect(result.relevant).toBe(false);
      expect(result.reason).toContain("general-news");
    });

    it("drops the NEET exam-centre access human-interest feature", () => {
      const result = explainRelevance(
        "conflict",
        input({
          topic: "conflict",
          title: "‘What if there’s an ambush?’: What’s it like getting to a NEET centre in Manipur?",
        }),
      );
      expect(result.relevant).toBe(false);
      expect(result.reason).toContain("general-news");
    });

    it("drops a diplomatic state-visit welcome with no kinetic event", () => {
      const result = explainRelevance(
        "conflict",
        input({
          topic: "conflict",
          title: "China rolled out an unprecedented welcome for Myanmar’s military leader this week",
          summary: "The reception came as his regime fights a nationwide rebellion.",
        }),
      );
      expect(result.relevant).toBe(false);
      expect(result.reason).toContain("relief/peace");
    });

    it("keeps a genuine NEET-exam-leak protest (narrowed exam exclude does not over-match)", () => {
      // The exam-logistics exclude must NOT eat a real protest about a NEET
      // paper leak — it only targets travel-to-centre framing.
      const result = explainRelevance(
        "protests",
        input({
          topic: "protests",
          title: "NEET UG 2026 paper leak: Youth Congress protests in Delhi; chief detained",
          summary: "Police detained the party chief as members marched over the exam paper leak.",
        }),
      );
      expect(result.relevant).toBe(true);
      expect(result.reason).not.toContain("excluded");
    });

    it("drops post-insurgency investment/business stories", () => {
      const result = explainRelevance(
        "conflict",
        input({
          topic: "conflict",
          title: "In first post-Naxal investment push, Chhattisgarh receives proposals worth Rs 9,580 crore",
        }),
      );
      expect(result.relevant).toBe(false);
      expect(result.reason).toContain("relief/peace");
    });

    it("drops diplomacy-to-prevent-spillover analysis", () => {
      const result = explainRelevance(
        "conflict",
        input({
          topic: "conflict",
          title: "Pakistan's U.S.-Iran Diplomacy Sought to Prevent a Militant Spillover",
        }),
      );
      expect(result.relevant).toBe(false);
      expect(result.reason).toContain("relief/peace");
    });

    it("drops a peace 'insurgency-free' declaration", () => {
      const result = explainRelevance(
        "conflict",
        input({
          topic: "conflict",
          title: "Calabarzon declared insurgency-free on Independence Day",
          summary:
            "The military said the region is now free of insurgency after years of operations.",
        }),
      );
      expect(result.relevant).toBe(false);
      expect(result.reason).toContain("relief/peace");
    });

    it("keeps a kinetic event despite insurgency-free framing (violence override)", () => {
      const result = explainRelevance(
        "conflict",
        input({
          topic: "conflict",
          title: "Province declared insurgency-free, but militants ambush an army patrol",
          summary:
            "Gunmen opened fire on soldiers in a firefight hours after the announcement.",
        }),
      );
      expect(result.relevant).toBe(true);
      expect(result.reason).toContain("required topic phrase");
    });

    it("does not treat a Maoist bounty (Rs 8 lakh) as an investment story", () => {
      // A bounty/reward in lakh/crore must NOT trip the economic-investment
      // exclude — that broad money wording is only off-topic when bound to an
      // explicit investment frame. Verdict aside, it must never be dropped by
      // the new relief/peace exclude.
      const result = explainRelevance(
        "conflict",
        input({
          topic: "conflict",
          title: "Chhattisgarh: Maoist with reward of Rs 8 lakh killed",
        }),
      );
      expect(result.reason).not.toContain("relief/peace");
    });

    it("keeps militant-violence reporting around talks (not pure diplomacy)", () => {
      const result = explainRelevance(
        "conflict",
        input({
          topic: "conflict",
          title: "Pakistan sees militant violence fall after China-mediated talks with Afghanistan",
        }),
      );
      expect(result.relevant).toBe(true);
      expect(result.reason).toContain("required topic phrase");
    });

    it("keeps an insurgent ceasefire declaration", () => {
      const result = explainRelevance(
        "conflict",
        input({
          topic: "conflict",
          title: "Philippine communist insurgents declare Christmas ceasefire",
        }),
      );
      expect(result.relevant).toBe(true);
      expect(result.reason).toContain("required topic phrase");
    });

    // Myanmar civil-war vocabulary the old India/Pakistan-centric gate missed.
    it("keeps a junta counteroffensive (offensive bound to an armed actor)", () => {
      const result = explainRelevance(
        "conflict",
        input({
          topic: "conflict",
          title:
            "Myanmar junta counteroffensive pushes Karenni resistance into a new phase of war",
        }),
      );
      expect(result.relevant).toBe(true);
      expect(result.reason).toContain("required topic phrase");
    });

    it("keeps 'fighting rages' headlines", () => {
      const result = explainRelevance(
        "conflict",
        input({
          topic: "conflict",
          title:
            "Junta escalates forced conscription in Kalay as local fighting rages",
        }),
      );
      expect(result.relevant).toBe(true);
      expect(result.reason).toContain("required topic phrase");
    });

    it("keeps land-mine casualty stories, including the plural", () => {
      const result = explainRelevance(
        "conflict",
        input({
          topic: "conflict",
          title: "A Family Ravaged by Land Mines in Myanmar",
        }),
      );
      expect(result.relevant).toBe(true);
      expect(result.reason).toContain("required topic phrase");
    });

    it("keeps junta air strikes (bare, plural)", () => {
      const result = explainRelevance(
        "conflict",
        input({
          topic: "conflict",
          title: "Junta air strikes hit a village in Sagaing region",
        }),
      );
      expect(result.relevant).toBe(true);
    });

    it("keeps heavy-shelling reports", () => {
      const result = explainRelevance(
        "conflict",
        input({
          topic: "conflict",
          title: "Heavy shelling reported across northern Rakhine",
        }),
      );
      expect(result.relevant).toBe(true);
    });

    it("keeps an actor-attack that kills civilians", () => {
      const result = explainRelevance(
        "conflict",
        input({
          topic: "conflict",
          title:
            "Myanmar junta attacks kill three civilians and trigger mass displacement in Okpho Township",
        }),
      );
      expect(result.relevant).toBe(true);
    });

    it("keeps 'air and drone strikes kill' headlines", () => {
      const result = explainRelevance(
        "conflict",
        input({
          topic: "conflict",
          title:
            "Myanmar junta air and drone strikes kill four civilians and destroy homes in Khin-U Township",
        }),
      );
      expect(result.relevant).toBe(true);
    });

    it("does not treat a junta state-visit / trade story as armed conflict", () => {
      const result = explainRelevance(
        "conflict",
        input({
          topic: "conflict",
          title:
            "Myanmar junta chief begins state visit to China to boost trade ties",
        }),
      );
      expect(result.relevant).toBe(false);
    });

    it("does not let the 'shelling out' idiom through", () => {
      const result = explainRelevance(
        "conflict",
        input({
          topic: "conflict",
          title: "Yangon firms shelling out millions for new office space",
        }),
      );
      expect(result.relevant).toBe(false);
    });

    it("does not treat a bare 'PDF' document as a resistance force", () => {
      const result = explainRelevance(
        "conflict",
        input({
          topic: "conflict",
          title: "PDF report shows Myanmar economy shrinking sharply",
        }),
      );
      expect(result.relevant).toBe(false);
    });

    it("drops a food/heritage metaphor that borrows a kinetic word", () => {
      const result = explainRelevance(
        "conflict",
        input({
          topic: "conflict",
          title:
            "Rataul: Legendary UP mango which battled Pakistan's ambush now facing survival crisis",
        }),
      );
      expect(result.relevant).toBe(false);
      expect(result.reason).toContain("op-ed/metaphor");
    });

    it("drops a retrospective 'How … escalated conflict' explainer", () => {
      const result = explainRelevance(
        "conflict",
        input({
          topic: "conflict",
          title:
            "How ambush of church leaders on a forested road escalated Naga-Kuki conflict across Manipur hills",
        }),
      );
      expect(result.relevant).toBe(false);
      expect(result.reason).toContain("op-ed/metaphor");
    });

    it("drops a returnee-displacement status story despite the airstrike word", () => {
      const result = explainRelevance(
        "conflict",
        input({
          topic: "conflict",
          title: "Airstrike Threats Keep Displaced Residents from Returning to Ye Chaung Phyar",
        }),
      );
      expect(result.relevant).toBe(false);
      expect(result.reason).toContain("op-ed/metaphor");
    });

    it("drops an envoy meeting rebel groups (diplomacy, not a kinetic event)", () => {
      const result = explainRelevance(
        "conflict",
        input({
          topic: "conflict",
          title: "Asean envoy meets Myanmar rebel groups in Thailand",
        }),
      );
      expect(result.relevant).toBe(false);
      expect(result.reason).toContain("relief/peace");
    });

    it("drops a family clemency plea over relatives arrested in Naxal cases", () => {
      const result = explainRelevance(
        "conflict",
        input({
          topic: "conflict",
          title:
            "'They Are Poor, Innocent Peasants, Please Release Them': Families Of Tribals Arrested In Naxal Cases Meet Chhattisgarh Deputy CM",
        }),
      );
      expect(result.relevant).toBe(false);
      expect(result.reason).toContain("relief/peace");
    });

    it("drops a reconciliation op-ed by a former insurgent", () => {
      const result = explainRelevance(
        "conflict",
        input({
          topic: "conflict",
          title:
            "Coexistence is the only sustainable path for Manipur, says former insurgent leader RK Meghen",
        }),
      );
      expect(result.relevant).toBe(false);
      expect(result.reason).toContain("relief/peace");
    });

    it("drops entertainment censorship of an insurgency film", () => {
      const result = explainRelevance(
        "conflict",
        input({
          topic: "conflict",
          title: "India's bans insurgency film Satluj claiming 'propaganda'",
        }),
      );
      expect(result.relevant).toBe(false);
      expect(result.reason).toContain("relief/peace");
    });

    it("drops a publisher-arrest book-censorship story", () => {
      const result = explainRelevance(
        "conflict",
        input({
          topic: "conflict",
          title: "3 publishers arrested in J-K for books that 'glorified separatists, militants'",
        }),
      );
      expect(result.relevant).toBe(false);
      expect(result.reason).toContain("relief/peace");
    });

    it("drops a precautionary cordon-and-search after CCTV spots suspects", () => {
      const result = explainRelevance(
        "conflict",
        input({
          topic: "conflict",
          title:
            "Jammu Kashmir: Security Forces Launch Search Operation After CCTV Spots Suspected Militants",
        }),
      );
      expect(result.relevant).toBe(false);
      expect(result.reason).toContain("relief/peace");
    });

    it("keeps a genuine search operation that reports an actual encounter", () => {
      // The precautionary cordon-and-search exclude is override-gated: a real
      // encounter with a kinetic verb must still be kept.
      const result = explainRelevance(
        "conflict",
        input({
          topic: "conflict",
          title: "Security forces launch search operation; two militants killed in ensuing gun battle",
        }),
      );
      expect(result.relevant).toBe(true);
      expect(result.reason).toContain("required topic phrase");
    });

    it("keeps a genuine ambush report near a mango-growing district", () => {
      // Guards the food-metaphor HARD exclude: a literal ambush is kept even
      // when produce is mentioned, because the metaphor pattern binds the two
      // within a short window and a real report separates them.
      const result = explainRelevance(
        "conflict",
        input({
          topic: "conflict",
          title: "Maoists ambush a security patrol, three troopers killed in Bastar",
          summary: "The convoy was attacked in a forested stretch during an anti-insurgency operation.",
        }),
      );
      expect(result.relevant).toBe(true);
      expect(result.reason).toContain("required topic phrase");
    });

    it("keeps a genuine search operation whose 'encounter underway' is the kinetic cue", () => {
      // The cordon-and-search exclude is override-gated; the violence override
      // must recognise the standard Indian term 'encounter underway' so a live
      // contact is re-admitted even without the words gunfight/gun battle.
      const result = explainRelevance(
        "conflict",
        input({
          topic: "conflict",
          title: "Search operation in Pulwama after suspected militants spotted; encounter underway",
        }),
      );
      expect(result.relevant).toBe(true);
      expect(result.reason).toContain("required topic phrase");
    });

    it("keeps an ammunition-magazine seizure from a terror hideout (book-censor no longer over-matches)", () => {
      // The book-censorship exclude dropped 'magazine' from its noun list so a
      // weapons-magazine recovery is never mistaken for a censored publication.
      const result = explainRelevance(
        "conflict",
        input({
          topic: "conflict",
          title: "Security forces seize weapons and magazines from militants in Pulwama",
        }),
      );
      expect(result.relevant).toBe(true);
      expect(result.reason).toContain("required topic phrase");
    });
  });

  describe("shipping", () => {
    // Freight-economics commerce homonyms must NOT pass the maritime-SECURITY
    // gate. These leaked in via the old "port congestion" / "freight rate"
    // admissions, which have been removed.
    it("drops global port congestion / shipping-rate commentary", () => {
      const result = explainRelevance(
        "shipping",
        input({
          topic: "shipping",
          title: "Global port congestion, high shipping rates to last into 2023",
        }),
      );
      expect(result.relevant).toBe(false);
    });

    it("drops container shipping-rate trend stories", () => {
      const result = explainRelevance(
        "shipping",
        input({
          topic: "shipping",
          title: "World container shipping rates keep rising amid port congestion",
        }),
      );
      expect(result.relevant).toBe(false);
    });

    it("drops shipping-cost surge stories", () => {
      const result = explainRelevance(
        "shipping",
        input({
          topic: "shipping",
          title: "Shipping Costs for a Container from China Surge 250% to $7,500",
        }),
      );
      expect(result.relevant).toBe(false);
    });

    it("drops congestion buried in the summary", () => {
      const result = explainRelevance(
        "shipping",
        input({
          topic: "shipping",
          title: "Quarterly logistics update",
          summary: "Port congestion worsens as container shipping rates climb",
        }),
      );
      expect(result.relevant).toBe(false);
    });

    // Genuine maritime-security events must STILL pass.
    it("keeps a vessel attack", () => {
      expect(
        explainRelevance(
          "shipping",
          input({ topic: "shipping", title: "Tanker attacked by drone in the Gulf of Oman" }),
        ).relevant,
      ).toBe(true);
    });

    it("keeps a port closure", () => {
      expect(
        explainRelevance(
          "shipping",
          input({ topic: "shipping", title: "Major port closure after explosion halts operations" }),
        ).relevant,
      ).toBe(true);
    });

    it("keeps armed robbery against a ship", () => {
      expect(
        explainRelevance(
          "shipping",
          input({ topic: "shipping", title: "Armed robbery against a ship in the Singapore Strait" }),
        ).relevant,
      ).toBe(true);
    });

    it("keeps a missile strike on a vessel", () => {
      expect(
        explainRelevance(
          "shipping",
          input({ topic: "shipping", title: "Houthi missile strike targets vessel in the Red Sea" }),
        ).relevant,
      ).toBe(true);
    });

    it("keeps route diversions", () => {
      expect(
        explainRelevance(
          "shipping",
          input({ topic: "shipping", title: "Ships reroute around Cape of Good Hope to avoid Red Sea" }),
        ).relevant,
      ).toBe(true);
    });

    it("keeps war-risk insurance for tankers", () => {
      expect(
        explainRelevance(
          "shipping",
          input({ topic: "shipping", title: "War risk premiums jump for tankers transiting Hormuz" }),
        ).relevant,
      ).toBe(true);
    });
  });
});

// Slop-only gate for externally-vouched (GDELT lane-coded) rows: runs the
// topic's noise EXCLUDE stages ONLY, never the REQUIRED allow gate, so a
// lane-vouched genuine event survives while a shared-vocabulary homonym /
// op-ed / metaphor is dropped.
describe("hitsSlopExclude", () => {
  describe("flashpoint", () => {
    it("keeps a lane-vouched public-order headline even when the body carries an ambiguous 'air strike' token", () => {
      // Regression lock: the title-rescue must front-run the body FLASHPOINT_EXCLUDE
      // homonym scan, or an anti-air-strike demonstration is wrongly demoted.
      const r = hitsSlopExclude(
        "flashpoint",
        input({
          topic: "flashpoint",
          title: "Thousands join demonstration against air strikes in Sanaa",
          summary: "An air strike on the district killed civilians, protesters said",
        }),
      );
      expect(r.relevant).toBe(true);
      expect(r.reason).toMatch(/title-rescue/);
    });

    it("drops a market-rally homonym with no public-order title cue", () => {
      const r = hitsSlopExclude(
        "flashpoint",
        input({ topic: "flashpoint", title: "Stocks extend rally as markets surge" }),
      );
      expect(r.relevant).toBe(false);
      expect(r.reason).toMatch(/slop: flashpoint/);
    });

    it("drops unambiguous title-noise (sports 'protest') outright", () => {
      const r = hitsSlopExclude(
        "flashpoint",
        input({
          topic: "flashpoint",
          title: "Malaysia awarded takraw title after Thailand protest referee's call",
        }),
      );
      expect(r.relevant).toBe(false);
      expect(r.reason).toMatch(/slop: flashpoint title noise/);
    });
  });

  describe("conflict", () => {
    it("drops a political metaphor op-ed ('minefield of coalition politics')", () => {
      const r = hitsSlopExclude(
        "conflict",
        input({
          topic: "conflict",
          title: "The minefield of coalition politics deepens after the vote",
        }),
      );
      expect(r.relevant).toBe(false);
      expect(r.reason).toMatch(/slop: conflict op-ed\/metaphor/);
    });

    it("keeps a real kinetic event even when it names a relief/peace context word (violence override)", () => {
      const r = hitsSlopExclude(
        "conflict",
        input({
          topic: "conflict",
          title: "Troops ambushed escorting relief convoy, three soldiers killed",
        }),
      );
      expect(r.relevant).toBe(true);
    });
  });

  it("returns relevant for a topic with no slop rule (keeps the lane verdict)", () => {
    const r = hitsSlopExclude(
      "shipping",
      input({ topic: "shipping", title: "Anything at all" }),
    );
    expect(r.relevant).toBe(true);
  });
});
