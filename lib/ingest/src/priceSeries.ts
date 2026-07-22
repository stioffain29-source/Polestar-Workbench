// Shared low-level price-series fetchers and helpers.
//
// Extracted from marketPrices.ts so BOTH the fuel-report price ingest
// (marketPrices.ts → report hard_numbers) and the live market-snapshot ingest
// (marketSnapshot.ts → market_prices table that the topic monitors read) run
// the exact same FRED / Yahoo fetch + parse + as-of logic. One source of truth
// for "what is the latest close" so the report and the monitor can never
// disagree on a price.
//
// FRED's fredgraph.csv and Yahoo's chart endpoint are both public and need no
// API key. Nothing here closes the shared DB pool.

export const FRED_CSV = "https://fred.stlouisfed.org/graph/fredgraph.csv";
const YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart";

export type PricePoint = { date: string; value: number };

export type Series = {
  id: string;
  /** Human-readable provenance shown on the price card (must match the data actually used). */
  source: string;
  /** Ascending by date, missing values dropped. */
  points: PricePoint[];
};

const FETCH_ATTEMPTS = 3;

export function parseFredCsv(text: string): PricePoint[] {
  const lines = text.trim().split(/\r?\n/);
  const points: PricePoint[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(",");
    if (parts.length < 2) continue;
    const date = parts[0].trim();
    const raw = parts[1].trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (raw === "" || raw === ".") continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    points.push({ date, value });
  }
  points.sort((a, b) => a.date.localeCompare(b.date));
  return points;
}

/**
 * Fetch one FRED series, retrying transient failures. FRED's public
 * fredgraph.csv endpoint is intermittently flaky (HTTP/2 stream resets, brief
 * 5xx/429); retrying with backoff makes the common transient case self-heal
 * within one run. A hard failure throws so the caller records it.
 */
export async function fetchFredSeries(id: string, source: string, startDate: string): Promise<Series> {
  const url = `${FRED_CSV}?id=${encodeURIComponent(id)}&cosd=${startDate}`;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (PolestarWorkbench MarketPrices)" },
      });
      if (!res.ok) throw new Error(`FRED ${id} HTTP ${res.status}`);
      const text = await res.text();
      const points = parseFredCsv(text);
      // A 200 with an empty/truncated body parses to zero points. Treat that
      // as a failure (retry, then throw) — returning an empty series here used
      // to count as "success" and let the caller commit a payload with the
      // series silently missing.
      if (!points.length) throw new Error(`FRED ${id}: empty series body`);
      return { id, source, points };
    } catch (err) {
      lastErr = err;
      if (attempt < FETCH_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 400 * attempt));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Parse Yahoo Finance chart JSON into ascending daily close points. */
