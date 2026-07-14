// Cargo Watch pattern-report live-PDF verification harness.
//
// The workbench is owner-gated, so the in-app "Download PDF" path (jsPDF +
// embedReactChartInPdf over the redesigned cargo pattern graphics, invoked from
// exportTopicReportPdf's cargo_watch branch) cannot be driven through a real
// signed-in browser session headlessly. This harness reproduces that EXACT
// client path in a real Chromium page:
//   1. read the cargo_watch report + incidents from Postgres (same shapes the
//      /api endpoints return; scope is re-applied inside buildCargoPatternModel),
//   2. esbuild-bundle the real exportTopicReportPdf for the browser,
//   3. run it in Chromium so embedReactChartInPdf rasterises the four real
//      pattern graphics + trend chart + choropleth via html2canvas,
//   4. write the produced PDF to screenshots/ for per-page inspection.
//
// Set CARGO_SPARSE=1 to render a deliberately thin (single-incident) period so
// the sparse/no-data fallbacks and appendix empty-state can be inspected too.
//
// Run: cd artifacts/workbench && npx tsx scripts/verifyCargoPatternPdf.ts
import { createRequire } from "node:module";
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  fetchLatestTopicReportId,
  fetchTopicReport,
  fetchTopicIncidents,
} from "./topicReportData";
import { clampIssueDateToLatestRecord } from "../src/lib/reportWindow";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKBENCH = resolve(HERE, "..");
const SRC = resolve(WORKBENCH, "src");
const ASSETS = resolve(WORKBENCH, "..", "..", "attached_assets");

const SPARSE = process.env.CARGO_SPARSE === "1";

// A single in-scope cargo row so the sparse run exercises the "insufficient
// period" pattern/priority-matrix fallbacks and the one-row appendix instead of
// the populated multi-pattern layout.
const SPARSE_INCIDENTS = [
  {
    id: 999001,
    topic: "cargo_watch",
    title: "Truck hijacking on the North-South Expressway in Malaysia",
    summary: "Armed men stole a container of electronics valued at US$180,000.",
    source: "Verify Harness",
    sourceUrl: null,
    location: "Malaysia",
    country: "Malaysia",
    severity: "high",
    occurredAt: new Date().toISOString().slice(0, 10),
    relevanceStatus: null,
    corroborations: [],
  },
];

async function bundleBrowser(): Promise<string> {
  const req = createRequire(import.meta.url);
  const esbuildMain = req.resolve(
    "/home/runner/workspace/node_modules/.pnpm/esbuild@0.27.3/node_modules/esbuild/lib/main.js",
  );
  const { build } = (await import(esbuildMain)) as typeof import("esbuild");
  const result = await build({
    entryPoints: [resolve(HERE, "verifyCargoPatternPdf.browser.tsx")],
    bundle: true,
    format: "iife",
    platform: "browser",
    write: false,
    logLevel: "warning",
    jsx: "automatic",
    alias: { "@": SRC, "@assets": ASSETS },
    loader: {
      ".png": "dataurl",
      ".jpg": "dataurl",
      ".jpeg": "dataurl",
      ".svg": "dataurl",
      ".gif": "dataurl",
      ".webp": "dataurl",
    },
    define: {
      "import.meta.env.BASE_URL": '"/"',
      "import.meta.env.MODE": '"production"',
      "import.meta.env.DEV": "false",
      "import.meta.env.PROD": "true",
      "process.env.NODE_ENV": '"production"',
    },
    plugins: [
      {
        name: "url-suffix-dataurl",
        setup(b) {
          // Vite-style `import x from "...ttf?url"` -> emit a data URL string.
          b.onResolve({ filter: /\?url$/ }, (args) => {
            const clean = args.path.replace(/\?url$/, "");
            const resolved = clean.startsWith("@/")
              ? resolve(SRC, clean.slice(2))
              : clean.startsWith("@assets/")
                ? resolve(ASSETS, clean.slice("@assets/".length))
                : clean;
            return {
              path: resolved,
              namespace: "url-dataurl",
              pluginData: { clean: resolved },
            };
          });
          b.onLoad({ filter: /.*/, namespace: "url-dataurl" }, async (args) => {
            const fs = await import("node:fs/promises");
            const path = await import("node:path");
            let p = args.path;
            if (!path.isAbsolute(p)) {
              // Bare package specifier (e.g. @expo-google-fonts/...): resolve via require.
              const { createRequire } = await import("node:module");
              const r = createRequire(resolve(SRC, "lib/pdfFonts.ts"));
              p = r.resolve(p);
            }
            const buf = await fs.readFile(p);
            const ext = path.extname(p).slice(1) || "bin";
            const mime =
              ext === "ttf"
                ? "font/ttf"
                : ext === "otf"
                  ? "font/otf"
                  : "application/octet-stream";
            const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
            return {
              contents: `export default ${JSON.stringify(dataUrl)};`,
              loader: "js",
            };
          });
        },
      },
    ],
  });
  return result.outputFiles![0].text;
}

