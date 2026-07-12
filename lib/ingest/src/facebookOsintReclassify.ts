// Facebook OSINT reclassify + translate pass (DB → DB).
//
// A free, DB-only maintenance pass over the isolated `facebook_osint` context
// rows in `social_raw`. It does two things, both idempotent and no-fabrication:
//
//   1. TRANSLATE — a non-English caption (Bahasa Indonesia / Tok Pisin) is
//      rendered into clean English via the shared translateCaptionToEnglish
//      harness and stored in `caption_en` (NULL until translated; the UI falls
//      back to the original caption). A caption already in English is left
//      untranslated. Translation only re-expresses the existing text — it adds
//      no facts and decides no scope, severity, country or promotion.
//
//   2. GUARD (slop filter) — the theatre classifiers assign a security category
//      from a broad vocabulary, so community chatter (a lost-property notice, an
//      eviction gripe, a governance press release) can land in a real security
//      category and even be auto-promoted. The pure applySecurityEventGuard
//      re-checks each row: when NEITHER the caption nor its translation carries
//      a security-event cue AND the text is confidently readable (English or now
//      translated), the category is demoted to "Other security" and the row's
//      eligibility / review / confidence are re-derived from the STORED fields
//      (the corroboration flag is read as-stored — the corroboration scorer is
//      NEVER re-run here, to avoid a self-match). A demoted row that had been
//      promoted into an incident is UN-PROMOTED: the minted incident is deleted
//      (only when its `social_raw:<id>` marker matches this row) and the
//      back-link cleared, returning the row to `pending_review`.
//
// This never fetches externally and takes no request input. It runs from the
// gated admin route only. Dry-run by default; pass `{ commit: true }` to write.
// NEVER closes the shared pool (the caller owns the pool lifecycle).

import { eq } from "drizzle-orm";
import {
  db,
  incidentsTable,
  socialRawTable,
  type SocialRawItem,
} from "@workspace/db";
import { translateCaptionToEnglish } from "./captionTranslate";
import { isLlmAvailable } from "./openaiConfig";
import { markerSocialRawId } from "./socialPromote";
import type { IncidentCategory } from "./structuredExtract";
import {
  applySecurityEventGuard,
  categoryToTopic,
  computeConfidence,
  deriveEligibility,
  deriveReview,
  isLikelyEnglish,
  normaliseSourceTier,
} from "./facebookOsintEligibility";

// Only the Facebook OSINT source is in scope — the Instagram/KAMMI rows in the
// same table are a separate source and are left untouched.
const FACEBOOK_SOURCE_NAME = "facebook_osint";

// A bounded per-run translation budget so a single call can never fan out into
// hundreds of LLM requests. The pass is idempotent (already-translated rows are
// skipped), so a large backlog is drained by re-running.
const DEFAULT_MAX_TRANSLATIONS = 300;

export interface FacebookOsintReclassifySummary {
  mode: "commit" | "dry-run";
  /** Facebook OSINT rows scanned. */
  considered: number;
  /** Captions newly translated to English this run. */
  translated: number;
  /** Non-English rows left untranslated because the LLM is unavailable. */
  translateSkippedNoLlm: number;
  /** Rows whose real category was demoted to "Other security" (slop). */
  demoted: number;
  /** Promoted incidents deleted because their source row was demoted. */
  unpromoted: number;
  /** Rows whose stored columns (or caption_en) changed. */
  updated: number;
  /** Rows with no change. */
  unchanged: number;
  demotedIds: number[];
  unpromotedIncidentIds: number[];
  errors: string[];
  logLines: string[];
}

export function emptyFacebookOsintReclassifySummary(
  mode: "commit" | "dry-run",
): FacebookOsintReclassifySummary {
  return {
    mode,
    considered: 0,
    translated: 0,
    translateSkippedNoLlm: 0,
    demoted: 0,
    unpromoted: 0,
    updated: 0,
    unchanged: 0,
    demotedIds: [],
    unpromotedIncidentIds: [],
    errors: [],
    logLines: [],
  };
}

