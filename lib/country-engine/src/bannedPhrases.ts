// Automated gobbledegook removal (owner brief §30) + banned BLUF openers (§15).
//
// Pure data + a single detector. No runtime dependencies.

// §30 — the FULL banned phrase list, transcribed verbatim from the brief.
export const BANNED_PHRASES: string[] = [
  "Operating picture",
  "Operationally significant reporting",
  "Business exposure centres on",
  "Easing from an elevated baseline",
  "While this picture holds",
  "Principal business risk",
  "This activity was more prominent",
  "Security-relevant incidents",
  "Operational centres",
  "The picture is led by",
  "Business users should",
  "For business users the priority is",
  "Direct exposure to violence and disruption",
  "Most likely disruption over the next seven days",
  "The coming week most likely follows the current pattern",
  "Sustained quiet stretch",
  "Knock-on delays",
  "Keep contingency arrangements under active review",
  "Operating sites",
  "Exposed sites",
  "Current pattern",
  "Wider operating environment",
];

// §15 — banned Bottom Line Up Front openers. The BLUF must not begin with a
// copied news headline or a generic template opener. The brief bans these
// specific phrases from appearing anywhere in the BLUF, and additionally names
// generic template openers that must not START the BLUF.
export const BANNED_OPENERS: string[] = [
  "The reporting pattern",
  "The operating picture",
  "Operating picture",
  "Lead development was",
  "Most operationally significant reporting",
  "Business exposure centres on",
  "Easing from an elevated baseline",
  "While this picture holds",
  "Principal business risk is direct exposure",
  "This period looks to be",
];

/**
 * Return every banned phrase (§30) that appears in the supplied text, matched
 * case-insensitively. British English throughout. Returns the canonical banned
 * phrase strings (not the matched casing) so callers can report them.
 */
export function findBannedPhrases(text: string): string[] {
  if (!text) return [];
  const haystack = text.toLowerCase();
  const found: string[] = [];
  for (const phrase of BANNED_PHRASES) {
    if (haystack.includes(phrase.toLowerCase())) {
      found.push(phrase);
    }
  }
  return found;
}

/**
 * Return every banned opener (§15) that the supplied text BEGINS with, matched
 * case-insensitively after trimming leading whitespace/quotation marks.
 */
export function findBannedOpeners(text: string): string[] {
  if (!text) return [];
  const trimmed = text.replace(/^[\s"'“”‘’]+/, "").toLowerCase();
  const found: string[] = [];
  for (const opener of BANNED_OPENERS) {
    if (trimmed.startsWith(opener.toLowerCase())) {
      found.push(opener);
    }
  }
  return found;
}