async function main() {
  const reportId = await fetchLatestTopicReportId("cargo_watch");
  const report = (await fetchTopicReport(reportId)) as {
    issueDate?: string | null;
    status?: string | null;
    [k: string]: unknown;
  };
  const incidents = SPARSE ? SPARSE_INCIDENTS : await fetchTopicIncidents();

  // Reproduce the ReportEditor's draft-advance + Option-A clamp so the harness
  // renders the SAME live window the owner sees in-app, not the stored (stale)
  // issue date. A draft left at an old issue date advances to today; the clamp
  // then pulls it back to the latest real cargo record so the window matches the
  // data the report actually covers (screen == PDF depends on this).
  const today = new Date().toISOString().slice(0, 10);
  const storedIssueDate = (report.issueDate ?? today).slice(0, 10);
  const isDraft = (report.status ?? "draft") === "draft";
  const draftAdvanced = isDraft && storedIssueDate < today;
  const renderIssueDate = draftAdvanced ? today : storedIssueDate;
  const effectiveIssueDate = clampIssueDateToLatestRecord(
    renderIssueDate,
    incidents as Array<{ occurredAt: string; topic?: string }>,
    "cargo_watch",
  );
  report.issueDate = effectiveIssueDate;

  console.log(
    `Cargo report ${reportId}; incidents=${incidents.length}${SPARSE ? " (SPARSE synthetic)" : ""}; ` +
      `stored issueDate=${storedIssueDate} -> effective=${effectiveIssueDate}`,
  );

  const bundle = await bundleBrowser();
  console.log(`Bundled browser harness (${(bundle.length / 1024).toFixed(0)} KB).`);

  const executablePath =
    process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;
  const browser = await chromium.launch({
    executablePath,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 1600 },
    });
    page.on("console", (m) => console.log(`[page:${m.type()}]`, m.text()));
    page.on("pageerror", (e) => console.log("[pageerror]", e.message));
    await page.setContent(
      "<!doctype html><html><head><meta charset=utf-8></head><body></body></html>",
    );
    await page.addScriptTag({ content: bundle });
    const resultJson = await page.evaluate(
      async ([data]) => {
        (window as unknown as { __VERIFY_DATA__: unknown }).__VERIFY_DATA__ =
          data;
        return await (
          window as unknown as { __runVerify__: () => Promise<string> }
        ).__runVerify__();
      },
      [{ report, incidents }] as const,
    );
    const result = JSON.parse(resultJson) as {
      saveCalls: number;
      err: string | null;
      base64: string;
    };
    console.log(`saveCalls=${result.saveCalls}`);
    if (result.err) console.log("export error:\n" + result.err);
    if (!result.base64) throw new Error("export produced no PDF bytes");
    const out = resolve(
      WORKBENCH,
      "screenshots",
      SPARSE
        ? "CargoWatch_Pattern_verify_sparse.pdf"
        : "CargoWatch_Pattern_verify.pdf",
    );
    writeFileSync(out, Buffer.from(result.base64, "base64"));
    console.log(
      `Wrote ${out} (${((result.base64.length * 0.75) / 1024).toFixed(0)} KB)`,
    );
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
