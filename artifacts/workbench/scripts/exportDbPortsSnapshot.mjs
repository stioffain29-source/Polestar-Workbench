/**
 * Read-only headless exporter for a saved Ports and Logistics edition.
 *
 * Usage (from the repository root):
 * node artifacts/workbench/scripts/exportDbPortsSnapshot.mjs 1 exports/db-ports
 *
 * The edition is read from Postgres through the same `toEdition` projection the
 * API serves, so the Word and PDF files here are byte-for-byte the documents the
 * in-app Download buttons produce for that revision. Nothing is written back.
 *
 * The temporary executable is bundled so Vite `?url` Roboto imports become data
 * URLs that Node can load.
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
const editionId = process.argv[2] || "1";
const outputDirectory = resolve(repository, process.argv[3] || "exports/db-ports");
const temporaryDirectory = resolve(repository, ".local/db-ports-export");
const executable = resolve(temporaryDirectory, "export-db-ports.cjs");
mkdirSync(temporaryDirectory, { recursive: true });
mkdirSync(outputDirectory, { recursive: true });

const entry = `
const { writeFileSync, mkdirSync } = require("node:fs");
const { resolve } = require("node:path");
const { Packer } = require("docx");
const { buildDbPortsDocxDocument, buildDbPortsPdf } = require(${JSON.stringify(resolve(workbench, "src/lib/dbPortsExport.ts"))});
const { getEditionRow, toEdition } = require(${JSON.stringify(resolve(repository, "artifacts/api-server/src/lib/dbPortsEditions.ts"))});
const { pool } = require("@workspace/db");

async function main() {
  const editionId = Number(process.argv[2]);
  const outputDirectory = process.argv[3];
  if (!Number.isInteger(editionId) || editionId <= 0) throw new Error("Edition id must be a positive integer.");
  const edition = toEdition(await getEditionRow(editionId));
  const payload = { edition, generatedAt: new Date().toISOString() };
  const basename = "Ports-and-Logistics-Intelligence-" + edition.endDate;
  mkdirSync(outputDirectory, { recursive: true });
  const docx = await Packer.toBuffer(buildDbPortsDocxDocument(payload));
  writeFileSync(resolve(outputDirectory, basename + ".docx"), docx);
  const pdf = await buildDbPortsPdf(payload);
  writeFileSync(resolve(outputDirectory, basename + ".pdf"), Buffer.from(pdf.output("arraybuffer")));
  process.stdout.write(JSON.stringify({
    basename,
    generatedAt: payload.generatedAt,
    title: edition.title,
    period: edition.startDate + " to " + edition.endDate,
    revision: edition.revision,
    selected: edition.quality.selectedCount,
    watch: edition.quality.watchCount,
  }, null, 2));
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
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

const result = spawnSync(process.execPath, [executable, editionId, outputDirectory], {
  cwd: repository,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
rmSync(temporaryDirectory, { recursive: true, force: true });
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.status !== 0) process.exit(result.status ?? 1);
