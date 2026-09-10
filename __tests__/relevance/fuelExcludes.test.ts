// Regression pins for the fuel exclude stack (FUEL_EXCLUDE), modelled on
// flashpointTitleExcludes.test.ts / conflictExcludes.test.ts / 
// cargoWatchExcludes.test.ts (tasks 449/451).
//
// FUEL_EXCLUDE in lib/relevance/src/topicRelevance.ts drops pure market
// commentary that mentions oil/fuel but carries no operational signal:
//   - equity / earnings / investor framing;
//   - futures / speculation / hedge-fund wires;
//   - bank & research-house price-call commentary ("Citi forecasts Brent…");
//   - "petrol/diesel prices today" live-blog tickers;
//   - EV demand-shift stories; PR/booster applause; travel-advisory SEO spam.
// Every fixture below is a real headline seen in the live incidents table
// (stored relevance_reason column identifies the pattern that fired),
// pinning BOTH directions:
//   - DROP: market-noise classes that must never re-enter the feed;
//   - KEEP: genuine fuel-operational coverage that shares price/market
//     vocabulary with a noise class and must never be collaterally swallowed
//     by a future regex tweak.
import {
  explainRelevance,
  RELEVANCE_RULE_VERSION,
  type RelevanceInput,
} from "@workspace/relevance";

function verdict(title: string, summary = ""): { relevant: boolean; reason: string } {
  const input: RelevanceInput = { topic: "fuel", title, summary };
  return explainRelevance("fuel", input);
}

// [class label, headline] — every row must DROP.
const DROP_FIXTURES: Array<[string, string]> = [
  // ---- futures / speculation wires (real ops backdrop does NOT rescue) ----
  ["crude futures wire", "Crude futures fall on new Iran proposal for peace talks"],
  ["futures surge wire", "WTI crude oil futures surged about 3% to $105 per barrel on Monday as tensions in the Middle East escalated"],
  ["investor-doubt price wire", "Oil prices rise as investors doubt breakthrough in US-Iran peace talks"],
  // ---- equity / earnings / investor framing ----
  ["share-price slide", "Oil major's share price slides after quarterly results disappoint"],
  ["earnings framing", "Refiner posts record earnings as crude spread widens"],
  // ---- bank / research-house price-call commentary ----
  ["bank Brent price call", "Citi forecasts Brent crude to reach $120 per barrel"],
  ["research-house call", "Goldman Sachs sees oil prices climbing above $100 per barrel next quarter"],
  ["generic forecast-to-hit", "Analysts say bank forecasts crude to hit $95 per barrel by December"],
  // ---- "prices today" live-blog tickers ----
  ["petrol prices today ticker", "Petrol, diesel prices today: How much does fuel cost in Delhi, Mumbai, Kolkata, Bengaluru on 8 May"],
  ["rates today ticker", "Petrol, diesel prices today, 21 May: Check fuel rates in Delhi, Mumbai, Bengaluru remain steady across Indian cities"],
  // ---- catch-all classifier bucket ----
  ["other-fuel-incident bucket", "Other fuel incident"],
  // ---- EV / demand-shift commentary ----
  ["EV sales surge", "IEA: Oil Shock Sparks Surge in EV Sales"],
  // ---- PR / booster applause ----
  ["subsidy-leadership applause", "PNG CORE applauds PM Marape's leadership on fuel subsidy and industry dialogue"],
  // ---- consumer travel-advisory SEO comma-spam ----
  [
    "travel-advisory SEO spam",
    "Travelers Warned: Visa & Mastercard Banned — Sunwing & WestJet Suspend Flights, Jet Fuel Crisis, Emergency Travel Tips Inside",
  ],
];

// [class label, headline] — every row must KEEP. Each shares price/market
// vocabulary with a DROP class above and pins that FUEL_EXCLUDE stays
// precision-bound to commentary, never operational disruption.
const KEEP_FIXTURES: Array<[string, string]> = [
  // Refinery strikes / fires — operational core, shares "fuel crisis" tone.
  ["refinery drone strikes", "Drone Strikes Hit Oil Refineries in Bashkortostan and Krasnodar, Worsening Russia's Fuel Shortage"],
  ["refinery ablaze", "Oil refinery ablaze in Cuba as fuel crisis deepens"],
  ["refinery-repair shortage", "Russia Faces Temporary Fuel Shortage Amid Refinery Repairs"],
  ["deputy-PM shortage admission", "Russian deputy PM acknowledges fuel shortage after refinery strikes"],
  // Government price actions — share price vocabulary with the ticker excludes
  // but are operational policy moves, not live-blog tickers.
  ["government price cut", "Govt cuts petrol price by Rs6/Litre, HSD by Rs6.80 ahead of Eid ul Adha"],
  ["war-driven price hike", "Pakistan hikes petrol, diesel prices due to Middle East war"],
  ["repeat pump-price hike", "Third fuel price hike in 2 weeks: Petrol price raised by 87 paise, diesel by 91 paise"],
  // Pump prices tied to a named disruption — shares "prices" with the tickers.
  ["pump prices on outage", "US Pump Prices Near 4-Year High on Iran War Disruption, Refinery Outages"],
  // Margins/market movement caused by a physical shortage — the market words
  // must not swallow the operational shortage story.
  ["jet-fuel route cuts", "Thai AirAsia cuts more summer routes as jet fuel prices surge"],
  ["Aramco producer-central output", "Saudi Aramco announces output increase to stabilise supply"],
  ["Air India fuel-cost operations", "Air India warns of operational impact as fuel costs rise"],
];

