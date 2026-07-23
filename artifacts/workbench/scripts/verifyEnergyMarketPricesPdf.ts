// Energy "Market Prices" live-PDF verification harness.
//
// The workbench is owner-gated, so the in-app "Download PDF" path (html2canvas
// over MarketPricesReportGrid, invoked from exportTopicReportPdf's energy
// branch) cannot be driven through a real signed-in browser session headlessly.
// This harness reproduces that EXACT client path in a real Chromium page:
//   1. read the energy report + incidents + energy market-price rows from
//      Postgres (same shapes the /api endpoints return),
//   2. esbuild-bundle the real exportTopicReportPdf for the browser,
//   3. run it in Chromium so embedReactChartInPdf rasterises the real
//      MarketPricesReportGrid via html2canvas,
//   4. write the produced PDF to screenshots/ for inspection.
//
// Run: cd artifacts/workbench && npx tsx scripts/verifyEnergyMarketPricesPdf.ts
import { createRequire } from "node:module";
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { eq, asc, desc } from "drizzle-orm";
import { db, reportsTable, marketPricesTable } from "@workspace/db";
import { fetchTopicReport, fetchTopicIncidents } from "./topicReportData";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKBENCH = resolve(HERE, "..");
const SRC = resolve(WORKBENCH, "src");
const ASSETS = resolve(WORKBENCH, "..", "..", "attached_assets");

// Topic under test — energy by default; fertiliser shares the exact same
// Market Prices branch (grid + overrides), so the harness covers both.
const TOPIC = (process.env.TOPIC ?? "energy").toLowerCase();
// Optional analyst overrides to exercise (JSON TopicSectionOverrides).
const OVERRIDES = process.env.OVERRIDES ? JSON.parse(process.env.OVERRIDES) : undefined;

async function fetchLatestReportId(): Promise<number> {
  const [row] = await db
    .select({ id: reportsTable.id })
    .from(reportsTable)
    .where(eq(reportsTable.topic, TOPIC))
    .orderBy(desc(reportsTable.id))
    .limit(1);
  if (!row) throw new Error(`No ${TOPIC} report found in the database.`);
  return row.id;
}

async function fetchGroupMarketPrices(): Promise<unknown[]> {
  const rows = await db
    .select()
    .from(marketPricesTable)
    .where(eq(marketPricesTable.group, TOPIC))
    .orderBy(asc(marketPricesTable.group), asc(marketPricesTable.key));
  return JSON.parse(JSON.stringify(rows));
}

async function bundleBrowser(): Promise<string> {
  const req = createRequire(import.meta.url);
  const esbuildMain = req.resolve(
    "/home/runner/workspace/node_modules/.pnpm/esbuild@0.27.3/node_modules/esbuild/lib/main.js",
  );
  const { build } = (await import(esbuildMain)) as typeof import("esbuild");
  const result = await build({
    entryPoints: [resolve(HERE, "verifyEnergyMarketPricesPdf.browser.tsx")],
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
            return { path: resolved, namespace: "url-dataurl", pluginData: { clean: resolved } };
          });
          b.onLoad({ filter: /.*/, namespace: "url-dataurl" }, async (args) => {
            const fs = await import("node:fs/promises");
            const path = await import("node:path");
            let p = args.path;
            if (!path.isAbsolute(p)) {
              // Bare package specifier (e.g. @expo-google-fonts/...): resolve via require.
              const { createRequire } = await import("node:module");
              const req = createRequire(resolve(SRC, "lib/pdfFonts.ts"));
              p = req.resolve(p);
            }
            const buf = await fs.readFile(p);
            const ext = path.extname(p).slice(1) || "bin";
            const mime =
              ext === "ttf" ? "font/ttf" : ext === "otf" ? "font/otf" : "application/octet-stream";
            const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
            return { contents: `export default ${JSON.stringify(dataUrl)};`, loader: "js" };
          });
        },
      },
    ],
  });
  return result.outputFiles![0].text;
}

async function main() {
  const reportId = await fetchLatestReportId();
  const report = await fetchTopicReport(reportId);
  const incidents = await fetchTopicIncidents();
  const marketPrices = await fetchGroupMarketPrices();
  console.log(
    `${TOPIC} report ${reportId}; incidents=${incidents.length}; ${TOPIC} market prices=${marketPrices.length}`,
  );
  if (marketPrices.length === 0) {
    throw new Error(`No ${TOPIC} market prices — cannot verify card rendering.`);
  }
  if (OVERRIDES) console.log(`Applying overrides: ${JSON.stringify(OVERRIDES)}`);

  const bundle = await bundleBrowser();
  console.log(`Bundled browser harness (${(bundle.length / 1024).toFixed(0)} KB).`);

  const executablePath =
    process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;
  const browser = await chromium.launch({
    executablePath,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });
    page.on("console", (m) => console.log(`[page:${m.type()}]`, m.text()));
    page.on("pageerror", (e) => console.log("[pageerror]", e.message));
    await page.setContent("<!doctype html><html><head><meta charset=utf-8></head><body></body></html>");
    await page.addScriptTag({ content: bundle });
    const resultJson = await page.evaluate(
      async ([data]) => {
        (window as unknown as { __VERIFY_DATA__: unknown }).__VERIFY_DATA__ = data;
        return await (window as unknown as { __runVerify__: () => Promise<string> }).__runVerify__();
      },
      [{ report, incidents, marketPrices, sectionOverrides: OVERRIDES }] as const,
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
      `${TOPIC === "energy" ? "EnergyWatch" : "FertiliserWatch"}_MarketPrices_verify.pdf`,
    );
    writeFileSync(out, Buffer.from(result.base64, "base64"));
    console.log(`Wrote ${out} (${(result.base64.length * 0.75 / 1024).toFixed(0)} KB)`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
