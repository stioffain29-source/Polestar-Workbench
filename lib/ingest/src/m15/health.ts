// Shared Source Health registration keys for M1.5 official connectors.

export const OFFICIAL_M15_HEALTH_TOPIC = "official_military_maritime";

export const UKMTO_HEALTH_NAME = "UKMTO Official Products";
export const UKMTO_SOURCE_URL = "https://www.ukmto.org/ukmto-products";

export const CENTCOM_HEALTH_NAME = "CENTCOM Press Releases";
export const CENTCOM_SOURCE_URL = "https://www.centcom.mil/MEDIA/PRESS-RELEASES/";
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

export {
  JMIC_HEALTH_NAME,
  JMIC_SOURCE_URL,
  CMF_HEALTH_NAME,
  CMF_SOURCE_URL,
  PARTNER_SOURCES,
} from "./partnerSources";
export type { PartnerProviderKey, PartnerSourceDef } from "./partnerSources";
