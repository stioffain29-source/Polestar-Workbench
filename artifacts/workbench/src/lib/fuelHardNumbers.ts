// Fuel Watch "Hard Numbers" cards.
//
// Replaces the generic Fast Facts block for Fuel Watch only. Every value
// is derived from incidents on file — no live market prices are invented.
// Cards that have no data are omitted from the grid rather than padded
// with dashes or weak placeholders.

import { format, parseISO, max as dateMax } from "date-fns";
import { resolveReportWindow } from "./reportWindow";
import { filterTopicReportIncidents, type TopicFastFactsIncident } from "./topicFastFacts";
import {
  latestJetFuelPoint,
  jetFuelMovement,
  jetFuelBenchmarkLabel,
} from "./jetFuelTrajectory";

export interface FuelHardNumberCard {
  label: string;
  value: string;
  note?: string;
  severity?: string;
}

const SEV_RANK: Record<string, number> = {
  insignificant: 1, low: 2, moderate: 3, high: 4, extreme: 5,
};
const SEV_LABEL: Record<string, string> = {
  insignificant: "Insignificant", low: "Low", moderate: "Moderate", high: "High", extreme: "Extreme",
};

function matchAny(text: string, patterns: RegExp[]): boolean {
  for (const re of patterns) if (re.test(text)) return true;
  return false;
}

function haystack(i: TopicFastFactsIncident): string {
  return [i.title ?? "", i.summary ?? ""].join(" ").toLowerCase();
}

const REFINERY_RE = [
  /\b(refinery|refineries) (disruption|outage|shutdown|fire|attack|maintenance|closure|halt)/,
  /\brefinery .{0,20}(unplanned|forced|emergency)/,
];
const SHORTAGE_RE = [
  /\b(fuel|petrol|diesel|lpg|cng|kerosene|jet fuel) (shortage|stockout|rationing|queues?)/,
  /\b(fuel|petrol|diesel) .{0,20}(runs? out|ran out)/,
];
const SUBSIDY_RE = [
  /\b(subsidy|subsidies|levy|levies|duty|excise|tax) .{0,30}(fuel|petrol|diesel|gas|lpg|kerosene)/,
  /\b(fuel|petrol|diesel|gas|lpg) (subsidy|levy|duty|excise|tax) (cut|hike|raise|increase|removed|removal|reform)/,
];
const TANKER_RE = [
  /\btanker (driver|drivers|strike|shortage|attack|blockade|convoy)/,
  /\b(forecourt|pump|petrol station) (closure|shut|queue|disruption)/,
];
const CHOKEPOINT_RE = [
  /\b(strait of hormuz|hormuz|bab[- ]el[- ]mandeb|suez|malacca|singapore strait)/,
  /\bchokepoint\b/,
];

export interface ComputeFuelHardNumbersOpts {
  issueDate: string;
  incidents: TopicFastFactsIncident[];
  /** Raw report.hardNumbers payload. Used to surface jet fuel prices. */
  hardNumbersRaw?: unknown;
}

/**
 * Compute the Fuel Watch Hard Numbers cards from in-window incidents.
 * Cards with zero signal are omitted. The first three cards
 * (reporting period, total, highest severity, latest) always render
 * so the section is never empty for a populated report.
 */
