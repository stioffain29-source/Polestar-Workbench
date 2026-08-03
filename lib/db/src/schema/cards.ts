import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  jsonb,
  boolean,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * The editable content of one infographic card. Stored as a single jsonb blob
 * on both drafts and templates so the template-driven form can evolve without a
 * schema migration. Every field is optional — a draft can be saved while still
 * incomplete. `keyPoints` holds exactly three short bullets in the finished
 * card, but is not length-enforced at the DB layer.
 */
export interface CardContent {
  topic?: string;
  country?: string;
  /** Event date/time as an ISO or `datetime-local` string. */
  eventDate?: string;
  headline?: string;
  bluf?: string;
  keyPoints?: string[];
  /** Five-tier risk vocabulary: insignificant | low | moderate | high | extreme. */
  rating?: string;
  outlook?: string;
  /** Optional map/locator label. */
  mapLocation?: string;
  /** Optional uploaded map/visual image as a data URL. */
  mapImage?: string;
  /** Optional per-card source note shown in the footer. */
  sourceNote?: string;
  /** Optional per-card logo override (data URL) — falls back to brand settings. */
  logoImage?: string;
  /** Optional per-card footer override — falls back to brand settings. */
  footerText?: string;
}

/**
 * A reusable card preset. The four seeded built-ins (Country Risk Snapshot,
 * Protest & Disruption Update, Incident Update, Market Entry Snapshot) share the
 * same five layout regions but emphasise them differently via `templateKey`.
 * Analysts can save their own presets too (isBuiltIn = false).
 */
export const cardTemplatesTable = pgTable("card_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  // Layout key driving region emphasis: country_risk | protest_disruption |
  // incident_update | market_entry (built-ins) or a saved preset's base layout.
  templateKey: text("template_key").notNull().default("country_risk"),
  isBuiltIn: boolean("is_built_in").notNull().default(false),
  content: jsonb("content")
    .$type<CardContent>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastEditedAt: timestamp("last_edited_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A saved, reloadable card draft. Holds the chosen layout (`templateKey`) plus
 * the analyst-entered content blob.
 */
export const cardDraftsTable = pgTable("card_drafts", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  templateKey: text("template_key").notNull().default("country_risk"),
  content: jsonb("content")
    .$type<CardContent>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastEditedAt: timestamp("last_edited_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Single-row brand configuration for the card builder. Lets a non-technical
 * analyst change the palette, logo, fonts and footer without code edits; the
 * card preview and PNG export both read from this record. Always operated on at
 * id = 1.
 */
export const brandSettingsTable = pgTable("brand_settings", {
  id: integer("id").primaryKey().default(1),
  colorMidnight: text("color_midnight").notNull().default("#0b0a3d"),
  colorElectric: text("color_electric").notNull().default("#465bff"),
  colorDusk: text("color_dusk").notNull().default("#363636"),
  colorPolar: text("color_polar").notNull().default("#e2e2e2"),
  // Subdued red — reserved for the Extreme rating tier only.
  colorExtreme: text("color_extreme").notNull().default("#A33232"),
  // Logo as a data URL (nullable — falls back to the bundled Polestar mark).
  logoImage: text("logo_image"),
  fontHeading: text("font_heading").notNull().default("Roboto Condensed"),
  fontBody: text("font_body").notNull().default("Roboto"),
  footerText: text("footer_text").notNull().default("Polestar Advisory"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CardTemplate = typeof cardTemplatesTable.$inferSelect;
export type InsertCardTemplate = typeof cardTemplatesTable.$inferInsert;
export type CardDraft = typeof cardDraftsTable.$inferSelect;
export type InsertCardDraft = typeof cardDraftsTable.$inferInsert;
export type BrandSettings = typeof brandSettingsTable.$inferSelect;
export type InsertBrandSettings = typeof brandSettingsTable.$inferInsert;
