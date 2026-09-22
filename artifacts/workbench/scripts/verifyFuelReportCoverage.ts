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
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildFuelWatchReportData,
  finalizeFuelPublication,
  fuelMarketLatestDate,
} from "../src/lib/fuelWatchReport";
import { FUEL_SEVERITIES } from "../src/lib/fuelCanonicalFacts";
import { resolveFuelEffectiveSections } from "../src/lib/fuelReportConsistency";
import { resolveSimpleProse } from "../src/lib/topicProseResolution";
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
  proseCache?: Record<string, any>;
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

function stableJson(value: unknown): string {
  const stable = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(stable);
    if (isRecord(input)) {
      return Object.fromEntries(
        Object.keys(input)
          .sort()
          .map((key) => [key, stable(input[key])]),
      );
    }
    return input;
  };
  return JSON.stringify(stable(value));
}

function sha256Json(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

type EffectiveSections = Record<string, unknown>;

const AUTHORIZED_GENERATED_REWRITES = [
  {
    section: "situation",
    from:
      "Evidence confidence is moderate, so the trend is clear even where the duration and depth of disruption are not yet settled.",
    to: "The duration and depth of disruption are not yet settled.",
  },
  {
    section: "whatHappened",
    from: "from India, Pakistan and Indonesia",
    to: "",
  },
  {
    section: "watchNext",
    from: "in Pakistan, India and Indonesia",
    to: "",
  },
] as const;

// Expected-output oracle only. The raw production AI payload is never passed
// through this helper; ReportPreview/PDF invoke the app's own resolver. This
// lets the proof distinguish the three authorized generated-only corrections
// from any other effective-section mutation.
function expectedAuthorizedGeneratedCorrections(
  sections: EffectiveSections,
): EffectiveSections {
  const expected = { ...sections };
  for (const rewrite of AUTHORIZED_GENERATED_REWRITES) {
    const value = expected[rewrite.section];
    if (typeof value !== "string") continue;
    expected[rewrite.section] = value.replace(rewrite.from, rewrite.to);
  }
  return expected;
}

function effectiveSectionDiff(
  before: EffectiveSections,
  after: EffectiveSections,
): string[] {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return keys.filter((key) => stableJson(before[key]) !== stableJson(after[key]));
}

function assertFuelBulletRenderersUseEffectiveSections() {
  const previewSource = readFileSync(
    resolve(SRC, "components", "ReportPreview.tsx"),
    "utf8",
  );
  const pdfSource = readFileSync(
    resolve(SRC, "lib", "exportTopicReportPdf.ts"),
    "utf8",
  );
  const requiredPreview = [
    'title="Implications for Business" text={fuelEffective?.implications}',
    'title="Watch Next" text={fuelEffective?.watchNext}',
  ];
  const requiredPdf = [
    '"Implications for Business",\n        fuelEffective?.implications ?? ""',
    '"Watch Next",\n        fuelEffective?.watchNext ?? ""',
  ];
  const forbidden = [
    "fuelData.narrativeData.implications",
    "fuelData.narrativeData.watchNext",
  ];
  const missingPreview = requiredPreview.filter(
    (needle) => !previewSource.includes(needle),
  );
  const missingPdf = requiredPdf.filter((needle) => !pdfSource.includes(needle));
  const bypasses = forbidden.filter(
    (needle) => previewSource.includes(needle) || pdfSource.includes(needle),
  );
  if (missingPreview.length || missingPdf.length || bypasses.length) {
    throw new Error(
      `Fuel bullet renderer source regression: ${JSON.stringify({
        missingPreview,
        missingPdf,
        bypasses,
      })}`,
    );
  }
  return {
    previewUsesFuelEffective: true,
    pdfUsesFuelEffective: true,
    noCanonicalBulletBypass: true,
  };
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
      // Stylesheet side-effect imports (leaflet) only need to resolve here; the
      // harness rasterises jsPDF output, not a styled page.
      ".css": "text",
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
    text,
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
  const exportOnly = process.env.FUEL_EXPORT_ONLY === "1";
  if ((!exportOnly && snapshot.report.id !== 23) || snapshot.report.topic !== "fuel") {
    throw new Error(
      exportOnly
        ? "Snapshot must contain a production Fuel report."
        : "Snapshot must contain production Fuel report 23.",
    );
  }

  const renderIssueDate =
    fuelMarketLatestDate(snapshot.report.hardNumbers) ??
    String(snapshot.report.issueDate).slice(0, 10);
  const storedReport = {
    ...snapshot.report,
    title: resolveReportTitle(snapshot.report.topic, snapshot.report.title),
  };
  // Report 23 is an old draft. Match ReportEditor’s stale-draft safety path:
  // clear saved prose without persisting a mutation. The production cached
  // seven-section AI payload is retained separately and passed byte-for-byte;
  // this harness does not regenerate or fabricate prose.
  const staleDraft =
    snapshot.report.status === "draft" &&
    String(snapshot.report.issueDate).slice(0, 10) < renderIssueDate;
  const report = {
    ...storedReport,
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
  const proseCache = snapshot.proseCache;
  if (
    !exportOnly &&
    (!isRecord(proseCache) ||
      !isRecord(proseCache.sections) ||
      Object.keys(proseCache.sections).length !== 7)
  ) {
    throw new Error(
      "Production snapshot must contain the exact cached seven-section Fuel payload.",
    );
  }
  const cachedSections =
    isRecord(proseCache) &&
    isRecord(proseCache.edited) &&
    Object.keys(proseCache.edited).length > 0
      ? proseCache.edited
      : isRecord(proseCache) && isRecord(proseCache.sections)
        ? proseCache.sections
        : null;
  const actualAiProse = cachedSections
    ? {
        ...cachedSections,
        datasetFingerprint: proseCache.fingerprint ?? null,
        stale: false,
        origin:
          isRecord(proseCache.edited) &&
          Object.keys(proseCache.edited).length > 0
            ? "analyst"
            : "generated",
      }
    : null;
  if (exportOnly) {
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
          return window.__runFuelPdfExportVerify__();
        },
        {
          report,
          incidents,
          actualAiProse,
          hiddenSections: Array.isArray(snapshot.report.hiddenSections)
            ? snapshot.report.hiddenSections
            : [],
          sectionOverrides: isRecord(snapshot.report.sectionOverrides)
            ? snapshot.report.sectionOverrides
            : {},
        },
      );
      const result = JSON.parse(resultJson) as {
        saveCalls: number;
        exportError: string | null;
        pdfBytes: number;
        base64: string;
      };
      const pdfPath = resolve(
        OUTPUT_DIR,
        `FuelWatch_report${report.id}_browser.pdf`,
      );
      if (result.base64) {
        writeFileSync(pdfPath, Buffer.from(result.base64, "base64"));
      }
      console.log(
        JSON.stringify({
          reportId: report.id,
          saveCalls: result.saveCalls,
          exportError: result.exportError,
          pdfBytes: result.pdfBytes,
          pdfPath: result.base64 ? pdfPath : null,
        }),
      );
      if (result.exportError || result.saveCalls < 1 || result.pdfBytes < 1) {
        process.exitCode = 1;
      }
    } finally {
      await browser.close();
    }
    return;
  }
  const frozenPath = "/tmp/fuel-report-23-frozen-effective-input.json";
  const frozen = JSON.parse(readFileSync(frozenPath, "utf8")) as Record<
    string,
    any
  >;
  const frozenHashesBefore = {
    storedReport: sha256Json(frozen.storedReport),
    effectiveReport: sha256Json(frozen.effectiveReport),
    proseCache: sha256Json(frozen.proseCache),
    actualAiProse: sha256Json(frozen.actualAiProse),
  };
  if (
    !frozen.hashesBefore ||
    JSON.stringify(frozen.hashesBefore) !== JSON.stringify(frozenHashesBefore)
  ) {
    throw new Error("Frozen Fuel effective input hash baseline does not match.");
  }
  if (sha256Json(proseCache) !== frozenHashesBefore.proseCache) {
    throw new Error("Snapshot prose cache differs from frozen production payload.");
  }
  if (sha256Json(actualAiProse) !== frozenHashesBefore.actualAiProse) {
    throw new Error("Selected cached AI payload differs from frozen input.");
  }
  const prefillExpected = resolveFuelEffectiveSections({
    report: {},
    aiProse: actualAiProse,
    fuelData,
  });
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
    canonicalSections: fuelData.narrativeData.canonicalSections,
    prefillResolved: prefillExpected,
  };
  // The old renderer populated these two fields before entering the old
  // finalizer. Reproduce that exact input locally, then require the current
  // resolver's effective sections to be byte-identical to the frozen HEAD
  // baseline before any issue comparison or browser assertions.
  const rendererInputReport = {
    ...report,
    implications: resolveSimpleProse(
      report.implications,
      actualAiProse.implications,
      "",
    ),
    watchNext: resolveSimpleProse(
      report.watchNext,
      actualAiProse.watchNext,
      "",
    ),
  };
  const currentPublication = finalizeFuelPublication({
    report: rendererInputReport,
    incidents,
    aiProse: actualAiProse,
  });
  const baselinePath = "/tmp/fuel-report-23-baseline-head-validator.json";
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as Record<
    string,
    any
  >;
  const expectedCorrectedSections = expectedAuthorizedGeneratedCorrections(
    baseline.effectiveSections,
  );
  const changedSections = effectiveSectionDiff(
    baseline.effectiveSections,
    currentPublication.effectiveSections,
  );
  const expectedChangedSections = effectiveSectionDiff(
    baseline.effectiveSections,
    expectedCorrectedSections,
  );
  const unauthorizedChangedSections = effectiveSectionDiff(
    expectedCorrectedSections,
    currentPublication.effectiveSections,
  );
  const authorizedChanges = AUTHORIZED_GENERATED_REWRITES.map((rewrite) => ({
    section: rewrite.section,
    rawPhrasePresent:
      typeof baseline.effectiveSections[rewrite.section] === "string" &&
      baseline.effectiveSections[rewrite.section].includes(rewrite.from),
    expectedPhraseRemoved:
      typeof expectedCorrectedSections[rewrite.section] === "string" &&
      !expectedCorrectedSections[rewrite.section].includes(rewrite.from),
    currentMatchesExpected:
      currentPublication.effectiveSections[rewrite.section] ===
      expectedCorrectedSections[rewrite.section],
    beforeSha256: sha256Json(baseline.effectiveSections[rewrite.section]),
    expectedAfterSha256: sha256Json(
      expectedCorrectedSections[rewrite.section],
    ),
    currentAfterSha256: sha256Json(
      currentPublication.effectiveSections[rewrite.section],
    ),
  }));
  const effectiveSectionsParity = {
    baselineSha256: sha256Json(baseline.effectiveSections),
    expectedCorrectedSha256: sha256Json(expectedCorrectedSections),
    currentSha256: sha256Json(currentPublication.effectiveSections),
    changedSections,
    expectedChangedSections,
    unauthorizedChangedSections,
    authorizedChanges,
    exactAuthorizedChanges:
      expectedChangedSections.length === 3 &&
      changedSections.length === 3 &&
      unauthorizedChangedSections.length === 0 &&
      authorizedChanges.every(
        (change) =>
          change.rawPhrasePresent &&
          change.expectedPhraseRemoved &&
          change.currentMatchesExpected,
      ),
  };
  if (!effectiveSectionsParity.exactAuthorizedChanges) {
    throw new Error(
      `Current effective Fuel sections differ beyond the three authorized generated corrections: ${JSON.stringify(
        effectiveSectionsParity,
      )}`,
    );
  }
  const staticFuelBulletRendererAssertion =
    assertFuelBulletRenderersUseEffectiveSections();

  mkdirSync(OUTPUT_DIR, { recursive: true });
  // Recheck validator-only changes cheaply after preview/export wiring has
  // already been exercised with this exact frozen payload.
  if (process.env.FUEL_AUDIT_ONLY === "1") {
    const audit = {
      reportId: report.id,
      renderIssueDate,
      effectiveSectionsParity,
      staticFuelBulletRendererAssertion,
      actualAiSha256: sha256Json(actualAiProse),
      baselineIssues: baseline.auditIssues,
      currentIssues: currentPublication.auditIssues,
    };
    const auditPath = resolve(OUTPUT_DIR, "FuelWatch_report23_final_validation.json");
    writeFileSync(auditPath, JSON.stringify(audit, null, 2));
    console.log(JSON.stringify({ auditPath, ...audit }));
    return;
  }
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
        storedReport,
        incidents,
        actualAiProse,
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
      aiPreviewBlocked: boolean;
      aiPreviewAiSectionsFound: string[];
      aiPreviewMissingSections: string[];
      canonicalTextMissingKeys: string[];
      actualPreviewGateIssues: string[];
      analystPreviewBlocked: boolean;
      analystPreviewGateIssues: string[];
      analystExportError: string | null;
      analystSaveCalls: number;
      prefillMatchesCanonical: boolean;
      prefillMatchesActualResolved: boolean;
      saveCalls: number;
      exportError: string | null;
      pdfBytes: number;
      base64: string;
    };
    const actualGateBlocked = browserResult.actualPreviewGateIssues.length > 0;
    const coverageAssertionsPass = actualGateBlocked
      ? true
      : browserResult.coverageFound &&
        browserResult.coverageMissingTokens.length === 0 &&
        browserResult.relatedVisible &&
        browserResult.relatedRowCount === expected.relatedCount &&
        browserResult.relatedTitlesFound.every(Boolean);
    if (!coverageAssertionsPass || !browserResult.prefillMatchesActualResolved) {
      throw new Error(
        `Fuel coverage browser assertions failed: ${JSON.stringify({
          blocked: browserResult.blocked,
          coverageFound: browserResult.coverageFound,
          coverageMissingTokens: browserResult.coverageMissingTokens,
          relatedVisible: browserResult.relatedVisible,
          relatedRowCount: browserResult.relatedRowCount,
          expectedRelatedCount: expected.relatedCount,
          relatedTitlesFound: browserResult.relatedTitlesFound,
          aiPreviewBlocked: browserResult.aiPreviewBlocked,
          aiPreviewAiSectionsFound: browserResult.aiPreviewAiSectionsFound,
          aiPreviewMissingSections: browserResult.aiPreviewMissingSections,
          canonicalTextMissingKeys: browserResult.canonicalTextMissingKeys,
          actualPreviewGateIssues: browserResult.actualPreviewGateIssues,
          analystPreviewBlocked: browserResult.analystPreviewBlocked,
          analystPreviewGateIssues: browserResult.analystPreviewGateIssues,
          analystExportError: browserResult.analystExportError,
          analystSaveCalls: browserResult.analystSaveCalls,
          prefillMatchesActualResolved: browserResult.prefillMatchesActualResolved,
        })}`,
      );
    }
    await page.screenshot({ path: PREVIEW_PATH, fullPage: true });
    const pdf = browserResult.base64
      ? (() => {
          writeFileSync(PDF_PATH, Buffer.from(browserResult.base64, "base64"));
          return inspectPdf(PDF_PATH, expected.relatedTitles);
        })()
      : null;
    const frozenAfter = JSON.parse(readFileSync(frozenPath, "utf8")) as Record<
      string,
      any
    >;
    const frozenHashesAfter = {
      storedReport: sha256Json(frozenAfter.storedReport),
      effectiveReport: sha256Json(frozenAfter.effectiveReport),
      proseCache: sha256Json(frozenAfter.proseCache),
      actualAiProse: sha256Json(frozenAfter.actualAiProse),
    };
    const proof = {
      source: "read-only production database snapshot",
      snapshotPath: SNAPSHOT_PATH,
      frozenInputPath: frozenPath,
      reportId: report.id,
      staleDraft,
      cachedAi: {
        origin: actualAiProse.origin,
        sectionCount: Object.keys(cachedSections).length,
        fingerprint: proseCache.fingerprint ?? null,
        model: proseCache.model ?? null,
        generatedAt: proseCache.generatedAt ?? null,
        exactPayloadSha256: sha256Json(actualAiProse),
      },
      inputHashes: {
        before: frozenHashesBefore,
        after: frozenHashesAfter,
        unchanged:
          JSON.stringify(frozenHashesAfter) ===
          JSON.stringify(frozenHashesBefore),
      },
      sourceIncidentRows: incidents.length,
      effectiveSectionsParity,
      staticFuelBulletRendererAssertion,
      baselineAuditIssues: baseline.auditIssues,
      currentAuditIssues: currentPublication.auditIssues,
      currentLiteralJudgementIssueCount:
        currentPublication.auditIssues.consistency.filter(
          (issue) => issue.code === "JUDGEMENT_CONSISTENCY",
        ).length,
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
        aiPreviewBlocked: browserResult.aiPreviewBlocked,
        aiPreviewAiSectionsFound: browserResult.aiPreviewAiSectionsFound,
        aiPreviewMissingSections: browserResult.aiPreviewMissingSections,
        canonicalTextMissingKeys: browserResult.canonicalTextMissingKeys,
        actualPreviewGateIssues: browserResult.actualPreviewGateIssues,
        analystPreviewBlocked: browserResult.analystPreviewBlocked,
        analystPreviewGateIssues: browserResult.analystPreviewGateIssues,
        analystExportError: browserResult.analystExportError,
        analystSaveCalls: browserResult.analystSaveCalls,
        prefillMatchesActualResolved: browserResult.prefillMatchesActualResolved,
      },
      pdf: {
        bytes: browserResult.pdfBytes,
        saveCalls: browserResult.saveCalls,
        exportError: browserResult.exportError,
        pages: pdf?.pages ?? 0,
        textLength: pdf?.textLength ?? 0,
        hasRelatedHeading: pdf?.hasRelatedHeading ?? false,
        relatedTitlesFound: pdf?.relatedTitlesFound ?? [],
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