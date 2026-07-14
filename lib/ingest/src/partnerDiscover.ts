import { createHash } from "node:crypto";
import {
  type PartnerProviderKey,
  partnerSourceByKey,
  resolvePartnerUrl,
} from "./m15/partnerSources";

export type PartnerListingItem = {
  provider: PartnerProviderKey;
  externalId: string;
  title: string;
  publishedAt: Date | null;
  sourceUrl: string;
  pdfUrl?: string;
  contentType: "html" | "pdf";
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

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function parseDate(value: string | undefined | null): Date | null {
  if (!value?.trim()) return null;
  const d = new Date(value.trim());
  return Number.isNaN(d.getTime()) ? null : d;
}

function hashSlug(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 12);
}

/** Stable external id from a product URL and optional title. */
export function partnerExternalIdFromUrl(
  url: string,
  title?: string,
): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    const advisory = path.match(/jmic-advisory-note-0?(\d{3})-?(\d{2})-?([a-z0-9-]+)/i);
    if (advisory) {
      return `${advisory[1]}-${advisory[2]}${advisory[3] ? `-${advisory[3].replace(/^-+/, "")}` : ""}`;
    }
    const segments = path.split("/").filter(Boolean);
    const last = segments[segments.length - 1]?.replace(/\.pdf$/i, "") ?? "";
    if (last && last.length >= 4 && !/^jmic-products$/i.test(last)) {
      const cleaned = last
        .replace(/^jmic-advisory-note-/, "")
        .replace(/^cmf-/, "")
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "");
      if (cleaned.length >= 4) return cleaned;
    }
  } catch {
    // fall through
  }
  if (title?.trim()) {
    const fromTitle = slugify(title);
    if (fromTitle.length >= 4) return fromTitle;
  }
  return hashSlug(url);
}

function extractCardProducts(
  html: string,
  provider: PartnerProviderKey,
  siteOrigin: string,
): PartnerListingItem[] {
  const items: PartnerListingItem[] = [];
  const cardRe =
    /<h3[^>]*>([\s\S]*?)<\/h3>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>/gi;
  for (const match of html.matchAll(cardRe)) {
    const title = stripTags(match[1] ?? "");
    const href = (match[2] ?? "").trim();
    if (!title || !href || href === "#" || href === "") continue;
    const sourceUrl = resolvePartnerUrl(href, siteOrigin);
    const isPdf = /\.pdf(?:\?|$)/i.test(sourceUrl);
    items.push({
      provider,
      externalId: partnerExternalIdFromUrl(sourceUrl, title),
      title,
      publishedAt: null,
      sourceUrl,
      pdfUrl: isPdf ? sourceUrl : undefined,
      contentType: isPdf ? "pdf" : "html",
    });
  }
  return items;
}

function extractAnchorProducts(
  html: string,
  provider: PartnerProviderKey,
  siteOrigin: string,
): PartnerListingItem[] {
  const items: PartnerListingItem[] = [];
  const seen = new Set<string>();
  const anchorRe = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorRe)) {
    const href = (match[1] ?? "").trim();
    if (!href || href.startsWith("#") || href.startsWith("mailto:")) continue;
    const lower = href.toLowerCase();
    const isPartnerPath =
      lower.includes("/partner-products/") ||
      lower.includes("/jmic-") ||
      lower.includes("/cmf-") ||
      /\.pdf(?:\?|$)/i.test(lower);
    if (!isPartnerPath) continue;

    const sourceUrl = resolvePartnerUrl(href, siteOrigin);
    const norm = sourceUrl.toLowerCase();
    if (seen.has(norm)) continue;
    seen.add(norm);

    const linkText = stripTags(match[2] ?? "");
    const title =
      linkText.length >= 4
        ? linkText
        : sourceUrl.split("/").pop()?.replace(/\.pdf.*/i, "") ?? "Partner product";
    const isPdf = /\.pdf(?:\?|$)/i.test(sourceUrl);
    items.push({
      provider,
      externalId: partnerExternalIdFromUrl(sourceUrl, title),
      title,
      publishedAt: null,
      sourceUrl,
      pdfUrl: isPdf ? sourceUrl : undefined,
      contentType: isPdf ? "pdf" : "html",
    });
  }
  return items;
}

