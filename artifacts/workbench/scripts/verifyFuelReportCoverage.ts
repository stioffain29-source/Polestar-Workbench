/**
 * Read-only real-Chromium Fuel Watch coverage harness.
 *
 * The report and incident snapshot is intentionally supplied from /tmp rather
 * than fetched through an application endpoint. The snapshot is produced by a
 * read-only production query outside this harness; this script never writes to
 * the database and never requests AI prose regeneration.
 *
 * Run only after the implementation under review is ready:
 *   cd artifacts/workbench && pnpm exec tsx scripts/verifyFuelReportCoverage.ts
 *
 * Optional environment variables:
 *   FUEL_PRODUCTION_SNAPSHOT=/tmp/fuel-report-23-production-snapshot.json
 *   VERIFY_OUTPUT_DIR=/tmp/fuel-report-23-coverage-artifacts
 */
import { createRequire } from "node:module";
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFuelWatchReportData, fuelMarketLatestDate } from "../src/lib/fuelWatchReport";
import { FUEL_SEVERITIES } from "../src/lib/fuelCanonicalFacts";
import { buildFuelCoverageSummary } from "../src/lib/fuelCoverage";
import { selectRelatedIncidents } from "../src/lib/relatedIncidents";
import { resolveReportTitle } from "../src/lib/reportNaming";
import type { TopicFastFactsIncident } from "../src/lib/topicFastFacts";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKBENCH = resolve(HERE, "..");
const SRC = resolve(WORKBENCH, "src");
const ASSETS = resolve(WORKBENCH, "..", "..", "attached_assets");
const SNAPSHOT_PATH =
  process.env.FUEL_PRODUCTION_SNAPSHOT ??
  "/tmp/fuel-report-23-production-snapshot.json";
const OUTPUT_DIR = resolve(
  process.env.VERIFY_OUTPUT_DIR ??
    "/tmp/fuel-report-23-coverage-artifacts",
);
const PREVIEW_PATH = resolve(
  OUTPUT_DIR,
  "FuelWatch_report23_coverage_preview.png",
);
const PDF_PATH = resolve(OUTPUT_DIR, "FuelWatch_report23_coverage.pdf");
const PROOF_PATH = resolve(
  OUTPUT_DIR,
  "FuelWatch_report23_coverage_proof.json",
);

type Snapshot = {
  report: Record<string, any>;
  incidents: TopicFastFactsIncident[];
  metadata?: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asCleanIncident(incident: TopicFastFactsIncident): TopicFastFactsIncident {
  return {
    id: incident.id,
    topic: incident.topic,
    title: incident.title,
    displayTitle: incident.displayTitle ?? null,
    summary: incident.summary ?? null,
    country: incident.country ?? null,
    location: incident.location ?? null,
    severity: incident.severity ?? "",
    occurredAt: incident.occurredAt,
    source: incident.source ?? null,
    sourceUrl: incident.sourceUrl ?? null,
  };
}

function normalized(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function titlePresentInPdf(text: string, title: string): boolean {
  const haystack = normalized(text);
  const words = normalized(title)
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 4);
  // pdftotext may insert line breaks in a wrapped title. Requiring its
  // distinctive words rather than the exact line keeps this a text-proof
  // assertion while remaining independent of pagination.
  return words.length > 0 && words.every((word) => haystack.includes(word));
}

async function bundleBrowser(): Promise<string> {
  const require = createRequire(import.meta.url);
  const esbuildMain = require.resolve(
    "/home/runner/workspace/node_modules/.pnpm/esbuild@0.27.3/node_modules/esbuild/lib/main.js",
  );
  const { build } = (await import(esbuildMain)) as typeof import("esbuild");
  const cartoBasemapKey = process.env.VITE_CARTO_BASEMAP_KEY?.trim();
  if (!cartoBasemapKey) {
    throw new Error(
      "VITE_CARTO_BASEMAP_KEY is required to bundle the browser harness.",
    );
  }
  const result = await build({
    entryPoints: [resolve(HERE, "verifyFuelReportCoverage.browser.tsx")],
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
      "__CARTO_BASEMAP_KEY__": JSON.stringify(cartoBasemapKey),
    },
    plugins: [
      {
        name: "url-suffix-dataurl",
        setup(b) {
          b.onResolve({ filter: /\?url$/ }, (args) => {
            const clean = args.path.replace(/\?url$/, "");
            const resolved = clean.startsWith("@/")
              ? resolve(SRC, clean.slice(2))
              : clean.startsWith("@assets/")
                ? resolve(ASSETS, clean.slice("@assets/".length))
                : clean;
            return { path: resolved, namespace: "url-dataurl" };
          });
          b.onLoad(
            { filter: /.*/, namespace: "url-dataurl" },
            async (args) => {
              const fs = await import("node:fs/promises");
              const path = await import("node:path");
              let filePath = args.path;
              if (!path.isAbsolute(filePath)) {
                const module = await import("node:module");
                filePath = module
                  .createRequire(resolve(SRC, "lib/pdfFonts.ts"))
                  .resolve(filePath);
              }
              const bytes = await fs.readFile(filePath);
              const ext = path.extname(filePath).slice(1) || "bin";
              const mime =
                ext === "ttf"
                  ? "font/ttf"
                  : ext === "otf"
                    ? "font/otf"
                    : "application/octet-stream";
              const dataUrl = `data:${mime};base64,${bytes.toString("base64")}`;
              return {
                contents: `export default ${JSON.stringify(dataUrl)};`,
                loader: "js",
              };
            },
          );
        },
      },
    ],
  });
  return result.outputFiles![0].text;
}

