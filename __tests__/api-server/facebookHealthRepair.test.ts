import {
  repairFacebookOsintHealthRow,
  type HealthRepairDb,
} from "../../artifacts/api-server/src/lib/facebookHealthRepair";

/**
 * The boot repair exists to stop an intentionally-off Facebook OSINT source
 * alarming red on the dashboard. Its reset also NULLS last_success_at, which is
 * the heartbeat throttling a PAID Apify pull: a null heartbeat reads as "never
 * run", which is a reason to run. So a repair that fires while the collector is
 * working re-arms paid spend on every boot. These tests pin both halves.
 */

const ENV_KEYS = [
  "FACEBOOK_API_KEY",
  "APIFY_TOKEN",
  "FACEBOOK_OSINT_ENABLED",
  "FACEBOOK_GROUPS_ENABLED",
  "FACEBOOK_PAGES_ENABLED",
  "FACEBOOK_SEARCH_ENABLED",
  "FACEBOOK_GROUPS",
  "FACEBOOK_PAGES",
  "FACEBOOK_SEARCH_TERMS",
] as const;

let saved: Record<string, string | undefined> = {};

function clearEnv(): void {
  for (const k of ENV_KEYS) delete process.env[k];
}

/** Records every update the repair attempts, so "did not touch it" is testable. */
function stubDb(): { db: HealthRepairDb; updates: Record<string, unknown>[] } {
  const updates: Record<string, unknown>[] = [];
  const db: HealthRepairDb = {
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updates.push(values);
        return { where: async () => undefined };
      },
    }),
  };
  return { db, updates };
}

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  clearEnv();
});

afterEach(() => {
  clearEnv();
  for (const k of ENV_KEYS) {
    const v = saved[k];
    if (v !== undefined) process.env[k] = v;
  }
});

describe("Facebook OSINT Source Health boot repair", () => {
  it("leaves the row alone when the collector runs on the shared Apify token", async () => {
    // No dedicated FACEBOOK_API_KEY — the collector falls back to APIFY_TOKEN
    // and is fully active. This is the exact configuration that used to be
    // mis-read as "not configured", wiping the heartbeat every boot.
    process.env.APIFY_TOKEN = "shared-account-token";

    const { db, updates } = stubDb();
    await repairFacebookOsintHealthRow(db);

    expect(updates).toEqual([]);
  });

  it("leaves the row alone when the dedicated key is present", async () => {
    process.env.FACEBOOK_API_KEY = "dedicated-key";

    const { db, updates } = stubDb();
    await repairFacebookOsintHealthRow(db);

    expect(updates).toEqual([]);
  });

  it("resets the row when there is no usable key at all", async () => {
    const { db, updates } = stubDb();
    await repairFacebookOsintHealthRow(db);

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      status: "not_configured",
      errorMessage: "Integration not configured",
      lastSuccessAt: null,
    });
  });

  it("resets the row when a key exists but every pass is switched off", async () => {
    process.env.APIFY_TOKEN = "shared-account-token";
    process.env.FACEBOOK_GROUPS_ENABLED = "false";
    process.env.FACEBOOK_PAGES_ENABLED = "false";
    process.env.FACEBOOK_SEARCH_ENABLED = "false";

    const { db, updates } = stubDb();
    await repairFacebookOsintHealthRow(db);

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ status: "not_configured" });
  });

  it("resets the row when the collector is explicitly disabled", async () => {
    process.env.APIFY_TOKEN = "shared-account-token";
    process.env.FACEBOOK_OSINT_ENABLED = "false";

    const { db, updates } = stubDb();
    await repairFacebookOsintHealthRow(db);

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ status: "not_configured" });
  });

  it("never nulls a heartbeat while the collector is active, whatever the row's stored state", async () => {
    // The old code had a second, UNCONDITIONAL pass for legacy rows that read
    // "Integration not configured" while stored as failing. It could null a
    // real heartbeat on an active source, so it is gone: an active collector
    // must produce zero writes here regardless of what the row currently says.
    process.env.APIFY_TOKEN = "shared-account-token";

    const { db, updates } = stubDb();
    await repairFacebookOsintHealthRow(db);

    expect(updates.some((u) => "lastSuccessAt" in u)).toBe(false);
  });
});
