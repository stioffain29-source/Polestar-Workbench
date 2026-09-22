/**
 * Read-only headless exporter for a saved DB Ports edition snapshot.
 *
 * Usage (from the repository root):
 * node artifacts/workbench/scripts/exportDbPortsSnapshot.mjs \
 *   research/db-ports-pilot/first-edition-snapshot.json exports/db-ports
 *
 * The temporary executable is bundled so Vite `?url` Roboto imports become
 * data URLs that Node's native fetch can load. No server or database is used.
 */
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const workbench = resolve(here, "..");
const repository = resolve(workbench, "../..");
const require = createRequire(import.meta.url);
const { build } = await import(createRequire(require.resolve("vite")).resolve("esbuild"));
const snapshot = resolve(repository, process.argv[2] || "research/db-ports-pilot/first-edition-snapshot.json");
const outputDirectory = resolve(repository, process.argv[3] || "exports/db-ports");
const temporaryDirectory = resolve(repository, ".local/db-ports-export");
const executable = resolve(temporaryDirectory, "export-db-ports.cjs");
mkdirSync(temporaryDirectory, { recursive: true });
mkdirSync(outputDirectory, { recursive: true });

const entry = `
const { readFileSync, writeFileSync, mkdirSync } = require("node:fs");
const { resolve } = require("node:path");
const { Packer } = require("docx");
const { buildDbPortsDocxDocument, buildDbPortsPdf } = require(${JSON.stringify(resolve(workbench, "src/lib/dbPortsExport.ts"))});
const { assessDbPortsItem, buildDbPortsQuality } = require("@workspace/db-ports");

async function main() {
  const snapshotPath = process.argv[2];
  const outputDirectory = process.argv[3];
  const raw = JSON.parse(readFileSync(snapshotPath, "utf8"));
  const window = { startDate: raw.startDate, endDate: raw.endDate };
  const items = raw.items.map((item) => {
    const assessment = assessDbPortsItem(item, window);
    return { ...item, blockers: assessment.blockers, secondaryReviewRequired: assessment.secondaryReviewRequired };
  });
  const editionWithoutQuality = { ...raw, items };
  const quality = buildDbPortsQuality(editionWithoutQuality);
  const edition = { ...editionWithoutQuality, quality };
  const payload = { edition, mode: "working", generatedAt: new Date().toISOString() };
  const basename = "DB-Ports-Pilot-2026-09-22-working";
  mkdirSync(outputDirectory, { recursive: true });
  const docx = await Packer.toBuffer(buildDbPortsDocxDocument(payload));
  writeFileSync(resolve(outputDirectory, basename + ".docx"), docx);
  const pdf = await buildDbPortsPdf(payload);
  writeFileSync(resolve(outputDirectory, basename + ".pdf"), Buffer.from(pdf.output("arraybuffer")));
  process.stdout.write(JSON.stringify({
    basename,
    generatedAt: payload.generatedAt,
    quality,
    itemBlockers: items.map(({ id, blockers }) => ({ id, blockers })),
  }, null, 2));
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
`;

await build({
  stdin: {
    contents: entry,
    loader: "js",
    resolveDir: workbench,
    sourcefile: "db-ports-headless-entry.js",
  },
  outfile: executable,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  logLevel: "warning",
  loader: {
    ".png": "dataurl",
    ".jpg": "dataurl",
    ".jpeg": "dataurl",
    ".svg": "dataurl",
    ".webp": "dataurl",
    ".gif": "dataurl",
    ".ttf": "dataurl",
  },
  plugins: [{
    name: "inline-url-assets",
    setup(pluginBuild) {
      pluginBuild.onResolve({ filter: /\?url$/ }, (args) => ({
        path: require.resolve(args.path.replace(/\?url$/, "")),
        namespace: "inline-url",
      }));
      pluginBuild.onLoad({ filter: /.*/, namespace: "inline-url" }, (args) => {
        const extension = extname(args.path).slice(1);
        const mime = extension === "ttf" ? "font/ttf" : `application/${extension}`;
        const data = readFileSync(args.path).toString("base64");
        return { contents: `module.exports = "data:${mime};base64,${data}";`, loader: "js" };
      });
    },
  }],
});

const result = spawnSync(process.execPath, [executable, snapshot, outputDirectory], {
  cwd: repository,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
rmSync(temporaryDirectory, { recursive: true, force: true });
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.status !== 0) process.exit(result.status ?? 1);