import { db, reportsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { recordSourceHealth } from "./sourceHealth";
import {
  fetchCrudeSeries,
  fetchFredSeries,
  valueAsOf,
  changeOver,
  trajectoryAsOf,
  type Series,
} from "./priceSeries";

// Thin alias so the report-pricing call sites below read unchanged. Crude and
// jet use the report's 7-day change convention; the shared fetchers/parsers now
// live in priceSeries.ts (reused by the live market-snapshot ingest).
const changePct = (series: Series, asOf: string, value: number): string | null =>
  changeOver(series, asOf, value, 7, "7d");

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
//   * Jet fuel    — FRED DJFUELUSGULF (U.S. Gulf Coast kerosene-type jet fuel,
//     EIA), USD/gal, itself a DAILY series (not the weekly WJFUELUSGULF
//     variant). This is the REAL jet-fuel price, not a proxy. EIA's own
//     publication of it still trails the daily Brent/WTI close by a few
//     business days — that lag is inherent to the only honest free jet-fuel
//     feed and is surfaced via jetDataNote, never papered over with a daily
//     distillate stand-in.
//
// FRED's fredgraph.csv and Yahoo's chart endpoint are both public and need no
// API key. Every fuel report is priced AS OF THE END OF ITS REPORTING WINDOW
// (its issue date, clamped down to the latest available fuel record) rather than
// "live today", so the Brent/WTI/jet "as of" dates and the jet trajectory always
// fall inside the period the report covers — a Fuel Watch issue must read as an
// AS-OF report, not a live ticker. Re-running is idempotent. Like the other
// ingest modules, this NEVER closes the shared DB pool — only the CLI wrapper does.


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
    prices.push({ label: "Jet fuel", benchmark: "U.S. Gulf Coast kerosene-type jet fuel", value: j.value, unit: "USD/gal", ...(change ? { change } : {}), asOf: j.date, source: jet.source });
    if (!asOf || j.date > asOf) asOf = j.date;
  }

  const trajPoints = trajectoryAsOf(jet, anchorDate, 6);
  const hardNumbers: Record<string, unknown> = {
    fastFacts: { prices },
  };
  if (trajPoints.length >= 2) {
    hardNumbers["jetFuelTrajectory"] = {
      benchmark: "U.S. Gulf Coast kerosene-type jet fuel",
      source: jet.source,
      unit: "USD/gal",
      period: "recent weeks",
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

  // Crude (Brent/WTI) prefers Yahoo (latest market close) and falls back to
  // FRED. Jet uses the REAL EIA U.S. Gulf Coast jet-fuel series (FRED
  // DJFUELUSGULF) directly — a daily series whose EIA publication still lags
  // the daily crude close by a few days, but it is the genuine jet price, not
  // a daily distillate proxy. All run in parallel.
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
      () => fetchFredSeries("DJFUELUSGULF", "EIA / FRED (DJFUELUSGULF)", startDate),
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
  // Same guard for jet: the whole hardNumbers payload is REPLACED per run, so
  // committing with jet.points=[] silently DROPS the jet card (and its
  // trajectory) until the next successful fetch. With the hourly price tick a
  // skipped run retries within the hour, so preserving the last good payload
  // beats writing a payload with the jet series missing.
  const jetDegraded = jet.points.length === 0;
  const writesEnabled = commit && !crudeDegraded && !jetDegraded;
  if (commit && crudeDegraded) {
    log(
      `  CRUDE DEGRADED (Brent points=${brent.points.length}, WTI points=${wti.points.length}) — both Yahoo and FRED failed for a crude benchmark; SKIPPING all writes to avoid clobbering valid prices with a blank.`,
    );
  }
  if (commit && !crudeDegraded && jetDegraded) {
    log(
      `  JET DEGRADED (jet points=0) — FRED DJFUELUSGULF failed; SKIPPING all writes to avoid dropping the jet card from otherwise-valid payloads. Next run retries.`,
    );
  }

  log(`\n=== Fuel reports: ${fuelReports.length} ===`);

  let reportsUpdated = 0;
  let latest: MarketPriceSummary["latest"] = { brent: null, wti: null, jet: null, asOf: null };
  let latestIssue = "";

  // Sort newest issue date first so `latest` reflects the most recent report.
  // Tie-break on id (serial, so highest = most recently created) to keep the
  // "live report" selection deterministic when several share an issue date.
  const sorted = [...fuelReports].sort((a, b) => {
    const byDate = (b.issueDate ?? "").localeCompare(a.issueDate ?? "");
    return byDate !== 0 ? byDate : Number(b.id) - Number(a.id);
  });

  // The MOST RECENT fuel report is the LIVE tracker — it must always show the
  // latest market close, never freeze behind a stale issue date. Crude wins the
  // period end (it publishes daily; jet/FRED lags and is labelled, not clamped),
  // so the live anchor = the latest available CRUDE close date. Older reports
  // stay anchored to their own issue date as historical as-of snapshots.
  const newestId = sorted[0]?.id;
  const crudeDates = [...brent.points, ...wti.points].map((p) => p.date);
  const latestCrudeClose = crudeDates.length
    ? crudeDates.reduce((a, b) => (a > b ? a : b))
    : null;

  for (const r of sorted) {
    const issueDate = r.issueDate ?? today;
    // The live (newest) report rolls FORWARD to the latest crude close so its
    // prices track the current market; it never rolls backward (a future-dated
    // report keeps its issue date and valueAsOf still returns the latest close).
    // Older reports anchor to their issue date. valueAsOf() returns the latest
    // close on/before the anchor (FRED/Yahoo lag may put it a day or two
    // earlier), and the workbench reads these same dates back out of
    // hardNumbers to drive the cover/period, the Fast Facts and the jet chart,
    // so cover, prices, market-read prose and the jet chart can never disagree.
    const isLive = r.id === newestId;
    const anchorDate =
      isLive && latestCrudeClose && latestCrudeClose > issueDate
        ? latestCrudeClose
        : issueDate;
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
  } else if (commit && (crudeDegraded || jetDegraded)) {
    log(`\nNO ROWS WRITTEN — ${crudeDegraded ? "crude" : "jet"} degraded; existing prices preserved. Next run will retry.`);
  } else {
    log(`\nDRY-RUN — no rows written. Re-run with --commit to write live prices.`);
  }

  // Record honest price-feed health onto the fuel topic. These rows REPLACE the
  // old fabricated "Reuters Energy Wire" / "S&P Global Platts" placeholders —
  // the report's prices genuinely come from these public market series.
  if (commit) {
    await recordSourceHealth(
      "fuel",
      [
        {
          name: "ICE Brent front-month (Yahoo Finance / FRED)",
          url: "https://finance.yahoo.com/quote/BZ=F",
          ok: brent.points.length > 0,
          error: brent.points.length > 0 ? null : "no price points returned (Yahoo + FRED both failed)",
        },
        {
          name: "NYMEX WTI front-month (Yahoo Finance / FRED)",
          url: "https://finance.yahoo.com/quote/CL=F",
          ok: wti.points.length > 0,
          error: wti.points.length > 0 ? null : "no price points returned (Yahoo + FRED both failed)",
        },
        {
          name: "EIA U.S. Gulf Coast jet fuel (FRED DJFUELUSGULF)",
          url: "https://fred.stlouisfed.org/series/DJFUELUSGULF",
          ok: jet.points.length > 0,
          error: jet.points.length > 0 ? null : "no price points returned (FRED DJFUELUSGULF failed)",
        },
      ],
      { sourceType: "api", reliability: 4, notes: "Live market price series — auto-monitored each price ingest run." },
    );
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
