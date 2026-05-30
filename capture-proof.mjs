import { chromium } from "playwright";
import fs from "fs";

const BASE = "https://document-asset-manager-stioffain29.replit.app";
const OUT = "/home/runner/workspace/proof";
fs.mkdirSync(OUT, { recursive: true });

const ONLY = process.env.ONLY;
let targets = [
  { name: "1-fuel-watch", label: "Fuel Watch", url: "/reports/9" },
  { name: "2-fertiliser-watch", label: "Fertiliser Watch", url: "/reports/10" },
  { name: "3-cargo-watch", label: "Cargo Watch", url: "/reports/11" },
  { name: "4-shipping-watch", label: "Shipping Watch", url: "/reports/12" },
  { name: "5-flashpoint", label: "Flashpoint", url: "/reports/13" },
  { name: "6-energy-watch", label: "Energy Watch", url: "/reports/8" },
  { name: "7-png-country", label: "Papua New Guinea", url: "/countries/papua-new-guinea" },
  { name: "8-papua-country", label: "Papua", url: "/countries/papua" },
];
if (ONLY) targets = targets.filter((t) => t.name === ONLY);

const EXE = fs.readFileSync("/tmp/chrome_path.txt", "utf8").trim();
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const ctx = await browser.newContext({ viewport: { width: 1300, height: 1700 }, acceptDownloads: true });
const results = [];

for (const t of targets) {
  const page = await ctx.newPage();
  const r = { ...t };
  try {
    await page.goto(BASE + t.url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector(".print-report", { timeout: 40000 });
    await page.waitForTimeout(2500); // let cover image + fonts settle

    r.fields = await page.evaluate(() => {
      const root = document.querySelector(".print-report");
      const spans = [...root.querySelectorAll("span")];
      const get = (label) => {
        const i = spans.findIndex((s) => s.textContent.trim().toLowerCase().startsWith(label.toLowerCase()));
        return i >= 0 && spans[i + 1] ? spans[i + 1].textContent.trim() : null;
      };
      return {
        status: get("Data status"),
        latestRecord: get("Latest record"),
        lastUpdated: get("Last updated"),
      };
    });

    const el = await page.$(".print-report");
    await el.screenshot({ path: `${OUT}/${t.name}-screen.png` });

    // Click Download PDF; handle a possible confirm modal.
    let download = null;
    const waitDl = page.waitForEvent("download", { timeout: 75000 }).catch(() => null);
    await page.getByRole("button", { name: /Download PDF/i }).first().click();
    await page.waitForTimeout(1500);
    // If a modal "export anyway / continue" button appears, click it.
    const modalBtn = page.getByRole("button", { name: /export anyway|continue|download anyway|proceed/i }).first();
    if (await modalBtn.count().catch(() => 0)) {
      try { await modalBtn.click({ timeout: 3000 }); } catch {}
    }
    download = await waitDl;
    if (download) {
      r.pdf = `${OUT}/${t.name}.pdf`;
      await download.saveAs(r.pdf);
      r.pdfBytes = fs.statSync(r.pdf).size;
    } else {
      r.pdf = "NO_DOWNLOAD_EVENT";
    }
  } catch (e) {
    r.error = e.message.split("\n")[0];
  }
  results.push(r);
  await page.close();
  console.log("done:", t.name, JSON.stringify(r.fields || r.error || ""));
}

await browser.close();
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
console.log("\n=== RESULTS ===\n" + JSON.stringify(results, null, 2));
