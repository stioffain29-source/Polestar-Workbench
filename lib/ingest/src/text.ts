export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function hasWord(hay: string, needle: string): boolean {
  return new RegExp(`\\b${escapeRe(needle)}\\b`, "i").test(hay);
}

export function parseDate(s: string | undefined | null): Date | null {
  if (!s) return null;
  const t = new Date(s);
  if (Number.isNaN(t.getTime())) return null;
  return t;
}

export function cleanText(s: string | undefined | null): string {
  if (!s) return "";
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
