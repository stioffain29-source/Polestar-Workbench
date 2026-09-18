import { SEVERITY_LEVELS } from "@/lib/topics";

export function clipCalloutTitle(title: string): string {
  if (!title) return "";
  const clean = title.replace(/\s+/g, " ").trim();
  const lower = clean.toLowerCase();
  if (/\b(?:student|worker|anti-government|pro-iran)\b.*\b(?:protest|demonstrat|rall)/i.test(clean)) return "PROTEST ACTIVITY";
  if (/\bdrone\b/i.test(clean)) return "DRONE INCIDENT";
  if (/\b(?:airport|flight)\b.*\b(?:clos|suspend|disrupt|halt)/i.test(clean)) return "AIRPORT DISRUPTION";
  if (/\b(?:road|highway|route)\b.*\b(?:block|clos|disrupt)/i.test(clean)) return "ROAD DISRUPTION";
  if (/\b(?:typhoon|cyclone|storm|flood)/i.test(clean)) return "WEATHER DISRUPTION";
  if (/\b(?:visa|migration|immigration)\b/i.test(clean)) return "MIGRATION RULE CHANGE";
  if (/\b(?:tariff|export duty|windfall tax)\b/i.test(clean)) return "TRADE POLICY CHANGE";
  if (/\b(?:clash|offensive|armed attack|outpost)\b/i.test(clean)) return "ARMED CLASHES";
  if (/\b(?:strike|walkout)\b/i.test(clean)) return "INDUSTRIAL ACTION";
  const words = clean
    .replace(/^[^:]{2,24}:\s*/, "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 5);
  while (words.length > 2 && /^(?:a|an|and|as|at|for|in|of|on|the|to|with)$/i.test(words[words.length - 1])) {
    words.pop();
  }
  return words.join(" ").replace(/[,:;.!?]+$/, "").toUpperCase();
}

export function clipCalloutSummary(summary: string, maxWords = 25): string {
  if (!summary) return "";
  const clean = summary.replace(/\.{3}|…/g, "").replace(/\s+/g, " ").trim();
  const completeSentence = clean.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? clean;
  const words = completeSentence.split(/\s+/);
  if (words.length <= maxWords) {
    return /[.!?]$/.test(completeSentence) ? completeSentence : `${completeSentence}.`;
  }
  const withinLimit = words.slice(0, maxWords).join(" ");
  const clauseEnd = Math.max(withinLimit.lastIndexOf(";"), withinLimit.lastIndexOf(","));
  const clipped = clauseEnd > withinLimit.length * 0.55
    ? withinLimit.slice(0, clauseEnd)
    : withinLimit;
  return `${clipped.replace(/[,:;.!?]+$/, "")}.`;
}

export function severityRank(sev?: string | null): number {
  if (!sev) return 0;
  const k = sev.toLowerCase();
  return SEVERITY_LEVELS.indexOf(k as any) !== -1 ? SEVERITY_LEVELS.indexOf(k as any) : 0;
}
