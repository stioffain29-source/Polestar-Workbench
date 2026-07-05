import { db, marketPricesTable, type InsertMarketPrice } from "@workspace/db";
import {
  fetchFredSeries,
  fetchCrudeSeries,
  fetchWorldBankFertiliser,
  valueAsOf,
  changeOver,
  changeVsPrev,
  trajectoryAsOf,
  type Series,
} from "./priceSeries";
import { recordSourceHealth, type FeedHealth } from "./sourceHealth";

// Live commodity-price SNAPSHOT ingest.
//
// Computes the latest close for every instrument shown on the Fuel / Energy /
// Fertiliser monitors and upserts one row per (group, key) into market_prices.
// Anchored to the LATEST AVAILABLE observation (not a report window) — this is
// a live ticker, unlike the per-report fuel hard_numbers in marketPrices.ts.
//
// Every series is fetched in its own try: a single feed outage (or a monthly
// series that hasn't refreshed) can never fail the others, and a failed series
// leaves its prior row untouched rather than zeroing the monitor. Nothing here
// closes the shared DB pool.

export type MarketSnapshotSummary = {
  mode: "commit" | "dry-run";
  upserted: number;
  considered: number;
  errors: { key: string; error: string }[];
  rows: { group: string; key: string; value: number; asOf: string; change: string | null }[];
  logLines: string[];
};

type CrudeSpec = {
  kind: "crude";
  yahoo: { symbol: string; source: string };
  fred: { id: string; source: string };
};
type FredSpec = { kind: "fred"; id: string; source: string };
type WorldBankSpec = { kind: "worldbank"; commodity: "urea" | "dap" | "potash" };

type Spec = {
  group: string;
  key: string;
  label: string;
  unit: string;
  benchmark?: string;
  changeMode: "7d" | "prev";
  trajCount: number;
  decimals: number;
  fetch: CrudeSpec | FredSpec | WorldBankSpec;
  /**
   * Cadence-aware staleness threshold (days). Set ONLY on the monthly series
   * whose upstream can return HTTP 200 while its data silently stops advancing.
   * When the latest observation lags more than this, the feed is escalated to
   * the "stale" Source Health status. Left unset on the daily/weekly series
   * (fuel + Henry Hub), which lag only a few days and have no monthly cadence.
   */
  staleLagDays?: number;
};

// Look-back window for every series. Generous so the monthly series (with a
// six-point trajectory + one-month change) always reaches back far enough.
const LOOKBACK_DAYS = 540;

// Cadence-aware staleness escalation for the MONTHLY market series. These feeds
// can return HTTP 200 while their data silently stops advancing (e.g. a
// version-stamped workbook URL that rotated, or an upstream that froze). A
// fetch-failure signal never fires, so the only tell is the data not advancing.
// Each monthly group gets a threshold tuned to ITS normal lag: beyond it the
// feed has failed to advance for well over a full extra publication cycle, so we
// escalate to the "stale" Source Health status (a visible signal) instead of a
// buried WARN log line. The daily/weekly series (fuel + Henry Hub) lag only a
// few days and are out of scope — they carry no `staleLagDays`.
//
// Fertiliser (World Bank Pink Sheet): a monthly observation normally lags up to
// ~50 days (the workbook for month M publishes ~5-6 weeks into month M+1), so 75
// = a full extra missed cycle. UNCHANGED.
const FERTILISER_STALE_LAG_DAYS = 75;
// Monthly energy (IMF/BLS FRED series eu_gas/coal/electricity): these publish
// later than the Pink Sheet and routinely lag ~60-62 days, so the threshold sits
// above that normal cadence — today's normally-lagging data stays green, while a
// freeze that misses a further full monthly cycle (~90+ days) escalates.
const ENERGY_STALE_LAG_DAYS = 90;

