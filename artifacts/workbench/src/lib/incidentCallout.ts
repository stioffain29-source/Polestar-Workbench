import { SEVERITY_LEVELS } from "@/lib/topics";

export function clipCalloutTitle(title: string): string {
  if (!title) return "";
  const words = title.replace(/\s+/g, " ").trim().split(" ");
  if (words.length <= 5) return words.join(" ");
  return words.slice(0, 5).join(" ") + "…";
}

export function clipCalloutSummary(summary: string): string {
  if (!summary) return "";
  let firstSentence = summary.split(/(?<=[.!?])\s+/)[0] || summary;
  const words = firstSentence.trim().split(/\s+/);
  if (words.length <= 30) return words.join(" ");
  return words.slice(0, 30).join(" ") + "…";
}

export function severityRank(sev?: string | null): number {
  if (!sev) return 0;
  const k = sev.toLowerCase();
  return SEVERITY_LEVELS.indexOf(k as any) !== -1 ? SEVERITY_LEVELS.indexOf(k as any) : 0;
}
