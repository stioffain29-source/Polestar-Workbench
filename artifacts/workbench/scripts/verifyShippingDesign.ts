// Read-only saved-data proof of the actual preview AND browser PDF exporter.
// Run after the Workbench build so its production CSS is available.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { pool } from "@workspace/db";
import { fetchTopicReport, fetchTopicIncidents, fetchMaritimeMovement } from "./topicReportData";
import { buildHeadlessReportData, type HeadlessReportRow } from "./headlessReportData";

const here = dirname(fileURLToPath(import.meta.url));
const workbench = resolve(here, "..");
const src = resolve(workbench, "src");
const assets = resolve(workbench, "../../attached_assets");
const require = createRequire(import.meta.url);
const out = resolve(process.env.OUT_DIR || "../../screenshots/shipping-seven-page-proof");

async function main() {
  const reportId = Number(process.env.REPORT_ID || 12);
  const saved = await fetchTopicReport(reportId) as HeadlessReportRow;
  const report = buildHeadlessReportData(saved, process.env.ISSUE_DATE);
  const [rows, movement] = await Promise.all([
    fetchTopicIncidents(), fetchMaritimeMovement(undefined, 200),
  ]);
  const options = {
    report,
    incidents: (rows as Array<{ topic: string }>).filter((row) => row.topic === "shipping"),
    movement, sectionOverrides: report.sectionOverrides,
    hiddenSections: (report.sectionOverrides as { hiddenSections?: string[] } | null)?.hiddenSections,
  };
  const buildRequire = createRequire(resolve(workbench, "../api-server/package.json"));
  const { build } = await import(buildRequire.resolve("esbuild"));
  const bundle = await build({
    entryPoints: [resolve(here, "verifyShippingDesign.browser.tsx")],
    bundle: true, format: "iife", platform: "browser", write: false,
    outfile: "shipping-proof.js", jsx: "automatic", logLevel: "warning",
    alias: { "@": src, "@assets": assets },
    loader: { ".png": "dataurl", ".jpg": "dataurl", ".jpeg": "dataurl", ".svg": "dataurl", ".webp": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl" },
    define: {
      "import.meta.env.BASE_URL": '"/"', "import.meta.env.MODE": '"production"',
      "import.meta.env.DEV": "false", "import.meta.env.PROD": "true",
      "process.env.NODE_ENV": '"production"',
    },
    plugins: [{
      name: "font-url",
      setup(b) {
        b.onResolve({ filter: /\?url$/ }, (args) => {
          const path = args.path.replace(/\?url$/, "");
          return { path: path.startsWith("@/") ? resolve(src, path.slice(2))
            : path.startsWith("@assets/") ? resolve(assets, path.slice(8))
            : path.startsWith(".") ? resolve(args.resolveDir, path)
            : require.resolve(path), namespace: "font-url" };
        });
        b.onLoad({ filter: /.*/, namespace: "font-url" }, (args) => ({
          contents: `export default ${JSON.stringify(`data:font/${extname(args.path).slice(1)};base64,${readFileSync(args.path).toString("base64")}`)}`,
          loader: "js",
        }));
      },
    }],
  });
  const assetDir = resolve(workbench, "dist/public/assets");
  let css = readdirSync(assetDir).filter((file) => file.endsWith(".css"))
    .map((file) => readFileSync(resolve(assetDir, file), "utf8")).join("\n");
  css = css.replace(/url\(([^)]+)\)/g, (original, path: string) => {
    const clean = path.replace(/['"]/g, "").split("/").pop();
    if (!clean || !/\.(woff2?|ttf|otf)$/.test(clean)) return original;
    return `url(data:font/${extname(clean).slice(1)};base64,${readFileSync(resolve(assetDir, clean)).toString("base64")})`;
  });
  css += bundle.outputFiles.filter((file) => file.path.endsWith(".css")).map((file) => file.text).join("\n");
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1050, height: 1500 } });
    page.on("pageerror", (error) => console.error(error.message));
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body style="margin:0"></body></html>`);
    await page.addScriptTag({ content: bundle.outputFiles.find((file) => file.path.endsWith(".js"))!.text });
    await page.evaluate(async (data) => {
      await window.renderShippingProof(data as Parameters<typeof window.renderShippingProof>[0]);
    }, options);
    const pages = page.locator("[data-shipping-page]");
    const measurements = await pages.evaluateAll((nodes) => nodes.map((node) => {
      const el = node as HTMLElement;
      return { page: el.dataset.shippingPage, height: el.clientHeight,
        contentHeight: el.scrollHeight, width: el.clientWidth, contentWidth: el.scrollWidth,
        text: el.innerText };
    }));
    for (let i = 0; i < await pages.count(); i++) {
      await pages.nth(i).screenshot({ path: resolve(out, `page-${i + 1}.png`) });
    }
    const exported = await page.evaluate(() => window.exportShippingProof());
    const facts = await page.evaluate(() => window.shippingProofFacts);
    const textAt = (number: number) => measurements.find((p) => p.page === String(number))?.text || "";
    const contentChecks = {
      noSeparateExecutiveSummary: !measurements.some((p) => /\bEXECUTIVE SUMMARY\b/.test(p.text)),
      routeRiskQualified: !facts.incomplete || !/\bL[1-5]\b|\bEXTREME\b/.test(textAt(3)),
      timelineHasRealTitles: !/\bCommercial-vessel event\b/.test(textAt(4)),
      relatedRegisterPresent: !facts.incidentCount || /\bDATE\b/i.test(textAt(7)) && /\bSEVERITY\b/i.test(textAt(7)),
      chartsTogether: /INCIDENTS BY REGION/.test(textAt(5)) && /RECORDS BY COUNTRY/.test(textAt(5)),
      disclaimerOnFinalPage: textAt(7).includes("Polestar Advisory Pte. Ltd. is an independent company registered in Singapore."),
    };
    writeFileSync(resolve(out, "shipping-watch.pdf"), Buffer.from(exported.base64, "base64"));
    const result = { reportId, issueDate: report.issueDate, pdfPages: exported.pages, contentChecks, previewPages: measurements };
    writeFileSync(resolve(out, "verification.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ reportId, issueDate: report.issueDate, pdfPages: exported.pages,
      pages: measurements.map(({ text, ...size }) => size) }, null, 2));
    if (measurements.length !== 7 || exported.pages !== 7) throw new Error("Expected seven preview pages and seven PDF pages.");
    if (Object.values(contentChecks).some((passed) => !passed)) throw new Error(`Saved report content checks failed: ${JSON.stringify(contentChecks)}`);
    if (measurements.some((p) => p.contentHeight > p.height + 2 || p.contentWidth > p.width + 2)) {
      throw new Error("The saved report overflows a fixed page.");
    }
  } finally {
    await browser.close();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => pool.end());