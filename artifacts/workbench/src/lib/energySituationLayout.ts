/**
 * Energy headings belong to the source, not to a hardcoded country classifier.
 * An overview mentioning a place must not become a second country section.
 */
export type EnergySituationHeading = string;

export type EnergySituationSegment = {
  text: string;
  heading: EnergySituationHeading | null;
  kind: "paragraph" | "standalone-label";
};

function sourceHeading(line: string): string | null {
  const text = line.trim();
  const marked = text.match(/^#{1,6}\s+(.+?)\s*#*$/) ??
    text.match(/^\*\*(.+?)\*\*:?\s*$/);
  if (marked) return marked[1].replace(/:$/, "").trim();
  // Accept legacy labels, but never infer a heading from a narrative sentence.
  if (text.length > 120 || /[.!?;]$/.test(text)) return null;
  if (/^[\p{L}\p{N}][^.!?;]+:$/u.test(text)) return text.slice(0, -1).trim();
  if (/\p{L}/u.test(text) && text === text.toUpperCase()) return text;
  if (/^[\p{Lu}][\p{L}'’-]*(?:\s*(?:\/|—|–)\s*[\p{Lu}][\p{L}'’-]*)+$/u.test(text)) return text;
  if (/^[\p{Lu}][\p{L}'’-]*(?:\s+[\p{Lu}][\p{L}'’-]*){0,5}$/u.test(text)) return text;
  return null;
}

/** Combine repeated explicit sections; preserve every distinct paragraph. */
export function segmentEnergySituationProse(
  text: string | null | undefined,
): EnergySituationSegment[] {
  const groups: Array<{ heading: string | null; paragraphs: string[] }> = [];
  const byHeading = new Map<string, (typeof groups)[number]>();
  let current = { heading: null as string | null, paragraphs: [] as string[] };
  groups.push(current);
  for (const line of (text ?? "").split(/\r?\n+/).filter((p) => p.trim())) {
    const heading = sourceHeading(line);
    if (heading) {
      const key = heading.toLocaleLowerCase().replace(/\s+/g, " ").trim();
      let group = byHeading.get(key);
      if (!group) {
        group = { heading, paragraphs: [] };
        byHeading.set(key, group);
        groups.push(group);
      }
      current = group;
    } else {
      const key = line.trim().replace(/\s+/g, " ");
      if (!current.paragraphs.some((p) => p.trim().replace(/\s+/g, " ") === key)) {
        current.paragraphs.push(line);
      }
    }
  }
  return groups.flatMap((group): EnergySituationSegment[] => {
    if (!group.paragraphs.length) return [];
    return [
      ...(group.heading ? [{
        text: group.heading, heading: group.heading, kind: "standalone-label" as const,
      }] : []),
      ...group.paragraphs.map((paragraph) => ({
        text: paragraph, heading: null, kind: "paragraph" as const,
      })),
    ];
  });
}