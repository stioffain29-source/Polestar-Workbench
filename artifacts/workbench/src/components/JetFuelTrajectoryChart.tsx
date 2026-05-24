// Jet Fuel Price Trajectory chart for Fuel Watch.
//
// Renders a clean Polestar-style line chart when a price series is
// provided. When no data is available — the current state, since the
// workbench has no jet fuel price ingestion yet — the component shows
// a clear empty-state note instead of inventing a series.
//
// Brand spec: lowercase hex only, Roboto, no shadows, no gradients on
// markers, no decorative clutter.

const NAVY = "#0b0a3d";
const ELECTRIC = "#465bff";
const DUSK = "#363636";
const POLAR = "#e2e2e2";

export interface JetFuelPricePoint {
  date: string; // ISO date
  price: number; // USD/bbl Singapore benchmark
}

export interface JetFuelTrajectoryChartProps {
  data?: JetFuelPricePoint[];
  /** Caption shown under the chart when data is present. */
  caption?: string;
}

const EMPTY_NOTE =
  "Jet fuel trajectory data is not available for this reporting cycle.";

export default function JetFuelTrajectoryChart({ data, caption }: JetFuelTrajectoryChartProps) {
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
          Singapore Jet Fuel Benchmark
        </div>
        {EMPTY_NOTE}
      </div>
    );
  }

  // Plain SVG line chart — no chart library, no shadows, no gradients.
  const W = 640;
  const H = 220;
  const padL = 44, padR = 12, padT = 16, padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const prices = data.map((d) => d.price);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const span = Math.max(1, maxP - minP);
  const yMin = minP - span * 0.1;
  const yMax = maxP + span * 0.1;

  const x = (i: number) => padL + (i / (data.length - 1)) * innerW;
  const y = (v: number) => padT + (1 - (v - yMin) / (yMax - yMin)) * innerH;

  const path = data
    .map((d, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(d.price).toFixed(1)}`)
    .join(" ");

  // Y-axis ticks: 4 evenly spaced.
  const yTicks = [0, 1, 2, 3].map((k) => yMin + (k / 3) * (yMax - yMin));

  return (
    <div style={{ fontFamily: "Roboto, sans-serif", color: DUSK }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
        {/* Axes baseline */}
        <line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke={POLAR} strokeWidth={1} />
        <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke={POLAR} strokeWidth={1} />
        {/* Y-axis labels and gridlines */}
        {yTicks.map((v, k) => (
          <g key={k}>
            <line x1={padL} y1={y(v)} x2={W - padR} y2={y(v)} stroke={POLAR} strokeWidth={0.5} />
            <text x={padL - 6} y={y(v) + 3} fontSize={10} fill={DUSK} textAnchor="end">
              {v.toFixed(0)}
            </text>
          </g>
        ))}
        {/* X-axis labels: first, middle, last */}
        {[0, Math.floor((data.length - 1) / 2), data.length - 1].map((i) => (
          <text key={i} x={x(i)} y={H - padB + 14} fontSize={10} fill={DUSK} textAnchor="middle">
            {data[i].date.slice(5)}
          </text>
        ))}
        {/* Trajectory line */}
        <path d={path} fill="none" stroke={ELECTRIC} strokeWidth={1.5} />
        {/* End-point marker — flat circle, no shadow/blur/gradient. */}
        <circle cx={x(data.length - 1)} cy={y(data[data.length - 1].price)} r={3} fill={NAVY} />
      </svg>
      <div style={{ fontSize: 11, marginTop: 6 }}>
        {caption ?? `Singapore jet fuel benchmark, ${data.length} observations.`}
      </div>
    </div>
  );
}
