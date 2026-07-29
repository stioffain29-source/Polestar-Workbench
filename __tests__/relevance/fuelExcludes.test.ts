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
import { explainRelevance, type RelevanceInput } from "@workspace/relevance";

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
  ["refiner margins on shortage", "US refiner margins hit new records as fuel shortage concerns grow"],
  ["jet-fuel route cuts", "Thai AirAsia cuts more summer routes as jet fuel prices surge"],
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
