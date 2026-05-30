const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE = "https://document-asset-manager-stioffain29.replit.app";
const OUT = path.join(__dirname);
const EXE = process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE;

const ALL = {
  flashpoint: { url: `${BASE}/reports/13`, file: "flashpoint" },
  cargo: { url: `${BASE}/reports/11`, file: "cargo_watch" },
  papua: { url: `${BASE}/countries/papua`, file: "papua" },
  png: { url: `${BASE}/countries/papua-new-guinea`, file: "papua_new_guinea" },
};

async function run(keys) {
  const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1600 }, acceptDownloads: true });
  for (const key of keys) {
    const t = ALL[key];
    const page = await ctx.newPage();
    console.log(`\n===== ${key.toUpperCase()} :: ${t.url} =====`);
    try {
      await page.goto(t.url, { waitUntil: "networkidle", timeout: 60000 });
    } catch (e) { console.log("nav warn:", e.message); }
    // wait for the printable report DOM
    try { await page.waitForSelector(".print-report", { timeout: 30000 }); }
    catch (e) { console.log("no .print-report:", e.message); }
    await page.waitForTimeout(3500);

    // provenance + status text
    const info = await page.evaluate(() => {
      const out = {};
      const all = Array.from(document.querySelectorAll("body *"));
      const das = all.find((el) => /data as of/i.test(el.textContent || "") && (el.textContent || "").length < 400);
      out.dataAsOf = das ? das.textContent.replace(/\s+/g, " ").trim() : null;
      const status = all.find((el) => /^(LIVE|MANUAL|STATIC)\b/i.test((el.textContent || "").trim()) && (el.textContent || "").trim().length < 30);
      out.statusBadge = status ? status.textContent.replace(/\s+/g, " ").trim() : null;
      const rep = document.querySelector(".print-report");
      out.title = document.title;
      out.reportHead = rep ? rep.innerText.replace(/\s+/g, " ").trim().slice(0, 500) : null;
      return out;
    });
    console.log("data-as-of:", info.dataAsOf);
    console.log("status badge:", info.statusBadge);
    console.log("report head:", info.reportHead);

    // full page screenshot
    const shot = path.join(OUT, `${t.file}.png`);
    await page.screenshot({ path: shot, fullPage: true });
    console.log("screenshot saved:", shot, fs.statSync(shot).size, "bytes");

    // click Download PDF, capture download
    try {
      const btn = page.getByRole("button", { name: /Download PDF/i }).first();
      await btn.scrollIntoViewIfNeeded();
      const [dl] = await Promise.all([
        page.waitForEvent("download", { timeout: 90000 }),
        btn.click(),
      ]);
      const pdf = path.join(OUT, `${t.file}.pdf`);
      await dl.saveAs(pdf);
      console.log("PDF saved:", pdf, fs.statSync(pdf).size, "bytes", "| suggested:", dl.suggestedFilename());
    } catch (e) {
      console.log("PDF export FAILED:", e.message);
    }
    await page.close();
  }
  await ctx.close();
  await browser.close();
}

const keys = process.argv.slice(2);
run(keys).then(() => console.log("\nDONE")).catch((e) => { console.error("FATAL", e); process.exit(1); });
