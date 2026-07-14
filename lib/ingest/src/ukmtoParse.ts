export const UKMTO_SITE_ORIGIN = "https://www.ukmto.org";

export type UkmtoProductType = "warning" | "advisory" | "monthly-report" | "other";

export type UkmtoListingItem = {
  externalId: string;
  productType: UkmtoProductType;
  productNumber: string;
  title: string;
  publishedAt: Date | null;
  sourceUrl: string;
  pdfUrl?: string;
  /** Live Sitecore API reference label (post-2026 site migration). */
  apiReference?: string;
  /** Live Sitecore API location label when no incident match is available. */
  apiLocation?: string;
};

export type UkmtoDetail = {
  externalId: string;
  productType: UkmtoProductType;
  productNumber: string;
  title: string;
  publishedAt: Date | null;
  reportDate: string | null;
  reportTime: string | null;
  locationText: string;
  coordinates: string | null;
  vesselType: string;
  incidentType: string;
  reportedImpact: string;
  sourceUrl: string;
  pdfUrl?: string;
  confidence: "high";
  bodyText: string;
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

function attrValue(tag: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i");
  const m = tag.match(re);
  return m ? (m[2] ?? m[3] ?? "").trim() : null;
}

function firstMatch(html: string, re: RegExp): string | null {
  const m = html.match(re);
  return m?.[1]?.trim() ?? null;
}

function parseIsoDate(value: string | undefined): Date | null {
  if (!value?.trim()) return null;
  const d = new Date(value.trim());
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Resolve href against the UKMTO site origin. */
export function resolveUkmtoUrl(href: string, baseUrl = UKMTO_SITE_ORIGIN): string {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#")) return trimmed;
  try {
    return new URL(trimmed, baseUrl).href;
  } catch {
    return trimmed;
  }
}

function slugFromHref(href: string, baseUrl = UKMTO_SITE_ORIGIN): string {
  try {
    const path = new URL(href, baseUrl).pathname;
    const parts = path.split("/").filter(Boolean);
    return parts[parts.length - 1] ?? "";
  } catch {
    return "";
  }
}

function normalizeProductType(raw: string | null): UkmtoProductType {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "warning") return "warning";
  if (v === "advisory") return "advisory";
  if (v === "monthly-report" || v === "monthly_report") return "monthly-report";
  return "other";
}

function parseDefinitionList(html: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const pairRe =
    /<div>\s*<dt>([\s\S]*?)<\/dt>\s*<dd>([\s\S]*?)<\/dd>\s*<\/div>/gi;
  for (const match of html.matchAll(pairRe)) {
    const key = stripTags(match[1] ?? "").toLowerCase();
    const value = stripTags(match[2] ?? "");
    if (key && value && value !== "—" && value !== "-") {
      fields[key] = value;
    }
  }
  return fields;
}

function buildExternalId(productNumber: string, href: string): string {
  const slug = slugFromHref(href);
  if (slug) return slug;
  return productNumber;
}

/**
 * Parse a UKMTO products listing page into warning/advisory link records.
 * Expects fixture/live list items: li.product-list__item[data-product-type].
 */
export function parseUkmtoListing(
  html: string,
  baseUrl = UKMTO_SITE_ORIGIN,
): UkmtoListingItem[] {
  const items: UkmtoListingItem[] = [];
  const itemRe =
    /<li\b[^>]*class="[^"]*product-list__item[^"]*"[^>]*>[\s\S]*?<\/li>/gi;

  for (const block of html.matchAll(itemRe)) {
    const openTag = block[0].match(/<li\b[^>]*>/i)?.[0] ?? "";
    const productType = normalizeProductType(attrValue(openTag, "data-product-type"));
    const productNumber = attrValue(openTag, "data-product-number") ?? "";

    const href = firstMatch(block[0], /<a[^>]*href="([^"]+)"[^>]*>/i);
    if (!href) continue;

    const title =
      firstMatch(block[0], /<a[^>]*href="[^"]+"[^>]*>\s*([\s\S]*?)\s*<\/a>/i) ?? "";
    if (!title.trim()) continue;

    const datetime = firstMatch(block[0], /<time[^>]*datetime="([^"]+)"/i);
    const pdfHref = firstMatch(
      block[0],
      /<a[^>]*class="[^"]*product-list__pdf[^"]*"[^>]*href="([^"]+)"/i,
    );

    const externalId = buildExternalId(productNumber, href);
    items.push({
      externalId,
      productType,
      productNumber: productNumber || externalId.split("-update-")[0] || externalId,
      title: stripTags(title),
      publishedAt: parseIsoDate(datetime ?? undefined),
      sourceUrl: resolveUkmtoUrl(href, baseUrl),
      pdfUrl: pdfHref ? resolveUkmtoUrl(pdfHref, baseUrl) : undefined,
    });
  }

  return items;
}

function combineReportDatetime(
  reportDate: string | null,
  reportTime: string | null,
  issueDate: string | null,
): Date | null {
  if (issueDate) {
    const fromIssue = parseIsoDate(issueDate);
    if (fromIssue) return fromIssue;
  }
  if (reportDate && reportTime) {
    const normalizedTime = reportTime.replace(/UTC$/i, "").trim();
    const combined = `${reportDate} ${normalizedTime}Z`;
    const d = parseIsoDate(combined);
    if (d) return d;
  }
  return reportDate ? parseIsoDate(reportDate) : null;
}

