import { fetchJsonViaCurl, sleep, type CurlFetchOptions } from "./feedFetch";
import {
  UKMTO_SITE_ORIGIN,
  type UkmtoDetail,
  type UkmtoListingItem,
  type UkmtoProductType,
  resolveUkmtoUrl,
} from "./ukmtoParse";

// UKMTO migrated to a Next.js SPA (2026). Listing pages no longer embed
// product rows in SSR HTML — the live catalogue is served from the Royal Navy
// Sitecore Content Delivery API.

export const UKMTO_API_ORIGIN =
  process.env.UKMTO_API_ORIGIN?.trim() || "https://sccd.royalnavy.mod.uk";

export const UKMTO_WARNINGS_TYPE_ID = "19089a80-069d-4974-8899-2a9802bb7cdf";
export const UKMTO_ADVISORIES_TYPE_ID = "30ec4eba-f133-4df6-b7bb-9a2328b64ec6";

const API_TIMEOUT_MS = 30_000;
const API_ATTEMPTS = 3;
const API_BACKOFF_MS = 2500;
const DEFAULT_MAX_LISTING_PRODUCTS = 80;
const DEFAULT_MAX_YEARS = 2;

type UkmtoApiFolder = {
  id: string;
  name: string;
  productItemCount: number;
};

export type UkmtoApiProduct = {
  id: string;
  reference: string;
  issueDate: string;
  name: string;
  location?: string;
  pdfUrl?: string;
};

export type UkmtoApiIncident = {
  incidentNumber: number;
  sitecoreId: string;
  utcDateOfIncident: string;
  utcDateCreated: string;
  incidentTypeName: string;
  place: string;
  locationLatitudeDDDMMSS?: string;
  locationLongitudeDDDMMSS?: string;
  vesselName?: string;
  vesselType?: string;
  otherDetails: string;
};

const PRODUCT_TYPES: ReadonlyArray<{ productType: UkmtoProductType; typeId: string }> =
  [
    { productType: "warning", typeId: UKMTO_WARNINGS_TYPE_ID },
    { productType: "advisory", typeId: UKMTO_ADVISORIES_TYPE_ID },
  ];

/** Headers the UKMTO Next.js SPA sends on cross-origin Sitecore API calls. */
export const UKMTO_API_CURL_OPTS: CurlFetchOptions = {
  accept: "application/json",
  headers: {
    Referer: `${UKMTO_SITE_ORIGIN}/`,
    Origin: UKMTO_SITE_ORIGIN,
    "sec-fetch-site": "cross-site",
    "sec-fetch-mode": "cors",
    "sec-fetch-dest": "empty",
  },
};

function apiOriginFromEnv(): string {
  return UKMTO_API_ORIGIN.replace(/\/$/, "");
}

function isUkmtoBlockedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /\b403\b|forbidden|blocked|cloudflare|attention required/i.test(msg);
}

async function fetchUkmtoJson<T>(path: string): Promise<T> {
  const url = `${apiOriginFromEnv()}${path.startsWith("/") ? path : `/${path}`}`;
  let lastErr: unknown;
  for (let attempt = 0; attempt < API_ATTEMPTS; attempt++) {
    try {
      return fetchJsonViaCurl<T>(url, API_TIMEOUT_MS, UKMTO_API_CURL_OPTS);
    } catch (err) {
      lastErr = err;
      const retryable =
        err instanceof Error &&
        (/curl failed|curl exit|timed out|timeout|empty body/i.test(err.message) ||
          /curl exit [1-9]\d*/.test(err.message) ||
          /status code 429/i.test(err.message) ||
          /status code 5\d{2}/i.test(err.message));
      if (retryable && attempt < API_ATTEMPTS - 1) {
        await sleep(API_BACKOFF_MS * 2 ** attempt + Math.random() * 400);
        continue;
      }
      break;
    }
  }
  const msg =
    lastErr instanceof Error ? lastErr.message : String(lastErr ?? "UKMTO API fetch failed");
  throw new Error(`UKMTO API ${path}: ${msg}`);
}

function parseIsoDate(value: string | undefined): Date | null {
  if (!value?.trim()) return null;
  const d = new Date(value.trim());
  return Number.isNaN(d.getTime()) ? null : d;
}

function slugifySegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Derive a stable external id (e.g. 087-26-attack) from an API product row. */
export function ukmtoExternalIdFromApiProduct(product: UkmtoApiProduct): string {
  const blob = `${product.reference} ${product.name}`.trim();
  const numberMatch = blob.match(/(\d{3}-\d{2})/);
  const productNumber = numberMatch?.[1];
  if (!productNumber) return slugifySegment(product.name || product.id);

  const updateMatch = blob.match(/update[\s_-]*0*(\d{1,3})/i);
  if (updateMatch) {
    const updateNum = updateMatch[1].padStart(3, "0");
    return `${productNumber}-update-${updateNum}`;
  }

  if (/attack/i.test(blob)) return `${productNumber}-attack`;
  if (/advisory/i.test(blob)) return `${productNumber}-advisory`;
  if (/suspicious/i.test(blob)) return `${productNumber}-suspicious-activity`;
  if (/boarding|hijack/i.test(blob)) return `${productNumber}-${slugifySegment(blob.match(/(illegal-boarding|hijack)/i)?.[1] ?? "incident")}`;

  return productNumber;
}

function productPathSegment(productType: UkmtoProductType): string {
  if (productType === "warning") return "warnings";
  if (productType === "advisory") return "advisories";
  return "ukmto-products";
}

export function ukmtoSourceUrlFromApiProduct(
  product: UkmtoApiProduct,
  productType: UkmtoProductType,
): string {
  const externalId = ukmtoExternalIdFromApiProduct(product);
  return resolveUkmtoUrl(
    `/ukmto-products/${productPathSegment(productType)}/${externalId}`,
  );
}

function productNumberFromExternalId(externalId: string): string {
  const m = externalId.match(/^(\d{3}-\d{2})/);
  return m?.[1] ?? externalId;
}

function titleFromApiProduct(product: UkmtoApiProduct, productType: UkmtoProductType): string {
  const externalId = ukmtoExternalIdFromApiProduct(product);
  const productNumber = productNumberFromExternalId(externalId);
  const ref = product.reference.trim();
  if (ref) return ref.replace(/_/g, " ");
  if (productType === "advisory") return `${productNumber} - ADVISORY`;
  return `${productNumber} - WARNING`;
}

export function apiProductToListingItem(
  product: UkmtoApiProduct,
  productType: UkmtoProductType,
): UkmtoListingItem {
  const externalId = ukmtoExternalIdFromApiProduct(product);
  return {
    externalId,
    productType,
    productNumber: productNumberFromExternalId(externalId),
    title: titleFromApiProduct(product, productType),
    publishedAt: parseIsoDate(product.issueDate),
    sourceUrl: ukmtoSourceUrlFromApiProduct(product, productType),
    pdfUrl: product.pdfUrl ? resolveUkmtoUrl(product.pdfUrl) : undefined,
    apiReference: product.reference,
    apiLocation: product.location,
  };
}

