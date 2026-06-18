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
