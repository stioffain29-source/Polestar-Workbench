import { db, reportsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// Live fuel-market price ingest.
//
// The Fuel Watch report's Brent / WTI / jet-fuel figures used to come from a
// hardcoded sample payload (FUEL_MARKET_DATA_SAMPLE in the workbench), so they
// never changed no matter how often the app was republished. This module
// replaces that with REAL prices pulled from FRED (the source the report
// already cites, "EIA / FRED"), and writes them into each fuel report's
// hard_numbers jsonb so preview, PDF and Fast Facts all read live data.
//
// Headline CRUDE prices (Brent/WTI) come from Yahoo Finance front-month futures,
// because they carry the most recent market CLOSE (e.g. Friday's settle) — the
// FRED EIA spot series lag by several business days, so a FRED-only report shows
// crude prices that are genuinely a week old and miss real intervening moves.
// Yahoo is the primary crude source; FRED is the fallback if Yahoo is down, so
// crude never goes empty.
//   * Brent crude — Yahoo BZ=F  (fallback FRED DCOILBRENTEU), USD/bbl, daily
//   * WTI crude   — Yahoo CL=F  (fallback FRED DCOILWTICO),   USD/bbl, daily
//   * Jet fuel    — FRED DJFUELUSGULF (US Gulf Coast kerosene), USD/gal — kept
//     on its native EIA/FRED series; there is no honest daily jet-fuel future to
//     substitute, so jet legitimately tracks its own (slower) publication date.
//
// FRED's fredgraph.csv and Yahoo's chart endpoint are both public and need no
// API key. The NEWEST fuel report is the live product, so it tracks the LATEST
// available prices (anchored to today). Older/archived reports stay frozen at
// their own issue date so historical issues keep date-appropriate numbers.
// Re-running is idempotent. Like the other ingest modules, this NEVER closes the
// shared DB pool — only the CLI wrapper does.

const FRED_CSV = "https://fred.stlouisfed.org/graph/fredgraph.csv";
const YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart";

type Series = {
  id: string;
  /** Human-readable provenance shown on the price card (must match the data actually used). */
  source: string;
  /** Ascending by date, missing values dropped. */
  points: { date: string; value: number }[];
};

export type MarketPriceSummary = {
  topic: "fuel_prices";
  mode: "commit" | "dry-run";
  seriesFetched: number;
  seriesErrors: { id: string; error: string }[];
  reportsConsidered: number;
  reportsUpdated: number;
  /** Headline values from the most recent fuel report, for quick reporting. */
  latest: { brent: number | null; wti: number | null; jet: number | null; asOf: string | null };
  logLines: string[];
};

function parseFredCsv(id: string, text: string): { date: string; value: number }[] {
  const lines = text.trim().split(/\r?\n/);
  const points: { date: string; value: number }[] = [];
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

const FETCH_ATTEMPTS = 3;

/**
 * Fetch one FRED series, retrying transient failures. FRED's public
 * fredgraph.csv endpoint is intermittently flaky (HTTP/2 stream resets, brief
 * 5xx/429), and in a deployment a SINGLE swallowed failure here used to leave a
 * report permanently un-priced (the freshness gate then skipped every retry).
 * Retrying with backoff makes the common transient case self-heal within one
 * run; a hard failure still throws so the caller records it and a later cold
 * start re-attempts.
 */
async function fetchSeries(id: string, source: string, startDate: string): Promise<Series> {
  const url = `${FRED_CSV}?id=${encodeURIComponent(id)}&cosd=${startDate}`;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (PolestarWorkbench MarketPrices)" },
      });
      if (!res.ok) throw new Error(`FRED ${id} HTTP ${res.status}`);
      const text = await res.text();
      return { id, source, points: parseFredCsv(id, text) };
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
function parseYahooChart(symbol: string, text: string): { date: string; value: number }[] {
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
 * failures. The window is anchored to `startDate` via period1/period2 (NOT a
 * hardcoded `range=1y`) so the series always reaches back far enough to price the
 * OLDEST fuel report — a fixed 1-year range silently truncated history and would
 * blank crude on any report older than a year.
 */
async function fetchYahooSeries(symbol: string, source: string, startDate: string): Promise<Series> {
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
 * returned series carries the source actually used, so the card attribution is
 * always truthful.
 */
async function fetchCrudeSeries(
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
    const s = await fetchSeries(fred.id, fred.source, startDate);
    const last = s.points.at(-1);
    log(`  ${fred.id.padEnd(14)} points=${s.points.length} latest=${last ? `${last.date} ${last.value}` : "(none)"} [FRED fallback]`);
    return s;
  }
}

/** Latest observation on or before `onOrBefore` (ISO date). */
function valueAsOf(series: Series, onOrBefore: string): { date: string; value: number } | null {
  let found: { date: string; value: number } | null = null;
  for (const p of series.points) {
    if (p.date <= onOrBefore) found = p;
    else break;
  }
  return found;
}

/** Observation nearest to `target` days back (latest on or before target). */
function changePct(series: Series, asOf: string, value: number): string | null {
  const d = new Date(asOf);
  d.setUTCDate(d.getUTCDate() - 7);
  const weekAgoDate = d.toISOString().slice(0, 10);
  const prev = valueAsOf(series, weekAgoDate);
  if (!prev || prev.value === 0) return null;
  const pct = ((value - prev.value) / prev.value) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% 7d`;
}

/** The most recent weekly trajectory points on or before the anchor date. */
function trajectoryAsOf(series: Series, onOrBefore: string, count: number): { date: string; value: number }[] {
  const eligible = series.points.filter((p) => p.date <= onOrBefore);
  return eligible.slice(-count).map((p) => ({ date: p.date, value: p.value }));
}

function buildHardNumbers(
  anchorDate: string,
  brent: Series,
  wti: Series,
  jet: Series,
): { hardNumbers: Record<string, unknown>; brent: number | null; wti: number | null; jet: number | null; asOf: string | null } | null {
  const b = valueAsOf(brent, anchorDate);
  const w = valueAsOf(wti, anchorDate);
  const j = valueAsOf(jet, anchorDate);
  if (!b && !w && !j) return null;

  const prices: Record<string, unknown>[] = [];
  let asOf: string | null = null;
  if (b) {
    const change = changePct(brent, b.date, b.value);
    prices.push({ label: "Brent crude", value: b.value, unit: "USD/bbl", ...(change ? { change } : {}), asOf: b.date, source: brent.source });
    asOf = b.date;
  }
  if (w) {
    const change = changePct(wti, w.date, w.value);
    prices.push({ label: "WTI crude", value: w.value, unit: "USD/bbl", ...(change ? { change } : {}), asOf: w.date, source: wti.source });
    if (!asOf || w.date > asOf) asOf = w.date;
  }
  if (j) {
    const change = changePct(jet, j.date, j.value);
    prices.push({ label: "Jet fuel", benchmark: "US Gulf Coast kerosene-type", value: j.value, unit: "USD/gal", ...(change ? { change } : {}), asOf: j.date, source: jet.source });
    if (!asOf || j.date > asOf) asOf = j.date;
  }

  const trajPoints = trajectoryAsOf(jet, anchorDate, 6);
  const hardNumbers: Record<string, unknown> = {
    fastFacts: { prices },
  };
  if (trajPoints.length >= 2) {
    hardNumbers["jetFuelTrajectory"] = {
      benchmark: "US Gulf Coast kerosene-type jet fuel",
      source: "EIA / FRED",
      unit: "USD/gal",
      period: "last 30 days",
      points: trajPoints,
    };
  }

  return {
    hardNumbers,
    brent: b?.value ?? null,
    wti: w?.value ?? null,
    jet: j?.value ?? null,
    asOf,
  };
}

/**
 * Fetch live Brent/WTI/jet-fuel prices from FRED and write them into every
 * fuel report's hard_numbers. Returns a structured summary. Does NOT close the
 * shared DB pool.
 */
export async function runMarketPricesIngest(opts: { commit?: boolean } = {}): Promise<MarketPriceSummary> {
  const commit = opts.commit ?? false;
  const logLines: string[] = [];
  const log = (s: string) => logLines.push(s);
  log(`Market price ingest (Yahoo crude + FRED jet) — mode=${commit ? "COMMIT" : "DRY-RUN"}`);

  // Load the fuel reports first so the fetch horizon can reach back far enough
  // to rehydrate the OLDEST report, not just recent ones. A fixed 70-day window
  // silently skipped any report older than that, leaving it on stale/fabricated
  // hard_numbers. We anchor the FRED start date to the oldest issue date minus a
  // 70-day buffer (covers the prior-week change line + the 6-point weekly jet
  // trajectory, with margin for FRED reporting gaps).
  const fuelReports = await db
    .select({ id: reportsTable.id, issueDate: reportsTable.issueDate })
    .from(reportsTable)
    .where(eq(reportsTable.topic, "fuel"));

  const today = new Date().toISOString().slice(0, 10);
  const oldestIssue = fuelReports.reduce(
    (min, r) => (r.issueDate && r.issueDate < min ? r.issueDate : min),
    today,
  );
  const start = new Date(oldestIssue);
  start.setUTCDate(start.getUTCDate() - 70);
  const startDate = start.toISOString().slice(0, 10);
  log(`  fetch horizon: from ${startDate} (oldest fuel issue ${oldestIssue} − 70d buffer)`);

  const seriesErrors: { id: string; error: string }[] = [];
  let seriesFetched = 0;
  const safe = async (id: string, fn: () => Promise<Series>, empty: Series): Promise<Series> => {
    try {
      const s = await fn();
      seriesFetched++;
      return s;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      seriesErrors.push({ id, error: msg });
      log(`  ${id.padEnd(14)} ERROR: ${msg}`);
      return empty;
    }
  };

  // Crude prefers Yahoo (latest market close), falls back to FRED. Jet stays on
  // its native FRED Gulf Coast series. All run in parallel.
  const [brent, wti, jet] = await Promise.all([
    safe(
      "BZ=F",
      () =>
        fetchCrudeSeries(
          { symbol: "BZ=F", source: "ICE Brent front-month (Yahoo Finance)" },
          { id: "DCOILBRENTEU", source: "FRED (DCOILBRENTEU)" },
          startDate,
          log,
        ),
      { id: "BZ=F", source: "ICE Brent front-month (Yahoo Finance)", points: [] },
    ),
    safe(
      "CL=F",
      () =>
        fetchCrudeSeries(
          { symbol: "CL=F", source: "NYMEX WTI front-month (Yahoo Finance)" },
          { id: "DCOILWTICO", source: "FRED (DCOILWTICO)" },
          startDate,
          log,
        ),
      { id: "CL=F", source: "NYMEX WTI front-month (Yahoo Finance)", points: [] },
    ),
    safe(
      "DJFUELUSGULF",
      async () => {
        const s = await fetchSeries("DJFUELUSGULF", "EIA / FRED (DJFUELUSGULF)", startDate);
        const last = s.points.at(-1);
        log(`  ${"DJFUELUSGULF".padEnd(14)} points=${s.points.length} latest=${last ? `${last.date} ${last.value}` : "(none)"} [FRED]`);
        return s;
      },
      { id: "DJFUELUSGULF", source: "EIA / FRED (DJFUELUSGULF)", points: [] },
    ),
  ]);

  // Partial-overwrite guard: a crude series with no points means BOTH Yahoo and
  // its FRED fallback failed for that benchmark. Committing anyway would write a
  // payload missing Brent/WTI and CLOBBER previously-valid crude on disk with a
  // blank — the exact "crude went empty" failure this change exists to prevent.
  // So when crude is degraded we DRY-RUN only (compute + log, never write); the
  // existing good data is preserved and the next cold start retries the fetch.
  const crudeDegraded = brent.points.length === 0 || wti.points.length === 0;
  const writesEnabled = commit && !crudeDegraded;
  if (commit && crudeDegraded) {
    log(
      `  CRUDE DEGRADED (Brent points=${brent.points.length}, WTI points=${wti.points.length}) — both Yahoo and FRED failed for a crude benchmark; SKIPPING all writes to avoid clobbering valid prices with a blank.`,
    );
  }

  log(`\n=== Fuel reports: ${fuelReports.length} ===`);

  let reportsUpdated = 0;
  let latest: MarketPriceSummary["latest"] = { brent: null, wti: null, jet: null, asOf: null };
  let latestIssue = "";

  // Sort newest issue date first so `latest` reflects the most recent report.
  const sorted = [...fuelReports].sort((a, b) => (b.issueDate ?? "").localeCompare(a.issueDate ?? ""));
  // The current report(s) are the live product → anchor them to today (latest
  // FRED observation). "Current" = every report sharing the MAX issue date that
  // is ON OR BEFORE today. Excluding future dates is deliberate: a future-dated
  // draft (e.g. next week's report being prepared) must NOT steal the "current"
  // designation from the live published report and freeze it on stale prices.
  // Ties resolve deterministically, and prod has exactly one fuel report so it
  // is always the live one. Older issues stay frozen at their own issue date.
  const maxIssue = sorted.reduce(
    (m, r) => (r.issueDate && r.issueDate <= today && r.issueDate > m ? r.issueDate : m),
    "",
  );

  for (const r of sorted) {
    const issueDate = r.issueDate ?? today;
    const isCurrent = !!r.issueDate && r.issueDate === maxIssue;
    // Current tracks live: anchor to today. Non-current reports (older archives,
    // or future-dated drafts) stay frozen at their own issue date.
    const anchorDate = isCurrent ? today : issueDate;
    const built = buildHardNumbers(anchorDate, brent, wti, jet);
    if (!built) {
      log(`  report ${r.id} (issue ${issueDate}, anchor ${anchorDate}): no price data on or before anchor — skipped`);
      continue;
    }
    if (r.issueDate && r.issueDate > latestIssue) {
      latestIssue = r.issueDate;
      latest = { brent: built.brent, wti: built.wti, jet: built.jet, asOf: built.asOf };
    }
    log(
      `  report ${r.id} (${issueDate}): Brent ${built.brent ?? "—"} · WTI ${built.wti ?? "—"} · Jet ${built.jet ?? "—"} (asOf ${built.asOf ?? "—"})`,
    );
    if (writesEnabled) {
      await db
        .update(reportsTable)
        .set({ hardNumbers: built.hardNumbers as never })
        .where(eq(reportsTable.id, r.id));
      reportsUpdated++;
    }
  }

  if (writesEnabled) {
    log(`\nUpdated ${reportsUpdated} fuel report(s) with live market prices.`);
  } else if (commit && crudeDegraded) {
    log(`\nNO ROWS WRITTEN — crude degraded; existing prices preserved. Next run will retry.`);
  } else {
    log(`\nDRY-RUN — no rows written. Re-run with --commit to write live prices.`);
  }

  return {
    topic: "fuel_prices",
    mode: commit ? "commit" : "dry-run",
    seriesFetched,
    seriesErrors,
    reportsConsidered: fuelReports.length,
    reportsUpdated,
    latest,
    logLines,
  };
}
