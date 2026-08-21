import {
  buildFuelProducerBuyerActions,
  filterFuelActionIncidents,
} from "@/lib/fuelNarratives";
import type { TopicFastFactsIncident } from "@/lib/topicFastFacts";

// The Fuel Watch "Market and Operator Responses" table cross-reads genuine
// producer/buyer/government/infrastructure ACTIONS that the ingest pipeline
// files under the `shipping` topic (OPEC+ / ADNOC / Aramco / Pertamina crude-
// route moves), which the fuel-only relevance gate deliberately never keeps.
// These tests lock the cross-read to genuine actions only — no market price
// signals, no company-name homonyms, no food-oil false matches.

const ISSUE_DATE = "2026-07-01"; // weekly window: 25 Jun–1 Jul 2026
const OCCURRED = "2026-06-29T12:00:00+00:00"; // safely inside the window

function mk(
  id: number,
  topic: string,
  title: string,
): TopicFastFactsIncident {
  return { id, topic, title, severity: "moderate", occurredAt: OCCURRED, sourceUrl: `https://example.test/${id}` };
}

describe("Fuel Watch Producer/Buyer Actions cross-read", () => {
  const incidents: TopicFastFactsIncident[] = [
    // Genuine fuel-topic government action (stays via the fuel window).
    mk(1, "fuel", "Russia orders diesel export ban amid fuel shortage"),
    // Genuine producer action siloed under shipping — the whole point of the
    // cross-read. Must be surfaced.
    mk(2, "shipping", "Pertamina tanker clears Strait of Hormuz after months-long delay amid Iran-US tensions"),
    // Market price movement — NOT an action; must never enter via cross-read.
    mk(3, "shipping", "Oil Prices Jump After Attack Halts Shipping in Strait of Hormuz"),
    // "Reliance" here is the common noun, not the company — must be excluded.
    mk(4, "shipping", "Reduce Reliance on Strait of Hormuz shipping lane, tanker analysts urge"),
    // Palm oil is food/agri, not a fuel — the bare "oil" token must not match.
    mk(5, "shipping", "Indonesia announces palm oil export ban amid shipping disruption"),
  ];

  it("merges only the fuel action and the genuine shipping producer action", () => {
    const merged = filterFuelActionIncidents(incidents, ISSUE_DATE);
    expect(merged.map((i) => i.id).sort()).toEqual([1, 2]);
  });

  it("surfaces the shipping-siloed Pertamina row as a Producer action", () => {
    const rows = buildFuelProducerBuyerActions({ issueDate: ISSUE_DATE, incidents });
    const pertamina = rows.find((r) => r.actor === "Pertamina");
    expect(pertamina).toBeDefined();
    expect(pertamina?.category).toBe("Producer action");
  });

  it("keeps the genuine fuel-topic diesel export ban as a Government action", () => {
    const rows = buildFuelProducerBuyerActions({ issueDate: ISSUE_DATE, incidents });
    const gov = rows.find((r) => r.category === "Government / policy action");
    expect(gov?.action).toMatch(/diesel export ban/i);
  });

  it("excludes bare oil-price market-signal headlines", () => {
    const rows = buildFuelProducerBuyerActions({ issueDate: ISSUE_DATE, incidents });
    expect(rows.some((r) => /oil prices jump/i.test(r.action))).toBe(false);
  });

  it("excludes the 'reliance' common-noun homonym", () => {
    const rows = buildFuelProducerBuyerActions({ issueDate: ISSUE_DATE, incidents });
    expect(rows.some((r) => /reduce reliance/i.test(r.action))).toBe(false);
    expect(rows.some((r) => r.actor === "Reliance")).toBe(false);
  });

  it("excludes palm oil (food/agri) via the food-oil guard", () => {
    const rows = buildFuelProducerBuyerActions({ issueDate: ISSUE_DATE, incidents });
    expect(rows.some((r) => /palm oil/i.test(r.action))).toBe(false);
  });
});

describe("Buyer supplier-pivot classification and story-key collapse", () => {
  // Two syndicated rewrites of ONE pivot (same buyer, same product) share
  // too few distinctive tokens for the near-duplicate guard — the pivot
  // story key (buyer subject + product) must collapse them to one row.
  const pivotCopies: TopicFastFactsIncident[] = [
    mk(10, "fuel", "Russia Turns To India For Gasoline As Refinery Damage Deepens Fuel Crisis"),
    mk(11, "fuel", "Russia seeking extra gasoline from one of its top oil buyers amid fuel crisis"),
  ];

  it("classifies a supplier pivot as a Buyer action", () => {
    const rows = buildFuelProducerBuyerActions({ issueDate: ISSUE_DATE, incidents: pivotCopies });
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe("Buyer action");
    expect(rows[0].action).toMatch(/pivoted to indian gasoline/i);
  });

  it("keeps two DIFFERENT buyers' pivots as separate rows", () => {
    const rows = buildFuelProducerBuyerActions({
      issueDate: ISSUE_DATE,
      incidents: [
        mk(12, "fuel", "Russia turns to India for gasoline amid refinery outages"),
        mk(13, "fuel", "Pakistan turns to Kuwait for diesel as fuel crisis deepens"),
      ],
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.category === "Buyer action")).toBe(true);
  });

  it("does not match a pivot on food oils (no bare-oil token)", () => {
    const rows = buildFuelProducerBuyerActions({
      issueDate: ISSUE_DATE,
      incidents: [
        mk(14, "fuel", "Indonesia turns to Malaysia for palm oil as cooking oil prices climb"),
      ],
    });
    expect(rows.some((r) => /palm oil/i.test(r.action))).toBe(false);
  });
});

