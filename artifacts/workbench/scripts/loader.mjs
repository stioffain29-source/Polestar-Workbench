// Node ESM loader that stubs Vite-style asset imports (?url, .ttf, .png,
// @assets/*) so the exporter can run outside the browser bundle.
export function resolve(specifier, context, nextResolve) {
  const isAssetLike =
    specifier.endsWith("?url") ||
    specifier.endsWith(".ttf") ||
    specifier.endsWith(".png") ||
    specifier.endsWith(".jpg") ||
    specifier.endsWith(".jpeg") ||
    specifier.endsWith(".webp") ||
    specifier.endsWith(".svg") ||
    specifier.startsWith("@assets/");
  if (isAssetLike) {
    return {
      url: 'data:text/javascript,export default ""',
      shortCircuit: true,
      format: "module",
    };
  }
  if (specifier.endsWith("/pdfFonts") || specifier.endsWith("/pdfFonts.ts")) {
    const stub = "export function setRoboto(){} export async function ensureRobotoLoaded(){}";
    return {
      url: `data:text/javascript,${encodeURIComponent(stub)}`,
      shortCircuit: true,
      format: "module",
    };
  }
  return nextResolve(specifier, context);
}
