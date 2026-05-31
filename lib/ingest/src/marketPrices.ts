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
// FRED's fredgraph.csv endpoint is public and needs no API key. Series:
//   * Brent crude  — DCOILBRENTEU (USD/bbl, daily)
//   * WTI crude    — DCOILWTICO   (USD/bbl, daily)
//   * Jet fuel     — DJFUELUSGULF (USD/gal, weekly, US Gulf Coast kerosene)
//
// Each fuel report is anchored to its own issue date: we use the latest
// observation on or before the issue date, so a report keeps date-appropriate
// numbers and re-running is idempotent. Like the other ingest modules, this
// NEVER closes the shared DB pool — only the CLI wrapper does.

const FRED_CSV = "https://fred.stlouisfed.org/graph/fredgraph.csv";

type Series = {
  id: string;
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
async function fetchSeries(id: string, startDate: string): Promise<Series> {
  const url = `${FRED_CSV}?id=${encodeURIComponent(id)}&cosd=${startDate}`;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (PolestarWorkbench MarketPrices)" },
      });
      if (!res.ok) throw new Error(`FRED ${id} HTTP ${res.status}`);
      const text = await res.text();
      return { id, points: parseFredCsv(id, text) };
    } catch (err) {
      lastErr = err;
      if (attempt < FETCH_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 400 * attempt));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
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

/** The most recent weekly trajectory points on or before the issue date. */
function trajectoryAsOf(series: Series, onOrBefore: string, count: number): { date: string; value: number }[] {
  const eligible = series.points.filter((p) => p.date <= onOrBefore);
  return eligible.slice(-count).map((p) => ({ date: p.date, value: p.value }));
}

function buildHardNumbers(
  issueDate: string,
  brent: Series,
  wti: Series,
  jet: Series,
): { hardNumbers: Record<string, unknown>; brent: number | null; wti: number | null; jet: number | null; asOf: string | null } | null {
  const b = valueAsOf(brent, issueDate);
  const w = valueAsOf(wti, issueDate);
  const j = valueAsOf(jet, issueDate);
  if (!b && !w && !j) return null;

  const prices: Record<string, unknown>[] = [];
  let asOf: string | null = null;
  if (b) {
    const change = changePct(brent, b.date, b.value);
    prices.push({ label: "Brent crude", value: b.value, unit: "USD/bbl", ...(change ? { change } : {}), asOf: b.date, source: "FRED (DCOILBRENTEU)" });
    asOf = b.date;
  }
  if (w) {
    const change = changePct(wti, w.date, w.value);
    prices.push({ label: "WTI crude", value: w.value, unit: "USD/bbl", ...(change ? { change } : {}), asOf: w.date, source: "FRED (DCOILWTICO)" });
    if (!asOf || w.date > asOf) asOf = w.date;
  }
  if (j) {
    const change = changePct(jet, j.date, j.value);
    prices.push({ label: "Jet fuel", benchmark: "US Gulf Coast kerosene-type", value: j.value, unit: "USD/gal", ...(change ? { change } : {}), asOf: j.date, source: "EIA / FRED (DJFUELUSGULF)" });
    if (!asOf || j.date > asOf) asOf = j.date;
  }

  const trajPoints = trajectoryAsOf(jet, issueDate, 6);
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
  log(`Market price ingest (FRED) — mode=${commit ? "COMMIT" : "DRY-RUN"}`);

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

  const seriesIds = ["DCOILBRENTEU", "DCOILWTICO", "DJFUELUSGULF"];
  const fetched: Record<string, Series> = {};
  const seriesErrors: { id: string; error: string }[] = [];
  await Promise.all(
    seriesIds.map(async (id) => {
      try {
        fetched[id] = await fetchSeries(id, startDate);
        const last = fetched[id].points.at(-1);
        log(`  ${id.padEnd(14)} points=${fetched[id].points.length} latest=${last ? `${last.date} ${last.value}` : "(none)"}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        seriesErrors.push({ id, error: msg });
        log(`  ${id.padEnd(14)} ERROR: ${msg}`);
      }
    }),
  );

  const brent = fetched["DCOILBRENTEU"] ?? { id: "DCOILBRENTEU", points: [] };
  const wti = fetched["DCOILWTICO"] ?? { id: "DCOILWTICO", points: [] };
  const jet = fetched["DJFUELUSGULF"] ?? { id: "DJFUELUSGULF", points: [] };

  log(`\n=== Fuel reports: ${fuelReports.length} ===`);

  let reportsUpdated = 0;
  let latest: MarketPriceSummary["latest"] = { brent: null, wti: null, jet: null, asOf: null };
  let latestIssue = "";

  // Sort newest issue date first so `latest` reflects the most recent report.
  const sorted = [...fuelReports].sort((a, b) => (b.issueDate ?? "").localeCompare(a.issueDate ?? ""));

  for (const r of sorted) {
    const issueDate = r.issueDate ?? new Date().toISOString().slice(0, 10);
    const built = buildHardNumbers(issueDate, brent, wti, jet);
    if (!built) {
      log(`  report ${r.id} (${issueDate}): no price data on or before issue date — skipped`);
      continue;
    }
    if (r.issueDate && r.issueDate > latestIssue) {
      latestIssue = r.issueDate;
      latest = { brent: built.brent, wti: built.wti, jet: built.jet, asOf: built.asOf };
    }
    log(
      `  report ${r.id} (${issueDate}): Brent ${built.brent ?? "—"} · WTI ${built.wti ?? "—"} · Jet ${built.jet ?? "—"} (asOf ${built.asOf ?? "—"})`,
    );
    if (commit) {
      await db
        .update(reportsTable)
        .set({ hardNumbers: built.hardNumbers as never })
        .where(eq(reportsTable.id, r.id));
      reportsUpdated++;
    }
  }

  if (!commit) {
    log(`\nDRY-RUN — no rows written. Re-run with --commit to write live prices.`);
  } else {
    log(`\nUpdated ${reportsUpdated} fuel report(s) with live FRED prices.`);
  }

  return {
    topic: "fuel_prices",
    mode: commit ? "commit" : "dry-run",
    seriesFetched: Object.keys(fetched).length,
    seriesErrors,
    reportsConsidered: fuelReports.length,
    reportsUpdated,
    latest,
    logLines,
  };
}
