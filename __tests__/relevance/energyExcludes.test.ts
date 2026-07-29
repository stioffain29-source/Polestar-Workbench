// Regression pins for the energy exclude stack (ENERGY_EXCLUDE), modelled on
// fuelExcludes.test.ts / shippingExcludes.test.ts (tasks 449/451/453).
//
// ENERGY_EXCLUDE in lib/relevance/src/topicRelevance.ts drops off-topic noise
// the US Google-News edition injects into a Middle East / South+East Asia /
// Oceania grid-stress monitor:
//   - US/Canadian investor-owned utilities (Duke, PG&E, ComEd, ...);
//   - US-local distribution vocabulary ("downed tree", "outage tracker",
//     "in your area") and county/township feeder faults;
//   - US TV-station call signs that syndicate local storm/outage wires;
//   - "blackout" HOMONYMS: consumer products (curtains/plates), medical /
//     drinking, broadcast/sports/media blackouts, historical retrospectives,
//     prep/how-to SEO, Q&A think-pieces, disinformation commentary;
//   - planned/scheduled maintenance, restored/recovery framing, negations
//     ("no load-shedding");
//   - coal-transition / climate-finance commentary sharing "coal"/"power
//     plant" vocabulary with the genuine PLN coal-supply grid-stress rule.
// Every fixture below is a real headline seen in the live incidents table
// (stored relevance_reason column identifies the pattern that fired),
// pinning BOTH directions:
//   - DROP: noise classes that must never re-enter the feed;
//   - KEEP: genuine grid-stress coverage that shares blackout/outage/coal
//     vocabulary with a noise class and must never be collaterally swallowed
//     by a future regex tweak.
import { explainRelevance, type RelevanceInput } from "@workspace/relevance";

function verdict(title: string, summary = ""): { relevant: boolean; reason: string } {
  const input: RelevanceInput = { topic: "energy", title, summary };
  return explainRelevance("energy", input);
}

// [class label, headline] — every row must DROP.
const DROP_FIXTURES: Array<[string, string]> = [
  // ---- US / Canadian investor-owned utilities ----
  ["Duke Energy local fault", "Duke Energy official explains cause of Terre Haute power outage Thursday"],
  ["Duke Energy scam wire", "Power outage scam text claiming to be Duke Energy circulating"],
  // ---- US-local distribution vocabulary + outage-tracker SEO ----
  ["tree crew feeder fault", "Tree crew causes power outage affecting southeast Genesee County"],
  ["outage tracker SEO", "Houston power outage tracker reveals fewer outages heading into winter storm"],
  ["in-your-area tracker", "Track power outages in your area with the ABC13 Power Outage Tracker"],
  // ---- county / township feeder noise ----
  ["county feeder fault", "Power outage hits 6,000 in Benzie County April 14"],
  // ---- US TV-station call signs (the in-your-area fixture's "ABC13" token
  // also hits this class; a summary-borne call-sign pin lives below) ----
  // ---- consumer-product / lifestyle "blackout" homonyms ----
  ["blackout curtains", "The Very Best Blackout Curtains To Block Out Light"],
  ["blackout social-media challenge", "Texas Girl, 9, Dies Doing 'Blackout' Social Media Challenge, Parents Issue Warning: 'Check On Your Child'"],
  ["blackout tattoo", "MGK says he turned 'yellow' and fell severely sick during his blackout tattoo"],
  // ---- medical / drinking "blackout" ----
  ["drinking blackout game", "‘Blackout Or Backout’: Penn State Student Creates Ultimate Drinking Card Game"],
  ["alcohol blackout study", "Blackout or pass-out? What twins tell us about sensitivity to alcohol | Newswise"],
  // ---- broadcast / media "blackout" ----
  ["media blackout", "Assault on journalists: GJA lambasts NMC for suggesting media blackout against perpetrators is dysfunctional"],
  // ---- novelty licence-plate "blackout" ----
  ["blackout plates", "Blackout Plate sales hit 70,000 in only three months"],
  // ---- historical retrospectives ----
  ["1977 retrospective", "The New York City Blackout of 1977"],
  ["2003 retrospective", "The romances, babies and heroes of the 2003 blackout"],
  // ---- prep / how-to / product-review SEO ----
  ["survival how-to", "How to Survive a Blackout: 6 Things You Need to Build an Emergency Tech Kit"],
  ["winter-storm tracker SEO", "Winter Weather Power Outage Tracker"],
  ["gaming how-to", "HOW TO WIN MORE BLACKOUT MATCHES IN CALL OF DUTY: BLACK OPS 4"],
  // ---- Q&A / disinformation think-pieces ----
  ["Q&A think-piece", "Q&A: What does the Iberian blackout signal for the energy transition?"],
  ["disinformation commentary", "Blackout disinformation: An attempt to leave the energy transition in the dark"],
  // ---- planned / scheduled maintenance ----
  ["planned outage notice", "More than 2,300 customers to be impacted by planned power outage in Byron"],
  // ---- restored / recovery framing ----
  ["restored-after wire", "Widespread power outage in north Reno area restored after morning disruption"],
  ["outages-drop recovery", "Austin power outages drop after severe storms sweep through city. See map"],
  // ---- negations (the OPPOSITE of an incident) ----
  ["no-shortage assurance", "No power shortage in country so no scope for load-shedding, says state minister"],
  ["no-load-shedding assurance", "No load shedding in Kerala, ‘overuse’ causing power disruptions: Minister Krishnankutty"],
  // ---- coal-transition / climate-finance commentary ----
  ["clean-energy-transition PR", "Eskom marks one year load-shedding free, eyes long-term clean energy transition"],
];