const SPECS: Spec[] = [
  // --- Fuel -----------------------------------------------------------------
  {
    group: "fuel", key: "brent", label: "Brent Crude", unit: "USD/bbl",
    benchmark: "ICE Brent front-month", changeMode: "7d", trajCount: 16, decimals: 2,
    fetch: {
      kind: "crude",
      yahoo: { symbol: "BZ=F", source: "ICE Brent front-month (Yahoo Finance)" },
      fred: { id: "DCOILBRENTEU", source: "EIA / FRED (DCOILBRENTEU)" },
    },
  },
  {
    group: "fuel", key: "wti", label: "WTI Crude", unit: "USD/bbl",
    benchmark: "NYMEX WTI front-month", changeMode: "7d", trajCount: 16, decimals: 2,
    fetch: {
      kind: "crude",
      yahoo: { symbol: "CL=F", source: "NYMEX WTI front-month (Yahoo Finance)" },
      fred: { id: "DCOILWTICO", source: "EIA / FRED (DCOILWTICO)" },
    },
  },
  {
    // Jet fuel: the REAL EIA U.S. Gulf Coast kerosene-type jet-fuel series
    // (FRED DJFUELUSGULF), USD/gal. Publishes weekly, so it lags the daily
    // crude close by a few days — it is the genuine jet price, not a proxy.
    group: "fuel", key: "jet", label: "Jet Fuel", unit: "USD/gal",
    benchmark: "U.S. Gulf Coast kerosene-type jet fuel", changeMode: "7d", trajCount: 16, decimals: 2,
    fetch: {
      kind: "fred",
      id: "DJFUELUSGULF", source: "EIA / FRED (DJFUELUSGULF)",
    },
  },
  // --- Energy ---------------------------------------------------------------
  {
    group: "energy", key: "henry_hub", label: "Natural Gas (Henry Hub)", unit: "USD/MMBtu",
    benchmark: "Henry Hub natural gas spot", changeMode: "7d", trajCount: 16, decimals: 2,
    fetch: { kind: "fred", id: "DHHNGSP", source: "EIA / FRED (DHHNGSP)" },
  },
  {
    group: "energy", key: "eu_gas", label: "Natural Gas (Europe)", unit: "USD/MMBtu",
    benchmark: "EU import natural gas", changeMode: "prev", trajCount: 6, decimals: 2,
    staleLagDays: ENERGY_STALE_LAG_DAYS,
    fetch: { kind: "fred", id: "PNGASEUUSDM", source: "IMF / FRED (PNGASEUUSDM)" },
  },
  {
    group: "energy", key: "coal", label: "Thermal Coal (Australia)", unit: "USD/mt",
    benchmark: "Australian thermal coal", changeMode: "prev", trajCount: 6, decimals: 2,
    staleLagDays: ENERGY_STALE_LAG_DAYS,
    fetch: { kind: "fred", id: "PCOALAUUSDM", source: "IMF / FRED (PCOALAUUSDM)" },
  },
  {
    group: "energy", key: "electricity", label: "Electricity (US City Avg)", unit: "USD/kWh",
    benchmark: "US city average retail electricity", changeMode: "prev", trajCount: 6, decimals: 3,
    staleLagDays: ENERGY_STALE_LAG_DAYS,
    fetch: { kind: "fred", id: "APU000072610", source: "BLS / FRED (APU000072610)" },
  },
  // --- Fertiliser (World Bank Pink Sheet, monthly) --------------------------
  {
    group: "fertiliser", key: "urea", label: "Urea", unit: "USD/mt",
    benchmark: "Urea (Black Sea / fob)", changeMode: "prev", trajCount: 6, decimals: 1,
    staleLagDays: FERTILISER_STALE_LAG_DAYS,
    fetch: { kind: "worldbank", commodity: "urea" },
  },
  {
    group: "fertiliser", key: "dap", label: "DAP", unit: "USD/mt",
    benchmark: "Diammonium phosphate", changeMode: "prev", trajCount: 6, decimals: 1,
    staleLagDays: FERTILISER_STALE_LAG_DAYS,
    fetch: { kind: "worldbank", commodity: "dap" },
  },
  {
    group: "fertiliser", key: "potash", label: "Potash", unit: "USD/mt",
    benchmark: "Potassium chloride (muriate of potash)", changeMode: "prev", trajCount: 6, decimals: 1,
    staleLagDays: FERTILISER_STALE_LAG_DAYS,
    fetch: { kind: "worldbank", commodity: "potash" },
  },
];

