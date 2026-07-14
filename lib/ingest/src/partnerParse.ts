import {
  TRIGGER_TERMS,
  matchRegionTags,
  type PartnerProviderKey,
} from "./m15";
import {
  JMIC_SITE_ORIGIN,
  CMF_SITE_ORIGIN,
  resolvePartnerUrl,
} from "./m15/partnerSources";

export type PartnerProvider = PartnerProviderKey;

export type PartnerProductInput = {
  provider: PartnerProvider;
  /** Raw text (from PDF extraction or plain text). */
  text: string;
  /** Optional HTML detail page for richer field extraction. */
  html?: string;
  /** Pre-known title (e.g. from listing). */
  title?: string;
  /** Pre-known date string or Date. */
  date?: string | Date | null;
  sourceUrl?: string;
  pdfUrl?: string;
};

export type PartnerProduct = {
  productTitle: string;
  provider: PartnerProvider;
  date: Date;
  region: string;
  threatLevel?: string;
  summary: string;
  sourceUrl: string;
};

const PARTNER_REGION_TAGS = [
  ...TRIGGER_TERMS.centcom.regionTags,
  "gulf of oman",
  "gulf of aden",
  "bab al-mandeb",
  "bab al mandeb",
  "north arabian sea",
  "arabian gulf",
  "persian gulf",
  "indian ocean",
  "arabian sea",
];

const THREAT_LEVEL_RE =
  /\b(?:threat\s+level|regional\s+threat\s+level|security\s+threat\s+level|risk\s+level)\s*(?:is|:|remains)?\s*([A-Z][A-Z\s-]{2,30})\b/i;

const STANDALONE_THREAT_RE =
  /\b(?:threat\s+level|regional\s+threat\s+level)\s*:\s*([A-Z][A-Z\s-]{2,30})\b/i;

const KNOWN_THREAT_TOKENS = [
  "critical",
  "high",
  "substantial",
  "elevated",
  "moderate",
  "low",
  "imminent",
] as const;

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function firstMatch(text: string, re: RegExp): string | null {
  const m = text.match(re);
  return m?.[1]?.trim() ?? null;
}

function parseDate(value: string | undefined | null): Date | null {
  if (!value?.trim()) return null;
  const d = new Date(value.trim());
  return Number.isNaN(d.getTime()) ? null : d;
}

function extractTitleFromHtml(html: string): string | null {
  const h2 = firstMatch(html, /<h2[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/h2>/i);
  if (h2) return stripTags(h2);
  const h1 = firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1 && !/joint maritime information center/i.test(h1)) return stripTags(h1);
  const og = firstMatch(html, /<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i);
  if (og) return decodeHtmlEntities(og);
  const title = firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  return title ? stripTags(title) : null;
}

function extractDateFromHtml(html: string): Date | null {
  const time = firstMatch(html, /<time[^>]+datetime="([^"]+)"/i);
  if (time) return parseDate(time);
  const dd = firstMatch(html, /<dt>\s*Date\s*<\/dt>\s*<dd>([\s\S]*?)<\/dd>/i);
  if (dd) {
    const innerTime = firstMatch(dd, /datetime="([^"]+)"/i);
    if (innerTime) return parseDate(innerTime);
    return parseDate(stripTags(dd));
  }
  return null;
}

function extractRegionFromHtml(html: string): string | null {
  const area = firstMatch(
    html,
    /<dt>\s*(?:Area of Concern|Region)\s*<\/dt>\s*<dd>([\s\S]*?)<\/dd>/i,
  );
  if (area) return stripTags(area);
  return null;
}

function extractThreatFromHtml(html: string): string | null {
  const level = firstMatch(
    html,
    /<dt>\s*(?:Regional Threat Level|Threat Level)\s*<\/dt>\s*<dd>([\s\S]*?)<\/dd>/i,
  );
  if (level) return normalizeThreatLevel(stripTags(level));
  return null;
}

function extractPdfUrlFromHtml(html: string, siteOrigin: string): string | null {
  const href = firstMatch(html, /<a[^>]+href="([^"]+\.pdf[^"]*)"/i);
  return href ? resolvePartnerUrl(href, siteOrigin) : null;
}

function extractFirstParagraph(text: string): string {
  const blocks = text
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter((b) => b.length >= 20);
  if (blocks.length > 0) return blocks[0]!;
  const lines = text
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 40);
  return lines[0] ?? text.trim().slice(0, 500);
}

