// Real-DOM verification driver for the in-app (html2canvas + jsPDF) spot
// report PDF export. Serves the vite-built harness over HTTP, runs the REAL
// exportElementToPdf in Chromium, and writes the captured PDF to disk.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { resolve, extname, join } from "node:path";

const DIST = resolve(import.meta.dirname, "dist");
const OUT = process.env.OUT_PATH || "/tmp/spot_harness.pdf";

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".ttf": "font/ttf",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

const server = createServer(async (req, res) => {
  try {
    const path = req.url.split("?")[0];
    const file = join(DIST, path === "/" ? "/index.html" : path);
    const body = await readFile(file);
    res.writeHead(200, {
      "Content-Type": MIME[extname(file)] || "application/octet-stream",
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const browser = await chromium.launch({
  executablePath:
    process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
    process.env.CHROMIUM_BIN ||
    undefined,
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });
page.on("console", (m) => {
  if (m.type() === "error") console.error("[browser]", m.text());
});
page.on("pageerror", (e) => console.error("[pageerror]", e.message));

await page.goto(`http://127.0.0.1:${port}/scripts/pdfHarness/index.html`, {
  waitUntil: "networkidle",
  timeout: 60000,
});
await page.waitForSelector(".print-report", { timeout: 30000 });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(300);

const dbg = await page.evaluate(() => window.debugBreaks());
console.log(JSON.stringify(dbg, null, 1));
const status = await page.evaluate(() => window.runExport());
if (status !== "OK") {
  console.error(`Export failed: ${status}`);
  process.exit(1);
}
const dataUri = await page.evaluate(() => window.__pdfData);
const base64 = dataUri.slice(dataUri.indexOf("base64,") + "base64,".length);
writeFileSync(OUT, Buffer.from(base64, "base64"));
console.log(`Wrote ${OUT}`);

await browser.close();
server.close();
