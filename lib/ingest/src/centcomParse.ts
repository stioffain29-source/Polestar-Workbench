import {
  TRIGGER_TERMS,
  matchRegionTags,
  matchesTerms,
} from "./m15/triggerTerms";

export const CENTCOM_SITE_ORIGIN = "https://www.centcom.mil";

export type CentcomListingItem = {
  externalId: string;
  title: string;
  publishedAt: Date | null;
  sourceUrl: string;
  summary?: string;
  /** Raw RSS description HTML — used when Akamai blocks detail pages. */
  rssDescriptionHtml?: string;
};

const CENTCOM_PRESS_RELEASE_PATH_RE =
  /centcom\.mil\/media\/(?:public-releases|press-releases)\//i;

/** True when a URL points at an official CENTCOM press / public release article. */
export function isCentcomPressReleaseUrl(url: string): boolean {
  return CENTCOM_PRESS_RELEASE_PATH_RE.test(url);
}

/** True for any official centcom.mil media article (press release or news article). */
export function isCentcomOfficialArticleUrl(url: string): boolean {
  return /centcom\.mil\/media\//i.test(url) && /\/article\/\d+\//i.test(url);
}

/** Keep only official centcom.mil media articles. */
export function filterCentcomOfficialArticleItems(
  items: CentcomListingItem[],
): CentcomListingItem[] {
  return items.filter((item) => isCentcomOfficialArticleUrl(item.sourceUrl));
}

/** Keep only official CENTCOM press-release article URLs. */
export function filterCentcomPressReleaseItems(
  items: CentcomListingItem[],
): CentcomListingItem[] {
  return items.filter((item) => isCentcomPressReleaseUrl(item.sourceUrl));
}

/** Dedupe listing rows by article id, keeping the richest record per id. */
export function dedupeCentcomListingItems(
  items: CentcomListingItem[],
): CentcomListingItem[] {
  const byId = new Map<string, CentcomListingItem>();
  for (const item of items) {
    const prev = byId.get(item.externalId);
    if (!prev) {
      byId.set(item.externalId, item);
      continue;
    }
    const prevRich = (prev.rssDescriptionHtml?.length ?? 0) + (prev.summary?.length ?? 0);
    const nextRich = (item.rssDescriptionHtml?.length ?? 0) + (item.summary?.length ?? 0);
    if (nextRich > prevRich) byId.set(item.externalId, item);
  }
  return Array.from(byId.values());
}

/** Plain-text body from an RSS description block (may contain inline HTML). */
export function bodyTextFromRssDescription(descriptionHtml: string): string {
  return stripTags(descriptionHtml);
}

/** Extract image URLs embedded in RSS description HTML. */
export function extractCentcomImageUrlsFromHtml(
  html: string,
  baseUrl = CENTCOM_SITE_ORIGIN,
): string[] {
  return Array.from(
    new Set(
      (html.match(/<img\b[^>]*>/gi) ?? [])
        .map((tag) => attrValue(tag, "src"))
        .filter((src): src is string => !!src)
        .map((src) => resolveCentcomUrl(src, baseUrl)),
    ),
  );
}

export type CentcomDetail = {
  externalId: string;
  title: string;
  publishedAt: Date | null;
  bodyText: string;
  sourceUrl: string;
  imageUrls?: string[];
  regionTags?: string[];
  categories?: string[];
};

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

/** Resolve href against the CENTCOM site origin. */
export function resolveCentcomUrl(href: string, baseUrl = CENTCOM_SITE_ORIGIN): string {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#")) return trimmed;
  try {
    return new URL(trimmed, baseUrl).href;
  } catch {
    return trimmed;
  }
}

function parseIsoDate(value: string | undefined): Date | null {
  if (!value?.trim()) return null;
  const d = new Date(value.trim());
  return Number.isNaN(d.getTime()) ? null : d;
}

function attrValue(tag: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i");
  const m = tag.match(re);
  return m ? (m[2] ?? m[3] ?? "").trim() : null;
}

function firstMatch(html: string, re: RegExp): string | null {
  const m = html.match(re);
  return m?.[1]?.trim() ?? null;
}

function dataTagToLabel(slug: string): string {
  return slug.replace(/-/g, " ").trim().toLowerCase();
}

function inferCentcomCategories(text: string, tagSlugs: string[]): string[] {
  const blob = `${text} ${tagSlugs.join(" ")}`.toLowerCase();
  const categories = new Set<string>();
  if (
    /\b(conflict|strike|airstrike|kinetic|attack|missile|hostile)\b/.test(blob) ||
    tagSlugs.includes("conflict")
  ) {
    categories.add("conflict");
  }
  if (
    matchesTerms(blob, TRIGGER_TERMS.centcom.operationalTerms) ||
    /\bmilitary\b/.test(blob) ||
    tagSlugs.includes("military")
  ) {
    categories.add("military");
  }
  if (
    matchesTerms(blob, TRIGGER_TERMS.centcom.escalationTerms) ||
    /\bescalation\b/.test(blob) ||
    tagSlugs.includes("escalation")
  ) {
    categories.add("escalation");
  }
  return Array.from(categories);
}