export function parseYahooChart(symbol: string, text: string): PricePoint[] {
  const json = JSON.parse(text) as {
    chart?: { result?: { timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }[] };
  };
  const result = json.chart?.result?.[0];
  const ts = result?.timestamp;
  const close = result?.indicators?.quote?.[0]?.close;
  if (!ts || !close) throw new Error(`Yahoo ${symbol}: no timestamp/close in payload`);
  const byDate = new Map<string, number>();
  for (let i = 0; i < ts.length; i++) {
    const v = close[i];
    if (v == null || !Number.isFinite(v)) continue;
    const date = new Date(ts[i] * 1000).toISOString().slice(0, 10);
    byDate.set(date, v); // last write wins → keeps the final close for a given day
  }
  return [...byDate.entries()]
    .map(([date, value]) => ({ date, value: Math.round(value * 100) / 100 }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Fetch one Yahoo Finance daily series (front-month future), retrying transient
 * failures. The window is anchored to `startDate` via period1/period2 so the
 * series always reaches back far enough.
 */
export async function fetchYahooSeries(symbol: string, source: string, startDate: string): Promise<Series> {
  const period1 = Math.floor(new Date(`${startDate}T00:00:00Z`).getTime() / 1000);
  const period2 = Math.floor(Date.now() / 1000) + 86400; // +1d so today's close is included
  const url = `${YAHOO_CHART}/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d`;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (PolestarWorkbench MarketPrices)" },
      });
      if (!res.ok) throw new Error(`Yahoo ${symbol} HTTP ${res.status}`);
      const text = await res.text();
      const points = parseYahooChart(symbol, text);
      if (!points.length) throw new Error(`Yahoo ${symbol}: empty series`);
      return { id: symbol, source, points };
    } catch (err) {
      lastErr = err;
      if (attempt < FETCH_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 400 * attempt));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * Crude (Brent/WTI) prefers Yahoo front-month futures (carries the latest market
 * close) and falls back to the FRED EIA spot series if Yahoo is unavailable, so
 * the headline crude price is as fresh as possible but never goes empty. The
 * returned series carries the source actually used, so attribution is truthful.
 */
export async function fetchCrudeSeries(
  yahoo: { symbol: string; source: string },
  fred: { id: string; source: string },
  startDate: string,
  log: (s: string) => void,
): Promise<Series> {
  try {
    const s = await fetchYahooSeries(yahoo.symbol, yahoo.source, startDate);
    const last = s.points.at(-1);
    log(`  ${yahoo.symbol.padEnd(14)} points=${s.points.length} latest=${last ? `${last.date} ${last.value}` : "(none)"} [Yahoo]`);
    return s;
  } catch (yErr) {
    const ymsg = yErr instanceof Error ? yErr.message : String(yErr);
    log(`  ${yahoo.symbol.padEnd(14)} Yahoo failed (${ymsg}) → falling back to FRED ${fred.id}`);
    const s = await fetchFredSeries(fred.id, fred.source, startDate);
    const last = s.points.at(-1);
    log(`  ${fred.id.padEnd(14)} points=${s.points.length} latest=${last ? `${last.date} ${last.value}` : "(none)"} [FRED fallback]`);
    return s;
  }
}

/** Latest observation on or before `onOrBefore` (ISO date). */
export function valueAsOf(series: Series, onOrBefore: string): PricePoint | null {
  let found: PricePoint | null = null;
  for (const p of series.points) {
    if (p.date <= onOrBefore) found = p;
    else break;
  }
  return found;
}

/**
 * Percentage change vs the observation ~`days` before `asOf`, formatted with a
 * caller-supplied suffix (e.g. "7d" for daily series, "MoM" for monthly).
 * Returns null when there is no comparable prior observation.
 */
export function changeOver(
  series: Series,
  asOf: string,
  value: number,
  days: number,
  suffix: string,
): string | null {
  const d = new Date(asOf);
  d.setUTCDate(d.getUTCDate() - days);
  const priorDate = d.toISOString().slice(0, 10);
  const prev = valueAsOf(series, priorDate);
  if (!prev || prev.value === 0) return null;
  const pct = ((value - prev.value) / prev.value) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% ${suffix}`;
}

/** The most recent `count` trajectory points on or before the anchor date. */
export function trajectoryAsOf(series: Series, onOrBefore: string, count: number): PricePoint[] {
  const eligible = series.points.filter((p) => p.date <= onOrBefore);
  return eligible.slice(-count).map((p) => ({ date: p.date, value: p.value }));
}

/**
 * Percentage change vs the immediately preceding observation in the series,
 * formatted with a caller-supplied suffix (e.g. "MoM"). Robust for monthly
 * series regardless of the day-of-month convention (a fixed day-count look-back
 * can straddle two months); for those, comparing to the previous datapoint is
 * the correct month-over-month delta. Returns null when there is no prior point.
 */
export function changeVsPrev(series: Series, onOrBefore: string, suffix: string): string | null {
  const eligible = series.points.filter((p) => p.date <= onOrBefore);
  if (eligible.length < 2) return null;
  const cur = eligible[eligible.length - 1];
  const prev = eligible[eligible.length - 2];
  if (prev.value === 0) return null;
  const pct = ((cur.value - prev.value) / prev.value) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% ${suffix}`;
}

// World Bank "Pink Sheet" monthly commodity prices — the only honest, free,
// global source for urea / DAP / potash spot prices ($/mt). The workbook URL is
// version-stamped and rotates ~monthly (e.g. ...-0050012025/... → ...-0050012026/...),
// so a HARDCODED url goes stale: it keeps returning HTTP 200 but its data stops
// at the vintage's last month, silently freezing the cards months in the past.
// To self-heal, we DISCOVER the current link from the public CMO landing page at
// runtime and try it first, then fall back to the last-known URLs. Whichever
// parses is used and the card always shows the REAL "as of" month, so an older
// file is never misrepresented as current. Monthly cadence is inherent — there
// is no daily fertiliser price feed anywhere.
const WORLD_BANK_CMO_PAGE = "https://www.worldbank.org/en/research/commodity-markets";
const WORLD_BANK_XLSX_FALLBACK_URLS = [
  "https://thedocs.worldbank.org/en/doc/74e8be41ceb20fa0da750cda2f6b9e4e-0050012026/related/CMO-Historical-Data-Monthly.xlsx",
  "https://thedocs.worldbank.org/en/doc/18675f1d1639c7a34d463f59263ba0a2-0050012025/related/CMO-Historical-Data-Monthly.xlsx",
];

/**
 * The version-stamped doc path carries a trailing 4-digit year
 * (…-0050012026/… → 2026). When the landing page happens to list more than one
 * monthly-history link (e.g. the current vintage alongside an archived one), we
 * prefer the highest year so a rotated URL is picked up rather than accidentally
 * pinning to an older vintage that would silently freeze the cards.
 */
function xlsxUrlVintage(url: string): number {
  const m = /-\d{6}(\d{4})\//.exec(url);
  return m ? Number(m[1]) : 0;
}

/**
 * Scrape the World Bank CMO landing page for the CURRENT monthly-history xlsx
 * link. The page always points at the freshest workbook, so this is what keeps
 * the fertiliser cards current after the URL rotates. Returns null on any
 * failure so the caller falls back to the baked-in URLs. The optional `log`
 * makes the discovery outcome observable (discovered vs. fell through to a
 * pinned fallback) so a broken landing-page scrape is visible in ingest logs
 * instead of silently degrading to a stale pinned link.
 */
async function discoverWorldBankXlsxUrl(
  log: (s: string) => void = () => {},
): Promise<string | null> {
  try {
    const res = await fetch(WORLD_BANK_CMO_PAGE, {
      headers: { "User-Agent": "Mozilla/5.0 (PolestarWorkbench MarketPrices)" },
    });
    if (!res.ok) {
      log(`  World Bank discovery: landing page HTTP ${res.status} — using pinned fallback URLs`);
      return null;
    }
    const html = await res.text();
    // Match every monthly-history link on the page (HTML entity ampersands
    // decoded) and prefer the freshest vintage, so a rotated URL is picked up
    // automatically even if the page lists several.
    const matches = [
      ...html.matchAll(
        /https:\/\/thedocs\.worldbank\.org\/[^"'\s)<>]*CMO-Historical-Data-Monthly\.xlsx/gi,
      ),
    ].map((m) => m[0].replace(/&amp;/g, "&"));
    if (!matches.length) {
      log("  World Bank discovery: no monthly-history link on landing page — using pinned fallback URLs");
      return null;
    }
    const best = [...new Set(matches)].sort(
      (a, b) => xlsxUrlVintage(b) - xlsxUrlVintage(a),
    )[0];
    log(`  World Bank discovery: resolved current workbook from landing page (${best})`);
    return best;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`  World Bank discovery: landing-page fetch failed (${msg}) — using pinned fallback URLs`);
    return null;
  }
}

type WbCommodity = "urea" | "dap" | "potash";

const WB_COLUMNS: { commodity: WbCommodity; match: (name: string) => boolean }[] = [
  { commodity: "urea", match: (n) => n === "urea" },
  { commodity: "dap", match: (n) => n === "dap" },
  { commodity: "potash", match: (n) => n.startsWith("potassium chloride") },
];

/** Convert a Pink Sheet month label ("2025M12") to a mid-month ISO date. */
function wbMonthToIso(raw: string): string | null {
  const m = /^(\d{4})M(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  return `${m[1]}-${m[2]}-15`;
}

/**
 * Fetch the World Bank Pink Sheet workbook and return urea/DAP/potash monthly
 * series (filtered to on/after `startDate`). Lazy-imports exceljs so the
 * crude/FRED path never pays for the xlsx parser.
 */
export async function fetchWorldBankFertiliser(
  startDate: string,
  log: (s: string) => void = () => {},
): Promise<Record<string, Series>> {
  const ExcelJS = (await import("exceljs")).default;
  let lastErr: unknown;
  const discovered = await discoverWorldBankXlsxUrl(log);
  const urls = [...new Set([discovered, ...WORLD_BANK_XLSX_FALLBACK_URLS].filter((u): u is string => !!u))];
  for (const url of urls) {
    try {
      // The 770KB+ xlsx download is large and its CDN intermittently resets the
      // connection ("fetch failed"). Retry a few times per URL with backoff so a
      // single transient reset never blanks the whole fertiliser group on a cold
      // start; only after the retries are exhausted do we fall through to the
      // next (stable-fallback) URL.
      let buf: Buffer | null = null;
      let fetchErr: unknown;
      for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
        try {
          const res = await fetch(url, {
            headers: { "User-Agent": "Mozilla/5.0 (PolestarWorkbench MarketPrices)" },
          });
          if (!res.ok) throw new Error(`World Bank HTTP ${res.status}`);
          buf = Buffer.from(await res.arrayBuffer());
          break;
        } catch (err) {
          fetchErr = err;
          if (attempt < FETCH_ATTEMPTS) await new Promise((r) => setTimeout(r, 600 * attempt));
        }
      }
      if (!buf) throw fetchErr instanceof Error ? fetchErr : new Error(String(fetchErr));
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf as never);
      const ws = wb.getWorksheet("Monthly Prices");
      if (!ws) throw new Error("World Bank: no 'Monthly Prices' sheet");

      // Row 5 carries commodity names; row 7+ is data with col 1 = "YYYYMmm".
      const nameRow = ws.getRow(5);
      const colByCommodity = new Map<WbCommodity, number>();
      for (let c = 2; c <= ws.columnCount; c++) {
        const raw = nameRow.getCell(c).value;
        const name = (raw == null ? "" : String(raw)).replace(/\*+$/, "").trim().toLowerCase();
        for (const spec of WB_COLUMNS) {
          if (!colByCommodity.has(spec.commodity) && spec.match(name)) {
            colByCommodity.set(spec.commodity, c);
          }
        }
      }

      const out: Record<string, Series> = {};
      for (const spec of WB_COLUMNS) {
        const col = colByCommodity.get(spec.commodity);
        if (!col) continue;
        const points: PricePoint[] = [];
        for (let r = 7; r <= ws.rowCount; r++) {
          const dateRaw = ws.getRow(r).getCell(1).value;
          const iso = wbMonthToIso(dateRaw == null ? "" : String(dateRaw));
          if (!iso || iso < startDate) continue;
          const cell = ws.getRow(r).getCell(col).value;
          const num = typeof cell === "number" ? cell : Number(cell);
          if (!Number.isFinite(num)) continue;
          points.push({ date: iso, value: num });
        }
        points.sort((a, b) => a.date.localeCompare(b.date));
        if (points.length) {
          out[spec.commodity] = {
            id: spec.commodity,
            source: "World Bank Commodity Markets (Pink Sheet)",
            points,
          };
        }
      }
      if (!Object.keys(out).length) throw new Error("World Bank: no fertiliser columns parsed");
      log(
        url === discovered
          ? "  World Bank workbook served from discovered current URL"
          : "  World Bank workbook served from PINNED FALLBACK URL (discovery did not resolve it) — verify the landing-page scrape",
      );
      return out;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
