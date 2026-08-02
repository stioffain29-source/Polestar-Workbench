export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function hasWord(hay: string, needle: string): boolean {
  return new RegExp(`\\b${escapeRe(needle)}\\b`, "i").test(hay);
}

/**
 * Index of the first word-boundary match of `needle` in `hay` (case-
 * insensitive), or -1 when it does not appear. Used to compare WHERE in a
 * piece of text different candidate terms first appear, rather than just
 * whether they appear at all.
 */
export function firstWordIndex(hay: string, needle: string): number {
  const m = new RegExp(`\\b${escapeRe(needle)}\\b`, "i").exec(hay);
  return m ? m.index : -1;
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

/**
 * Strip private/personal data from a social-media caption before it is stored or
 * sent to any model: phone numbers (Indonesian +62 / 08… and generic
 * international forms), WhatsApp links/numbers, and email addresses. Public
 * hashtags and @org mentions are preserved. This is a hard guardrail — member-
 * level / personal data must never be persisted. Shared by every social source
 * (Instagram, Facebook OSINT, KAMMI).
 */
export function sanitiseCaption(raw: string): string {
  let t = raw;
  // wa.me / api.whatsapp.com links with numbers.
  t = t.replace(/https?:\/\/(?:wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com)\/\S+/gi, "[removed]");
  t = t.replace(/\bwhats?app\b\s*[:#]?\s*\+?\d[\d\s().-]{6,}\d/gi, "[removed]");
  // Email addresses.
  t = t.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[removed]");
  // Indonesian + generic phone numbers (+62…, 08…, or 9+ digit runs).
  t = t.replace(/\+62[\d\s().-]{7,}\d/g, "[removed]");
  t = t.replace(/\b08\d[\d\s().-]{6,}\d/g, "[removed]");
  t = t.replace(/\+?\d[\d\s().-]{9,}\d/g, (m) => {
    const digits = m.replace(/\D/g, "");
    return digits.length >= 10 ? "[removed]" : m;
  });
  return t.replace(/[ \t]{2,}/g, " ").trim();
}
