export {
  loadTriggerTerms,
  TRIGGER_TERMS,
  termToPattern,
  matchesTerms,
  matchRegionTags,
} from "./triggerTerms";
export type {
  M15TriggerTerms,
  M15CentcomTerms,
  M15UkmtoTerms,
  M15PartnerTerms,
} from "./triggerTerms";

export {
  routeOfficialSource,
  isPartnerEscalationAdvisory,
  isPartnerThreatLevelUpdate,
} from "./routing";
export type {
  M15Watch,
  M15SourceKind,
  RouteOfficialSourceInput,
  RouteOfficialSourceResult,
} from "./routing";

export {
  OFFICIAL_M15_HEALTH_TOPIC,
  UKMTO_HEALTH_NAME,
  UKMTO_SOURCE_URL,
  CENTCOM_HEALTH_NAME,
  CENTCOM_SOURCE_URL,
  CENTCOM_RSS_URL,
  CENTCOM_NEWS_RSS_URL,
  CENTCOM_GOOGLE_NEWS_RSS_URL,
  JMIC_HEALTH_NAME,
  JMIC_SOURCE_URL,
  CMF_HEALTH_NAME,
  CMF_SOURCE_URL,
  PARTNER_SOURCES,
} from "./health";
export type { PartnerProviderKey, PartnerSourceDef } from "./health";
export {
  partnerSourceByKey,
  resolvePartnerUrl,
  JMIC_ADVISORIES_URL,
  CMF_OVERVIEW_URL,
  CMF_IRTA_URL,
  PARTNER_URL_HEALTH_NOTES,
} from "./partnerSources";

export { assignAnalystFlags, simulateOfficialSourceIngest } from "./flags";
export type { AssignAnalystFlagsInput, AnalystFlags } from "./flags";

export {
  normalizeOfficialSourceUrl,
  expandOfficialSourceUrlVariants,
  lookupNewsEchoNormalizedUrls,
  partitionOfficialInserts,
} from "./dedupe";
export type {
  OfficialPreparedItem,
  OfficialInsertPartition,
} from "./dedupe";

export {
  appendCentcomImageUrls,
  parseCentcomImageUrlsFromBody,
  CENTCOM_IMAGE_FOOTER_HEADING,
} from "./centcomEvidence";
