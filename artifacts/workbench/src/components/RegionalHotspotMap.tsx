import IncidentMap from "@/components/IncidentMap";
import type { RegionalMapPoint } from "@/lib/regionalWeekly";
import { DUSK, ELECTRIC, NAVY, SEV_COLOR, sevKey } from "@/lib/pdfChrome";

/** The same keyed CARTO map and canonical point order serve preview and PDF. */
export function RegionalHotspotMap({
  points,
  topic,
}: {
  points: RegionalMapPoint[];
  topic: string | undefined;
}) {
  if (points.length === 0) {
    return (
      <p className="text-[12px] text-muted-foreground italic" style={{ fontFamily: "Roboto, sans-serif" }}>
        No selected development has a verified plottable location.
      </p>
    );
  }

  return (
    <div
      className="border border-[#bdc8d6] bg-white overflow-hidden"
      data-regional-basemap="carto-positron"
      style={{ fontFamily: "Roboto, sans-serif" }}
    >
      <IncidentMap
        key={topic}
        domId="regional-hotspot-map"
        height={255}
        maxZoom={5}
        boundsPadding={[32, 28]}
        hideControls
        showLabels={false}
        showSeverityLegend={false}
        points={points.map((point, index) => ({
          lat: point.lat,
          lng: point.lng,
          severity: point.severity,
          title: point.title,
          markerNumber: index + 1,
        }))}
      />
      <div className="grid grid-cols-1 md:grid-cols-2 border-t border-[#bdc8d6]">
        {points.map((point, index) => (
          <div
            key={index}
            className={`flex gap-2.5 p-3 border-[#d9e0e8] ${index >= 2 ? "border-t" : ""} ${index % 2 === 1 ? "md:border-l" : ""}`}
          >
            <div
              data-regional-map-number
              className="mt-0.5 w-5 h-5 rounded-full shrink-0 text-white text-[10px] font-bold flex items-center justify-center"
              style={{ backgroundColor: SEV_COLOR[sevKey(point.severity)] ?? ELECTRIC }}
            >
              {index + 1}
            </div>
            <div>
              <h4 className="text-[10px] font-bold uppercase tracking-wide leading-[1.25] mb-1" style={{ color: NAVY }}>
                {point.label}
              </h4>
              <p className="text-[9.5px] leading-[1.35] m-0" style={{ color: DUSK }}>
                {point.summary}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}