function buildBodyText(parts: {
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

function coordinatesFromIncident(incident: UkmtoApiIncident | null): string | null {
  if (!incident?.locationLatitudeDDDMMSS || !incident.locationLongitudeDDDMMSS) {
    return null;
  }
  return `${incident.locationLatitudeDDDMMSS} ${incident.locationLongitudeDDDMMSS}`;
}

/** Build a UkmtoDetail from API listing metadata (no HTML detail page). */
export function ukmtoDetailFromApiListing(
  item: UkmtoListingItem,
  incident: UkmtoApiIncident | null = null,
): UkmtoDetail {
  const narrative =
    incident?.otherDetails?.replace(/\r\n/g, "\n").trim() || item.title;
  const locationText =
    incident?.place?.trim() || item.apiLocation?.trim() || "Not specified";
  const vesselType = incident?.vesselType?.trim() || "Not specified";
  const incidentType = incident?.incidentTypeName?.trim() || item.title;
  const publishedAt =
    parseIsoDate(incident?.utcDateOfIncident) ?? item.publishedAt;
  const reportDateTime = publishedAt
    ? publishedAt.toISOString().replace(".000Z", "Z")
    : null;

  const bodyText = buildBodyText({
    narrative,
    productNumber: item.productNumber,
    locationText,
    coordinates: coordinatesFromIncident(incident),
    vesselType,
    incidentType,
    reportedImpact: "Not specified",
    reportDateTime,
  });

  return {
    externalId: item.externalId,
    productType: item.productType,
    productNumber: item.productNumber,
    title: item.title,
    publishedAt,
    reportDate: publishedAt ? publishedAt.toISOString().slice(0, 10) : null,
    reportTime: publishedAt
      ? publishedAt.toISOString().slice(11, 16).replace(":", "") + "UTC"
      : null,
    locationText,
    coordinates: coordinatesFromIncident(incident),
    vesselType,
    incidentType,
    reportedImpact: "Not specified",
    sourceUrl: item.sourceUrl,
    pdfUrl: item.pdfUrl,
    confidence: "high",
    bodyText,
  };
}

export async function fetchUkmtoIncidents(): Promise<UkmtoApiIncident[]> {
  return fetchUkmtoJson<UkmtoApiIncident[]>("/api/ukmto/all");
}

function incidentIndex(incidents: UkmtoApiIncident[]): Map<number, UkmtoApiIncident> {
  const map = new Map<number, UkmtoApiIncident>();
  for (const row of incidents) {
    if (!map.has(row.incidentNumber)) map.set(row.incidentNumber, row);
  }
  return map;
}

function maxListingProductsFromEnv(): number {
  const raw = process.env.UKMTO_API_MAX_LISTING?.trim();
  if (!raw) return DEFAULT_MAX_LISTING_PRODUCTS;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_LISTING_PRODUCTS;
}

function maxYearsFromEnv(): number {
  const raw = process.env.UKMTO_API_MAX_YEARS?.trim();
  if (!raw) return DEFAULT_MAX_YEARS;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_YEARS;
}

function incidentYear(incident: UkmtoApiIncident): number {
  const d =
    parseIsoDate(incident.utcDateOfIncident) ?? parseIsoDate(incident.utcDateCreated);
  return d ? d.getUTCFullYear() % 100 : new Date().getUTCFullYear() % 100;
}

function incidentProductNumber(incident: UkmtoApiIncident): string {
  const yy = String(incidentYear(incident)).padStart(2, "0");
  const nn = String(incident.incidentNumber).padStart(3, "0");
  return `${nn}-${yy}`;
}

function incidentProductType(incident: UkmtoApiIncident): UkmtoProductType {
  return /advisory/i.test(incident.incidentTypeName) ? "advisory" : "warning";
}

function incidentExternalId(incident: UkmtoApiIncident): string {
  const productNumber = incidentProductNumber(incident);
  const blob = `${incident.otherDetails}\n${incident.incidentTypeName}`;
  const updateMatch = blob.match(/update[\s_-]*0*(\d{1,3})/i);
  if (updateMatch) {
    return `${productNumber}-update-${updateMatch[1].padStart(3, "0")}`;
  }
  if (/attack/i.test(blob)) return `${productNumber}-attack`;
  if (/advisory/i.test(blob)) return `${productNumber}-advisory`;
  if (/suspicious/i.test(blob)) return `${productNumber}-suspicious-activity`;
  if (/boarding|hijack/i.test(blob)) {
    const m = blob.match(/(illegal-boarding|hijack)/i);
    return `${productNumber}-${slugifySegment(m?.[1] ?? "incident")}`;
  }
  return productNumber;
}

function titleFromIncident(incident: UkmtoApiIncident, productNumber: string): string {
  const heading = incident.otherDetails
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => /UKMTO/i.test(line));
  if (heading) return heading.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  return `${productNumber} - ${incident.incidentTypeName.toUpperCase()}`;
}

/** Build a listing row from the live `/api/ukmto/all` incident feed. */
export function incidentToListingItem(incident: UkmtoApiIncident): UkmtoListingItem {
  const productType = incidentProductType(incident);
  const productNumber = incidentProductNumber(incident);
  const externalId = incidentExternalId(incident);
  return {
    externalId,
    productType,
    productNumber,
    title: titleFromIncident(incident, productNumber),
    publishedAt:
      parseIsoDate(incident.utcDateOfIncident) ?? parseIsoDate(incident.utcDateCreated),
    sourceUrl: resolveUkmtoUrl(
      `/ukmto-products/${productPathSegment(productType)}/${externalId}`,
    ),
    apiReference: titleFromIncident(incident, productNumber).replace(/\s+/g, "_").toUpperCase(),
    apiLocation: incident.place?.trim() || undefined,
  };
}

/**
 * Fallback catalogue when the year/month product tree is WAF-blocked: recent
 * warnings and advisories are still published on `/api/ukmto/all`.
 */
export async function fetchUkmtoListingFromIncidents(opts?: {
  maxProducts?: number;
}): Promise<UkmtoListingItem[]> {
  const maxProducts = opts?.maxProducts ?? maxListingProductsFromEnv();
  const incidents = await fetchUkmtoIncidents();
  const seen = new Set<string>();
  const items: UkmtoListingItem[] = [];
  const sorted = [...incidents].sort((a, b) => {
    const at =
      parseIsoDate(a.utcDateOfIncident)?.getTime() ??
      parseIsoDate(a.utcDateCreated)?.getTime() ??
      0;
    const bt =
      parseIsoDate(b.utcDateOfIncident)?.getTime() ??
      parseIsoDate(b.utcDateCreated)?.getTime() ??
      0;
    return bt - at;
  });
  for (const incident of sorted) {
    const listing = incidentToListingItem(incident);
    if (seen.has(listing.externalId)) continue;
    seen.add(listing.externalId);
    items.push(listing);
    if (items.length >= maxProducts) break;
  }
  return items;
}

async function fetchUkmtoLiveListingFromCatalog(opts?: {
  maxProducts?: number;
  maxYears?: number;
}): Promise<UkmtoListingItem[]> {
  const maxProducts = opts?.maxProducts ?? maxListingProductsFromEnv();
  const maxYears = opts?.maxYears ?? maxYearsFromEnv();
  const items: UkmtoListingItem[] = [];
  const seen = new Set<string>();

  for (const { productType, typeId } of PRODUCT_TYPES) {
    const years = await fetchUkmtoJson<UkmtoApiFolder[]>(
      `/api/ukmto/products-count/${typeId}`,
    );
    const yearSlice = years.slice(0, maxYears);
    for (const year of yearSlice) {
      const months = await fetchUkmtoJson<UkmtoApiFolder[]>(
        `/api/ukmto/products-count/${typeId}/${encodeURIComponent(year.name)}`,
      );
      for (const month of [...months].reverse()) {
        if (month.productItemCount <= 0) continue;
        const products = await fetchUkmtoJson<UkmtoApiProduct[]>(
          `/api/ukmto/products/${month.id}`,
        );
        for (const product of products) {
          const listing = apiProductToListingItem(product, productType);
          if (seen.has(listing.externalId)) continue;
          seen.add(listing.externalId);
          items.push(listing);
          if (items.length >= maxProducts) {
            return items.sort((a, b) => {
              const at = a.publishedAt?.getTime() ?? 0;
              const bt = b.publishedAt?.getTime() ?? 0;
              return bt - at;
            });
          }
        }
      }
    }
  }

  return items.sort((a, b) => {
    const at = a.publishedAt?.getTime() ?? 0;
    const bt = b.publishedAt?.getTime() ?? 0;
    return bt - at;
  });
}

/**
 * Pull warnings + advisories from the live Sitecore API (year → month → products).
 * Newest months are scanned first; results are deduped by externalId.
 * When the product tree is blocked (403/Cloudflare), falls back to `/api/ukmto/all`.
 */
export async function fetchUkmtoLiveListing(opts?: {
  maxProducts?: number;
  maxYears?: number;
}): Promise<UkmtoListingItem[]> {
  try {
    return await fetchUkmtoLiveListingFromCatalog(opts);
  } catch (catalogErr) {
    if (!isUkmtoBlockedError(catalogErr)) throw catalogErr;
    try {
      const fallback = await fetchUkmtoListingFromIncidents(opts);
      if (fallback.length > 0) return fallback;
    } catch {
      // incidents endpoint blocked too — surface the original catalog error
    }
    throw catalogErr;
  }
}

export function matchIncidentForListingItem(
  item: UkmtoListingItem,
  incidentsByNumber: ReadonlyMap<number, UkmtoApiIncident>,
): UkmtoApiIncident | null {
  const m = item.productNumber.match(/^(\d{3})-/);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return incidentsByNumber.get(n) ?? null;
}

export async function fetchUkmtoIncidentIndex(): Promise<Map<number, UkmtoApiIncident>> {
  const incidents = await fetchUkmtoIncidents();
  return incidentIndex(incidents);
}