function buildUkmtoBodyText(parts: {
  narrative: string;
  productNumber: string;
  locationText: string;
  coordinates: string | null;
  vesselType: string;
  incidentType: string;
  reportedImpact: string;
  reportDateTime: string | null;
}): string {
  const lines = [
    "[Confidence: High (official)]",
    "",
    parts.narrative,
    "",
    "---",
    `Product number: ${parts.productNumber}`,
  ];
  if (parts.reportDateTime) lines.push(`Date and time: ${parts.reportDateTime}`);
  lines.push(`Location: ${parts.locationText}`);
  if (parts.coordinates) lines.push(`Coordinates: ${parts.coordinates}`);
  lines.push(`Vessel type: ${parts.vesselType}`);
  lines.push(`Incident type: ${parts.incidentType}`);
  lines.push(`Reported impact: ${parts.reportedImpact}`);
  return lines.join("\n");
}

/**
 * Parse a UKMTO warning or advisory detail page into required product fields.
 */
export function parseUkmtoDetail(
  html: string,
  baseUrl: string,
): UkmtoDetail {
  const articleOpen =
    html.match(/<article\b[^>]*class="[^"]*ukmto-product[^"]*"[^>]*>/i)?.[0] ?? "";
  const productType = normalizeProductType(attrValue(articleOpen, "data-product-type"));
  const productNumber =
    attrValue(articleOpen, "data-product-number") ??
    firstMatch(html, /<dd>\s*(\d{3}-\d{2})\s*<\/dd>/i) ??
    "unknown";

  const title = stripTags(
    firstMatch(html, /<h2[^>]*class="[^"]*ukmto-product__title[^"]*"[^>]*>([\s\S]*?)<\/h2>/i) ??
      firstMatch(html, /<title>([\s\S]*?)<\/title>/i) ??
      "",
  );

  const reportDateRaw = firstMatch(
    html,
    /<dt>Report Date<\/dt>\s*<dd>\s*<time[^>]*datetime="([^"]+)"/i,
  );
  const reportTime = stripTags(
    firstMatch(html, /<dt>Report Time<\/dt>\s*<dd>([\s\S]*?)<\/dd>/i) ?? "",
  ) || null;
  const issueDate = firstMatch(
    html,
    /<dt>Issue Date<\/dt>\s*<dd><time[^>]*datetime="([^"]+)"/i,
  );

  const pdfHref = firstMatch(
    html,
    /<p[^>]*class="[^"]*ukmto-product__pdf[^"]*"[^>]*>\s*<a[^>]*href="([^"]+)"/i,
  );
  const pdfUrl = pdfHref ? resolveUkmtoUrl(pdfHref, baseUrl) : undefined;

  const canonicalHref =
    firstMatch(html, /<link[^>]*rel="canonical"[^>]*href="([^"]+)"/i) ?? baseUrl;
  const sourceUrl = resolveUkmtoUrl(canonicalHref, baseUrl);
  const externalId = slugFromHref(sourceUrl, baseUrl) || productNumber;

  const bodyBlock =
    firstMatch(html, /<div[^>]*class="[^"]*ukmto-product__body[^"]*"[^>]*>([\s\S]*?)<\/div>/i) ??
    "";
  const paragraphs = bodyBlock.match(/<p[^>]*>[\s\S]*?<\/p>/gi) ?? [];
  const narrative = paragraphs.map((p) => stripTags(p)).filter(Boolean).join("\n\n");

  const footerFields = parseDefinitionList(
    firstMatch(html, /<footer[^>]*class="[^"]*ukmto-product__fields[^"]*"[^>]*>([\s\S]*?)<\/footer>/i) ??
      html,
  );

  const locationText =
    footerFields["location text"] ??
    footerFields["location"] ??
    "Not specified";
  const coordinates =
    footerFields["coordinates"] && footerFields["coordinates"] !== "—"
      ? footerFields["coordinates"]
      : null;
  const vesselType = footerFields["vessel type"] ?? "Not specified";
  const incidentType = footerFields["incident type"] ?? title;
  const reportedImpact = footerFields["reported impact"] ?? "Not specified";
  const reportDateTime =
    footerFields["date and time"] ??
    ([reportDateRaw, reportTime].filter(Boolean).join(" ").trim() || null);

  const publishedAt = combineReportDatetime(
    reportDateRaw,
    reportTime,
    issueDate,
  );

  const bodyText = buildUkmtoBodyText({
    narrative,
    productNumber: footerFields["warning / advisory number"] ?? productNumber,
    locationText,
    coordinates,
    vesselType,
    incidentType,
    reportedImpact,
    reportDateTime,
  });

  return {
    externalId,
    productType,
    productNumber: footerFields["warning / advisory number"] ?? productNumber,
    title,
    publishedAt,
    reportDate: reportDateRaw,
    reportTime,
    locationText,
    coordinates,
    vesselType,
    incidentType,
    reportedImpact,
    sourceUrl,
    pdfUrl,
    confidence: "high",
    bodyText,
  };
}
