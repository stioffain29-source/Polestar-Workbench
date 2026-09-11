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
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { eq, asc, desc } from "drizzle-orm";
import {
  db,
  pool,
  reportsTable,
  marketPricesTable,
  reportProseTable,
} from "@workspace/db";
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeSectionOverrides(
  saved: unknown,
  requested: unknown,
): unknown {
  if (requested === undefined) return saved;
  if (!isRecord(saved) || !isRecord(requested)) return requested;
  return { ...saved, ...requested };
}

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

// Read the existing prose cache only. This deliberately does not call the
// report-prose API: that endpoint can generate and persist a new narrative on
// a cache miss, which a verification harness must never do.
async function fetchSavedAiProse(reportId: number): Promise<unknown | null> {
  const [row] = await db
    .select()
    .from(reportProseTable)
    .where(eq(reportProseTable.reportId, reportId))
    .limit(1);
  if (!row) return null;

  const sections = row.edited ?? row.sections;
  if (!sections) return null;
  const stale =
    !!row.edited &&
    (row.editedFingerprint == null ||
      row.editedFingerprint !== row.fingerprint ||
      row.editedGenerationBasisFingerprint !== row.generationBasisFingerprint);
  return {
    ...sections,
    datasetFingerprint:
      (row.edited
        ? row.editedGenerationBasisFingerprint
        : row.generationBasisFingerprint) ?? undefined,
    stale,
  };
}

async function bundleBrowser(): Promise<string> {
  const req = createRequire(import.meta.url);
  const esbuildMain = req.resolve(
    "/home/runner/workspace/node_modules/.pnpm/esbuild@0.27.3/node_modules/esbuild/lib/main.js",
  );
  const { build } = (await import(esbuildMain)) as typeof import("esbuild");
  const cartoBasemapKey = process.env.VITE_CARTO_BASEMAP_KEY?.trim();
  if (!cartoBasemapKey) {
    throw new Error(
      "VITE_CARTO_BASEMAP_KEY is required to bundle the browser verification harness.",
    );
  }
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
      // CountryChoroplethMap imports the shared CARTO config at module load.
      // Inject the secret value into the browser bundle without ever printing
      // it or exposing it in harness diagnostics.
      "__CARTO_BASEMAP_KEY__": JSON.stringify(cartoBasemapKey),
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

const PDF_HEADINGS = new Map(
  [
    "FAST FACTS",
    "BLUF",
    "ENERGY SITUATION",
    "MARKET PRICES",
    "WHAT HAPPENED",
    "WHAT MATTERS",
    "IMPLICATIONS FOR BUSINESS",
    "WATCH NEXT",
    "POLESTAR VIEW",
    "RELATED INCIDENTS",
    "DISCLAIMER",
  ].map((heading) => [heading, heading]),
);

function pageHeadings(text: string): string[] {
  const found: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+/g, " ").trim().toUpperCase();
    if (!PDF_HEADINGS.has(line) || found.includes(line)) continue;
    found.push(line);
  }
  return found;
}

