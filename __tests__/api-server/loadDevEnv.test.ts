import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadDevEnv } from "../../artifacts/api-server/src/lib/loadDevEnv";

const savedEnv = { ...process.env };

describe("loadDevEnv", () => {
  const root = resolve(__dirname, "../..");
  const envLocalPath = resolve(root, ".env.local");
  let hadEnvLocal = false;
  let envLocalBackup = "";

  beforeEach(() => {
    process.env = { ...savedEnv };
    delete process.env.INGEST_ADMIN_TOKEN;
    hadEnvLocal = existsSync(envLocalPath);
    if (hadEnvLocal) {
      envLocalBackup = readFileSync(envLocalPath, "utf8");
      rmSync(envLocalPath);
    }
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    if (hadEnvLocal) {
      writeFileSync(envLocalPath, envLocalBackup);
    } else if (existsSync(envLocalPath)) {
      rmSync(envLocalPath);
    }
  });

  it("loads INGEST_ADMIN_TOKEN from .env.local when unset", () => {
    writeFileSync(envLocalPath, 'INGEST_ADMIN_TOKEN="from-dotenv-local"\n', "utf8");
    loadDevEnv();
    expect(process.env.INGEST_ADMIN_TOKEN).toBe("from-dotenv-local");
  });

  it("does not override an already-set INGEST_ADMIN_TOKEN", () => {
    process.env.INGEST_ADMIN_TOKEN = "preset";
    writeFileSync(envLocalPath, 'INGEST_ADMIN_TOKEN="from-dotenv-local"\n', "utf8");
    loadDevEnv();
    expect(process.env.INGEST_ADMIN_TOKEN).toBe("preset");
  });

  it("falls back to .replit userenv.shared when .env.local is absent", () => {
    loadDevEnv();
    expect(process.env.INGEST_ADMIN_TOKEN).toBeTruthy();
  });
});
