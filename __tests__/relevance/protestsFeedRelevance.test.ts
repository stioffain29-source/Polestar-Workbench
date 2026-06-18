import { explainRelevance, type RelevanceInput } from "@workspace/relevance";

// Fixture-based suite that locks in the Protests-feed relevance rules — the
// large, regex-heavy flashpoint gate that disambiguates the overloaded word
// "rally" (political vs market/crypto/currency/sports/motorsport), drops
// natural-disaster homonyms of "strike", and rejects awareness-drive rallies.
//
// The "Protests & Civil Unrest" monitor reads the live `flashpoint` data
// topic (see replit.md / topic-protests-vs-flashpoint memory), so every
// fixture is asserted against BOTH `flashpoint` and `protests`, which share
// the same gate in explainRelevance.

type Verdict = "KEEP" | "DROP";

interface Fixture {
  title: string;
  summary?: string;
  verdict: Verdict;
  // Optional substring the reason must contain, to lock in WHICH rule fired
  // (not just the keep/drop outcome).
  reason?: string | RegExp;
}

function build(
  overrides: Partial<RelevanceInput> & Pick<RelevanceInput, "topic" | "title">,
): RelevanceInput {
  return { summary: "", ...overrides };
}

const FIXTURES: Fixture[] = [
  // ---- Political rallies: KEEP ------------------------------------------
  {
    title: "Thousands rally against the government over fuel price hikes",
    verdict: "KEEP",
    reason: "political rally",
  },
  {
    title: "Opposition holds mass rally in capital demanding PM's resignation",
    verdict: "KEEP",
    reason: "political rally",
  },
  {
    title: "Anti-government rally turns out thousands in Dhaka",
    verdict: "KEEP",
    reason: "political rally",
  },
  {
    title: "Grand alliance rally behind opposition leader draws huge crowds",
    verdict: "KEEP",
    reason: "political rally",
  },
  {
    title: "11-Party Alliance grand rally fills the square",
    verdict: "KEEP",
    reason: "political rally",
  },
  {
    title: "Farmers rally to demand higher crop prices and debt relief",
    verdict: "KEEP",
    reason: "political rally",
  },
  // A "rally" with an explicit public-order companion takes the public-order
  // branch rather than the political-rally branch — still KEEP.
  {
    title: "Nationwide rally builds in capital",
    summary: "Trade union leaders detained by police",
    verdict: "KEEP",
    reason: "public-order cue",
  },
  // Unmistakable public-order headline (title-rescue) — KEEP.
  {
    title: "Workers stage a demonstration outside parliament",
    verdict: "KEEP",
    reason: "title-rescue",
  },

  // ---- Market / equity rallies: DROP -----------------------------------
  {
    title: "Stocks extend rally as markets surge",
    verdict: "DROP",
    reason: "homonym",
  },
  {
    title: "PSEi rebounds above 5,900 on Wall Street rally",
    verdict: "DROP",
    reason: "homonym",
  },
  {
    title: "Nokia's 140% rally turns AI comeback into valuation puzzle",
    verdict: "DROP",
    reason: "homonym",
  },

  // ---- Crypto rallies: DROP --------------------------------------------
  {
    title: "Bitcoin rally pushes crypto market to new highs",
    verdict: "DROP",
    reason: "homonym",
  },
  {
    title: "Ethereum's Iran rally fizzles after a volatile week",
    verdict: "DROP",
    reason: "homonym",
  },

  // ---- Currency / FX rallies: DROP -------------------------------------
  {
    title: "Ringgit rally gains against the dollar",
    verdict: "DROP",
    reason: "homonym",
  },
  {
    title: "Relief rally for the peso lifts regional currencies",
    verdict: "DROP",
    reason: "homonym",
  },

  // ---- Sports rallies: DROP --------------------------------------------
  {
    title: "Rays rally past Yankees in ninth inning",
    verdict: "DROP",
    reason: "homonym",
  },
  {
    title: "Late rally seals win for the home side",
    verdict: "DROP",
    reason: "homonym",
  },

  // ---- Motorsport rallies: DROP ----------------------------------------
  {
    title: "Rally Japan kicks off the WRC season",
    verdict: "DROP",
    reason: "homonym",
  },
  {
    title: "Taklimakan Rally 2026: GWM TANK dominates the unforgiving desert",
    verdict: "DROP",
    reason: "homonym",
  },

  // ---- Natural-disaster "strike" homonyms: DROP ------------------------
  {
    title: "Magnitude 6.6 quake strikes Mindanao",
    verdict: "DROP",
    reason: "homonym",
  },
  {
    title: "Lightning strike kills three farmers in field",
    verdict: "DROP",
    reason: "homonym",
  },
  {
    title: "Typhoon strikes coastal provinces, thousands flee",
    verdict: "DROP",
    reason: "homonym",
  },

  // ---- Awareness drives misusing "rally": DROP -------------------------
  {
    title: "Anti-dengue rally held to raise awareness in Manila",
    verdict: "DROP",
    reason: "without public-order cue",
  },
  {
    title: "Anti-tobacco rally organised by the health department",
    verdict: "DROP",
    reason: "without public-order cue",
  },

  // ---- Sports mega-event fan colour: DROP ------------------------------
  {
    title: "Hundreds protest Iran's 'regime team' ahead of World Cup opener",
    verdict: "DROP",
    reason: "homonym in headline",
  },
  {
    title: "Some wave protest flags, others cheer as Iran plays World Cup opener",
    verdict: "DROP",
    reason: "homonym in headline",
  },

  // ---- Metaphor / expressive "form of protest": DROP -------------------
  {
    title: "Returning to Bangladesh was form of protest: Zahed Ur Rahman",
    verdict: "DROP",
    reason: "non-civil-unrest",
  },
  {
    title: "Drag show performed in Manila street as form of protest",
    verdict: "DROP",
    reason: "non-civil-unrest",
  },

  // ---- Retrospective disciplinary aftermath of a dated protest: DROP ---
  {
    title: "Bangladesh university punishes staff over 2024 protest crackdown",
    verdict: "DROP",
    reason: "homonym in headline",
  },

  // ---- Diplomatic / bilateral-relations "protest": DROP ----------------
  {
    title: "Bilateral relations: envoy harassed in Delhi, strains and protest",
    verdict: "DROP",
    reason: "non-civil-unrest",
  },

  // ---- Symbolism / explainer think-piece: DROP -------------------------
  {
    title: "What does pink symbolize at the Women's Alliance protest in Jakarta?",
    verdict: "DROP",
    reason: "homonym in headline",
  },

  // ---- Editorially suppressed genuine protests (operator-removed): DROP -
  {
    title: "3 Demands Raised by Indonesian Women's Alliance in Jakarta Protest",
    verdict: "DROP",
    reason: "editorially suppressed",
  },
  {
    title: "Bandung Students Protest for Third Time; Here Are the Demands",
    verdict: "DROP",
    reason: "editorially suppressed",
  },
  {
    title: "Bangladesh halts construction of largest Lord Ram statue after radical groups protest",
    verdict: "DROP",
    reason: "editorially suppressed",
  },

  // ---- Genuine local protests must SURVIVE the new excludes: KEEP ------
  {
    title: "Thousands of students protest in Jakarta against new education fees",
    verdict: "KEEP",
    reason: "civil-unrest",
  },
  {
    title: "Jakarta students protest against costly programs, rising fuel prices",
    verdict: "KEEP",
    reason: "civil-unrest",
  },
  {
    title: "Workers stage a protest outside the labour ministry over unpaid wages",
    verdict: "KEEP",
    reason: "civil-unrest",
  },

  // ---- Figurative "roadblock" (obstacle metaphor): DROP ----------------
  // Bare "roadblock" is a REQUIRED protest tactic, so an obstacle-metaphor
  // headline leaks in unless caught. Dropped only when no real-unrest
  // companion is present.
  {
    title: "Starmer to meet Japan's Takaichi as fighter jet funding sputters",
    summary:
      "The Global Combat Air Programme has faced roadblocks including delays to Britain's financial contribution to the project.",
    verdict: "DROP",
    reason: "figurative 'roadblock'",
  },
  // A REAL road-block as a protest tactic, sitting next to a genuine-unrest
  // companion, must SURVIVE the figurative exclude: KEEP.
  {
    title: "Demonstrators set up roadblocks across the city in anti-government unrest",
    verdict: "KEEP",
  },
  // PNG soldiers' barracks roadblock (a genuine standoff) must SURVIVE: KEEP.
  {
    title: "PNG Defence Force Soldiers Maintain Demands After Murray Barracks Roadblock",
    verdict: "KEEP",
  },

  // ---- Cancelled / suspended industrial action (non-event): DROP -------
  {
    title: "Colombo Port workers call off strike",
    verdict: "DROP",
    reason: "cancelled/suspended industrial action",
  },
  {
    title: "Samsung workers' union suspends planned strike",
    verdict: "DROP",
    reason: "cancelled/suspended industrial action",
  },
  // A strike that CONTINUES / turns to protest must SURVIVE: KEEP.
  {
    title: "Bangladesh's primary teachers withdraw strike suspension, continue protest",
    verdict: "KEEP",
  },
  // A genuine long protest that has concluded is still real unrest: KEEP.
  {
    title: "105-day protest to save Sri Lanka's Mannar Island called off",
    verdict: "KEEP",
  },

  // ---- Off-topic news digest (protest is one bundled item): DROP -------
  {
    title: "CJP's first protest, India-Nepal ties, and Vizag steel plant accident",
    verdict: "DROP",
    reason: "news digest",
  },

  // ---- Scraped CMS/CSS markup dumped into the body: DROP ---------------
  {
    title: "India's top-heavy boom and the lesson for Bangladesh",
    summary:
      "Byline Tue, 05/05/2026 - 11:54 .full-viewport-wrapper img { width: 100%; object-fit: cover; max-height: calc(100vh - 71px); } Meanwhile protests erupted in Dhaka over the economy.",
    verdict: "DROP",
    reason: "general-news noise",
  },

  // ---- Travel/safety advisory to AVOID protest areas (non-event): DROP --
  {
    title: "Malaysians advised to avoid central Jakarta demonstration areas",
    verdict: "DROP",
    reason: "travel/safety advisory",
  },
  {
    title: "US, France to nationals in Metro Manila: Avoid Sept. 21 protest areas",
    verdict: "DROP",
    reason: "travel/safety advisory",
  },
  // A live demonstration that merely mentions a central/downtown AREA, with no
  // "avoid" instruction, must SURVIVE the advisory exclude: KEEP.
  {
    title: "Protesters clash with police in central Jakarta as thousands gather downtown",
    verdict: "KEEP",
  },

  // ---- Editorial LABEL leading the headline (commentary): DROP ---------
  {
    title: "Analysis: Nepal's protests are being closely watched in Vietnam",
    verdict: "DROP",
    reason: "editorial label",
  },
  {
    title: "[Opinion] Revisiting the first data center protest in Malaysia",
    verdict: "DROP",
    reason: "editorial label",
  },
  // A real protest whose headline happens to start with a place, not a label,
  // must SURVIVE: KEEP. ("Analysis" only fires as a leading label.)
  {
    title: "Forensic analysis confirms three protesters killed by live rounds in Dhaka",
    verdict: "KEEP",
  },

  // ---- Editorial FORMAT (listicle / gallery / explainer / think-piece) --
  {
    title: "Five things to know about Indonesia's deadly unrest",
    verdict: "DROP",
    reason: "editorial format",
  },
  {
    title: "Indonesia's anti-government protests – in pictures",
    verdict: "DROP",
    reason: "editorial format",
  },
  {
    title: "Bangladesh's protests explained: what led to PM's ouster and the challenges ahead",
    verdict: "DROP",
    reason: "editorial format",
  },
  {
    title: "What's next for Nepal after deadly protests force PM out?",
    verdict: "DROP",
    reason: "editorial format",
  },

  // ---- Protest aftermath / clean-up (non-event): DROP ------------------
  {
    title: "Military, police join cleaning workers to clean up streets after mass protest",
    verdict: "DROP",
    reason: "aftermath",
  },
  // Clean-up that is still LIVE (clashes continue) must SURVIVE: KEEP.
  {
    title: "Clashes continue as crews clear debris after another night of protest unrest",
    verdict: "KEEP",
  },

  // ---- Diplomatic / interstate formal "protest" (a note): DROP ---------
  {
    title: "Thailand lodges official landmine protest against Cambodia",
    verdict: "DROP",
    reason: "diplomatic/interstate",
  },

  // ---- Sports-governance protest (not civil unrest): DROP --------------
  {
    title: "Protest demands resignation of Sri Lanka Cricket Board",
    verdict: "DROP",
    reason: "sports-governance",
  },
  {
    title: "French Open players plan media protest over prize money share",
    verdict: "DROP",
    reason: "sports-governance",
  },

  // ---- Appeal for calm / restraint (preventive statement): DROP --------
  {
    title: "PNP calls for calm as Congress convenes special session",
    summary:
      "The Philippine National Police urged the public not to escalate political tensions amid the Senate leadership squabble as Congress convenes a special session.",
    verdict: "DROP",
    reason: "appeal for calm",
  },
  {
    title: "Election body urges restraint as political tensions rise",
    summary: "Officials appealed for calm; no incidents were reported.",
    verdict: "DROP",
    reason: "appeal for calm",
  },
  // A genuine event that ALSO mentions an appeal for calm must be KEPT.
  {
    title: "After deadly protests, Nepal's new prime minister urges calm",
    verdict: "KEEP",
  },
  {
    title: "Protesters clash with police as officials call for calm",
    verdict: "KEEP",
  },

  // ---- Overseas / diaspora venue (not APAC civil unrest): DROP ---------
  {
    title:
      "Bangladesh July Revolution leaders speak at Oxford Union as protesters clash outside",
    verdict: "DROP",
    reason: "overseas/diaspora venue",
  },
  {
    title: "British Tamils protest at Downing Street to condemn Sri Lanka's arrests",
    verdict: "DROP",
    reason: "overseas/diaspora venue",
  },

  // ---- Recruitment-industry complaint over a requirement: DROP --------
  {
    title: "Recruiters protest Saudi skills test requirement for Nepali workers",
    verdict: "DROP",
    reason: "recruitment-industry complaint",
  },
  // A real recruitment-agency STREET action must still be KEPT.
  {
    title: "Manpower agencies stage sit-in protest outside ministry over new rule",
    verdict: "KEEP",
  },
];

describe("Protests-feed relevance rules", () => {
  for (const topic of ["flashpoint", "protests"] as const) {
    describe(`topic: ${topic}`, () => {
      for (const fx of FIXTURES) {
        const label = `${fx.verdict}: ${fx.title}`;
        it(label, () => {
          const result = explainRelevance(
            topic,
            build({ topic, title: fx.title, summary: fx.summary }),
          );
          expect(result.relevant).toBe(fx.verdict === "KEEP");
          if (fx.reason !== undefined) {
            if (fx.reason instanceof RegExp) {
              expect(result.reason).toMatch(fx.reason);
            } else {
              expect(result.reason).toContain(fx.reason);
            }
          }
        });
      }
    });
  }
});
