// Shared foreign-subject dominance helpers for country brief render gates.
//
// A record filed under a domestic country tag may still be about an overseas
// event (foreign earthquake, foreign riot, Yemen/Houthi theatre). Render gates
// drop such rows only when foreign-place cues OUTNUMBER local anchors across the
// headline text — the same dominance basis used for Indonesia, PNG, and West
// Papua briefs. Pure data (regex pairs) lives in workbench countryMatch; this
// module holds the reusable counting logic so gates cannot drift.

/** Count non-overlapping regex matches in a string. */
export function countPatternMatches(re: RegExp, text: string): number {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  return (text.match(g) ?? []).length;
}

/**
 * True when foreign-subject cues strictly dominate local anchors in `text`.
 * A tie retains the record (precision-first — do not drop ambiguous rows).
 */
export function isForeignSubjectDominant(
  foreignRe: RegExp,
  localRe: RegExp,
  text: string | null | undefined,
): boolean {
  const t = text ?? "";
  const foreignCount = countPatternMatches(foreignRe, t);
  if (foreignCount === 0) return false;
  return foreignCount > countPatternMatches(localRe, t);
}
