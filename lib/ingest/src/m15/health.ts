// Shared Source Health registration keys for M1.5 official connectors.

export const OFFICIAL_M15_HEALTH_TOPIC = "official_military_maritime";

export const UKMTO_HEALTH_NAME = "UKMTO Official Products";
export const UKMTO_SOURCE_URL = "https://www.ukmto.org/ukmto-products";

export const CENTCOM_HEALTH_NAME = "CENTCOM Press Releases";
export const CENTCOM_SOURCE_URL = "https://www.centcom.mil/MEDIA/PRESS-RELEASES/";
/** Official press-release RSS (less WAF-sensitive than the HTML listing page). */
export const CENTCOM_RSS_URL =
  "https://www.centcom.mil/DesktopModules/ArticleCS/RSS.ashx?ContentType=2&Site=808&isdashboardselected=0&max=50";

export {
  JMIC_HEALTH_NAME,
  JMIC_SOURCE_URL,
  CMF_HEALTH_NAME,
  CMF_SOURCE_URL,
  PARTNER_SOURCES,
} from "./partnerSources";
export type { PartnerProviderKey, PartnerSourceDef } from "./partnerSources";