function inspectPdf(pdfPath: string, expectedTitles: string[]) {
  const info = execFileSync("pdfinfo", [pdfPath], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const pages = Number(info.match(/^Pages:\s+(\d+)/m)?.[1] ?? 0);
  if (!pages) throw new Error("PDF did not report a physical page count.");
  const text = execFileSync("pdftotext", [pdfPath, "-"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return {
    pages,
    textLength: text.length,
    hasRelatedHeading: /\bRELATED INCIDENTS\b/i.test(text),
    relatedTitlesFound: expectedTitles.map((title) =>
      titlePresentInPdf(text, title),
    ),
  };
}

async function main() {
  const snapshot = JSON.parse(
    readFileSync(SNAPSHOT_PATH, "utf8"),
  ) as Snapshot;
  if (!isRecord(snapshot.report) || !Array.isArray(snapshot.incidents)) {
    throw new Error(`Invalid Fuel production snapshot: ${SNAPSHOT_PATH}`);
  }
  if (snapshot.report.id !== 23 || snapshot.report.topic !== "fuel") {
    throw new Error("Snapshot must contain production Fuel report 23.");
  }

  const renderIssueDate =
    fuelMarketLatestDate(snapshot.report.hardNumbers) ??
    String(snapshot.report.issueDate).slice(0, 10);
  // Report 23 is an old draft. Match ReportEditor’s stale-draft safety path:
  // clear saved prose without persisting a mutation, and never pass a cached AI
  // payload whose fingerprint was not freshly validated.
  const staleDraft =
    snapshot.report.status === "draft" &&
    String(snapshot.report.issueDate).slice(0, 10) < renderIssueDate;
  const report = {
    ...snapshot.report,
    title: resolveReportTitle(snapshot.report.topic, snapshot.report.title),
    issueDate: renderIssueDate,
    executiveSummary: staleDraft ? "" : snapshot.report.executiveSummary ?? "",
    situation: staleDraft ? "" : snapshot.report.situation ?? "",
    whatHappened: staleDraft ? "" : snapshot.report.whatHappened ?? "",
    whatMatters: staleDraft ? "" : snapshot.report.whatMatters ?? "",
    implications: staleDraft ? "" : snapshot.report.implications ?? "",
    polestarView: staleDraft ? "" : snapshot.report.polestarView ?? "",
    watchNext: staleDraft ? "" : snapshot.report.watchNext ?? "",
  };
  const incidents = snapshot.incidents.map(asCleanIncident);
  const fuelData = buildFuelWatchReportData(
    { issueDate: renderIssueDate, hardNumbers: report.hardNumbers },
    incidents,
  );
  const coverage = buildFuelCoverageSummary(fuelData.canonicalFacts);
  const severityTotal = Object.values(coverage.severityDistribution).reduce(
    (sum, count) => sum + count,
    0,
  );
  const dailyTotal = coverage.dailyTrend.reduce(
    (sum, day) => sum + day.count,
    0,
  );
  const affectedCountryTotal = coverage.affectedCountries.reduce(
    (sum, country) => sum + country.count,
    0,
  );
  const canonicalAttributedCountryTotal = fuelData.canonicalFacts.countries.reduce(
    (sum, country) => sum + country.count,
    0,
  );
  const canonicalSeverityDistribution = Object.fromEntries(
    FUEL_SEVERITIES.map((severity) => [
      severity,
      fuelData.canonicalFacts.severityDistribution[severity],
    ]),
  );
  const severityParity = FUEL_SEVERITIES.every(
    (severity) =>
      coverage.severityDistribution[severity] ===
      canonicalSeverityDistribution[severity],
  );
  const unattributedRow = coverage.affectedCountries.find(
    (country) => country.country === "Unattributed",
  );
  const expectedUnattributedCount =
    coverage.totalDistinctDevelopments - canonicalAttributedCountryTotal;
  const attributedRows = coverage.affectedCountries.filter(
    (country) => country.country !== "Unattributed",
  );
  const coverageReconciliation = {
    severityTotal,
    dailyTotal,
    affectedCountryTotal,
    canonicalAttributedCountryTotal,
    expectedUnattributedCount,
    unattributedRowCount: unattributedRow?.count ?? null,
    activeCountryRows: attributedRows.length,
    canonicalActiveCountries: fuelData.canonicalFacts.countries.length,
    severityParity,
    severityMatchesTotal:
      severityTotal === coverage.totalDistinctDevelopments,
    dailyMatchesTotal: dailyTotal === coverage.totalDistinctDevelopments,
    countriesMatchCanonical:
      affectedCountryTotal === coverage.totalDistinctDevelopments &&
      coverage.activeCountries === attributedRows.length &&
      coverage.activeCountries === fuelData.canonicalFacts.countries.length &&
      unattributedRow?.count === expectedUnattributedCount,
  };
  if (
    !coverageReconciliation.severityMatchesTotal ||
    !coverageReconciliation.dailyMatchesTotal ||
    !coverageReconciliation.severityParity ||
    !coverageReconciliation.countriesMatchCanonical
  ) {
    throw new Error(
      `Fuel coverage counts do not reconcile: ${JSON.stringify(
        coverageReconciliation,
      )}`,
    );
  }
  const relatedRows = selectRelatedIncidents(
    fuelData.canonicalFacts.qualifyingIncidents.map((incident) => ({
      ...incident.raw,
      id: incident.raw.id ?? incident.id,
    })),
    "fuel",
  );
  const sectionOverrides = isRecord(report.sectionOverrides)
    ? report.sectionOverrides
    : undefined;
  const hiddenSections =
    Array.isArray(sectionOverrides?.hiddenSections)
      ? sectionOverrides.hiddenSections
      : undefined;
  const expected = {
    coverage,
    canonicalQualifyingCount: fuelData.canonicalFacts.qualifyingIncidents.length,
    relatedCount: relatedRows.length,
    relatedTitles: relatedRows.map((row) => row.displayTitle || row.title),
    reportingPeriod: fuelData.canonicalFacts.reportingPeriod,
  };

  mkdirSync(OUTPUT_DIR, { recursive: true });
  const bundle = await bundleBrowser();
  const browser = await chromium.launch({
    executablePath:
      process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
      process.env.CHROMIUM_BIN ||
      undefined,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1200 },
      deviceScaleFactor: 1,
    });
    await page.goto("about:blank");
    await page.addScriptTag({ content: bundle });
    const resultJson = await page.evaluate(
      async (data) => {
        window.__FUEL_COVERAGE_VERIFY_DATA__ = data;
        return window.__runFuelCoverageVerify__();
      },
      {
        report,
        incidents,
        aiProse: null,
        hiddenSections,
        sectionOverrides,
        expected,
      },
    );
    const browserResult = JSON.parse(resultJson) as {
      blocked: boolean;
      previewLength: number;
      coverageFound: boolean;
      coverageMissingTokens: string[];
      relatedVisible: boolean;
      relatedRowCount: number;
      relatedTitlesFound: boolean[];
      saveCalls: number;
      exportError: string | null;
      pdfBytes: number;
      base64: string;
    };
    if (
      browserResult.blocked ||
      !browserResult.coverageFound ||
      browserResult.coverageMissingTokens.length > 0 ||
      !browserResult.relatedVisible ||
      browserResult.relatedRowCount !== expected.relatedCount ||
      browserResult.relatedTitlesFound.some((found) => !found)
    ) {
      throw new Error(
        `Fuel coverage browser assertions failed: ${JSON.stringify({
          blocked: browserResult.blocked,
          coverageFound: browserResult.coverageFound,
          coverageMissingTokens: browserResult.coverageMissingTokens,
          relatedVisible: browserResult.relatedVisible,
          relatedRowCount: browserResult.relatedRowCount,
          expectedRelatedCount: expected.relatedCount,
          relatedTitlesFound: browserResult.relatedTitlesFound,
        })}`,
      );
    }
    await page.screenshot({ path: PREVIEW_PATH, fullPage: true });
    if (!browserResult.base64) {
      throw new Error("Fuel export produced no PDF bytes.");
    }
    writeFileSync(PDF_PATH, Buffer.from(browserResult.base64, "base64"));
    const pdf = inspectPdf(PDF_PATH, expected.relatedTitles);
    const proof = {
      source: "read-only production database snapshot",
      snapshotPath: SNAPSHOT_PATH,
      reportId: report.id,
      staleDraft,
      aiProsePassed: false,
      sourceIncidentRows: incidents.length,
      renderIssueDate,
      reportingPeriod: expected.reportingPeriod,
      canonicalQualifyingCount: expected.canonicalQualifyingCount,
      coverage: {
        totalDistinctDevelopments: coverage.totalDistinctDevelopments,
        activeCountries: coverage.activeCountries,
        canonicalSeverityDistribution,
        severityDistribution: coverage.severityDistribution,
        dailyTrend: coverage.dailyTrend,
        affectedCountries: coverage.affectedCountries,
        reconciliation: coverageReconciliation,
      },
      related: {
        canonicalQualifyingCount: expected.canonicalQualifyingCount,
        selectedCount: expected.relatedCount,
        selectedTitles: expected.relatedTitles,
        visibleInPreview: browserResult.relatedVisible,
        noFixedSixAssertion:
          expected.canonicalQualifyingCount <= 6 ||
          expected.relatedCount > 6 ||
          expected.relatedCount < expected.canonicalQualifyingCount,
      },
      preview: {
        blocked: browserResult.blocked,
        textLength: browserResult.previewLength,
        coverageFound: browserResult.coverageFound,
        coverageMissingTokens: browserResult.coverageMissingTokens,
        relatedVisible: browserResult.relatedVisible,
        relatedRowCount: browserResult.relatedRowCount,
        relatedTitlesFound: browserResult.relatedTitlesFound,
      },
      pdf: {
        bytes: browserResult.pdfBytes,
        saveCalls: browserResult.saveCalls,
        exportError: browserResult.exportError,
        pages: pdf.pages,
        textLength: pdf.textLength,
        hasRelatedHeading: pdf.hasRelatedHeading,
        relatedTitlesFound: pdf.relatedTitlesFound,
      },
      artifacts: {
        preview: PREVIEW_PATH,
        pdf: PDF_PATH,
        proof: PROOF_PATH,
      },
    };
    writeFileSync(PROOF_PATH, `${JSON.stringify(proof, null, 2)}\n`);
    console.log(
      JSON.stringify({
        snapshotPath: SNAPSHOT_PATH,
        reportId: report.id,
        renderIssueDate,
        sourceIncidentRows: incidents.length,
        canonicalQualifyingCount: expected.canonicalQualifyingCount,
        selectedRelatedCount: expected.relatedCount,
        previewPath: PREVIEW_PATH,
        pdfPath: PDF_PATH,
        proofPath: PROOF_PATH,
      }),
    );
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});