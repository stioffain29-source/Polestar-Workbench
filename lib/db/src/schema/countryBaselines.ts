import { pgTable, serial, text, timestamp, jsonb } from "drizzle-orm/pg-core";

export type CountryBaselineWatchlistItem = {
  label: string;
  note: string;
  match: string[];
};

export const countryBaselinesTable = pgTable("country_baselines", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  operatingEnvironment: text("operating_environment").notNull().default(""),
  securityContext: text("security_context").notNull().default(""),
  knownRiskAreas: jsonb("known_risk_areas").$type<string[]>().notNull().default([]),
  keyCitiesProvinces: jsonb("key_cities_provinces").$type<string[]>().notNull().default([]),
  movementConstraints: text("movement_constraints").notNull().default(""),
  infrastructureLimits: text("infrastructure_limits").notNull().default(""),
  medicalEvac: text("medical_evac").notNull().default(""),
  resourceSectorExposure: text("resource_sector_exposure").notNull().default(""),
  locationWatchlist: jsonb("location_watchlist")
    .$type<CountryBaselineWatchlistItem[]>()
    .notNull()
    .default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CountryBaselineRow = typeof countryBaselinesTable.$inferSelect;
export type InsertCountryBaseline = typeof countryBaselinesTable.$inferInsert;