function normalizeThreatLevel(raw: string): string {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  const lower = cleaned.toLowerCase();
  for (const token of KNOWN_THREAT_TOKENS) {
    if (lower.includes(token)) {
      return token.toUpperCase();
    }
  }
  return cleaned.toUpperCase();
}

function extractThreatLevel(text: string): string | undefined {
  const labeled =
    text.match(THREAT_LEVEL_RE)?.[1] ?? text.match(STANDALONE_THREAT_RE)?.[1];
  if (labeled) return normalizeThreatLevel(labeled);

  const blob = text.toLowerCase();
  for (const token of KNOWN_THREAT_TOKENS) {
    const re = new RegExp(`\\b${token}\\b`, "i");
    if (re.test(blob) && /\bthreat\b|\brisk\b|\blevel\b|\bsecurity\b/.test(blob)) {
      return token.toUpperCase();
    }
  }
  return undefined;
}

function extractRegion(text: string, htmlRegion?: string | null): string {
  if (htmlRegion?.trim()) return htmlRegion.trim();
  const tags = matchRegionTags(text, PARTNER_REGION_TAGS);
  if (tags.length > 0) return tags.join(", ");
  const area = firstMatch(text, /Area of Concern:\s*([^\n.]+)/i);
  if (area) return area.trim();
  return "middle east";
}

function extractTitleFromText(text: string, provider: PartnerProvider): string | null {
  const advisory = firstMatch(
    text,
    /JMIC Advisory Note:\s*([^\n|]+(?:\|[^\n]+)?)/i,
  );
  if (advisory) return `JMIC Advisory Note: ${advisory.trim()}`;
  const cmf = firstMatch(text, /CMF Regional Threat Assessment[^\n]*/i);
  if (cmf) return cmf.trim();
  const line = text.split(/\n/).map((l) => l.trim()).find((l) => l.length >= 15);
  if (line) return line;
  return provider === "jmic"
    ? "JMIC Advisory"
    : "CMF Maritime Product";
}

function extractDateFromText(text: string): Date | null {
  const iso = firstMatch(text, /\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) return parseDate(iso);
  const dmy = firstMatch(text, /\b(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})\b/);
  if (dmy) return parseDate(dmy);
  const pipeDate = firstMatch(text, /\|\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})/);
  if (pipeDate) return parseDate(pipeDate);
  return null;
}

function siteOriginFor(provider: PartnerProvider): string {
  return provider === "jmic" ? JMIC_SITE_ORIGIN : CMF_SITE_ORIGIN;
}

/**
 * Map raw partner PDF/HTML into the Phase 3 partner product field spec.
 */
export function parsePartnerProduct(input: PartnerProductInput): PartnerProduct {
  const html = input.html ?? "";
  const text = input.text.trim();
  const blob = `${stripTags(html)} ${text}`.trim();
  const siteOrigin = siteOriginFor(input.provider);

  const productTitle =
    input.title?.trim() ||
    (html ? extractTitleFromHtml(html) : null) ||
    extractTitleFromText(text, input.provider) ||
    (input.provider === "jmic" ? "JMIC Advisory" : "CMF Maritime Product");

  const date =
    (input.date instanceof Date ? input.date : parseDate(input.date ?? undefined)) ||
    (html ? extractDateFromHtml(html) : null) ||
    extractDateFromText(text) ||
    new Date("1970-01-01T00:00:00Z");

  const htmlRegion = html ? extractRegionFromHtml(html) : null;
  const region = extractRegion(blob, htmlRegion);

  const threatLevel =
    (html ? extractThreatFromHtml(html) : null) ||
    extractThreatLevel(blob) ||
    undefined;

  const summary = html
    ? extractFirstParagraph(stripTags(html.match(/<div[^>]*class="[^"]*body[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? html))
    : extractFirstParagraph(text);

  const pdfUrl =
    input.pdfUrl ||
    (html ? extractPdfUrlFromHtml(html, siteOrigin) : undefined) ||
    undefined;

  const sourceUrl =
    input.sourceUrl?.trim() ||
    pdfUrl ||
    (input.provider === "jmic" ? JMIC_SITE_ORIGIN : CMF_SITE_ORIGIN);

  return {
    productTitle,
    provider: input.provider,
    date,
    region,
    threatLevel,
    summary,
    sourceUrl,
  };
}
