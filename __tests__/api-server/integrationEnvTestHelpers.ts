/**
 * Shared, exhaustive list of every integration secret / config env var read by
 * the Source Health probes (`getMaritimeSourceHealth` + `getIntegrationStatuses`
 * and the shared `@workspace/ingest` config helpers they call).
 *
 * Several integrations resolve a single credential from MORE THAN ONE var (e.g.
 * AIS reads AIS_API_KEY *or* AISSTREAM_API_KEY via resolveAisKey(); OpenAI reads
 * the AI_INTEGRATIONS_* pair or the OPENAI_* pair). A workspace that has one of
 * the alternate secrets set would silently hand a probe a credential the test
 * thought it had cleared, so an assertion would no longer reflect the code under
 * test. Clearing ALL of these in a beforeEach isolates every case from the real
 * workspace secrets: each test then sets only the vars it needs.
 */
export const INTEGRATION_ENV_VARS: readonly string[] = [
  // GDELT enrichment + structured event layer
  "GDELT_CLOUD_API_KEY",
  "GDELT_CLOUD_API_BASE",
  "GDELT_ENRICH_ENABLED",
  "GDELT_STRUCTURED_ENABLED",
  "GDELT_STRUCTURED_INTERVAL_HOURS",
  "GDELT_STRUCTURED_MAX_CALLS",
  // ReliefWeb (corroboration + situational reports share one appname)
  "RELIEFWEB_APPNAME",
  // Liveuamap paid overlay
  "LIVEUAMAP_API_KEY",
  // OpenAI / AI integrations (credential resolves from either pair)
  "AI_INTEGRATIONS_OPENAI_API_KEY",
  "AI_INTEGRATIONS_OPENAI_BASE_URL",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  // AIS vessel movement (credential resolves from AIS_API_KEY OR AISSTREAM_API_KEY)
  "AIS_API_KEY",
  "AISSTREAM_API_KEY",
  "AIS_ENABLED",
  "AIS_PROVIDER",
  "AIS_COLLECT_SECONDS",
  // Vessel registry (Datalastic) cargo-type breakdown
  "VESSEL_REGISTRY_API_KEY",
  "VESSEL_REGISTRY_ENABLED",
  "VESSEL_REGISTRY_PROVIDER",
  "VESSEL_REGISTRY_API_BASE",
  "VESSEL_REGISTRY_MAX_LOOKUPS",
  // Windward (scaffolded maritime provider)
  "WINDWARD_API_KEY",
  "WINDWARD_ENABLED",
  // Social-watch Instagram (credential resolves from INSTAGRAM_API_KEY OR APIFY_TOKEN)
  "INSTAGRAM_API_KEY",
  "APIFY_TOKEN",
  "INSTAGRAM_ENABLED",
  "INSTAGRAM_PROVIDER",
  "INSTAGRAM_API_BASE",
  "INSTAGRAM_ACTOR",
  "KAMMI_INSTAGRAM_HANDLE",
  "SOCIAL_WATCH_ENABLED",
  // Operational admin controls
  "INGEST_ADMIN_TOKEN",
];

/**
 * Delete every known integration secret from `process.env` so each test starts
 * from a known-clean environment. Call this in `beforeEach`, then set only the
 * vars the individual case needs.
 */
export function clearIntegrationEnv(): void {
  for (const name of INTEGRATION_ENV_VARS) {
    delete process.env[name];
  }
}
