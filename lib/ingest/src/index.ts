export { runFlashpointIngest, resolveFlashpointCountry } from "./flashpoint";
export { runFlashpointMastheadRelocate } from "./flashpointMastheadRelocate";
export { runFlashpointUnknownReattribute } from "./flashpointUnknownReattribute";
export type { FlashpointMastheadRelocateSummary } from "./flashpointMastheadRelocate";
export { runCargoWatchIngest } from "./cargoWatch";
export { runShippingIngest } from "./shipping";
export { runEnergyIngest, runFertiliserIngest, runFuelIngest, runConflictIngest, runIndonesiaLocalIngest } from "./topicConfigs";
export { classifyNewsConfidence } from "./newsConfidence";
export type { Confidence } from "./newsConfidence";
export { runNewsTopicIngest } from "./newsTopic";
export type { NewsTopicConfig, TopicFeed, CountryAlias } from "./newsTopic";
export { runMarketPricesIngest } from "./marketPrices";
export type { MarketPriceSummary } from "./marketPrices";
export { runMarketSnapshotIngest } from "./marketSnapshot";
export type { MarketSnapshotSummary } from "./marketSnapshot";
export {
  runMaritimeMovementIngest,
  isAisConfigured,
  resolveAisKey,
  AIS_THEATRES,
  computeDarkByTheatre,
  isLoitering,
  isWithinDarkWindow,
  REGISTRY_HEALTH_TOPIC,
  REGISTRY_HEALTH_NAME,
} from "./maritimeMovement";
export type {
  MaritimeMovementSummary,
  MaritimeMovementOptions,
  PriorVesselSighting,
} from "./maritimeMovement";
export {
  resolveVesselClasses,
  classifyVesselClass,
  readVesselRegistryConfig,
  isVesselRegistryConfigured,
} from "./vesselRegistry";
export type {
  VesselClass,
  VesselLookup,
  VesselRegistryConfig,
  VesselRegistryResult,
} from "./vesselRegistry";
export { runStrikesIngest, classifyStrikeFields } from "./strikes";
export type { StrikesIngestSummary, StrikeTheatre } from "./strikes";
export { runStrikesBackfill } from "./backfillStrikes";
export type { StrikesBackfillSummary } from "./backfillStrikes";
export { runTitleTranslation, needsTitleTranslation } from "./titleTranslate";
export type { TitleTranslationSummary } from "./titleTranslate";
export {
  isLlmAvailable,
  readOpenAiConfig,
  openAiProseModel,
  openAiFastModel,
  OPENAI_ENV_VARS,
} from "./openaiConfig";
export type { OpenAiConfig } from "./openaiConfig";
export { loadDevEnv } from "./loadDevEnv";
export { runResolveGoogleNewsUrls, resolveGoogleNewsUrl, isGoogleNewsRedirect } from "./googleNewsUrl";
export type { ResolveUrlSummary } from "./googleNewsUrl";
export {
  runReliefWebCorroboration,
  isReliefWebConfigured,
  RELIEFWEB_NOT_CONFIGURED_MESSAGE,
} from "./reliefweb";
export type { ReliefWebCorroborationSummary } from "./reliefweb";
export {
  runReliefWebReportsIngest,
  emptyReliefWebReportsSummary,
} from "./reliefwebReports";
export type { ReliefWebReportsSummary } from "./reliefwebReports";
export { runIccPiracyIngest, emptyIccPiracySummary } from "./iccPiracy";
export type { IccPiracySummary } from "./iccPiracy";
export {
  runSocialWatchIngest,
  emptySocialWatchSummary,
  readSocialWatchConfig,
  isSocialWatchActive,
  sanitiseCaption,
  classifyStatus,
  isProtestRelevant,
  isPromotable,
  extractLocation,
  extractIssue,
  extractEventDateTime,
  detectAlertReasons,
  makeDedupKey,
  parseTelegramHtml,
  SOCIAL_WATCH_STATUSES,
  SOCIAL_WATCH_IG_HEALTH_NAME,
  SOCIAL_WATCH_TG_HEALTH_NAME,
} from "./socialWatch";
export type {
  SocialWatchSummary,
  SocialWatchConfig,
  SocialWatchStatus,
  PlatformResult as SocialWatchPlatformResult,
  RawSocialPost,
} from "./socialWatch";
export {
  runFacebookOsintIngest,
  persistFacebookPosts,
  fetchApifyDatasetItems,
  resolveApifyTaskLatestDataset,
  emptyFacebookOsintSummary,
  readFacebookOsintConfig,
  isFacebookOsintActive,
  classifyPost,
  classifyPostBroad,
  resolveScope,
  normaliseFacebookPost,
  sanitiseUrl,
  makeFacebookDedupKey,
  detectKeywords,
  FACEBOOK_OSINT_HEALTH_NAME,
} from "./facebookOsint";
export type {
  FacebookOsintSummary,
  FacebookOsintConfig,
  FacebookPageSource,
  FbClassification,
  RawFacebookPost,
  ScopeResolution,
  PersistFacebookOptions,
  PersistFacebookResult,
} from "./facebookOsint";
export {
  deriveEligibility,
  deriveReview,
  computeConfidence,
  detectCredibleDomains,
  extractHosts,
  pickCorroboration,
  pickDuplicate,
  categoryToTopic,
  normaliseSourceTier,
  tokenize,
  CREDIBLE_DOMAINS,
} from "./facebookOsintEligibility";
export type {
  SourceTier,
  CredibleDomainMatch,
  IncidentCandidate,
  IncidentMatch,
  EligibilityInput,
  Eligibility,
  PostMatchInput,
  ReviewInput,
  Review,
  ConfidenceInput,
} from "./facebookOsintEligibility";
export {
  normaliseInstagramPost,
  persistInstagramKammiPosts,
  resolveApifyTaskOrActorLatestDataset,
} from "./instagramKammi";
export type {
  RawInstagramPost,
  PersistInstagramKammiOptions,
  PersistInstagramKammiResult,
} from "./instagramKammi";
export {
  runGdeltEnrich,
  isGdeltConfigured,
  isGdeltEnrichEnabled,
} from "./gdeltEnrich";
export {
  GDELT_HEALTH_NAME,
  GDELT_HEALTH_TOPIC,
  GDELT_NOT_CONFIGURED_MESSAGE,
  RELIEFWEB_CORROBORATION_HEALTH_NAME,
  RELIEFWEB_REPORTS_HEALTH_NAME,
  isOptionalIntegrationSource,
} from "./optionalIntegrations";
export type { GdeltEnrichSummary } from "./gdeltEnrich";
export { recordSourceHealth, FAILURE_ESCALATION_THRESHOLD } from "./sourceHealth";
export type { FeedHealth } from "./sourceHealth";
export { classifySeverity, maxSeverity, severityFromFatalities, SEVERITY_RANK, isReactionLed, isPresentTenseFatalOrPluralStrike, isNaturalCauseDeath, isFatalKineticAttack, isJudicialDeath, isBiographicalOrIllnessDeath, hasIndonesianViolenceSignal } from "./severity";
export type { Severity, SeverityTopic } from "./severity";
export { runSeverityBackfill } from "./backfillSeverity";
export type { SeverityBackfillSummary } from "./backfillSeverity";
export { runCargoCountryBackfill } from "./backfillCargoCountry";
export type { CargoCountryBackfillSummary } from "./backfillCargoCountry";
export { runNewsCountryBackfill } from "./backfillNewsCountry";
export { runPngExtractBackfill, runWestPapuaExtractBackfill } from "./backfillPngExtract";
export type { PngExtractBackfillSummary } from "./backfillPngExtract";
export {
  derivePngProvince,
  derivePngLocality,
  extractPngItem,
  derivePngIncidentDate,
} from "./pngExtract";
export type { PngCategory, PngExtraction } from "./pngExtract";
export {
  deriveWestPapuaProvince,
  deriveWestPapuaLocality,
  extractWestPapuaItem,
  deriveWestPapuaIncidentDate,
} from "./westPapuaExtract";
export type { WestPapuaCategory, WestPapuaExtraction } from "./westPapuaExtract";
export { deriveLocality } from "./structuredExtract";
export type { IncidentCategory } from "./structuredExtract";
export type { NewsCountryBackfillSummary } from "./backfillNewsCountry";
export { geocode } from "./geocode";
export type { GeoResult } from "./geocode";
export type {
  IngestTopic,
  IngestOptions,
  IngestSummary,
  FeedStat,
} from "./types";
