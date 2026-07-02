import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { loadDevEnv } from "../../lib/ingest/src/loadDevEnv";

const savedEnv = { ...process.env };

describe("loadDevEnv", () => {
  let fixtureRoot = "";
  let originalCwd = "";

  beforeEach(() => {
    process.env = { ...savedEnv };
    delete process.env.INGEST_ADMIN_TOKEN;
    delete process.env.NODE_ENV;
    originalCwd = process.cwd();
    // Isolate the workspace-root walk on a throwaway fixture so the test never
    // depends on the real repo's .env.local / .replit contents (or CI secrets).
    fixtureRoot = mkdtempSync(resolve(tmpdir(), "loaddevenv-"));
    writeFileSync(resolve(fixtureRoot, "pnpm-workspace.yaml"), "packages: []\n", "utf8");
    process.chdir(fixtureRoot);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.env = { ...savedEnv };
    if (fixtureRoot) {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("loads INGEST_ADMIN_TOKEN from .env.local when unset", () => {
    writeFileSync(
      resolve(fixtureRoot, ".env.local"),
      'INGEST_ADMIN_TOKEN="from-dotenv-local"\n',
      "utf8",
    );
    loadDevEnv();
    expect(process.env.INGEST_ADMIN_TOKEN).toBe("from-dotenv-local");
  });

  it("does not override an already-set INGEST_ADMIN_TOKEN", () => {
    process.env.INGEST_ADMIN_TOKEN = "preset";
    writeFileSync(
      resolve(fixtureRoot, ".env.local"),
      'INGEST_ADMIN_TOKEN="from-dotenv-local"\n',
      "utf8",
    );
    loadDevEnv();
    expect(process.env.INGEST_ADMIN_TOKEN).toBe("preset");
  });

  it("falls back to .replit userenv.shared when .env.local is absent", () => {
    writeFileSync(
      resolve(fixtureRoot, ".replit"),
      '[userenv.shared]\nINGEST_ADMIN_TOKEN = "from-replit-shared"\n',
      "utf8",
    );
    loadDevEnv();
    expect(process.env.INGEST_ADMIN_TOKEN).toBe("from-replit-shared");
  });

  it("prefers .env.local over the .replit userenv.shared fallback", () => {
    writeFileSync(
      resolve(fixtureRoot, ".env.local"),
      'INGEST_ADMIN_TOKEN="from-dotenv-local"\n',
      "utf8",
    );
    writeFileSync(
      resolve(fixtureRoot, ".replit"),
      '[userenv.shared]\nINGEST_ADMIN_TOKEN = "from-replit-shared"\n',
      "utf8",
    );
    loadDevEnv();
    expect(process.env.INGEST_ADMIN_TOKEN).toBe("from-dotenv-local");
  });
});
