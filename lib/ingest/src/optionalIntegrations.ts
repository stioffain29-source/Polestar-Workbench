// Stable Source Health display names for optional external integrations.
// These rows are surfaced primarily on the Integrations panel; when they are
// intentionally off (not_configured / pending) they must not pollute the Action
// Required panel or the dashboard failing-source count.

export const GDELT_HEALTH_NAME = "GDELT Conflict Events";
export const GDELT_HEALTH_TOPIC = "flashpoint";
export const GDELT_NOT_CONFIGURED_MESSAGE =
  "No GDELT_CLOUD_API_KEY — precision enrichment is skipped; the base flashpoint feed is unaffected.";

export const RELIEFWEB_CORROBORATION_HEALTH_NAME = "ReliefWeb (UN OCHA)";
export const RELIEFWEB_REPORTS_HEALTH_NAME = "ReliefWeb Situational Reports (UN OCHA)";

const OPTIONAL_INTEGRATION_SOURCE_NAMES = new Set([
  GDELT_HEALTH_NAME,
  RELIEFWEB_CORROBORATION_HEALTH_NAME,
  RELIEFWEB_REPORTS_HEALTH_NAME,
]);

export function isOptionalIntegrationSource(name: string): boolean {
  return OPTIONAL_INTEGRATION_SOURCE_NAMES.has(name);
}
