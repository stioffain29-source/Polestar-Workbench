import { chromium } from "playwright";
import { resolve } from "node:path";

const BASE = process.env.API_BASE ?? "http://localhost:80";
const OUT_DIR = resolve(process.cwd(), "screenshots");

const REPORTS = [
  { id: 13, name: "Flashpoint_Protests" },
  { id: 12, name: "Shipping_Hormuz" },
  { id: 11, name: "CargoWatch" },
  { id: 9, name: "FuelWatch" },
  { id: 10, name: "FertiliserWatch" },
  { id: 8, name: "EnergyWatch" },
];

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_BIN || undefined,
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });

for (const r of REPORTS) {
  const url = `${BASE}/reports/${r.id}`;
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForSelector(".print-report", { timeout: 30000 });
  await page.evaluate(async () => {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const imgs = Array.from(document.images);
    await Promise.all(
      imgs.map((img) =>
        img.complete ? Promise.resolve() : new Promise((res) => { img.onload = img.onerror = res; })
      )
    );
  });
  await page.waitForTimeout(800);
  // Isolate the report into a clean body so the editor's fixed-height,
  // overflow-hidden two-pane layout cannot clip output to a single page.
  await page.evaluate(() => {
    const pr = document.querySelector(".print-report");
    if (!pr) return;
    const clone = pr.cloneNode(true);
    document.body.replaceChildren(clone);
    document.documentElement.style.cssText = "height:auto;overflow:visible;margin:0;padding:0;";
    document.body.style.cssText = "height:auto;overflow:visible;margin:0;padding:0;background:#fff;";
    const fix = document.createElement("style");
    fix.textContent =
      ".print-report,.print-report *{overflow:visible !important;max-height:none !important;}" +
      ".print-report{display:block !important;width:100%;}";
    document.head.appendChild(fix);
  });
  await page.waitForTimeout(300);
  await page.emulateMedia({ media: "print" });
  const out = resolve(OUT_DIR, `${r.name}_2026-05-30.pdf`);
  await page.pdf({
    path: out,
    format: "A4",
    printBackground: true,
    margin: { top: "0", right: "0", bottom: "0", left: "0" },
  });
  console.log(`Wrote ${out}`);
}

await browser.close();