// The recomputed, stored-field-derived state for one row.
interface Recomputed {
  captionEn: string | null;
  category: IncidentCategory;
  securityRelevant: boolean;
  credible: boolean;
  credibilityReason: string | null;
  promotable: boolean;
  promotionTopic: string;
  reviewFlag: boolean;
  reviewReason: string | null;
  confidence: number;
}

function recompute(item: SocialRawItem, captionEn: string | null): Recomputed {
  const raw = item.caption ?? "";
  const category = applySecurityEventGuard({
    category: item.category as IncidentCategory,
    caption: raw,
    captionEn,
  }).category;

  const inScope = item.country !== "Unknown";
  const elig = deriveEligibility({
    category,
    sourceTier: normaliseSourceTier(item.sourceTier),
    credibleDomainLabels: item.detectedCredibleDomains ?? [],
    // Read the STORED corroboration flag — never re-run the corroboration
    // scorer here (it would self-match the row's own promoted incident).
    corroborated: item.corroborated,
    corroborationReason: item.corroborationReason,
  });
  const review = deriveReview({
    inScope,
    securityRelevant: elig.securityRelevant,
    promotable: elig.promotable,
    category,
  });
  const confidence = computeConfidence({
    inScope,
    localityPrecise: item.province != null,
    securityRelevant: elig.securityRelevant,
    credible: elig.credible,
    corroborated: item.corroborated,
    hasIncidentDate: item.incidentDate != null,
    keywordCount: (item.detectedKeywords ?? []).length,
  });

  return {
    captionEn,
    category,
    securityRelevant: elig.securityRelevant,
    credible: elig.credible,
    credibilityReason: elig.credibilityReason,
    promotable: elig.promotable,
    promotionTopic: categoryToTopic(category),
    reviewFlag: review.reviewFlag,
    reviewReason: review.reviewReason,
    confidence,
  };
}

function columnsChanged(item: SocialRawItem, r: Recomputed): boolean {
  return (
    (r.captionEn ?? null) !== (item.captionEn ?? null) ||
    r.category !== item.category ||
    r.securityRelevant !== item.securityRelevant ||
    r.credible !== item.credible ||
    (r.credibilityReason ?? null) !== (item.credibilityReason ?? null) ||
    r.promotable !== item.promotable ||
    r.promotionTopic !== item.promotionTopic ||
    r.reviewFlag !== item.reviewFlag ||
    (r.reviewReason ?? null) !== (item.reviewReason ?? null) ||
    r.confidence !== item.confidence
  );
}

/**
 * Translate + re-guard every `facebook_osint` row. DB-only, idempotent, dry-run
 * by default. Pass `{ commit: true }` to persist. `maxTranslations` bounds LLM
 * fan-out per run (default 300); re-run to drain a larger backlog.
 */
