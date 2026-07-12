// Per-incident relevance evaluator — the single, persistable verdict.
//
// `explainRelevance` (topicRelevance.ts) is the source of truth for the
// keep/drop decision and the human-readable reason. This wrapper turns
// that verdict into the shape we persist on each incident row and filter
// on at the API: a boolean, a coarse score, the reason, and a rule
// version so a backfill can re-evaluate rows when the rules change.

import { explainRelevance, type RelevanceInput } from "./topicRelevance";

// Bump whenever the relevance RULES change. The backfill re-evaluates any
// row whose stored version differs (or is null), so a bump cleans the DB
// against the latest rules on the next server boot.
export const RELEVANCE_RULE_VERSION = "2026-07-12.2";

export type RelevanceStatus = "relevant" | "irrelevant";

export interface IncidentRelevanceVerdict {
  relevant: boolean;
  status: RelevanceStatus;
  score: number;
  reason: string;
  version: string;
}

/**
 * Evaluate a single incident against its OWN topic's relevance rules.
 * Returns the persistable verdict. Topics with no rule default to
 * relevant (score 0.5) so unknown families are never silently emptied.
 */
export function evaluateIncidentRelevance(
  topic: string,
  input: RelevanceInput,
): IncidentRelevanceVerdict {
  const { relevant, reason } = explainRelevance(topic, input);
  let score: number;
  if (!relevant) {
    score = 0;
  } else if (/title-rescue|unambiguous|required topic phrase/.test(reason)) {
    score = 1;
  } else if (/ambiguous token/.test(reason)) {
    score = 0.7;
  } else {
    // "default allow (no rule for topic)" and any other keep reason.
    score = 0.5;
  }
  return {
    relevant,
    status: relevant ? "relevant" : "irrelevant",
    score,
    reason,
    version: RELEVANCE_RULE_VERSION,
  };
}
