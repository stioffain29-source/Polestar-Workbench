/**
 * Source-preserving layout helpers for the Energy Situation read.
 *
 * This module does not rewrite, merge, or classify incident data. It only
 * decides whether an already-saved prose paragraph can safely receive one of
 * the report's requested visual geography labels. Both the HTML preview and
 * the PDF renderer should consume these segments so their paragraph order and
 * heading decisions stay identical.
 */

export type EnergySituationHeading =
  | "Bangladesh / Dhaka"
  | "Philippines / Visayas"
  | "Pakistan";

export type EnergySituationSegment = {
  /** Exact paragraph/label text from the saved situation field. */
  text: string;
  /**
   * A heading is present only when this paragraph is a standalone saved label
   * or exclusively names one geography. Multi-geography and unlocated
   * paragraphs deliberately receive null.
   */
  heading: EnergySituationHeading | null;
  /** Standalone labels are rendered as labels, not repeated as body prose. */
  kind: "paragraph" | "standalone-label";
};

type HeadingRule = {
  heading: EnergySituationHeading;
  terms: RegExp[];
};

const HEADING_RULES: HeadingRule[] = [
  {
    heading: "Bangladesh / Dhaka",
    terms: [/\bbangladesh\b/i, /\bdhaka\b/i],
  },
  {
    heading: "Philippines / Visayas",
    terms: [/\bphilippines\b/i, /\bvisayas\b/i],
  },
  {
    heading: "Pakistan",
    terms: [/\bpakistan\b/i],
  },
];

const STANDALONE_LABELS: Array<{
  heading: EnergySituationHeading;
  pattern: RegExp;
}> = [
  {
    heading: "Bangladesh / Dhaka",
    pattern: /^(?:#{1,6}\s*)?(?:bangladesh\s*\/\s*dhaka|dhaka\s*\/\s*bangladesh)\s*:?\s*$/i,
  },
  {
    heading: "Philippines / Visayas",
    pattern: /^(?:#{1,6}\s*)?(?:philippines\s*\/\s*visayas|visayas\s*\/\s*philippines)\s*:?\s*$/i,
  },
  {
    heading: "Pakistan",
    pattern: /^(?:#{1,6}\s*)?pakistan\s*:?\s*$/i,
  },
];

function standaloneHeading(text: string): EnergySituationHeading | null {
  const trimmed = text.trim();
  for (const candidate of STANDALONE_LABELS) {
    if (candidate.pattern.test(trimmed)) return candidate.heading;
  }
  return null;
}

function exclusiveHeading(text: string): EnergySituationHeading | null {
  const matches = HEADING_RULES.filter((rule) =>
    rule.terms.some((term) => term.test(text)),
  );
  return matches.length === 1 ? matches[0].heading : null;
}

/**
 * Split saved Energy Situation text using the same newline paragraph boundary
 * used by the existing preview. Empty lines are presentation spacing and are
 * discarded, but every non-empty paragraph is returned once, in source order,
 * with its wording untouched.
 */
export function segmentEnergySituationProse(
  text: string | null | undefined,
): EnergySituationSegment[] {
  const source = text ?? "";
  return source
    .split(/\r?\n+/)
    .filter((paragraph) => paragraph.trim().length > 0)
    .map((paragraph) => {
      const savedLabel = standaloneHeading(paragraph);
      if (savedLabel) {
        return {
          text: paragraph,
          heading: savedLabel,
          kind: "standalone-label" as const,
        };
      }
      return {
        text: paragraph,
        heading: exclusiveHeading(paragraph),
        kind: "paragraph" as const,
      };
    });
}