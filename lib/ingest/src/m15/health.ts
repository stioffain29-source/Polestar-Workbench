// Shared Source Health registration keys for M1.5 official connectors.

export const OFFICIAL_M15_HEALTH_TOPIC = "official_military_maritime";

export const UKMTO_HEALTH_NAME = "UKMTO Official Products";
export const UKMTO_SOURCE_URL = "https://www.ukmto.org/ukmto-products";

export const CENTCOM_HEALTH_NAME = "CENTCOM Press Releases";
/** Legacy press-releases listing — may redirect or be empty; kept for Source Health URL. */
export const CENTCOM_SOURCE_URL = "https://www.centcom.mil/MEDIA/PRESS-RELEASES/";
/** Primary live listing path since mid-2026 (operational releases moved here from ContentType=2 RSS). */
export const CENTCOM_PUBLIC_RELEASES_URL =
  "https://www.centcom.mil/MEDIA/PUBLIC-RELEASES/";
/** Official press-release RSS (less WAF-sensitive than the HTML listing page). */
export const CENTCOM_RSS_URL =
  "https://www.centcom.mil/DesktopModules/ArticleCS/RSS.ashx?ContentType=2&Site=808&isdashboardselected=0&max=50";
/** Official news RSS — may include PUBLIC-RELEASES / PRESS-RELEASES items when ContentType=2 is empty. */
export const CENTCOM_NEWS_RSS_URL =
  "https://www.centcom.mil/DesktopModules/ArticleCS/RSS.ashx?ContentType=1&Site=808&isdashboardselected=0&max=50";
/** Google News site-scope fallback when centcom.mil HTML + press RSS are blocked/empty. */
export const CENTCOM_GOOGLE_NEWS_RSS_URL =
  "https://news.google.com/rss/search?q=" +
  encodeURIComponent(
    "site:centcom.mil (inurl:PUBLIC-RELEASES OR inurl:PRESS-RELEASES) when:180d",
  ) +
  "&hl=en-US&gl=US&ceid=US:en";
/** Broader Google News fallback — datacenter egress often gets zero items on the narrow inurl query. */
export const CENTCOM_GOOGLE_NEWS_BROAD_RSS_URL =
  "https://news.google.com/rss/search?q=" +
  encodeURIComponent("site:centcom.mil when:90d") +
  "&hl=en-US&gl=US&ceid=US:en";
/** DoD news releases RSS — some CENTCOM products are syndicated here with centcom.mil links. */
export const DOD_NEWS_RELEASES_RSS_URL =
  "https://www.defense.gov/DesktopModules/ArticleCS/RSS.ashx?max=50&ContentType=9&Site=945";

export {
  JMIC_HEALTH_NAME,
  JMIC_SOURCE_URL,
  CMF_HEALTH_NAME,
  CMF_SOURCE_URL,
  PARTNER_SOURCES,
} from "./partnerSources";
export type { PartnerProviderKey, PartnerSourceDef } from "./partnerSources";