export function computeFuelHardNumbers(opts: ComputeFuelHardNumbersOpts): FuelHardNumberCard[] {
  const window = filterTopicReportIncidents(opts.incidents, "fuel", opts.issueDate);
  const period = resolveReportWindow("fuel", opts.issueDate).shortLabel;

  const cards: FuelHardNumberCard[] = [
    { label: "Reporting Period", value: period },
    { label: "Fuel Incidents", value: String(window.length), note: window.length === 1 ? "record in window" : "records in window" },
  ];

  // Singapore Jet Fuel — surfaced only when the report carries a real
  // trajectory series. We never invent a price; if the series is absent
  // or too short the card is simply omitted.
  const latest = latestJetFuelPoint(opts.hardNumbersRaw);
  if (latest) {
    const unit = latest.unit ?? "";
    const valueStr = `${latest.value.toFixed(latest.value >= 10 ? 1 : 2)}${unit ? ` ${unit}` : ""}`;
    const move = jetFuelMovement(opts.hardNumbersRaw);
    let note: string;
    if (move) {
      const arrow = move.direction === "up" ? "↑" : "↓";
      note = `${arrow} ${Math.abs(move.delta).toFixed(2)}${unit ? ` ${unit}` : ""} (${move.pct >= 0 ? "+" : ""}${move.pct.toFixed(1)}%) vs start`;
    } else {
      note = jetFuelBenchmarkLabel(opts.hardNumbersRaw);
    }
    cards.push({ label: "Singapore Jet Fuel", value: valueStr, note });
  }

  // Highest severity
  let highestKey = "";
  let highestRank = 0;
  for (const i of window) {
    const k = (i.severity ?? "").toLowerCase();
    const r = SEV_RANK[k] ?? 0;
    if (r > highestRank) { highestRank = r; highestKey = k; }
  }
  if (highestKey) {
    cards.push({
      label: "Highest Severity",
      value: SEV_LABEL[highestKey] ?? highestKey,
      severity: highestKey,
      note: "Worst rating in window",
    });
  }

  // Latest incident date
  if (window.length > 0) {
    const dates = window
      .map((i) => { try { return parseISO(i.occurredAt); } catch { return null; } })
      .filter((d): d is Date => d !== null && !isNaN(d.getTime()));
    if (dates.length > 0) {
      cards.push({
        label: "Latest Incident",
        value: format(dateMax(dates), "dd MMM yyyy"),
      });
    }
  }

  // Operational signal counters — only rendered when present.
  let refinery = 0, shortage = 0, subsidy = 0, tanker = 0, chokepoint = 0;
  for (const i of window) {
    const t = haystack(i);
    if (matchAny(t, REFINERY_RE)) refinery++;
    if (matchAny(t, SHORTAGE_RE)) shortage++;
    if (matchAny(t, SUBSIDY_RE)) subsidy++;
    if (matchAny(t, TANKER_RE)) tanker++;
    if (matchAny(t, CHOKEPOINT_RE)) chokepoint++;
  }

  if (refinery > 0) {
    cards.push({ label: "Refinery Disruption", value: String(refinery), note: refinery === 1 ? "incident" : "incidents" });
  }
  if (shortage > 0) {
    cards.push({ label: "Shortages / Rationing", value: String(shortage), note: shortage === 1 ? "incident" : "incidents" });
  }
  if (subsidy > 0) {
    cards.push({ label: "Subsidy / Levy Moves", value: String(subsidy), note: subsidy === 1 ? "policy event" : "policy events" });
  }
  if (tanker > 0) {
    cards.push({ label: "Tanker / Forecourt", value: String(tanker), note: tanker === 1 ? "incident" : "incidents" });
  }
  if (chokepoint > 0) {
    cards.push({ label: "Chokepoint Pressure", value: String(chokepoint), note: chokepoint === 1 ? "fuel-relevant flag" : "fuel-relevant flags" });
  }

  // Most-affected country — only when there is a clear leader (>1 record
  // and a non-trivial gap). We never crown a country off a single record.
  const countryCount = new Map<string, number>();
  for (const i of window) {
    const c = (i.country ?? "").trim();
    if (!c) continue;
    countryCount.set(c, (countryCount.get(c) ?? 0) + 1);
  }
  const ranked = Array.from(countryCount.entries()).sort((a, b) => b[1] - a[1]);
  if (ranked.length > 0 && ranked[0][1] >= 2) {
    const [country, n] = ranked[0];
    const tied = ranked.filter(([, c]) => c === n).length;
    if (tied === 1) {
      cards.push({
        label: "Most Affected Country",
        value: country,
        note: `${n} records`,
      });
    }
  }

  return cards;
}
