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
