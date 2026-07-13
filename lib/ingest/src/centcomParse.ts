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
};

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
