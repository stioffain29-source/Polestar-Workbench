const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const OUT = path.resolve(process.cwd(), "exports");
const BASE = "http://localhost:80";
const SLUGS = ["papua", "papua-new-guinea"];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    args: ["--no-sandbox"],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
    deviceScaleFactor: 2,
    acceptDownloads: true,
  });
  const page = await ctx.newPage();

  for (const slug of SLUGS) {
    console.log(`\n=== ${slug} ===`);
    await page.goto(`${BASE}/countries/${slug}`, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForSelector(".print-report", { timeout: 30000 });
    // let map tiles + charts settle
    await page.waitForTimeout(6000);

    const shotPath = path.join(OUT, `${slug}-report.png`);
    const reportEl = page.locator(".print-report");
    await reportEl.scrollIntoViewIfNeeded();
    await page.waitForTimeout(2000);
    await reportEl.screenshot({ path: shotPath });
    console.log("screenshot:", shotPath);

    const btn = page.getByRole("button", { name: /download pdf/i });
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 60000 }),
      btn.click(),
    ]);
    const pdfPath = path.join(OUT, `polestar-country-report-${slug}.pdf`);
    await download.saveAs(pdfPath);
    console.log("pdf:", pdfPath);
  }

  await browser.close();
  console.log("\nDONE");
})().catch((e) => {
  console.error("CAPTURE FAILED:", e);
  process.exit(1);
});