/**
 * Parse a CENTCOM press-releases listing page into link records.
 * Expects fixture/live tiles: article.listing-tile[data-article-id].
 */
export function parseCentcomListing(
  html: string,
  baseUrl = CENTCOM_SITE_ORIGIN,
): CentcomListingItem[] {
  const items: CentcomListingItem[] = [];
  const articleRe =
    /<article\b[^>]*class="[^"]*listing-tile[^"]*"[^>]*>[\s\S]*?<\/article>/gi;

  for (const block of html.match(articleRe) ?? []) {
    const openTag = block.match(/<article\b[^>]*>/i)?.[0] ?? "";
    const externalId = attrValue(openTag, "data-article-id");
    if (!externalId) continue;

    const href =
      firstMatch(block, /<h2[^>]*class="[^"]*listing-tile__title[^"]*"[^>]*>\s*<a[^>]*href="([^"]+)"/i) ??
      firstMatch(block, /<a[^>]*href="([^"]+)"[^>]*>/i);
    if (!href) continue;

    const title =
      firstMatch(
        block,
        /<h2[^>]*class="[^"]*listing-tile__title[^"]*"[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/i,
      ) ?? "";
    if (!title.trim()) continue;

    const datetime =
      firstMatch(block, /<time[^>]*datetime="([^"]+)"/i) ??
      firstMatch(block, /<time[^>]*>([^<]+)<\/time>/i);
    const summaryRaw = firstMatch(
      block,
      /<p[^>]*class="[^"]*listing-tile__summary[^"]*"[^>]*>([\s\S]*?)<\/p>/i,
    );

    items.push({
      externalId,
      title: stripTags(title),
      publishedAt: parseIsoDate(datetime ?? undefined),
      sourceUrl: resolveCentcomUrl(href, baseUrl),
      summary: summaryRaw ? stripTags(summaryRaw) : undefined,
    });
  }

  return items;
}

/** Strip the publisher masthead Google News appends to CENTCOM titles. */
export function stripCentcomGoogleNewsTitle(title: string): string {
  return title.replace(/\s+-\s+centcom\.mil\s*$/i, "").trim();
}

/** True when a Google News title is clearly not a press / public release. */
export function isCentcomGoogleNewsNoiseTitle(title: string): boolean {
  return /\b(photo gallery|tag obama|tag [a-z]+|biograph)/i.test(title);
}

/**
 * Parse a Google News RSS search feed for centcom.mil items.
 * Links are opaque redirects (no /Article/{id}/) until resolved downstream.
 */