describe("Market / supply signal wording variants", () => {
  it("classifies 'refiner margins' wire styling as a Market signal", () => {
    const rows = buildFuelProducerBuyerActions({
      issueDate: ISSUE_DATE,
      incidents: [
        mk(20, "fuel", "US refiner margins spiked to record highs this week as fuel shortage concerns grow"),
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe("Market / supply signal");
  });

  it("excludes an involuntary refinery fire — not a market or operator RESPONSE", () => {
    const rows = buildFuelProducerBuyerActions({
      issueDate: ISSUE_DATE,
      incidents: [mk(21, "fuel", "Oil refinery ablaze in Cuba as fuel crisis deepens")],
    });
    expect(rows).toHaveLength(0);
  });

  it("gives margin rows a supporting-indicator read, never a driver claim", () => {
    const rows = buildFuelProducerBuyerActions({
      issueDate: ISSUE_DATE,
      incidents: [
        mk(23, "fuel", "US refiner margins spiked to record highs this week as fuel shortage concerns grow"),
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].operationalRead).toMatch(/supporting market indicator/i);
    expect(rows[0].operationalRead).toMatch(/not an operational driver/i);
  });

  it("still refuses market signals via the shipping cross-read", () => {
    const rows = buildFuelProducerBuyerActions({
      issueDate: ISSUE_DATE,
      incidents: [
        mk(22, "shipping", "Oil terminal fire disrupts crude loading at Gulf port"),
      ],
    });
    expect(rows).toHaveLength(0);
  });
});

describe("Market and Operator Responses rework", () => {
  // The two live prod headlines that described ONE operational development
  // (Red Sea / Suez corridor rerouting) under different wire styling.
  const rerouteCopies: TopicFastFactsIncident[] = [
    mk(30, "shipping", "Asian refineries reroute Saudi oil imports via the Suez Canal"),
    mk(31, "shipping", "Two Saudi Oil Tankers Reroute in the Red Sea Toward the Suez Canal"),
  ];

  it("collapses same-corridor reroute copies to one row (newest survives)", () => {
    const rows = buildFuelProducerBuyerActions({ issueDate: ISSUE_DATE, incidents: rerouteCopies });
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe("Infrastructure / routing action");
    expect(rows[0].action).toMatch(/Asian refineries reroute/);
  });

  it("keeps reroutes on DIFFERENT corridors as separate rows", () => {
    const rows = buildFuelProducerBuyerActions({
      issueDate: ISSUE_DATE,
      incidents: [
        mk(32, "shipping", "Crude tankers reroute to avoid the Strait of Hormuz amid tensions"),
        mk(33, "shipping", "Crude carriers rerouting in the Red Sea toward the Suez Canal"),
      ],
    });
    expect(rows).toHaveLength(2);
  });

  it("summarizes reroute headlines into concise operational actions", () => {
    const rows = buildFuelProducerBuyerActions({
      issueDate: ISSUE_DATE,
      incidents: [mk(34, "shipping", "Two Saudi Oil Tankers Reroute in the Red Sea Toward the Suez Canal")],
    });
    expect(rows[0].action).toMatch(/rerouted.*Red Sea/i);
    expect(rows[0].action).not.toMatch(/Two Saudi Oil Tankers/i);
  });

  it("appends the country stamp only when the headline names no actor or place", () => {
    const withPlace: TopicFastFactsIncident = {
      ...mk(35, "fuel", "Diesel export ban ordered amid worsening fuel shortage"),
      country: "Sri Lanka",
    };
    const carriesOwnCue: TopicFastFactsIncident = {
      ...mk(36, "fuel", "US refiner margins spiked to record highs this week as fuel shortage concerns grow"),
      country: "Pakistan", // reporting origin, NOT the event geography
    };
    const rows = buildFuelProducerBuyerActions({
      issueDate: ISSUE_DATE,
      incidents: [withPlace, carriesOwnCue],
    });
    const ban = rows.find((r) => /export ban/i.test(r.action));
    const margins = rows.find((r) => /refiner margins/i.test(r.action));
    expect(ban?.action).toMatch(/export ban in Sri Lanka/i);
    expect(margins?.action).not.toMatch(/Pakistan/);
  });

  it("never claims price follow-through ('usually firms within days' is gone)", () => {
    const rows = buildFuelProducerBuyerActions({
      issueDate: ISSUE_DATE,
      incidents: [
        ...rerouteCopies,
        mk(37, "fuel", "US refiner margins spiked to record highs this week as fuel shortage concerns grow"),
        mk(38, "fuel", "Russia orders diesel export ban amid fuel shortage"),
      ],
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.operationalRead).not.toMatch(/usually/i);
      expect(r.operationalRead).not.toMatch(/firms within days/i);
    }
  });
});

describe("Fuel Watch keeps producer-central, OPEC outlook and aviation-cost items", () => {
  // Inclusion is material fuel-market relevance, not a narrow "direct
  // producer action" test. Classification follows why the story matters.
  it("keeps Aramco and ADNOC as Producer action when the producer is central", () => {
    const rows = buildFuelProducerBuyerActions({
      issueDate: ISSUE_DATE,
      incidents: [
        mk(40, "fuel", "Saudi Aramco announces output increase to stabilise supply"),
        mk(41, "fuel", "ADNOC issues statement clarifying attacks on facilities"),
      ],
    });
    const aramco = rows.find((r) => r.actor === "Saudi Aramco");
    const adnoc = rows.find((r) => r.actor === "ADNOC");
    expect(aramco).toBeDefined();
    expect(aramco?.category).toBe("Producer action");
    expect(adnoc).toBeDefined();
    expect(adnoc?.category).toBe("Producer action");
  });

  it("keeps an OPEC/IEA demand-outlook disagreement as a market signal", () => {
    const rows = buildFuelProducerBuyerActions({
      issueDate: ISSUE_DATE,
      incidents: [
        mk(42, "fuel", "OPEC and IEA disagree over 2026 oil demand outlook"),
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe("Market / supply signal");
    expect(rows[0].action).toMatch(/OPEC and IEA disagree/i);
  });

  it("keeps Air India fuel-cost operational impact as a Buyer action", () => {
    const rows = buildFuelProducerBuyerActions({
      issueDate: ISSUE_DATE,
      incidents: [
        mk(43, "fuel", "Air India warns of operational impact as fuel costs rise"),
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].actor).toBe("Air India");
    expect(rows[0].category).toBe("Buyer action");
  });

  it("still excludes a bare oil-price jump that is not an OPEC/IEA outlook", () => {
    const rows = buildFuelProducerBuyerActions({
      issueDate: ISSUE_DATE,
      incidents: [
        mk(44, "shipping", "Oil Prices Jump After Attack Halts Shipping in Strait of Hormuz"),
      ],
    });
    expect(rows).toHaveLength(0);
  });

  it("excludes condemnation-only producer headlines", () => {
    const rows = buildFuelProducerBuyerActions({
      issueDate: ISSUE_DATE,
      incidents: [
        mk(45, "fuel", "UAE strongly condemns targeting of two ADNOC vessels"),
      ],
    });
    expect(rows).toHaveLength(0);
  });

  it("excludes producer-named vessel attack headlines", () => {
    const rows = buildFuelProducerBuyerActions({
      issueDate: ISSUE_DATE,
      incidents: [
        mk(48, "fuel", "ADNOC vessel attacked again in Strait of Hormuz, no injuries"),
        mk(49, "fuel", "ADNOC vessel Attacked Again in Strait of Hormuz"),
      ],
    });
    expect(rows).toHaveLength(0);
  });

  it("still keeps Pertamina operational tanker moves", () => {
    const rows = buildFuelProducerBuyerActions({
      issueDate: ISSUE_DATE,
      incidents: [
        mk(2, "shipping", "Pertamina tanker clears Strait of Hormuz after months-long delay amid Iran-US tensions"),
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].actor).toBe("Pertamina");
  });

  it("gives windfall tax cuts a policy read, not an aviation trim read", () => {
    const rows = buildFuelProducerBuyerActions({
      issueDate: ISSUE_DATE,
      incidents: [
        mk(46, "fuel", "India cuts windfall tax on petrol, diesel, aviation-fuel exports"),
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe("Government / policy action");
    expect(rows[0].operationalRead).toMatch(/policy reset/i);
    expect(rows[0].operationalRead).not.toMatch(/aviation demand response/i);
  });

  it("reads a failed shortage-ease headline as persistent tightness", () => {
    const rows = buildFuelProducerBuyerActions({
      issueDate: ISSUE_DATE,
      incidents: [
        mk(47, "fuel", "Indian gasoline fails to ease Russia's fuel shortage"),
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].operationalRead).toMatch(/did not materialise|persists/i);
    expect(rows[0].operationalRead).not.toMatch(/supply resuming eases/i);
  });
});
