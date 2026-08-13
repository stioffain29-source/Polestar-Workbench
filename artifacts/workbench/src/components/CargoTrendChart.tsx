// Weekly Cargo Theft Trend chart for the Cargo Watch report.
//
// Reads a weekly count series built by lib/cargoReportData.ts. The PDF
// exporter rasterises this component directly (embedReportChartInPdf.ts)
// so the screen and PDF always share one chart implementation.
//
// Brand spec: lowercase hex only, Roboto, electric-blue bars, navy axis
// labels, polar-gray axes/gridlines. No shadows, blurs, gradients or neon.

import { niceCargoCountMax, type CargoTrendPoint } from "@/lib/cargoReportData";

const NAVY = "#0b0a3d";
const ELECTRIC = "#465bff";
const DUSK = "#363636";
const POLAR = "#e2e2e2";

export interface CargoTrendChartProps {
  data?: CargoTrendPoint[] | null;
}

function formatWeek(point: CargoTrendPoint): string {
  if (point.label) return point.label;
  const d = new Date(point.date);
  if (isNaN(d.getTime())) return point.date;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = d.getUTCDate().toString().padStart(2, "0");
  return `${day} ${months[d.getUTCMonth()]}`;
}

export default function CargoTrendChart({ data }: CargoTrendChartProps) {
  if (!data || data.length < 2) return null;

  const W = 640;
  const H = 240;
  const padL = 42, padR = 16, padT = 18, padB = 30;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const total = data.reduce((s, d) => s + d.count, 0);
  const yMax = niceCargoCountMax(Math.max(...data.map((d) => d.count)));
  const ticks = yMax <= 4
    ? Array.from({ length: yMax + 1 }, (_, k) => k)
    : [0, 1, 2, 3, 4].map((k) => (k / 4) * yMax);

  const slot = innerW / data.length;
  const barW = slot * 0.6;
  const xAt = (i: number) => padL + i * slot + slot / 2;
  const yAt = (v: number) => padT + (1 - v / yMax) * innerH;

  const labelIdx = data.length <= 6
    ? data.map((_, i) => i)
    : [0, Math.floor((data.length - 1) / 3), Math.floor((2 * (data.length - 1)) / 3), data.length - 1];

  const hasPartial = data.some((d) => d.partial);
  const firstLabel = formatWeek(data[0]);
  const lastLabel = formatWeek(data[data.length - 1]);

  return (
    <div style={{ fontFamily: "Roboto, sans-serif", color: DUSK }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <div style={{ fontWeight: 700, color: NAVY, fontSize: 13 }}>
          Weekly Cargo Theft Trend
        </div>
        <div style={{ fontSize: 11 }}>
          {total} record{total === 1 ? "" : "s"} across {data.length} weeks
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: "block" }}>
        {/* Axes */}
        <line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke={POLAR} strokeWidth={1} />
        <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke={POLAR} strokeWidth={1} />
        {/* Y gridlines + integer labels */}
        {ticks.map((v, k) => (
          <g key={k}>
            <line x1={padL} y1={yAt(v)} x2={W - padR} y2={yAt(v)} stroke={POLAR} strokeWidth={0.5} />
            <text x={padL - 6} y={yAt(v) + 3} fontSize={10} fill={DUSK} textAnchor="end">
              {Math.round(v)}
            </text>
          </g>
        ))}
        {/* Bars */}
        {data.map((d, i) => {
          const h = innerH - (yAt(d.count) - padT);
          return (
            <rect
              key={i}
              x={xAt(i) - barW / 2}
              y={yAt(d.count)}
              width={barW}
              height={Math.max(0, h)}
              fill={ELECTRIC}
            />
          );
        })}
        {/* X-axis week labels */}
        {labelIdx.map((i) => (
          <text key={i} x={xAt(i)} y={H - padB + 14} fontSize={10} fill={DUSK} textAnchor="middle">
            {formatWeek(data[i])}
          </text>
        ))}
      </svg>
      {/* paddingBottom: html2canvas draws text baselines low, so without bottom
          room this last caption line has its descenders sheared in the PDF
          rasterisation. Component-level so preview==PDF. */}
      <div style={{ fontSize: 11, marginTop: 6, paddingBottom: 6, lineHeight: 1.35 }}>
        In-scope cargo incidents per week, {firstLabel} to {lastLabel}.
        {hasPartial
          ? " Weeks marked * are partial (clipped to the reporting period)."
          : ""}
      </div>
    </div>
  );
}
