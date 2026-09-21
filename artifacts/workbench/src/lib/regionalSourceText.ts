const KNOWN_REGIONAL_MASTHEADS = [
  "Ratopati",
  "SuaraGarut.ID",
  "The New Indian Express",
  "Inquirer.net",
  "SBS",
  "Reuters",
  "Associated Press",
  "AFP",
  "BBC",
  "CNN",
] as const;

function escaped(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Removes publisher/feed decoration without rewriting the reported facts.
 * Numbers, place names and ordinary prose are intentionally left untouched.
 */
export function cleanRegionalSourceText(
  text: string | null | undefined,
  source?: string | null,
): string {
  if (!text) return "";
  let cleaned = text
    .replace(/https?:\/\/[^\s)\]}]+/gi, " ")
    .replace(/\bwww\.[^\s)\]}]+/gi, " ")
    .replace(/\b(?:source|read more|read full story)\s*:\s*(?=$|[|—–-])/gi, " ")
    .replace(/\b(?:subscribe(?: now)?|click here|continue reading)\b[\s.!]*/gi, " ")
    .replace(/\bappeared first on\b[\s\S]*$/i, " ");

  const labels = [...KNOWN_REGIONAL_MASTHEADS, source?.trim()]
    .filter((label): label is string => Boolean(label))
    .sort((a, b) => b.length - a.length);
  for (const label of new Set(labels)) {
    const pattern = escaped(label);
    cleaned = cleaned
      .replace(new RegExp(`^\\s*(?:source\\s*:\\s*)?${pattern}\\s*(?:[|:—–-]\\s*)?`, "i"), "")
      .replace(new RegExp(`\\s*(?:[|:—–-]\\s*)?${pattern}\\s*$`, "i"), "")
      .replace(new RegExp(`\\s*\\(\\s*${pattern}\\s*\\)\\s*$`, "i"), "");
  }

  return cleaned
    .replace(/\s+[|—–-]\s*$/u, "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}