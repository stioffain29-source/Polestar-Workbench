import { useMemo, useState } from "react";
import { useListIncidents, useListStrikes } from "@workspace/api-client-react";
import { RATING_COLORS, SEVERITY_LABELS, markerStyle } from "@/lib/topics";
import { cn } from "@/lib/utils";

// Map a strike munition to the rating palette so all map markers share the
// same approved colours and styling rules.
function munitionRating(munition: string): string {
  if (munition === "ballistic_missile" || munition === "cruise_missile") return "extreme";
  if (munition === "drone") return "high";
  if (munition === "mixed") return "moderate";
  return "low";
}

const COUNTRY_LABELS: Array<{ name: string; lat: number; lng: number }> = [
  { name: "Saudi Arabia", lat: 24, lng: 45 },
  { name: "UAE", lat: 24, lng: 54 },
  { name: "Iran", lat: 32, lng: 53 },
  { name: "Iraq", lat: 33, lng: 44 },
  { name: "Jordan", lat: 31, lng: 36 },
  { name: "Kuwait", lat: 29, lng: 47 },
  { name: "Qatar", lat: 25, lng: 51 },
  { name: "Oman", lat: 21, lng: 57 },
  { name: "Bahrain", lat: 26, lng: 50 },
  { name: "Yemen", lat: 15, lng: 47 },
  { name: "India", lat: 22, lng: 78 },
  { name: "Pakistan", lat: 30, lng: 70 },
  { name: "Indonesia", lat: -3, lng: 115 },
  { name: "Australia", lat: -25, lng: 134 },
  { name: "PNG", lat: -6, lng: 145 },
  { name: "Vietnam", lat: 16, lng: 107 },
  { name: "Singapore", lat: 1.3, lng: 103 },
  { name: "Malaysia", lat: 4, lng: 102 },
  { name: "Philippines", lat: 12, lng: 122 },
  { name: "Japan", lat: 36, lng: 138 },
];

const W = 1400;
const H = 700;
const LNG_MIN = 30;
const LNG_MAX = 180;
const LAT_MIN = -40;
const LAT_MAX = 50;

function project(lat: number, lng: number): [number, number] {
  const x = ((lng - LNG_MIN) / (LNG_MAX - LNG_MIN)) * W;
  const y = ((LAT_MAX - lat) / (LAT_MAX - LAT_MIN)) * H;
  return [x, y];
}

export default function MapPage() {
  const [view, setView] = useState<"incidents" | "maritime" | "land">("incidents");
  const { data: incidents = [] } = useListIncidents({});
  const { data: maritime = [] } = useListStrikes({ theatre: "maritime_hormuz" });
  const { data: land = [] } = useListStrikes({ theatre: "land_gcc" });

  const points = useMemo(() => {
    if (view === "incidents") {
      return incidents
        .filter((i) => i.latitude != null && i.longitude != null)
        .map((i) => ({
          id: `i-${i.id}`,
          lat: i.latitude!,
          lng: i.longitude!,
          title: i.title,
          country: i.country,
          when: i.occurredAt,
          rating: i.severity,
        }));
    }
    const strikes = view === "maritime" ? maritime : land;
    return strikes
      .filter((s) => s.latitude != null && s.longitude != null)
      .map((s) => ({
        id: `s-${s.id}`,
        lat: s.latitude!,
        lng: s.longitude!,
        title: `${s.munition.replace(/_/g, " ")} · ${s.targetCategory.replace(/_/g, " ")}`,
        country: s.country,
        when: s.occurredAt,
        rating: munitionRating(s.munition),
      }));
  }, [view, incidents, maritime, land]);

  const [hover, setHover] = useState<typeof points[number] | null>(null);

  return (
    <div className="max-w-[1800px] mx-auto space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold text-primary uppercase tracking-tight">Geospatial Map</h1>
          <p className="text-muted-foreground font-sans mt-1 text-sm">APAC and Middle East operating area</p>
        </div>
        <div className="flex border border-border rounded-sm overflow-hidden">
          {(["incidents", "maritime", "land"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                "px-4 py-2 text-xs uppercase tracking-wider font-serif font-medium",
                view === v ? "bg-accent text-accent-foreground" : "bg-card hover:bg-muted",
              )}
            >
              {v === "incidents" ? "Incidents" : v === "maritime" ? "Maritime Strikes" : "Land Strikes"}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-primary rounded-sm border border-border overflow-hidden relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block">
          <defs>
            <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
              <path d="M 50 0 L 0 0 0 50" fill="none" stroke="#4655FF" strokeOpacity="0.08" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width={W} height={H} fill="#0B0B3D" />
          <rect width={W} height={H} fill="url(#grid)" />
          {COUNTRY_LABELS.map((c) => {
            const [x, y] = project(c.lat, c.lng);
            return (
              <g key={c.name}>
                <circle cx={x} cy={y} r={2} fill="#E2E2E2" opacity={0.4} />
                <text
                  x={x + 6}
                  y={y + 4}
                  fill="#E2E2E2"
                  opacity={0.6}
                  fontSize={11}
                  fontFamily="Roboto Condensed, sans-serif"
                  style={{ letterSpacing: "0.05em", textTransform: "uppercase" }}
                >
                  {c.name}
                </text>
              </g>
            );
          })}
          {points.map((p) => {
            const [x, y] = project(p.lat, p.lng);
            const s = markerStyle(p.rating);
            return (
              <g key={p.id} onMouseEnter={() => setHover(p)} onMouseLeave={() => setHover(null)} style={{ cursor: "pointer" }}>
                <circle
                  cx={x}
                  cy={y}
                  r={6}
                  fill={s.fill}
                  fillOpacity={s.fillOpacity}
                  stroke={s.stroke}
                  strokeOpacity={s.strokeOpacity}
                  strokeWidth={s.strokeWidth}
                />
              </g>
            );
          })}
        </svg>
        {hover && (
          <div className="absolute top-3 left-3 bg-card border border-border rounded-sm p-3 max-w-sm">
            <div className="text-[10px] font-sans uppercase tracking-widest text-muted-foreground">{hover.country}</div>
            <div className="font-serif font-bold text-primary text-sm mt-0.5">{hover.title}</div>
            <div className="text-xs font-mono text-muted-foreground mt-1">{new Date(hover.when).toLocaleString()}</div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground font-sans">
        <span>Showing {points.length} markers. Hover for detail.</span>
        <span className="inline-flex items-center gap-4">
          {(["extreme", "high", "moderate", "low", "insignificant"] as const).map((r) => (
            <span key={r} className="inline-flex items-center gap-1.5">
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{
                  backgroundColor: RATING_COLORS[r],
                  opacity: 0.78,
                  border: `1.5px solid ${RATING_COLORS[r]}`,
                }}
              />
              {SEVERITY_LABELS[r]}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}
