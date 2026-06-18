export interface IncidentSourceLike {
  resolvedUrl?: string | null;
  sourceUrl?: string | null;
}

/**
 * The best outbound "source" link for an incident. Most feeds are Google News
 * aggregators, so `sourceUrl` is an opaque news.google.com/rss/articles/...
 * redirect; ingest resolves the underlying publisher URL into `resolvedUrl`
 * when it can. Prefer that direct, readable link and fall back to `sourceUrl`
 * (and finally null) so analysts always get the cleanest available source.
 */
export function incidentSourceUrl(i: IncidentSourceLike): string | null {
  return i.resolvedUrl ?? i.sourceUrl ?? null;
}