export async function runFacebookOsintReclassify(
  opts: {
    commit?: boolean;
    maxTranslations?: number;
    log?: (s: string) => void;
  } = {},
): Promise<FacebookOsintReclassifySummary> {
  const commit = opts.commit ?? false;
  const maxTranslations = opts.maxTranslations ?? DEFAULT_MAX_TRANSLATIONS;
  const summary = emptyFacebookOsintReclassifySummary(
    commit ? "commit" : "dry-run",
  );
  const log = (s: string) => {
    summary.logLines.push(s);
    opts.log?.(s);
  };

  log(`facebook-osint-reclassify — mode=${commit ? "COMMIT" : "DRY-RUN"}`);

  const rows = await db
    .select()
    .from(socialRawTable)
    .where(eq(socialRawTable.sourceName, FACEBOOK_SOURCE_NAME));
  summary.considered = rows.length;

  const llm = isLlmAvailable();
  let translationsThisRun = 0;

  for (const item of rows) {
    try {
      const raw = (item.caption ?? "").trim();

      // --- 1. Translate (only genuinely non-English, still-untranslated rows).
      let captionEn = item.captionEn ?? null;
      const needsTranslation =
        !captionEn && raw.length > 0 && !isLikelyEnglish(raw);
      if (needsTranslation) {
        if (!llm) {
          summary.translateSkippedNoLlm++;
        } else if (translationsThisRun < maxTranslations) {
          translationsThisRun++;
          const translated = await translateCaptionToEnglish(raw);
          if (translated) {
            captionEn = translated;
            summary.translated++;
          }
        }
      }

      // --- 2. Guard + recompute from stored fields.
      const r = recompute(item, captionEn);
      const demoted = r.category !== item.category; // only ever → "Other security"
      const changed = columnsChanged(item, r);

      if (!changed) {
        summary.unchanged++;
        continue;
      }
      summary.updated++;
      if (demoted) summary.demotedIds.push(item.id);

      // A demoted row that was promoted into an incident must be un-promoted.
      const needsUnpromote =
        demoted && !r.securityRelevant && item.promotedIncidentId != null;

      if (!commit) {
        if (needsUnpromote) {
          summary.unpromoted++;
          summary.unpromotedIncidentIds.push(item.promotedIncidentId!);
        }
        continue;
      }

      if (needsUnpromote) {
        const incId = item.promotedIncidentId!;
        await db.transaction(async (tx) => {
          const [inc] = await tx
            .select({
              id: incidentsTable.id,
              analystNotes: incidentsTable.analystNotes,
            })
            .from(incidentsTable)
            .where(eq(incidentsTable.id, incId));

          // Only delete an incident we minted from THIS row (marker match) or a
          // dangling back-link (incident already gone). Never touch an incident
          // that belongs to another source row.
          let clear = false;
          if (!inc) {
            clear = true; // dangling back-link
          } else if (markerSocialRawId(inc.analystNotes) === item.id) {
            await tx.delete(incidentsTable).where(eq(incidentsTable.id, incId));
            clear = true;
            summary.unpromoted++;
            summary.unpromotedIncidentIds.push(incId);
          } else {
            summary.errors.push(
              `row #${item.id}: promoted incident #${incId} marker mismatch — left intact`,
            );
          }

          await tx
            .update(socialRawTable)
            .set({
              captionEn: r.captionEn,
              category: r.category,
              securityRelevant: r.securityRelevant,
              credible: r.credible,
              credibilityReason: r.credibilityReason,
              promotable: r.promotable,
              promotionTopic: r.promotionTopic,
              reviewFlag: r.reviewFlag,
              reviewReason: r.reviewReason,
              confidence: r.confidence,
              ...(clear
                ? {
                    reviewStatus: "pending_review",
                    promotedIncidentId: null,
                    promotedAt: null,
                  }
                : {}),
              updatedAt: new Date(),
            })
            .where(eq(socialRawTable.id, item.id));
        });
      } else {
        await db
          .update(socialRawTable)
          .set({
            captionEn: r.captionEn,
            category: r.category,
            securityRelevant: r.securityRelevant,
            credible: r.credible,
            credibilityReason: r.credibilityReason,
            promotable: r.promotable,
            promotionTopic: r.promotionTopic,
            reviewFlag: r.reviewFlag,
            reviewReason: r.reviewReason,
            confidence: r.confidence,
            updatedAt: new Date(),
          })
          .where(eq(socialRawTable.id, item.id));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      summary.errors.push(`row #${item.id}: ${msg}`);
      log(`  ERROR row #${item.id}: ${msg}`);
    }
  }

  summary.demoted = summary.demotedIds.length;

  log(
    `  considered=${summary.considered} translated=${summary.translated} translate-skipped-no-llm=${summary.translateSkippedNoLlm} demoted=${summary.demoted} unpromoted=${summary.unpromoted} updated=${summary.updated} unchanged=${summary.unchanged}`,
  );
  if (!commit) log("  DRY-RUN — re-run with --commit to write.");

  return summary;
}
