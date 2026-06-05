import { pgTable, text, real, jsonb, timestamp, primaryKey } from "drizzle-orm/pg-core";

// Live commodity-price snapshots that the topic monitors (Fuel / Energy /
// Fertiliser) render. ONE row per (group, key) — the latest close for that
// instrument, overwritten in place by each ingest. This is distinct from the
// per-report fuel hard_numbers (which anchor prices to a report's window); this
// table is a single live snapshot anchored to the latest available close.
//
// Every value here comes from a real public feed (FRED / Yahoo / World Bank).
// A series that fails to fetch leaves its prior row untouched — the monitor
// never shows fabricated or zeroed prices.

export type PriceTrajectoryPoint = { date: string; value: number };

export const marketPricesTable = pgTable(
  "market_prices",
  {
    /** Topic monitor this instrument belongs to: "fuel" | "energy" | "fertiliser". */
    group: text("commodity_group").notNull(),
    /** Stable instrument key, e.g. "brent", "henry_hub", "urea". */
    key: text("commodity_key").notNull(),
    /** Display label, e.g. "Brent Crude". */
    label: text("label").notNull(),
    /** Latest observed price. */
    value: real("value").notNull(),
    /** Unit, e.g. "USD/bbl", "USD/MMBtu", "USD/mt". */
    unit: text("unit").notNull(),
    /** Pre-formatted change string, e.g. "+2.1% 7d" or "-0.8% MoM"; null when no comparable prior observation. */
    change: text("change"),
    /** ISO date of the latest observation (the price's "as of" date). */
    asOf: text("as_of").notNull(),
    /** Truthful provenance, e.g. "FRED (DHHNGSP)". */
    source: text("source").notNull(),
    /** Optional benchmark descriptor, e.g. "Henry Hub natural gas spot". */
    benchmark: text("benchmark"),
    /** Recent points for a sparkline; null when unavailable. */
    trajectory: jsonb("trajectory").$type<PriceTrajectoryPoint[]>(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.group, t.key] })],
);

export type MarketPrice = typeof marketPricesTable.$inferSelect;
export type InsertMarketPrice = typeof marketPricesTable.$inferInsert;
