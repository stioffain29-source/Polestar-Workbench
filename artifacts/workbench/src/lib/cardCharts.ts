// Auto-fill builders that turn a dashboard's live data into a card-native
// CardChart (plain HTML/div bars — never recharts SVG, which html2canvas
// mangles in the PNG export). One builder per dashboard view the analyst can
// drop into an infographic card. Every builder caps at the top 6 bars and uses
// the SAME shared aggregation helpers as the dashboards (strikeAnalysis /
// cargoAnalysis) so a card can never disagree with the page it came from.

import type { CardChart, CardChartBar, Incident, Strike } from "@workspace/api-client-react";
import { parseUsdLoss, identifyCountry, isCargoInScope } from "./cargoAnalysis";
import { deriveTarget, deriveWeapon, groupCount } from "./strikeAnalysis";
import { CARD_RATING_LABELS } from "./cardTemplates";

const MAX_BARS = 6;

// Fixed tier order so a severity chart always reads worst-first, regardless of
// which tiers happen to be populated.
const SEVERITY_ORDER = ["extreme", "high", "moderate", "low", "insignificant"];

function fmtUsd(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n)}`;
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, 1).toLocaleDateString("en-GB", {
    month: "short",
    year: "numeric",
  });
}

function firstCountry(raw: string | null | undefined): string {
  return (raw ?? "").split(/[;,/]/)[0]?.trim() || "Unattributed";
}

// Generic count -> bars, top N, electric default colour.
function countBars(
  rows: { key: string; count: number }[],
  cap = MAX_BARS,
): CardChartBar[] {
  return rows
    .filter((r) => r.count > 0)
    .slice(0, cap)
    .map((r) => ({ label: r.key, value: r.count, valueLabel: String(r.count) }));
}

function topicRows(incidents: Incident[], topic: Incident["topic"]): Incident[] {
  return incidents.filter((i) => i.topic === topic);
}

// ---- Topic (news-incident) builders --------------------------------------

export function buildTopicSeverityChart(
  incidents: Incident[],
  topic: Incident["topic"],
  label: string,
): CardChart {
  const rows = topicRows(incidents, topic);
  const counts = new Map(groupCount(rows, (i) => i.severity).map((c) => [c.key, c.count]));
  const bars: CardChartBar[] = SEVERITY_ORDER.filter((s) => (counts.get(s) ?? 0) > 0).map(
    (s) => ({
      label: CARD_RATING_LABELS[s] ?? s,
      value: counts.get(s) ?? 0,
      valueLabel: String(counts.get(s) ?? 0),
      rating: s,
    }),
  );
  return { title: `${label} — severity mix`, note: `${rows.length} incidents`, bars };
}

export function buildTopicCountryChart(
  incidents: Incident[],
  topic: Incident["topic"],
  label: string,
): CardChart {
  const rows = topicRows(incidents, topic);
  const counts = groupCount(rows, (i) => firstCountry(i.country));
  return {
    title: `${label} — by country`,
    note: `Top ${Math.min(MAX_BARS, counts.length)} of ${rows.length} incidents`,
    bars: countBars(counts),
  };
}

export function buildTopicTrendChart(
  incidents: Incident[],
  topic: Incident["topic"],
  label: string,
): CardChart {
  const rows = topicRows(incidents, topic);
  const now = Date.now();
  const bars: CardChartBar[] = [];
  for (let w = MAX_BARS - 1; w >= 0; w--) {
    const end = now - w * 7 * 86_400_000;
    const start = end - 7 * 86_400_000;
    const count = rows.filter((i) => {
      const t = new Date(i.occurredAt).getTime();
      return t > start && t <= end;
    }).length;
    bars.push({
      label: new Date(end).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }),
      value: count,
      valueLabel: String(count),
    });
  }
  return { title: `${label} — weekly trend`, note: "Incidents per 7-day window", bars };
}

// ---- Cargo Watch builders ------------------------------------------------

function cargoRows(incidents: Incident[]): Incident[] {
  return incidents.filter((i) => i.topic === "cargo_watch" && isCargoInScope(i));
}

export function buildCargoLossByMonthChart(incidents: Incident[]): CardChart {
  const rows = cargoRows(incidents);
  const m = new Map<string, number>();
  for (const i of rows) {
    const loss = parseUsdLoss(i);
    if (loss == null || !Number.isFinite(loss) || loss <= 0) continue;
    const d = new Date(i.occurredAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    m.set(key, (m.get(key) ?? 0) + loss);
  }
  const sorted = Array.from(m.entries()).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const bars: CardChartBar[] = sorted
    .slice(-MAX_BARS)
    .map(([key, total]) => ({ label: monthLabel(key), value: total, valueLabel: fmtUsd(total) }));
  return { title: "Cargo Watch — losses by month", note: "Source-stated USD only", bars };
}

export function buildCargoCountryChart(incidents: Incident[]): CardChart {
  const rows = cargoRows(incidents);
  const counts = groupCount(
    rows,
    (i) => identifyCountry(i.country) ?? identifyCountry(i.title) ?? "Unattributed",
  );
  return {
    title: "Cargo Watch — by country",
    note: `Top ${Math.min(MAX_BARS, counts.length)} of ${rows.length} incidents`,
    bars: countBars(counts),
  };
}

// ---- Missile Strike Tracker builders -------------------------------------

export function buildStrikeCountryChart(strikes: Strike[]): CardChart {
  const counts = groupCount(strikes, (s) => s.country || "Unattributed");
  return {
    title: "Missile Tracker — by country",
    note: `All theatres · top ${Math.min(MAX_BARS, counts.length)} of ${strikes.length} strikes`,
    bars: countBars(counts),
  };
}

export function buildStrikeWeaponChart(strikes: Strike[]): CardChart {
  const counts = groupCount(strikes, (s) => deriveWeapon(s));
  return {
    title: "Missile Tracker — by weapon",
    note: `All theatres · ${strikes.length} strikes`,
    bars: countBars(counts),
  };
}

export function buildStrikeTargetChart(strikes: Strike[]): CardChart {
  const counts = groupCount(strikes, (s) => deriveTarget(s));
  return {
    title: "Missile Tracker — by target",
    note: `All theatres · ${strikes.length} strikes`,
    bars: countBars(counts),
  };
}

// ---- Catalog + dispatcher ------------------------------------------------

export type ChartSourceKind = "topic" | "cargo" | "strike";

export interface ChartType {
  key: string;
  label: string;
}

export interface ChartSource {
  key: string;
  label: string;
  kind: ChartSourceKind;
  topic?: Incident["topic"];
  types: ChartType[];
}

const TOPIC_TYPES: ChartType[] = [
  { key: "topic_severity", label: "Severity mix" },
  { key: "topic_country", label: "By country" },
  { key: "topic_trend", label: "Weekly trend" },
];

export const CHART_SOURCES: ChartSource[] = [
  {
    key: "strikes",
    label: "Missile Strike Tracker",
    kind: "strike",
    types: [
      { key: "strike_country", label: "Strikes by country" },
      { key: "strike_weapon", label: "Strikes by weapon" },
      { key: "strike_target", label: "Strikes by target" },
    ],
  },
  {
    key: "cargo",
    label: "Cargo Watch",
    kind: "cargo",
    topic: "cargo_watch",
    types: [
      { key: "cargo_loss_month", label: "Losses by month (USD)" },
      { key: "cargo_country", label: "Incidents by country" },
      { key: "cargo_severity", label: "Severity mix" },
    ],
  },
  { key: "flashpoint", label: "Protests & Civil Unrest", kind: "topic", topic: "flashpoint", types: TOPIC_TYPES },
  { key: "shipping", label: "Shipping Watch", kind: "topic", topic: "shipping", types: TOPIC_TYPES },
  { key: "fuel", label: "Fuel Watch", kind: "topic", topic: "fuel", types: TOPIC_TYPES },
  { key: "energy", label: "Energy", kind: "topic", topic: "energy", types: TOPIC_TYPES },
  { key: "fertiliser", label: "Fertiliser", kind: "topic", topic: "fertiliser", types: TOPIC_TYPES },
];

export function buildCardChart(
  sourceKey: string,
  typeKey: string,
  data: { incidents: Incident[]; strikes: Strike[] },
): CardChart | null {
  const src = CHART_SOURCES.find((s) => s.key === sourceKey);
  if (!src) return null;
  const { incidents, strikes } = data;
  switch (typeKey) {
    case "strike_country":
      return buildStrikeCountryChart(strikes);
    case "strike_weapon":
      return buildStrikeWeaponChart(strikes);
    case "strike_target":
      return buildStrikeTargetChart(strikes);
    case "cargo_loss_month":
      return buildCargoLossByMonthChart(incidents);
    case "cargo_country":
      return buildCargoCountryChart(incidents);
    case "cargo_severity":
      return buildTopicSeverityChart(incidents, "cargo_watch", "Cargo Watch");
    case "topic_severity":
      return src.topic ? buildTopicSeverityChart(incidents, src.topic, src.label) : null;
    case "topic_country":
      return src.topic ? buildTopicCountryChart(incidents, src.topic, src.label) : null;
    case "topic_trend":
      return src.topic ? buildTopicTrendChart(incidents, src.topic, src.label) : null;
  }
  return null;
}
