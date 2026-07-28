// Regression pins for the shipping exclude stack, modelled on
// flashpointTitleExcludes.test.ts / conflictExcludes.test.ts / 
// cargoWatchExcludes.test.ts (tasks 449/451).
//
// The shipping topic layers two gates in lib/relevance/src/topicRelevance.ts:
//   1. SHIPPING_OFF_REGION gated by SHIPPING_THEATRE_RE — European /
//      Black-Baltic / UK-Channel maritime stories drop UNLESS the same story
//      also names a tracked Gulf/Asia chokepoint theatre (then it is kept);
//   2. SHIPPING_EXCLUDE — commerce homonyms (food-price commentary, vessel
//      sale-and-purchase / newbuild deals, Baltic Dry Index wires, navy
//      procurement) that must never lead the Confirmed Maritime Incidents
//      board even when a chokepoint is name-dropped (NOT theatre-suppressed).
// Every fixture below is a real headline seen in the live incidents table
// (stored relevance_reason column identifies the pattern that fired),
// pinning BOTH directions:
//   - DROP: commerce / off-region noise that must never re-enter the feed;
//   - KEEP: genuine chokepoint-theatre maritime-security coverage sharing
//     vessel-class / market vocabulary with a noise class that must never be
//     collaterally swallowed by a future regex tweak.
import { explainRelevance, type RelevanceInput } from "@workspace/relevance";

function verdict(title: string, summary = ""): { relevant: boolean; reason: string } {
  const input: RelevanceInput = { topic: "shipping", title, summary };
  return explainRelevance("shipping", input);
}

// [class label, headline] — every row must DROP.
const DROP_FIXTURES: Array<[string, string]> = [
  // ---- SHIPPING_OFF_REGION: Black Sea theatre (no tracked chokepoint) ----
  ["Black Sea tanker drone strike", "Sanctioned tanker hit in Ukrainian Black Sea drone attack"],
  ["Black Sea tanker strike 2", "Turkey-operated tanker carrying Russian oil struck by naval drone in Black Sea"],
  ["Black Sea security analysis", "Maritime Security and Safety in the Black Sea and Sea of Azov"],
  // ---- SHIPPING_OFF_REGION: UK / Baltic shadow-fleet enforcement ----
  ["UK shadow-fleet boarding", "UK to start boarding Russian shadow tankers after PM Starmer gives green light"],
  ["shadow-tanker captain charged", "Captain of shadow tanker seized by UK's Royal Navy charged with sanctions busting"],
  ["shadow-fleet Tate Modern", "Shadow fleet tanker seized by UK linked to Tate Modern sponsor"],
  // ---- SHIPPING_EXCLUDE: food-price / food-security commentary ----
  ["FAO food-price warning", "Strait of Hormuz closure may trigger 'severe' food price crisis: FAO"],
  ["WFP hunger warning", "WFP Warns Strait of Hormuz Closure Has Pushed Millions More into Hunger"],
  ["grain-price commentary", "Rice prices plummet 16% in eastern India amid Bangladesh's land port closure"],
  // ---- SHIPPING_EXCLUDE: airline jet-fuel cost stories ----
  // (real row fired on its summary's "jet fuel costs" phrase)
  ["airline fuel-cost warning", "Lufthansa Warns Strait of Hormuz Closure Will Add $2 Billion in Fuel Costs — airline says jet fuel costs will surge on longer routings"],
  // ---- SHIPPING_EXCLUDE: vessel sale-and-purchase / newbuild deals ----
  ["ageing suezmax sale", "Frontline cashes in on ageing suezmax pair"],
  ["suezmax disposal gain", "CMB.TECH pockets $29m gain from veteran suezmax disposal"],
  ["ageing suezmax deal", "Dynacom lands $65m for ageing suezmax"],
  ["newbuild return", "Ibaizabal heads back to suezmax newbuilds"],
  ["newbuild spree", "Costamare confirms boxship newbuild spree backed by COSCO"],
  // ---- SHIPPING_EXCLUDE: Baltic Dry Index freight-rate wires ----
  ["Baltic Dry Index wire", "Baltic Dry Index climbs to 2991 up 27 points"],
  ["Baltic Dry Index wire 2", "Baltic Dry Index Falls to Near 1-Week Low"],
  // ---- SHIPPING_EXCLUDE: navy mine-countermeasures procurement (NOT
  //      theatre-suppressed — a Hormuz name-drop does not rescue it) ----
  ["minehunting-drone capability PR", "Defender-Viper: Royal Navy's new minehunting drone helping to safeguard the Strait of Hormuz"],
];

// [class label, headline] — every row must KEEP. Each shares vessel-class /
// theatre / market vocabulary with a DROP class above and pins that both
// gates stay precision-bound.
const KEEP_FIXTURES: Array<[string, string]> = [
  // Tanker attack/mine incidents in a tracked theatre — same "tanker" token
  // as the sale-and-purchase and shadow-fleet excludes.
  ["Hormuz tanker mine explosion", "Oil tanker explodes in Strait of Hormuz after hitting naval mine, says Iran"],
  ["Hormuz tanker explosion", "Oil Tanker Ignores Iran's Warnings, Blown Up In Deadly Explosion Near Strait Of Hormuz"],
  ["Hormuz tanker interdiction", "'You are in range of my missiles': Iran orders tanker to stop Strait of Hormuz exit"],
  // Red Sea projectile incidents — tracked theatre, shares "tanker/vessel".
  ["Red Sea projectile near tanker", "Unidentified projectile lands near tanker in southern Red Sea: UKMTO"],
  ["projectile near vessel", "Unknown projectile lands near tanker in southern Red Sea"],
  // Off-region geography named ALONGSIDE a tracked theatre — the theatre
  // suppression must keep the comparative piece in-scope.
  [
    "comparative piece naming Hormuz + North Sea",
    "From the strait of Hormuz to the North Sea, a global maritime war rages around us – and more than the price of oil is at stake",
  ],
];

describe("shipping exclude stack (off-region gate + commerce-homonym regression pins)", () => {
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

  it("names the off-region rule in the drop reason", () => {
    const v = verdict("Sanctioned tanker hit in Ukrainian Black Sea drone attack");
    expect(v.relevant).toBe(false);
    expect(v.reason).toContain("shipping off-region");
  });

  it("names the off-topic rule in the commerce drop reason", () => {
    const v = verdict("Frontline cashes in on ageing suezmax pair");
    expect(v.relevant).toBe(false);
    expect(v.reason).toContain("shipping off-topic");
  });

  it("a tracked theatre suppresses the off-region gate (Black Sea + Hormuz keeps)", () => {
    // SHIPPING_OFF_REGION only fires when NO tracked theatre is named; a
    // story spanning both must stay in-scope.
    const v = verdict(
      "War Risk to Oil Supplies Grows With Red and Black Sea Disruptions",
      "Attacks on tankers in the Red Sea and Black Sea are reshaping war-risk premiums for vessels transiting the Strait of Hormuz.",
    );
    expect(v.relevant).toBe(true);
  });

  it("SHIPPING_EXCLUDE is NOT theatre-suppressed (Hormuz name-drop cannot rescue commerce noise)", () => {
    const v = verdict("Defender-Viper: Royal Navy's new minehunting drone helping to safeguard the Strait of Hormuz");
    expect(v.relevant).toBe(false);
    expect(v.reason).toContain("shipping off-topic");
  });
});