// [class label, headline] — every row must KEEP. Each shares blackout/outage/
// price/coal vocabulary with a DROP class above and pins that ENERGY_EXCLUDE
// stays precision-bound to noise, never live grid-stress coverage.
const KEEP_FIXTURES: Array<[string, string]> = [
  // Load-shedding / rolling-outage core — shares "load shedding" with the
  // negation excludes but reports live grid stress.
  ["unbearable load-shedding", "K-Electric slammed over 'unbearable' load-shedding"],
  ["severe load-shedding", "Severe load-shedding hits Khulna city"],
  // "No scope for PLANNED load shedding" — a word between the negation and the
  // load-shedding token must not let the negation exclude over-reach.
  ["qualified negation keeps", "No scope for planned load shedding, says state minister"],
  // Coal-supply grid stress — shares "coal" with the transition-commentary
  // exclude and even contains "No Planned Blackouts".
  ["PLN coal supply concerns", "Bahlil Assures No Planned Blackouts Amid PLN Coal Supply Concerns"],
  // Qualifier-bound blackout headlines — share "blackout" with every homonym.
  ["island-wide blackout", "Cuban officials report an island-wide blackout as country struggles with energy crisis"],
  ["total war blackout feature", "How Ukrainians are surviving a total blackout because of Russian attacks"],
  ["blackout tragedy", "The Sumatra Electricity Blackout Tragedy: From Economic Chaos to Loss of Life"],
  // Brownouts / red alerts — operational grid stress.
  ["rotating brownouts", "Rotating brownouts hit Visayas power consumers on Tuesday, June 2, 2026"],
  ["red-alert power crisis", "Visayas power crisis: 3rd day of red alert as demand exceeds supply"],
  // Grid attack drill — shares "blackout" lead with the homonym excludes.
  ["grid missile-strike drill", "Blackout: Israel Drills For Missile Strikes On Power Grid"],
  // Tariff / price actions — operational policy moves, not commentary.
  ["IMF-driven tariff hike", "Pakistan govt approves massive hike in power tariff on IMF demand: Report"],
  // Recovery-adjacent wording ("expected to ease") — the recovery exclude
  // deliberately omits "ease" because it appears in ongoing-crisis prose.
  ["easing wording keeps", "925MW from Adani added to national grid, load-shedding expected to ease: BPDB"],
  // Load-shedding warning framed around looting risk.
  ["blackout-looting warning", "There will be blackout, random looting and vandalism if we don’t implement load shedding, says De Ruyter"],
  ["regional electricity crisis", "Electricity Crisis Hits Several Regions in Indonesia"],
];

describe("energy exclude stack (grid-noise regression pins)", () => {
  describe.each(DROP_FIXTURES.filter(([label]) => label !== ""))("DROP: %s", (_label, title) => {
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

  it("names the energy off-topic rule in the drop reason", () => {
    const v = verdict("Duke Energy official explains cause of Terre Haute power outage Thursday");
    expect(v.relevant).toBe(false);
    expect(v.reason).toContain("energy off-topic");
  });

  it("a call-sign token in the SUMMARY drops a headline even with an outage word", () => {
    // ENERGY_EXCLUDE runs on the full haystack (title + summary) BEFORE the
    // required gate, so a US TV-station byline in the summary poisons an
    // otherwise-ambiguous local outage row.
    const v = verdict(
      "Annapolis storm leaves power outages and road closures",
      "WBAL-TV Baltimore reports downed power lines across Anne Arundel County.",
    );
    expect(v.relevant).toBe(false);
  });
});
