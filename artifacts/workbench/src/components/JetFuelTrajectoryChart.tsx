// Jet Fuel Price Trajectory chart for Fuel Watch.
//
// Reads a parsed series from report.hardNumbers (via the shared
// jetFuelTrajectory helpers) so the preview and the PDF exporter
// always read the same data. When fewer than two valid points are
// available the chart renders an honest empty-state card.
//
// Brand spec: lowercase hex only, Roboto, no shadows, no gradients on
// markers, no decorative clutter.

import type { JetFuelPricePoint } from "@/lib/jetFuelTrajectory";

const NAVY = "#0b0a3d";
const ELECTRIC = "#465bff";
const DUSK = "#363636";
const POLAR = "#e2e2e2";

export type { JetFuelPricePoint };

export interface JetFuelTrajectoryChartProps {
  data?: JetFuelPricePoint[] | null;
  /** Benchmark label rendered in the chart's title row. */
  benchmarkLabel?: string;
}

const EMPTY_NOTE =
  "Jet fuel trajectory data is not available for this reporting cycle.";

function formatDateShort(iso: string): string {
  // YYYY-MM-DD -> DD MMM
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = d.getUTCDate().toString().padStart(2, "0");
  return `${day} ${months[d.getUTCMonth()]}`;
}

function pickUnit(series: JetFuelPricePoint[]): string {
  for (const p of series) {
    if (p.unit && p.unit.trim()) return p.unit.trim();
  }
  return "";
}

export default function JetFuelTrajectoryChart({ data, benchmarkLabel }: JetFuelTrajectoryChartProps) {
  // Never assume Singapore. When no label is supplied, fall back to a
  // neutral phrase so the chart subtitle reads honestly.
  const benchmark = benchmarkLabel?.trim() || "Jet fuel benchmark";

  if (!data || data.length < 2) {
    return (
      <div
        style={{
          border: `1px solid ${POLAR}`,
          padding: "18px 16px",
          fontFamily: "Roboto, sans-serif",
          fontSize: 12,
          color: DUSK,
          background: "#fff",
        }}
      >
        <div style={{ fontWeight: 700, color: NAVY, marginBottom: 4 }}>
          {benchmark}
        </div>
        {EMPTY_NOTE}
      </div>
    );
  }

  const unit = pickUnit(data);
  const W = 640;
  const H = 240;
  const padL = 52, padR = 16, padT = 18, padB = 30;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const prices = data.map((d) => d.value);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const span = Math.max(maxP - minP, Math.abs(maxP) * 0.02, 0.01);
  const yMin = minP - span * 0.15;
  const yMax = maxP + span * 0.15;

  const x = (i: number) => padL + (i / (data.length - 1)) * innerW;
  const y = (v: number) => padT + (1 - (v - yMin) / (yMax - yMin)) * innerH;

  const path = data
    .map((d, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(d.value).toFixed(1)}`)
    .join(" ");

  const yTicks = [0, 1, 2, 3].map((k) => yMin + (k / 3) * (yMax - yMin));
  const xTickIndexes = data.length <= 4
    ? data.map((_, i) => i)
    : [0, Math.floor((data.length - 1) / 3), Math.floor((2 * (data.length - 1)) / 3), data.length - 1];

  const last = data[data.length - 1];
  const yDecimals = span >= 10 ? 0 : span >= 1 ? 1 : 2;

  return (
    <div style={{ fontFamily: "Roboto, sans-serif", color: DUSK }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <div style={{ fontWeight: 700, color: NAVY, fontSize: 13 }}>
          {benchmark}{unit ? ` (${unit})` : ""}
        </div>
        <div style={{ fontSize: 11 }}>
          Latest {formatDateShort(last.date)}: <span style={{ color: NAVY, fontWeight: 700 }}>{last.value.toFixed(yDecimals)}</span>{unit ? ` ${unit}` : ""}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
        {/* Axes */}
        <line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke={POLAR} strokeWidth={1} />
        <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke={POLAR} strokeWidth={1} />
        {/* Y-axis labels and gridlines */}
        {yTicks.map((v, k) => (
          <g key={k}>
            <line x1={padL} y1={y(v)} x2={W - padR} y2={y(v)} stroke={POLAR} strokeWidth={0.5} />
            <text x={padL - 6} y={y(v) + 3} fontSize={10} fill={DUSK} textAnchor="end">
              {v.toFixed(yDecimals)}
            </text>
          </g>
        ))}
        {/* X-axis labels */}
        {xTickIndexes.map((i) => (
          <text key={i} x={x(i)} y={H - padB + 14} fontSize={10} fill={DUSK} textAnchor="middle">
            {formatDateShort(data[i].date)}
          </text>
        ))}
        {/* Trajectory line */}
        <path d={path} fill="none" stroke={ELECTRIC} strokeWidth={1.5} />
        {/* Data-supplied annotations only — no fabricated labels. */}
        {data.map((p, i) =>
          p.annotation ? (
            <g key={`ann-${i}`}>
              <line x1={x(i)} y1={padT} x2={x(i)} y2={H - padB} stroke={DUSK} strokeWidth={0.5} strokeDasharray="3 3" opacity={0.5} />
              <text x={x(i) + 4} y={padT + 10} fontSize={9} fill={DUSK}>{p.annotation}</text>
            </g>
          ) : null,
        )}
        {/* Latest-value marker — flat circle, no shadow/blur/gradient. */}
        <circle cx={x(data.length - 1)} cy={y(last.value)} r={3.5} fill={NAVY} />
      </svg>
      <div style={{ fontSize: 11, marginTop: 6 }}>
        {benchmark}, {data.length} observations from {formatDateShort(data[0].date)} to {formatDateShort(last.date)}.
      </div>
    </div>
  );
}
