import {
  buildFuelProducerBuyerActions,
  filterFuelActionIncidents,
} from "@/lib/fuelNarratives";
import type { TopicFastFactsIncident } from "@/lib/topicFastFacts";

// The Fuel Watch "Producer and Buyer Actions" table cross-reads genuine
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
    expect(rows[0].action).toMatch(/turns to india/i);
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

  it("classifies a refinery fire as a Market supply signal, never a Producer action", () => {
    const rows = buildFuelProducerBuyerActions({
      issueDate: ISSUE_DATE,
      incidents: [mk(21, "fuel", "Oil refinery ablaze in Cuba as fuel crisis deepens")],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe("Market / supply signal");
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
