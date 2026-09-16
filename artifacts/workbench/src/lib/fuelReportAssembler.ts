import {
  getReport,
  listIncidents,
  listMarketPrices,
  type Incident,
  type MarketPrice,
  type Report,
} from "@workspace/api-client-react";
import {
  finalizeFuelPublication,
  type FuelPublicationBundle,
  type FuelReportInput,
} from "./fuelWatchReport";
import type { TopicFastFactsIncident } from "./topicFastFacts";

export interface FuelHydrationValidation {
  reportingPeriodStart: string;
  reportingPeriodEnd: string;
  jetDate: string | null;
  jetSource: string | null;
  trajectorySource: string | null;
  jetUnit: string | null;
  trajectoryUnit: string | null;
  errors: string[];
}

export interface AssembledFuelReport {
  report: Report;
  hydratedReport: FuelReportInput;
  incidents: Incident[];
  marketPrices: MarketPrice[];
  publication: FuelPublicationBundle;
  validation: FuelHydrationValidation;
}

const ymd = (date: Date) => date.toISOString().slice(0, 10);

export function resolveFuelRollingWindow(end = ymd(new Date())): { start: string; end: string } {
  const startDate = new Date(`${end}T00:00:00.000Z`);
  startDate.setUTCDate(startDate.getUTCDate() - 6);
  return { start: ymd(startDate), end };
}

function isIata(row: Pick<MarketPrice, "source">): boolean {
  return /IATA|Platts/i.test(row.source);
}

function freshestRow(rows: MarketPrice[], key: string, end: string): MarketPrice | null {
  return rows
    .filter((row) => row.key === key)
    .map((row) => {
      const points = (row.trajectory ?? [])
        .filter((point) => point.date <= end && Number.isFinite(point.value))
        .sort((a, b) => a.date.localeCompare(b.date));
      const point = points.at(-1);
      const dates = [point?.date, row.asOf <= end ? row.asOf : null]
        .filter((date): date is string => !!date);
      return dates.length ? { row, date: dates.sort().at(-1)! } : null;
    })
    .filter((candidate): candidate is { row: MarketPrice; date: string } => !!candidate)
    .sort((a, b) => {
      const byDate = b.date.localeCompare(a.date);
      if (byDate) return byDate;
      if (key === "jet") return Number(isIata(b.row)) - Number(isIata(a.row));
      return 0;
    })[0]?.row ?? null;
}

export function buildFuelHardNumbersFromMarket(rows: MarketPrice[], end: string): Record<string, unknown> {
  const selected = (["brent", "wti", "jet"] as const)
    .map((key) => ({ key, row: freshestRow(rows, key, end) }))
    .filter((entry): entry is { key: "brent" | "wti" | "jet"; row: MarketPrice } => !!entry.row);
  const prices = selected.map(({ key, row }) => {
    return {
      label: key === "jet" ? "Jet fuel" : row.label,
      ...(row.benchmark ? { benchmark: row.benchmark } : {}),
      value: row.value,
      unit: row.unit,
      ...(row.change ? { change: row.change } : {}),
      asOf: row.asOf,
      source: row.source,
    };
  });
  const jet = selected.find((entry) => entry.key === "jet")?.row;
  const jetPoints = (jet?.trajectory ?? [])
    .filter((point) => point.date <= end && Number.isFinite(point.value))
    .sort((a, b) => a.date.localeCompare(b.date));
  return {
    fastFacts: { prices },
    ...(jet && jetPoints.length >= 2
      ? {
          jetFuelTrajectory: {
            benchmark: jet.benchmark ?? "Global jet fuel composite",
            source: jet.source,
            unit: jet.unit,
            period: "latest month",
            points: jetPoints,
          },
        }
      : {}),
  };
}

export function validateFuelHydration(
  hardNumbers: Record<string, unknown>,
  window = resolveFuelRollingWindow(),
): FuelHydrationValidation {
  const facts = hardNumbers.fastFacts as { prices?: Array<Record<string, unknown>> } | undefined;
  const jet = facts?.prices?.find((price) => /jet/i.test(String(price.label ?? "")));
  const trajectory = hardNumbers.jetFuelTrajectory as Record<string, unknown> | undefined;
  const points = Array.isArray(trajectory?.points) ? trajectory.points as Array<Record<string, unknown>> : [];
  const latestPoint = points.at(-1);
  const jetDate = typeof jet?.asOf === "string" ? jet.asOf : null;
  const trajectoryDate = typeof latestPoint?.date === "string" ? latestPoint.date : null;
  const jetSource = typeof jet?.source === "string" ? jet.source : null;
  const trajectorySource = typeof trajectory?.source === "string" ? trajectory.source : null;
  const jetUnit = typeof jet?.unit === "string" ? jet.unit : null;
  const trajectoryUnit = typeof trajectory?.unit === "string" ? trajectory.unit : null;
  const errors: string[] = [];
  if (!jetDate || jetDate !== window.end) errors.push(`Jet fuel benchmark must be dated ${window.end}.`);
  if (!trajectoryDate || trajectoryDate < window.start || trajectoryDate > window.end) {
    errors.push("Jet fuel trajectory must cover the current reporting window.");
  }
  if (!jetSource || jetSource !== trajectorySource) errors.push("Jet fuel headline and trajectory sources differ.");
  if (!jetUnit || jetUnit !== trajectoryUnit) errors.push("Jet fuel headline and trajectory units differ.");
  if (jetSource && /IATA|Platts/i.test(jetSource) && trajectorySource && !/IATA|Platts/i.test(trajectorySource)) {
    errors.push("A newer IATA benchmark was replaced by an older non-IATA trajectory.");
  }
  return {
    reportingPeriodStart: window.start,
    reportingPeriodEnd: window.end,
    jetDate,
    jetSource,
    trajectorySource,
    jetUnit,
    trajectoryUnit,
    errors,
  };
}

/**
 * Single live data boundary for Fuel Watch. Both the editor and PDF download
 * must call this by exact report id; persisted hard_numbers never win over the
 * current market/development inputs.
 */
export async function assembleFuelWatchReport(reportId: number): Promise<AssembledFuelReport> {
  const [{ report, incidents, marketPrices }] = await Promise.all([
    (async () => {
      const report = await getReport(reportId, { cache: "no-store" });
      if (report.topic !== "fuel") throw new Error(`Report ${reportId} is not a Fuel Watch report.`);
      const [fuel, shipping, energy, marketPrices] = await Promise.all([
        listIncidents({ topic: "fuel" }, { cache: "no-store" }),
        listIncidents({ topic: "shipping" }, { cache: "no-store" }),
        listIncidents({ topic: "energy" }, { cache: "no-store" }),
        listMarketPrices({ group: "fuel" }, { cache: "no-store" }),
      ]);
      return { report, incidents: [...fuel, ...shipping, ...energy], marketPrices };
    })(),
  ]);
  const window = resolveFuelRollingWindow();
  const hardNumbers = buildFuelHardNumbersFromMarket(marketPrices, window.end);
  const hydratedReport: FuelReportInput = {
    ...report,
    issueDate: window.end,
    hardNumbers,
  };
  const validation = validateFuelHydration(hardNumbers, window);
  const publication = finalizeFuelPublication({
    report: hydratedReport,
    incidents: incidents as unknown as TopicFastFactsIncident[],
  });
  return { report, hydratedReport, incidents, marketPrices, publication, validation };
}

export function assertFuelHydrationValid(validation: FuelHydrationValidation): void {
  if (validation.errors.length) {
    throw new Error(`Fuel Watch export blocked: ${validation.errors.join(" ")}`);
  }
}