// Canonical partner-source registry for M1.5 JMIC / CMF connectors.
// Listing URLs are probed during deploy smoke checks (see m15Phase0Prereq.test.ts).

export type PartnerProviderKey = "jmic" | "cmf";

export type PartnerSourceDef = {
  /** Stable provider key stored on official_military_maritime_sources.source_name */
  key: PartnerProviderKey;
  /** Human-readable label for Source Health and UI */
  displayName: string;
  /** Source Health feed name (sources.name) */
  healthName: string;
  /** Primary product listing URL */
  listingUrl: string;
  /** Site origin for resolving relative hrefs */
  siteOrigin: string;
  /** Env flag to disable ingest without removing the connector slot */
  envVar: string;
};

export const JMIC_HEALTH_NAME = "JMIC Official Products";
export const JMIC_SOURCE_URL = "https://www.ukmto.org/partner-products/jmic-products";
export const JMIC_SITE_ORIGIN = "https://www.ukmto.org";
export const JMIC_ADVISORIES_URL =
  "https://www.ukmto.org/partner-products/jmic-products/jmic-advisories";

export const CMF_HEALTH_NAME = "CMF Official Products";
export const CMF_SOURCE_URL = "https://www.ukmto.org/partner-products/cmf-products";
export const CMF_SITE_ORIGIN = "https://www.ukmto.org";
export const CMF_OVERVIEW_URL =
  "https://combinedmaritimeforces.com/combined-task-forces/joint-maritime-information-center/";
export const CMF_IRTA_URL = "https://combinedmaritimeforces.com/irtas-irtbs/";

/** All registered partner providers (JMIC + CMF). */
export const PARTNER_SOURCES: readonly PartnerSourceDef[] = [
  {
    key: "jmic",
    displayName: "JMIC (Joint Maritime Information Center)",
    healthName: JMIC_HEALTH_NAME,
    listingUrl: JMIC_SOURCE_URL,
    siteOrigin: JMIC_SITE_ORIGIN,
    envVar: "JMIC_INGEST_ENABLED",
  },
  {
    key: "cmf",
    displayName: "CMF (Combined Maritime Forces)",
    healthName: CMF_HEALTH_NAME,
    listingUrl: CMF_SOURCE_URL,
    siteOrigin: CMF_SITE_ORIGIN,
    envVar: "CMF_INGEST_ENABLED",
  },
] as const;

export function partnerSourceByKey(key: PartnerProviderKey): PartnerSourceDef {
  const found = PARTNER_SOURCES.find((s) => s.key === key);
  if (!found) throw new Error(`Unknown partner provider: ${key}`);
  return found;
}

export function resolvePartnerUrl(
  href: string,
  siteOrigin: string,
): string {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#")) return trimmed;
  try {
    return new URL(trimmed, siteOrigin).href;
  } catch {
    return trimmed;
  }
}

/**
 * Documented URL reachability from the last deploy-environment probe.
 * UKMTO partner pages may return 403 from some egress IPs (Cloudflare/WAF);
 * CMF WordPress pages are generally reachable. Update after live smoke checks.
 */
export const PARTNER_URL_HEALTH_NOTES: Record<string, string> = {
  [JMIC_SOURCE_URL]:
    "UKMTO JMIC listing — may block automated probes (403); HTML fixtures saved under __tests__/fixtures/m15/.",
  [CMF_SOURCE_URL]:
    "UKMTO CMF listing — may block automated probes (403); use cmf-jmic-overview.html fixture.",
  [CMF_OVERVIEW_URL]: "CMF JMIC overview page — reachable (200) from deploy environment.",
  [CMF_IRTA_URL]: "CMF IRTA/IRTB product page — reachable (200) from deploy environment.",
};
