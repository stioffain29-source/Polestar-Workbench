import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  CENTCOM_SOURCE_URL,
  CENTCOM_RSS_URL,
  UKMTO_SOURCE_URL,
} from "../../lib/ingest/src/m15/health.js";
import {
  M15_FIXTURE_DIR,
  M15_OPTIONAL_FIXTURES,
  M15_REQUIRED_FIXTURES,
} from "./m15/fixtures-manifest.js";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const LIVE_URL_TIMEOUT_SEC = 30;

type UrlCheck = {
  name: string;
  url: string;
  ok: boolean;
  status?: number;
  error?: string;
};

/** Probe via curl (matches deploy smoke checks; Node fetch is often CF-blocked). */
function probeUrlWithCurl(name: string, url: string): UrlCheck {
  const result = spawnSync(
    "curl",
    [
      "-sI",
      "-L",
      "--max-time",
      String(LIVE_URL_TIMEOUT_SEC),
      "-A",
      BROWSER_UA,
      "-o",
      process.platform === "win32" ? "NUL" : "/dev/null",
      "-w",
      "%{http_code}",
      url,
    ],
    { encoding: "utf8" },
  );

  if (result.error) {
    return { name, url, ok: false, error: result.error.message };
  }

  const status = Number.parseInt((result.stdout ?? "").trim(), 10);
  if (!Number.isFinite(status)) {
    return {
      name,
      url,
      ok: false,
      error: result.stderr?.trim() || "no HTTP status from curl",
    };
  }

  return {
    name,
    url,
    ok: status >= 200 && status < 400,
    status,
    error: status >= 200 && status < 400 ? undefined : `HTTP ${status}`,
  };
}

function checkFixtures(): { missingRequired: string[]; missingOptional: string[] } {
  const missingRequired = M15_REQUIRED_FIXTURES.filter(
    (name) => !existsSync(join(M15_FIXTURE_DIR, name)),
  );
  const missingOptional = M15_OPTIONAL_FIXTURES.filter(
    (name) => !existsSync(join(M15_FIXTURE_DIR, name)),
  );
  return { missingRequired, missingOptional };
}

async function main(): Promise<number> {
  const skipLive = process.argv.includes("--skip-live");
  const { missingRequired, missingOptional } = checkFixtures();

  console.log("M1.5 Phase 0 — prerequisites\n");
  console.log(`Fixture directory: ${M15_FIXTURE_DIR}`);

  if (missingRequired.length === 0) {
    console.log(
      `✓ Required fixtures (${M15_REQUIRED_FIXTURES.length}/${M15_REQUIRED_FIXTURES.length})`,
    );
  } else {
    console.log("✗ Missing required fixtures:");
    for (const name of missingRequired) console.log(`  - ${name}`);
  }

  if (missingOptional.length === 0) {
    console.log(
      `✓ Optional fixtures (${M15_OPTIONAL_FIXTURES.length}/${M15_OPTIONAL_FIXTURES.length})`,
    );
  } else {
    console.log("○ Optional fixtures not present:");
    for (const name of missingOptional) console.log(`  - ${name}`);
  }

  let liveFailed = false;
  if (skipLive) {
    console.log("\n○ Live URL checks skipped (--skip-live)");
  } else {
    console.log("\nLive URL checks (curl + browser User-Agent):");
    const results = [
      probeUrlWithCurl("CENTCOM RSS", CENTCOM_RSS_URL),
      probeUrlWithCurl("CENTCOM", CENTCOM_SOURCE_URL),
      probeUrlWithCurl("UKMTO", UKMTO_SOURCE_URL),
      probeUrlWithCurl("UKMTO warnings", `${UKMTO_SOURCE_URL}/warnings`),
      probeUrlWithCurl("UKMTO advisories", `${UKMTO_SOURCE_URL}/advisories`),
    ];
    for (const r of results) {
      if (r.ok) {
        console.log(`✓ ${r.name} ${r.status} ${r.url}`);
      } else {
        liveFailed = true;
        console.log(`✗ ${r.name} ${r.error ?? "failed"} ${r.url}`);
      }
    }
    if (liveFailed) {
      console.log(
        "\nNote: CENTCOM HTML listing may block datacenter egress; RSS (ContentType=2) is the primary live ingest path. Re-run from Replit/prod if local curl fails.",
      );
    }
  }

  if (missingRequired.length > 0) {
    console.log("\nPhase 0 FAILED — add missing required fixtures before Phase 2 parsers.");
    return 1;
  }
  console.log("\nPhase 0 fixtures OK — proceed with Phase 2 ingest work.");
  return 0;
}

main()
  .then((code) => {
    if (code !== 0) process.exit(code);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
