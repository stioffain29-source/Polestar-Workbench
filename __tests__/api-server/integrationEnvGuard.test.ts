import {
  INTEGRATION_ENV_VARS,
  clearIntegrationEnv,
} from "./integrationEnvTestHelpers";

/**
 * Regression guard for the global integration-env isolation mechanism
 * (`jest.setup.ts`, wired via `setupFilesAfterEnv`). If that setup file is ever
 * removed or stops running, these tests fail — proving that a future suite
 * toggling an integration credential can no longer accidentally inherit ambient
 * workspace secrets.
 */
describe("global integration-env isolation", () => {
  it("clears every integration var before each test", () => {
    for (const name of INTEGRATION_ENV_VARS) {
      expect(process.env[name]).toBeUndefined();
    }
  });

  it("re-clears vars set in a prior lifecycle before the next test runs", () => {
    // Simulate ambient state leaking in (as an exported workspace secret would).
    for (const name of INTEGRATION_ENV_VARS) {
      process.env[name] = "leaked-ambient-value";
    }
    // The very next test's global beforeEach must wipe these again.
    expect(process.env[INTEGRATION_ENV_VARS[0]]).toBe("leaked-ambient-value");
  });

  it("does not inherit the leaked values from the previous test", () => {
    for (const name of INTEGRATION_ENV_VARS) {
      expect(process.env[name]).toBeUndefined();
    }
  });

  it("keeps INTEGRATION_ENV_VARS and clearIntegrationEnv in sync", () => {
    for (const name of INTEGRATION_ENV_VARS) {
      process.env[name] = "x";
    }
    clearIntegrationEnv();
    for (const name of INTEGRATION_ENV_VARS) {
      expect(process.env[name]).toBeUndefined();
    }
  });
});