export function parseGoogleNewsCentcomRssListing(xml: string): CentcomListingItem[] {
  const items: CentcomListingItem[] = [];
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;

  for (const block of xml.match(itemRe) ?? []) {
    const titleRaw =
      firstMatch(block, /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i) ?? "";
    const link =
      firstMatch(block, /<link>([^<]+)<\/link>/i) ??
      firstMatch(block, /<guid[^>]*>([^<]+)<\/guid>/i);
    if (!link?.trim()) continue;

    const title = stripCentcomGoogleNewsTitle(stripTags(titleRaw));
    if (!title || isCentcomGoogleNewsNoiseTitle(title)) continue;

    const pubDate =
      firstMatch(block, /<pubDate>([^<]+)<\/pubDate>/i) ??
      firstMatch(block, /<dc:date>([^<]+)<\/dc:date>/i);
    const publishedAt = pubDate ? parseIsoDate(pubDate) ?? new Date(pubDate) : null;
    if (publishedAt && Number.isNaN(publishedAt.getTime())) continue;

    const summaryRaw = firstMatch(
      block,
      /<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i,
    );

    const articleId =
      firstMatch(link, /\/Article\/(\d+)\//) ??
      firstMatch(block, /\/Article\/(\d+)\//);
    const guid =
      firstMatch(block, /<guid[^>]*>([^<]+)<\/guid>/i) ??
      extractArticleIdFromGoogleNewsUrl(link);
    const externalId = articleId ?? (guid ? `gn-${guid.slice(0, 40)}` : null);
    if (!externalId) continue;

    items.push({
      externalId,
      title,
      publishedAt: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : null,
      sourceUrl: link.trim(),
      summary: summaryRaw ? stripTags(summaryRaw) : undefined,
      rssDescriptionHtml: summaryRaw ?? undefined,
    });
  }

  return items;
}

function extractArticleIdFromGoogleNewsUrl(url: string): string | null {
  const m = url.match(/\/(?:rss\/)?articles\/([^?/]+)/);
  return m?.[1] ?? null;
}

/**
 * Parse the official CENTCOM press-release RSS feed (ContentType=2).
 * Used for live ingest when the HTML listing page is WAF-blocked.
 */
export function parseCentcomRssListing(
  xml: string,
  baseUrl = CENTCOM_SITE_ORIGIN,
): CentcomListingItem[] {
  const items: CentcomListingItem[] = [];
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;

  for (const block of xml.match(itemRe) ?? []) {
    const titleRaw =
      firstMatch(block, /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i) ?? "";
    const link =
      firstMatch(block, /<link>([^<]+)<\/link>/i) ??
      firstMatch(block, /<guid[^>]*>([^<]+)<\/guid>/i);
    if (!link?.trim()) continue;

    const externalId =
      firstMatch(link, /\/Article\/(\d+)\//) ??
      firstMatch(block, /\/Article\/(\d+)\//);
    if (!externalId) continue;

    const title = stripTags(titleRaw);
    if (!title) continue;

    const pubDate =
      firstMatch(block, /<pubDate>([^<]+)<\/pubDate>/i) ??
      firstMatch(block, /<dc:date>([^<]+)<\/dc:date>/i);
    const publishedAt = pubDate ? parseIsoDate(pubDate) ?? new Date(pubDate) : null;
    if (publishedAt && Number.isNaN(publishedAt.getTime())) continue;

    const summaryRaw = firstMatch(
      block,
      /<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i,
    );

    items.push({
      externalId,
      title,
      publishedAt: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : null,
      sourceUrl: resolveCentcomUrl(link.trim(), baseUrl),
      summary: summaryRaw ? stripTags(summaryRaw) : undefined,
      rssDescriptionHtml: summaryRaw ?? undefined,
    });
  }

  return items;
}

/**
 * Parse a single CENTCOM release detail page.
 */
export function parseCentcomDetail(
  html: string,
  baseUrl: string,
): CentcomDetail {
  const articleOpen = html.match(/<article\b[^>]*class="[^"]*press-release[^"]*"[^>]*>/i)?.[0] ?? "";
  const externalId =
    attrValue(articleOpen, "data-article-id") ??
    firstMatch(html, /\/Article\/(\d+)\//) ??
    "unknown";

  const title =
    stripTags(
      firstMatch(html, /<h1[^>]*class="[^"]*press-release__title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i) ??
        firstMatch(html, /<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i) ??
        firstMatch(html, /<title>([\s\S]*?)<\/title>/i) ??
        "",
    );

  const publishedRaw =
    firstMatch(html, /<meta[^>]*property="article:published_time"[^>]*content="([^"]+)"/i) ??
    firstMatch(html, /<time[^>]*class="[^"]*press-release__date[^"]*"[^>]*datetime="([^"]+)"/i) ??
    firstMatch(html, /<time[^>]*datetime="([^"]+)"/i);

  const canonicalHref =
    firstMatch(html, /<link[^>]*rel="canonical"[^>]*href="([^"]+)"/i) ??
    firstMatch(html, /href="([^"]*\/Article\/\d+\/[^"]*)"/i);
  const sourceUrl = canonicalHref ? resolveCentcomUrl(canonicalHref, baseUrl) : baseUrl;

  const bodyBlock =
    firstMatch(html, /<div[^>]*class="[^"]*press-release__body[^"]*"[^>]*>([\s\S]*?)<\/div>/i) ??
    "";
  const paragraphs = bodyBlock.match(/<p[^>]*>[\s\S]*?<\/p>/gi) ?? [];
  const bodyText = paragraphs
    .map((p) => stripTags(p))
    .filter(Boolean)
    .join("\n\n");

  const imageUrls = Array.from(
    new Set(
      (html.match(/<img[^>]*src="([^"]+)"/gi) ?? [])
        .map((tag) => attrValue(tag, "src"))
        .filter((src): src is string => !!src)
        .map((src) => resolveCentcomUrl(src, baseUrl)),
    ),
  );

  const tagSlugs = Array.from(
    html.matchAll(/<li[^>]*class="[^"]*tag-list__item[^"]*"[^>]*data-tag="([^"]+)"/gi),
  ).map((m) => m[1]!.toLowerCase());

  const explicitRegionTags = tagSlugs
    .filter((slug) => slug !== "military" && slug !== "escalation" && slug !== "conflict")
    .map(dataTagToLabel);

  const blob = `${title} ${bodyText} ${explicitRegionTags.join(" ")}`;
  const matchedRegions = matchRegionTags(blob, TRIGGER_TERMS.centcom.regionTags);
  const regionTags = Array.from(
    new Set([...matchedRegions.map((t) => t.toLowerCase()), ...explicitRegionTags]),
  );

  const categories = inferCentcomCategories(blob, tagSlugs);

  return {
    externalId,
    title,
    publishedAt: parseIsoDate(publishedRaw ?? undefined),
    bodyText,
    sourceUrl,
    imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
    regionTags: regionTags.length > 0 ? regionTags : undefined,
    categories: categories.length > 0 ? categories : undefined,
  };
}
