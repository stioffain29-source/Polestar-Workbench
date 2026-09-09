/**
 * Global jest setup (registered via `setupFilesAfterEnv` in jest.config.js).
 *
 * Integration Source-Health / config probes resolve credentials straight from
 * `process.env`. If a suite toggles an integration var (e.g. to assert an
 * "unconfigured" state) WITHOUT first clearing the ambient environment, a real
 * workspace secret exported into the process can silently satisfy — or defeat —
 * the assertion, so the test passes/fails for the wrong reason.
 *
 * Clearing every known integration var in a global `beforeEach` guarantees that
 * EVERY test — including suites added in the future that forget the convention —
 * starts from a known-clean integration environment. Each test then sets only
 * the vars it needs. This is the single mechanism that makes ambient workspace
 * secrets unable to leak into any integration assertion.
 */
import { clearIntegrationEnv } from "./__tests__/api-server/integrationEnvTestHelpers";

// Vite replaces this compile-time global in production. Jest runs the source
// through CommonJS, so provide only a non-secret key-shaped test value.
(globalThis as typeof globalThis & { __CARTO_BASEMAP_KEY__?: string })
  .__CARTO_BASEMAP_KEY__ = "jest-carto-basemap-key";

beforeEach(() => {
  clearIntegrationEnv();
});