function startDate(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - LOOKBACK_DAYS);
  return d.toISOString().slice(0, 10);
}

function round(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

/**
 * Fetch the latest commodity snapshots and upsert them into market_prices.
 * World Bank fertiliser series share one xlsx download (fetched once, cached
 * across the three fertiliser specs).
 */
export async function runMarketSnapshotIngest(
  opts: { commit?: boolean } = {},
): Promise<MarketSnapshotSummary> {
  const commit = opts.commit ?? false;
  const cosd = startDate();
  const anchor = new Date().toISOString().slice(0, 10);
  const logLines: string[] = [];
  const log = (s: string) => logLines.push(s);
  const errors: { key: string; error: string }[] = [];
  const rows: MarketSnapshotSummary["rows"] = [];
  const healthByGroup = new Map<string, FeedHealth[]>();
  const addHealth = (group: string, h: FeedHealth) => {
    const arr = healthByGroup.get(group) ?? [];
    arr.push(h);
    healthByGroup.set(group, arr);
  };

  log(`market snapshot ingest (${commit ? "commit" : "dry-run"}) anchor=${anchor} cosd=${cosd}`);

  // World Bank Pink Sheet is one workbook covering all fertilisers — fetch once.
  let worldBank: Record<string, Series> | null = null;
  let worldBankErr: string | null = null;
  if (SPECS.some((s) => s.fetch.kind === "worldbank")) {
    try {
      worldBank = await fetchWorldBankFertiliser(cosd, log);
      log(`  World Bank Pink Sheet fetched (${Object.keys(worldBank).join(", ")})`);
    } catch (err) {
      worldBankErr = err instanceof Error ? err.message : String(err);
      log(`  World Bank Pink Sheet failed: ${worldBankErr}`);
    }
  }

  let upserted = 0;
  for (const spec of SPECS) {
    try {
      let series: Series;
      if (spec.fetch.kind === "crude") {
        series = await fetchCrudeSeries(spec.fetch.yahoo, spec.fetch.fred, cosd, log);
      } else if (spec.fetch.kind === "fred") {
        series = await fetchFredSeries(spec.fetch.id, spec.fetch.source, cosd);
        const last = series.points.at(-1);
        log(`  ${spec.fetch.id.padEnd(14)} points=${series.points.length} latest=${last ? `${last.date} ${last.value}` : "(none)"}`);
      } else {
        if (!worldBank) throw new Error(worldBankErr ?? "World Bank workbook unavailable");
        const s = worldBank[spec.fetch.commodity];
        if (!s) throw new Error(`World Bank: no ${spec.fetch.commodity} column`);
        series = s;
        const last = series.points.at(-1);
        log(`  ${spec.fetch.commodity.padEnd(14)} points=${series.points.length} latest=${last ? `${last.date} ${last.value}` : "(none)"}`);
      }

      const latest = valueAsOf(series, anchor) ?? series.points.at(-1) ?? null;
      if (!latest) throw new Error("no observations in series");

      // Staleness guardrail: even monthly series should lag <~60 days. A larger
      // gap means the upstream feed froze (e.g. a version-stamped URL that still
      // returns HTTP 200 but stopped advancing) — surface it loudly so a future
      // source-layout/URL rotation is caught instead of silently freezing cards.
      const lagDays = Math.floor((Date.parse(anchor) - Date.parse(latest.date)) / 86_400_000);
      if (lagDays > 60) {
        log(`  WARN ${spec.group}:${spec.key} latest=${latest.date} lags ${lagDays}d — feed may be stale`);
      }
      // Cadence-aware staleness escalation (monthly series only): a monthly
      // series that has not advanced past a full extra publication cycle is a
      // genuine silent freeze (HTTP 200 but stopped advancing). Flag it so
      // recordSourceHealth surfaces it as "stale" on Source Health, not just a
      // log line. Normal ~monthly lag (<= spec.staleLagDays) stays green. Daily/
      // weekly series (no staleLagDays) never escalate here.
      const staleFrozen =
        spec.staleLagDays != null && lagDays > spec.staleLagDays;
      const staleHint =
        spec.group === "fertiliser"
          ? "The workbook still returns data but has stopped advancing (likely a rotated/frozen source URL). Verify the World Bank CMO landing-page discovery."
          : "The upstream still returns data but has stopped advancing (likely a frozen or discontinued FRED series). Verify the source series still publishes.";
      const staleReason = staleFrozen
        ? `Latest ${spec.label} observation ${latest.date} lags ${lagDays}d — beyond the expected ~monthly cadence for this feed. ${staleHint}`
        : null;
      if (staleFrozen) {
        log(`  STALE ${spec.group}:${spec.key} latest=${latest.date} lags ${lagDays}d — escalating to Source Health`);
      }

      const value = round(latest.value, spec.decimals);
      const change =
        spec.changeMode === "prev"
          ? changeVsPrev(series, latest.date, "MoM")
          : changeOver(series, latest.date, latest.value, 7, "7d");
      const trajectory = trajectoryAsOf(series, latest.date, spec.trajCount).map((p) => ({
        date: p.date,
        value: round(p.value, spec.decimals),
      }));

      const row: InsertMarketPrice = {
        group: spec.group,
        key: spec.key,
        label: spec.label,
        value,
        unit: spec.unit,
        change,
        asOf: latest.date,
        source: series.source,
        benchmark: spec.benchmark ?? null,
        trajectory,
        updatedAt: new Date(),
      };

      if (commit) {
        await db
          .insert(marketPricesTable)
          .values(row)
          .onConflictDoUpdate({
            target: [marketPricesTable.group, marketPricesTable.key],
            set: {
              label: row.label,
              value: row.value,
              unit: row.unit,
              change: row.change,
              asOf: row.asOf,
              source: row.source,
              benchmark: row.benchmark,
              trajectory: row.trajectory,
              updatedAt: row.updatedAt,
            },
          });
      }
      upserted += 1;
      rows.push({ group: spec.group, key: spec.key, value, asOf: latest.date, change });
      addHealth(spec.group, {
        name: priceFeedName(spec),
        url: priceFeedUrl(spec),
        ok: true,
        ...(staleFrozen ? { stale: true, staleReason } : {}),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ key: `${spec.group}:${spec.key}`, error: msg });
      log(`  ${spec.group}:${spec.key} FAILED: ${msg}`);
      addHealth(spec.group, { name: priceFeedName(spec), url: priceFeedUrl(spec), ok: false, error: msg });
    }
  }

  log(`market snapshot done: upserted=${upserted}/${SPECS.length} errors=${errors.length}`);

  // Live Source Health telemetry for the price feeds (energy + fertiliser only;
  // fuel feed health is already recorded by the report price ingest). Never
  // breaks ingestion — recordSourceHealth swallows its own DB errors.
  if (commit) {
    for (const [group, feeds] of healthByGroup) {
      if (group === "fuel") continue;
      await recordSourceHealth(group, feeds, {
        sourceType: "market_data",
        reliability: 4,
        notes: "Commodity price feed (market snapshot ingest).",
      });
    }
  }

  return {
    mode: commit ? "commit" : "dry-run",
    upserted,
    considered: SPECS.length,
    errors,
    rows,
    logLines,
  };
}

function priceFeedName(spec: Spec): string {
  if (spec.fetch.kind === "crude") return `${spec.label} (${spec.fetch.yahoo.symbol})`;
  if (spec.fetch.kind === "fred") return `${spec.label} (${spec.fetch.id})`;
  return `${spec.label} (World Bank Pink Sheet)`;
}

function priceFeedUrl(spec: Spec): string {
  if (spec.fetch.kind === "crude") return `https://finance.yahoo.com/quote/${spec.fetch.yahoo.symbol}`;
  if (spec.fetch.kind === "fred") return `https://fred.stlouisfed.org/series/${spec.fetch.id}`;
  return "https://www.worldbank.org/en/research/commodity-markets";
}