describe("fuel exclude stack (market-commentary regression pins)", () => {
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

  it("names the fuel off-topic rule in the drop reason", () => {
    const v = verdict("Citi forecasts Brent crude to reach $120 per barrel");
    expect(v.relevant).toBe(false);
    expect(v.reason).toContain("fuel off-topic");
  });

  it("a speculation token in the SUMMARY drops a headline even with an ops word", () => {
    // FUEL_EXCLUDE runs on the full haystack (title + summary) BEFORE the
    // required gate, so market-wire summaries poison otherwise-ambiguous rows.
    const v = verdict(
      "Oil jumps as tensions rise near Strait of Hormuz",
      "Hedge fund speculators piled into crude futures contracts on Monday.",
    );
    expect(v.relevant).toBe(false);
  });
});

describe("Fuel Watch consequence and physical-geography gate", () => {
  it.each([
    "Oil tankers transit the Strait of Hormuz",
    "Refinery sector update from industry leaders",
    "Energy company issues statement on regional tensions",
    "OPEC and IEA disagree over the oil demand outlook",
    "ADNOC issues a statement about its facilities",
  ])("drops a bare fuel-sector subject cue: %s", (title) => {
    const v = verdict(title);
    expect(v.relevant).toBe(false);
    expect(v.reason).toContain("without demonstrable operational fuel consequence");
  });

  it("does not infer relevance or physical event geography from publisher metadata", () => {
    const v = explainRelevance("fuel", {
      topic: "fuel",
      title: "Company publishes its annual sustainability review - Hormuz Energy",
      summary: "The review describes corporate governance priorities. Hormuz Energy",
      source: "Hormuz Energy (Fuel)",
      sourceUrl: "https://oil-refinery.example/iran/tanker",
      location: "Strait of Hormuz",
      country: "Iran",
    });
    expect(v.relevant).toBe(false);
    expect(v.reason).toContain("without demonstrable operational fuel consequence");
  });

  it("does not treat an actor or reporting-origin country as event geography", () => {
    const v = explainRelevance("fuel", {
      topic: "fuel",
      title: "National minister comments on oil tankers in Hormuz",
      summary: "The minister discussed energy security at a conference.",
      source: "National Daily",
      location: "Capital City",
      country: "Pakistan",
    });
    expect(v.relevant).toBe(false);
  });

  it.each([
    "Storm damage halted diesel deliveries to regional fuel stations",
    "Pipeline outage cut crude supply and forced refinery output lower",
    "Tanker traffic resumed after the channel reopened",
    "Government raised petrol prices after removing the fuel subsidy",
    "Government cuts windfall tax on exports of petrol, diesel and aviation fuel",
    "Trading partners sign a diesel supply pact covering the entire import requirement",
    "Aviation fuel exports jump after loading restrictions ease",
    "Jet fuel prices soar as regional inventories tighten",
    "Regional carriers reel from a 121% jet fuel surge",
    "Jet fuel rates up after the regulator approved a new schedule",
    "Higher aviation fuel costs push airfares up and constrain airline operations",
    "Easing jet fuel costs allow the carrier to restore suspended routes",
    "Oil exports stall after a blockade closes the loading channel",
    "Oil exports surge after the blockade is lifted",
    "Refining bottlenecks push diesel prices higher",
  ])("keeps generalized operational consequences without named geographies: %s", (title) => {
    expect(verdict(title).relevant).toBe(true);
  });

  it.each([
    "Electric aviation could reshape regional travel over the long term",
    "Sustainable aviation fuel may reach cost parity by 2036, report says",
    "Petrol and diesel prices today: check rates in major cities",
    "Oil exports fall under threat as regional tensions rise",
  ])("keeps non-operational future/ticker noise out: %s", (title) => {
    expect(verdict(title).relevant).toBe(false);
  });

  it("bumps the persisted fuel relevance rules for backfill", () => {
    expect(RELEVANCE_RULE_VERSION).toBe("2026-09-10.1");
  });
});

// ---------------------------------------------------------------------------
// Fuel coverage classes added Aug 2026 (Bangladesh Jet A-1 hike + Pakistan
// fuel-pricing transport/pump strikes). Pins the new REQUIRED.fuel patterns
// both ways: the missed-story classes must KEEP, and neighbouring market
// chatter / generic commuter strikes must still DROP.
describe("fuel coverage: aviation price action + fuel-linked transport strikes (Aug 2026)", () => {
  const KEEP: Array<[string, string, string?]> = [
    ["Jet A-1 regulator hike", "Energy regulator hikes the price of Jet A-1 fuel by over 21%"],
    ["jet fuel price hiked", "Jet fuel price hiked by over 21%"],
    ["goods-transport strike over fuel pricing", "Nationwide goods-transport strike halts freight services", "Transporters press unresolved demands over daily fuel pricing and diesel and cargo-transport taxes."],
    ["oil transporters strike (actor is fuel-haulage)", "Goods, oil transporters strike continues"],
    ["petroleum dealers pump closure", "Petroleum dealers announce closure of pumps nationwide from Aug 15"],
    ["petrol pumps nationwide close", "Petrol pumps nationwide to close from August 15"],
  ];
  KEEP.forEach(([label, title, summary]) => {
    it(`KEEP: ${label}`, () => {
      expect(verdict(title, summary ?? "").relevant).toBe(true);
    });
  });

  const DROP: Array<[string, string, string?]> = [
    ["jet fuel market chatter", "Jet fuel prices tick higher on global markets", "Analysts see jet fuel price forecast rising with crude futures."],
    ["generic commuter transport strike", "Jeepney drivers stage transport strike in Iligan City"],
    ["pay strike with no fuel link", "Teachers strike nationwide over pay", "Teachers demand salary increase."],
  ];
  DROP.forEach(([label, title, summary]) => {
    it(`DROP: ${label}`, () => {
      expect(verdict(title, summary ?? "").relevant).toBe(false);
    });
  });
});