function extractArticleProducts(
  html: string,
  provider: PartnerProviderKey,
  siteOrigin: string,
): PartnerListingItem[] {
  const articleMatch = html.match(
    /<article[^>]*class="[^"]*(?:jmic|cmf)-product[^"]*"[^>]*>([\s\S]*?)<\/article>/i,
  );
  if (!articleMatch) return [];
  const block = articleMatch[0] ?? "";
  const title =
    stripTags(
      block.match(/<h2[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/h2>/i)?.[1] ??
        block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1] ??
        "",
    ) || `${provider.toUpperCase()} product`;
  const time = block.match(/<time[^>]+datetime="([^"]+)"/i)?.[1];
  const pdfHref = block.match(/<a[^>]+href="([^"]+\.pdf[^"]*)"/i)?.[1];
  const sourceUrl = resolvePartnerUrl(
    pdfHref ?? `/${provider}-product/${slugify(title)}`,
    siteOrigin,
  );
  return [
    {
      provider,
      externalId: partnerExternalIdFromUrl(sourceUrl, title),
      title,
      publishedAt: parseDate(time),
      sourceUrl,
      pdfUrl: pdfHref ? resolvePartnerUrl(pdfHref, siteOrigin) : undefined,
      contentType: pdfHref ? "pdf" : "html",
    },
  ];
}

function dedupeListingItems(items: PartnerListingItem[]): PartnerListingItem[] {
  const byId = new Map<string, PartnerListingItem>();
  for (const item of items) {
    const key = `${item.provider}:${item.externalId}`;
    if (!byId.has(key)) byId.set(key, item);
  }
  return Array.from(byId.values());
}

/** Discover partner products from a listing or product index HTML page. */
export function discoverPartnerProducts(
  provider: PartnerProviderKey,
  listingHtml: string,
): PartnerListingItem[] {
  const def = partnerSourceByKey(provider);
  const fromCards = extractCardProducts(listingHtml, provider, def.siteOrigin);
  const fromAnchors = extractAnchorProducts(listingHtml, provider, def.siteOrigin);
  const fromArticle = extractArticleProducts(listingHtml, provider, def.siteOrigin);
  return dedupeListingItems([...fromCards, ...fromAnchors, ...fromArticle]).filter(
    (item) => !/\/jmic-products\/?$/.test(item.sourceUrl.replace(def.siteOrigin, "")),
  );
}

/** Fixture-backed products with detail pages for parser tests and ingest dry-runs. */
export const PARTNER_FIXTURE_LISTING_ITEMS: Record<
  PartnerProviderKey,
  PartnerListingItem[]
> = {
  jmic: [
    {
      provider: "jmic",
      externalId: "012-26-southern-corridor",
      title: "JMIC Advisory Note: 012-26 | Southern Corridor Available",
      publishedAt: new Date("2026-07-06"),
      sourceUrl:
        "https://www.ukmto.org/partner-products/jmic-products/jmic-advisories/012-26-southern-corridor",
      pdfUrl:
        "https://www.ukmto.org/-/media/ukmto/products/jmic-advisory-note-01226-southern-corridor-available.pdf?rev=9a14a580491c4cc388e09d351578bad1",
      contentType: "html",
    },
  ],
  cmf: [
    {
      provider: "cmf",
      externalId: "threat-assessment-q2-2026",
      title: "CMF Regional Threat Assessment — Arabian Gulf Q2 2026",
      publishedAt: new Date("2026-06-15"),
      sourceUrl:
        "https://www.ukmto.org/partner-products/cmf-products/threat-assessment-q2-2026",
      contentType: "html",
    },
  ],
};

export function mergeFixturePartnerProducts(
  provider: PartnerProviderKey,
  discovered: PartnerListingItem[],
): PartnerListingItem[] {
  const extras = PARTNER_FIXTURE_LISTING_ITEMS[provider] ?? [];
  return dedupeListingItems([...discovered, ...extras]);
}

export const PARTNER_LISTING_FIXTURES: Record<PartnerProviderKey, string> = {
  jmic: "jmic-products-listing.html",
  cmf: "cmf-products-listing.html",
};

export const PARTNER_DETAIL_FIXTURES: Record<
  PartnerProviderKey,
  Record<string, string>
> = {
  jmic: {
    "012-26-southern-corridor": "jmic-advisory-012-26-southern-corridor.html",
  },
  cmf: {
    "threat-assessment-q2-2026": "cmf-threat-assessment-q2-2026.html",
  },
};

export const PARTNER_PDF_FIXTURES: Record<
  PartnerProviderKey,
  Record<string, string>
> = {
  jmic: {
    "012-26-southern-corridor": "jmic-advisory-012-26-southern-corridor.pdf",
  },
  cmf: {},
};
