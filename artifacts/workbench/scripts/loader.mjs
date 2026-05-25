// Node ESM loader for the headless PDF exporter.
//
// - Vite-style `?url` imports for .ttf files are resolved to the actual on-disk
//   path in node_modules and exported as a `file://` URL string. The headless
//   wrapper patches global fetch to read those URLs from disk, so the real
//   Roboto bytes flow into pdfFonts.ts unchanged. This is the critical bit:
//   if pdfFonts is stubbed, jsPDF silently falls back to Helvetica.
// - Other asset specifiers (PNG, JPG, SVG, @assets/*) that the exporter
//   imports for cover/logo art are stubbed to an empty string. The exporter
//   already guards image draws with try/catch so a missing logo simply does
//   not render; nothing else depends on those bytes.
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { resolve as resolvePath, dirname } from "node:path";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
// Workspace root is two levels up from artifacts/workbench/scripts.
const WORKSPACE_ROOT = resolvePath(HERE, "..", "..", "..");
const ATTACHED_ASSETS = resolvePath(WORKSPACE_ROOT, "attached_assets");

function mimeFor(p) {
  if (p.endsWith(".png")) return "image/png";
  if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
  if (p.endsWith(".webp")) return "image/webp";
  if (p.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

function assetAsDataUrl(absPath) {
  const buf = readFileSync(absPath);
  return `data:${mimeFor(absPath)};base64,${buf.toString("base64")}`;
}

function resolveTtfPath(spec) {
  // spec looks like: "@expo-google-fonts/roboto/400Regular/Roboto_400Regular.ttf?url"
  const bare = spec.replace(/\?url$/, "");
  // require.resolve handles the package + subpath lookup against node_modules.
  return require.resolve(bare);
}

export function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith(".ttf?url")) {
    const abs = resolveTtfPath(specifier);
    const fileUrl = pathToFileURL(abs).href;
    const mod = `export default ${JSON.stringify(fileUrl)};`;
    return {
      url: `data:text/javascript,${encodeURIComponent(mod)}`,
      shortCircuit: true,
      format: "module",
    };
  }
  // @assets/<file> -> read the real file from attached_assets/ and inline as
  // a data URL so pdf.addImage gets the actual logo bytes instead of "".
  if (specifier.startsWith("@assets/")) {
    const rel = specifier.slice("@assets/".length).replace(/\?url$/, "");
    try {
      const dataUrl = assetAsDataUrl(resolvePath(ATTACHED_ASSETS, rel));
      const mod = `export default ${JSON.stringify(dataUrl)};`;
      return {
        url: `data:text/javascript,${encodeURIComponent(mod)}`,
        shortCircuit: true,
        format: "module",
      };
    } catch {
      return {
        url: 'data:text/javascript,export default ""',
        shortCircuit: true,
        format: "module",
      };
    }
  }
  const isAssetLike =
    specifier.endsWith("?url") ||
    specifier.endsWith(".ttf") ||
    specifier.endsWith(".png") ||
    specifier.endsWith(".jpg") ||
    specifier.endsWith(".jpeg") ||
    specifier.endsWith(".webp") ||
    specifier.endsWith(".svg");
  if (isAssetLike) {
    return {
      url: 'data:text/javascript,export default ""',
      shortCircuit: true,
      format: "module",
    };
  }
  return nextResolve(specifier, context);
}
