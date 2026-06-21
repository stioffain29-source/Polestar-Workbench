import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Facebook OSINT monitoring items for the Papua New Guinea + Indonesian Papua
// theatres — a CONTEXT source, modelled exactly on social_watch_items /
// reliefweb_reports / maritime_movement.
//
// CRITICAL PRODUCT RULE: a social_raw item is NEVER an incident. It lives in its
// own table precisely so a Facebook post can never inflate any incident count
// (dashboard, topic monitors, reports). The ONLY path from this table into
// `incidents` is an explicit, gated, human-in-the-loop PROMOTE action, and the
// server RE-DERIVES eligibility on promote — it never trusts a client claim.
// Once promoted, `promotedIncidentId` links the raw item back to the incident
// it created.
//
// PROMOTION GATE (re-derived server-side): an item is eligible only when it is
// (a) security-relevant (a real security category, not "Other security") AND
// (b) credible — its page is a config-declared OFFICIAL or LOCAL_MEDIA source,
// OR the post links to a credible domain, OR it is corroborated by an existing
// incident (cross-feed). An uncorroborated post from an unverified OSINT page is
// never promotable. Credibility is NEVER inferred from the post text.
//
// PRIVACY / SECURITY: only PUBLIC page posts are ever fetched. The ingest stores
// a MINIMISED, redacted payload only — caption is sanitised (phone/email/private
// links stripped), and post comments, author/commenter profiles and any
// token-bearing URLs are never persisted. The Apify token is never stored or
// surfaced (it travels only as a request query param).
//
// Dedup: re-fetches and reshares collapse to a single row via the UNIQUE
// `dedup_key` (a content/image fingerprint). The ingest also de-duplicates
// within a run before writing.
export const socialRawTable = pgTable(
  "social_raw",
  {
    id: serial("id").primaryKey(),
    // Constant adapter source key ("facebook_osint"); part of the external-id
    // dedup so a future provider can share the table without id collisions.
    sourceName: text("source_name").notNull().default("facebook_osint"),
    // Platform the post came from (currently always "facebook").
    platform: text("platform").notNull().default("facebook"),
    // Page handle / slug the post was read from, e.g. "PNGFacts".
    pageHandle: text("page_handle").notNull(),
    // Display name of the monitored page.
    pageName: text("page_name"),
    // Config-declared credibility tier of the monitored page:
    // "official" | "local_media" | "osint". NEVER inferred from post text.
    sourceTier: text("source_tier").notNull().default("osint"),
    // Platform-native post id (used for idempotent re-fetch + source linking).
    externalId: text("external_id").notNull(),
    // When the post itself was published.
    postedAt: timestamp("posted_at", { withTimezone: true }),
    // Best-effort extracted incident-occurrence date (distinct from postedAt).
    incidentDate: timestamp("incident_date", { withTimezone: true }),
    // Sanitised, minimised post text (phone/email/private links stripped).
    caption: text("caption"),
    // Public image URL(s) attached to the post.
    imageUrls: jsonb("image_urls").$type<string[]>().notNull().default([]),
    // Outbound links found in the post (token-bearing URLs redacted).
    links: jsonb("links").$type<string[]>().notNull().default([]),
    // Credible-source domains detected among the post's outbound links.
    detectedCredibleDomains: jsonb("detected_credible_domains")
      .$type<string[]>()
      .notNull()
      .default([]),
    // Keyword-filtered theatre scope: "Papua New Guinea" | "Indonesia".
    country: text("country").notNull().default("Unknown"),
    // Province when derivable from the theatre gazetteer, else null.
    province: text("province"),
    // Free-text location / place mentioned in the post, else null.
    location: text("location"),
    // Security category (shared IncidentCategory rulebook), else "Other security".
    category: text("category").notNull().default("Other security"),
    // Business-impact line derived from the category.
    businessImpact: text("business_impact"),
    // True when the category is a real security category (not "Other security").
    securityRelevant: boolean("security_relevant").notNull().default(false),
    // True when the page tier or a detected credible domain establishes credibility.
    credible: boolean("credible").notNull().default(false),
    // Human-readable explanation of the credibility decision.
    credibilityReason: text("credibility_reason"),
    // True when an existing incident corroborates this post (cross-feed match).
    corroborated: boolean("corroborated").notNull().default(false),
    // Human-readable explanation of the corroboration decision.
    corroborationReason: text("corroboration_reason"),
    // Best-matching corroborating incident id (null when none).
    corroboratingIncidentId: integer("corroborating_incident_id"),
    // Topic the promote action would file the incident under: flashpoint | conflict.
    promotionTopic: text("promotion_topic").notNull().default("flashpoint"),
    // Public source URL of the post.
    url: text("url").notNull(),
    // Guard that this row is supporting context, not an incident.
    classification: text("classification").notNull().default("context"),
    // Content/image fingerprint — UNIQUE so re-fetches/reshares collapse to one.
    dedupKey: text("dedup_key").notNull(),
    // Coarse public engagement counts when the scraper supplies them (reactions /
    // comments / shares). NEVER includes commenter identities — counts only. Null
    // when the provider does not report them ("not reported", never a fake zero).
    engagement: jsonb("engagement")
      .$type<{ reactions?: number; comments?: number; shares?: number }>(),
    // Curated security/theatre keywords that actually matched the caption — a
    // transparency signal for the analyst, derived from real text matches only.
    detectedKeywords: jsonb("detected_keywords")
      .$type<string[]>()
      .notNull()
      .default([]),
    // Deterministic triage score (0-100) combining the concrete signals already
    // derived for this row. Not a probability; never fabricates certainty.
    confidence: integer("confidence").notNull().default(0),
    // True when the row should surface in the analyst review queue (in-scope AND
    // a real security category). A TRIAGE flag only — never promotes anything.
    reviewFlag: boolean("review_flag").notNull().default(false),
    // Human-readable explanation of the review-flag decision (null when unflagged).
    reviewReason: text("review_reason"),
    // Minimised, redacted echo of the source payload (no comments/PII/tokens).
    rawPayload: jsonb("raw_payload").$type<Record<string, unknown>>(),
    // True only when the re-derived gate (security AND credible) passes — i.e.
    // eligible for promotion to an incident.
    promotable: boolean("promotable").notNull().default(false),
    // Backlink to the incident this item was promoted into (null until promoted).
    promotedIncidentId: integer("promoted_incident_id"),
    promotedAt: timestamp("promoted_at", { withTimezone: true }),
    // When this item was last successfully checked by the ingest.
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    dedupUnique: uniqueIndex("social_raw_dedup_unique").on(t.dedupKey),
    byExternal: index("social_raw_external_idx").on(t.sourceName, t.externalId),
    byCountry: index("social_raw_country_idx").on(t.country),
    byCategory: index("social_raw_category_idx").on(t.category),
    byPromotable: index("social_raw_promotable_idx").on(t.promotable),
    byReview: index("social_raw_review_idx").on(t.reviewFlag),
    byPosted: index("social_raw_posted_idx").on(t.postedAt),
  }),
);

export type SocialRawItem = typeof socialRawTable.$inferSelect;
export type InsertSocialRawItem = typeof socialRawTable.$inferInsert;