function inspectRenderedPdf(pdfPath: string, outDir: string): {
  physicalPages: number;
  headingsByPage: Array<{ page: number; headings: string[] }>;
  overflow: boolean;
  overflowPages: number[];
} {
  mkdirSync(outDir, { recursive: true });
  const info = execFileSync("pdfinfo", [pdfPath], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const pagesMatch = info.match(/^Pages:\s+(\d+)/m);
  const physicalPages = pagesMatch ? Number(pagesMatch[1]) : 0;
  if (!physicalPages) throw new Error("Unable to determine the exported PDF page count.");

  const headingsByPage = [];
  for (let page = 1; page <= physicalPages; page++) {
    const text = execFileSync(
      "pdftotext",
      ["-f", String(page), "-l", String(page), "-layout", pdfPath, "-"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    headingsByPage.push({ page, headings: pageHeadings(text) });
  }

  // Energy Watch has a fixed six-page contract. A seventh (or later) physical
  // page is the observable form of body overflow; render the contract pages
  // regardless so the proof pack still contains pages 2–6 for inspection.
  const expectedPages = 6;
  const overflowPages = Array.from(
    { length: Math.max(0, physicalPages - expectedPages) },
    (_, index) => expectedPages + index + 1,
  );
  const renderThrough = Math.min(expectedPages, physicalPages);
  if (renderThrough >= 2) {
    execFileSync(
      "pdftoppm",
      [
        "-f",
        "2",
        "-l",
        String(renderThrough),
        "-png",
        "-r",
        "144",
        pdfPath,
        resolve(outDir, "page"),
      ],
      { stdio: "ignore" },
    );
  }
  return {
    physicalPages,
    headingsByPage,
    overflow: overflowPages.length > 0,
    overflowPages,
  };
}

async function main() {
  const reportId = await fetchLatestReportId();
  const report = await fetchTopicReport(reportId);
  const allIncidents = await fetchTopicIncidents();
  // Every renderer in the energy/fertiliser branch applies a byTopic window
  // filter before reading incidents. Drop unrelated topic rows before crossing
  // the Node → Chromium boundary; this preserves the exporter input it can
  // observe while avoiding a 100MB+ CDP payload from unrelated archives.
  const incidents = allIncidents.filter(
    (incident) => isRecord(incident) && incident.topic === TOPIC,
  );
  const marketPrices = await fetchGroupMarketPrices();
  const savedAiProse = await fetchSavedAiProse(reportId);
  const savedSectionOverrides = isRecord(report)
    ? report.sectionOverrides
    : undefined;
  const sectionOverrides = mergeSectionOverrides(
    savedSectionOverrides,
    OVERRIDES,
  );
  const hiddenSections =
    isRecord(sectionOverrides) && Array.isArray(sectionOverrides.hiddenSections)
      ? sectionOverrides.hiddenSections
      : undefined;
  const reportIssueDate =
    isRecord(report) && typeof report.issueDate === "string"
      ? report.issueDate
      : "unknown";
  console.log(
    `SAVED DEVELOPMENT REPORT · ${TOPIC} · id=${reportId} · issueDate=${reportIssueDate}`,
  );
  console.log(
    `incidents=${incidents.length}; ${TOPIC} market prices=${marketPrices.length}; savedAiProse=${savedAiProse ? "yes" : "no"}`,
  );
  if (marketPrices.length === 0) {
    throw new Error(`No ${TOPIC} market prices — cannot verify card rendering.`);
  }
  if (OVERRIDES) console.log("Applying requested section overrides on top of saved overrides.");

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
    page.on("crash", () => console.error("Chromium page crashed during PDF export."));
    await page.setContent("<!doctype html><html><head><meta charset=utf-8></head><body></body></html>");
    await page.addScriptTag({ content: bundle });
    const resultJson = await page.evaluate(
      async ([data]) => {
        (window as unknown as { __VERIFY_DATA__: unknown }).__VERIFY_DATA__ = data;
        return await (window as unknown as { __runVerify__: () => Promise<string> }).__runVerify__();
      },
      [
        {
          report,
          incidents,
          marketPrices,
          aiProse: savedAiProse,
          hiddenSections,
          sectionOverrides,
        },
      ] as const,
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
    const inspection = inspectRenderedPdf(
      out,
      resolve(WORKBENCH, "screenshots", `${TOPIC}-MarketPrices-pages`),
    );
    writeFileSync(
      resolve(WORKBENCH, "screenshots", `${TOPIC}_MarketPrices_verify.json`),
      JSON.stringify(
        {
          reportId,
          issueDate: reportIssueDate,
          savedDevelopmentReport: true,
          savedAiProse: !!savedAiProse,
          physicalPages: inspection.physicalPages,
          headingsByPage: inspection.headingsByPage,
          overflow: inspection.overflow,
          overflowPages: inspection.overflowPages,
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify(
        {
          issueDate: reportIssueDate,
          physicalPages: inspection.physicalPages,
          headingsByPage: inspection.headingsByPage,
          overflow: inspection.overflow,
          overflowPages: inspection.overflowPages,
        },
        null,
        2,
      ),
    );
    if (inspection.overflow) {
      throw new Error(
        `Energy Watch PDF overflowed the six-page contract: physical pages ${inspection.physicalPages}.`,
      );
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
}).finally(() => pool.end());
