/**
 * Read-only, production-snapshot verification of the real preview and in-app
 * PDF exporter. This does not log in, alter reports, or expose a debug route.
 *
 * From repo root:
 * pnpm --filter @workspace/workbench exec tsx scripts/verifyRegionalReportMap.ts \
 *   ../../.local/verification/regional-map-production.json
 *
 * VERIFY_ORIGIN is the deployment URL obtained from deployment metadata.
 * Its document is fulfilled only inside this isolated browser; application
 * routes, sessions, API responses and all basemap requests remain untouched.
 */
import { createRequire } from "node:module";
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKBENCH = resolve(HERE, "..");
const SRC = resolve(WORKBENCH, "src");
const ASSETS = resolve(WORKBENCH, "../../attached_assets");
const OUT = resolve(
  WORKBENCH,
  `../../screenshots/${process.env.REGIONAL_VERIFY_OUTPUT_DIR || "regional-map-fix"}`,
);
const require = createRequire(import.meta.url);
const { build } = await import(createRequire(require.resolve("vite")).resolve("esbuild"));
const input = process.argv[2];
if (!input) throw new Error("Pass a read-only saved-report JSON snapshot.");
const reports = JSON.parse(readFileSync(resolve(input), "utf8"));
const origin = process.env.VERIFY_ORIGIN;
if (!origin?.startsWith("https://")) throw new Error("VERIFY_ORIGIN must be a verified app URL.");
// Normal compile-time app configuration, never logged or written to disk.
const key = process.env.VITE_CARTO_BASEMAP_KEY;
if (!key) throw new Error("The configured CARTO basemap key is required.");

const result = await build({
  entryPoints: [resolve(HERE, "verifyRegionalReportMap.browser.tsx")],
  bundle: true, format: "iife", platform: "browser", write: false,
  jsx: "automatic", logLevel: "warning",
  alias: { "@": SRC, "@assets": ASSETS },
  loader: { ".png": "dataurl", ".jpg": "dataurl", ".jpeg": "dataurl", ".svg": "dataurl", ".webp": "dataurl", ".gif": "dataurl" },
  define: {
    "import.meta.env.BASE_URL": '"/"',
    "import.meta.env.MODE": '"production"',
    "import.meta.env.DEV": "false",
    "import.meta.env.PROD": "true",
    "process.env.NODE_ENV": '"production"',
    "__CARTO_BASEMAP_KEY__": JSON.stringify(key),
  },
  plugins: [{
    name: "inline-fonts",
    setup(b: import("esbuild").PluginBuild) {
      b.onResolve({ filter: /\?url$/ }, (args) => {
        const clean = args.path.replace(/\?url$/, "");
        return {
          path: clean.startsWith("@/") ? resolve(SRC, clean.slice(2))
            : clean.startsWith("@assets/") ? resolve(ASSETS, clean.slice(8))
              : require.resolve(clean),
          namespace: "inline-font",
        };
      });
      b.onLoad({ filter: /.*/, namespace: "inline-font" }, (args) => ({
        contents: `export default ${JSON.stringify(`data:font/${extname(args.path).slice(1)};base64,${readFileSync(args.path).toString("base64")}`)};`,
        loader: "js",
      }));
    },
  }],
});
const cssDir = resolve(WORKBENCH, "dist/public/assets");
const css = readdirSync(cssDir).filter((name) => name.endsWith(".css"))
  .map((name) => readFileSync(resolve(cssDir, name), "utf8")).join("\n");
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
  page.setDefaultTimeout(45_000);
  const route = `${origin.replace(/\/$/, "")}/__local-regional-map-verification`;
  await page.route(route, (request) => request.fulfill({
    contentType: "text/html",
    body: "<!doctype html><html><head><meta charset='utf-8'></head><body><main id='root' style='max-width:800px;margin:24px auto'></main></body></html>",
  }));
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: result.outputFiles[0].text });
  const verification: unknown[] = [];
  for (const report of reports) {
    const preview = await page.evaluate(async (data) => window.renderRegionalVerification(data), report);
    await page.locator("[data-regional-map-root]").screenshot({ path: resolve(OUT, `${report.topic}-preview.png`) });
    await page.locator("[data-regional-required='risk-map']").locator("..").screenshot({ path: resolve(OUT, `${report.topic}-report-page.png`) });
    const encoded = await page.evaluate(async (data) => window.exportRegionalVerification(data), report);
    const pdf = resolve(OUT, `${report.topic}.pdf`);
    writeFileSync(pdf, Buffer.from(encoded, "base64"));
    execFileSync("pdftotext", ["-layout", pdf, resolve(OUT, `${report.topic}.txt`)]);
    // The map follows the Regional Outlook, on the first or second body page.
    execFileSync("pdftoppm", ["-f", "2", "-l", "3", "-scale-to", "1600", "-png", pdf, resolve(OUT, `${report.topic}-pdf`)]);
    await page.setViewportSize({ width: 390, height: 1100 });
    const mobile = await page.evaluate(async (data) => window.renderRegionalVerification(data, true), report);
    await page.locator("[data-regional-map-root]").screenshot({ path: resolve(OUT, `${report.topic}-mobile.png`) });
    verification.push({ id: report.id, topic: report.topic, preview, mobile, pdfBytes: Buffer.byteLength(encoded, "base64") });
    await page.setViewportSize({ width: 1280, height: 1100 });
  }
  writeFileSync(resolve(OUT, "verification.json"), JSON.stringify(verification, null, 2));
  console.log(JSON.stringify(verification, null, 2));
} finally {
  await browser.close();
}