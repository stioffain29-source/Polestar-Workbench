import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { CountryFastFactsIncident } from "@/lib/countryFastFacts";

const SEV_COLOR: Record<string, string> = {
  extreme: "#A33232",
  high: "#C0392B",
  moderate: "#E67E22",
  low: "#6FB872",
  insignificant: "#1B6B7A",
};

const SEV_LABEL: Record<string, string> = {
  extreme: "Extreme",
  high: "High",
  moderate: "Moderate",
  low: "Low",
  insignificant: "Insignificant",
};

// Severity ordering used to pick the colour for a marker that represents several
// incidents sharing one coordinate — the HIGHEST severity present wins, so an
// Extreme record is never hidden under a lower-severity dot.
const SEV_RANK: Record<string, number> = {
  extreme: 5,
  high: 4,
  moderate: 3,
  low: 2,
  insignificant: 1,
};

const POLAR = "#e2e2e2";
const DUSK = "#363636";

export interface CountryReportMapProps {
  incidents: CountryFastFactsIncident[];
  /** Optional DOM id used by html2canvas during PDF export. */
  domId?: string;
  /** Report country name — used to centre the map when nothing is plottable. */
  countryName?: string;
}

// Default map view per report country. When the active window holds no records
// with coordinates, the map centres on the report's own country instead of a
// generic world view. Centroids mirror COUNTRY_CENTROIDS in the ingest geocoder.
const COUNTRY_VIEW: Record<string, { center: L.LatLngTuple; zoom: number }> = {
  "papua new guinea": { center: [-6.31, 143.96], zoom: 5 },
  png: { center: [-6.31, 143.96], zoom: 5 },
  papua: { center: [-4.0, 138.0], zoom: 5 },
  "west papua": { center: [-2.5, 138.0], zoom: 5 },
};

function resolveCountryView(name?: string): { center: L.LatLngTuple; zoom: number } | null {
  const key = (name ?? "").trim().toLowerCase();
  if (!key) return null;
  return COUNTRY_VIEW[key] ?? null;
}

/**
 * Interactive incident map for the Country Report Builder.
 *
 * Uses CartoDB Positron tiles (clean, light, professional basemap, no API
 * key required). Plots incidents that have valid latitude+longitude.
 *
 * Markers are rendered as plain absolutely-positioned HTML <div> dots in an
 * overlay layered over the Leaflet container (NOT Leaflet circleMarkers, and NOT
 * <canvas> elements). This is deliberate: the in-app "Download PDF" rasterises
 * the on-screen DOM with html2canvas, which does NOT reliably capture Leaflet's
 * canvas/SVG marker panes NOR standalone <canvas> overlay elements — both show on
 * screen but vanish in the PDF, leaving a legend with no visible points. Plain
 * HTML <div> dots rasterise faithfully, so the screen and the PDF agree. One dot
 * is drawn per distinct coordinate (coloured by the highest severity present and
 * badged with the incident count when several share a point), and dots are
 * re-projected on every map move/zoom. Records without coordinates are not
 * plotted but remain in totals and tables.
 */
export default function CountryReportMap({ incidents, domId, countryName }: CountryReportMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const dotsRef = useRef<Array<{ el: HTMLElement; lat: number; lng: number; half: number }>>([]);

  const plottable = incidents.filter(
    (i) => typeof i.latitude === "number" && typeof i.longitude === "number"
      && !Number.isNaN(i.latitude) && !Number.isNaN(i.longitude),
  );

  useEffect(() => {
    if (!containerRef.current) return;

    if (!mapRef.current) {
      mapRef.current = L.map(containerRef.current, {
        zoomControl: true,
        attributionControl: true,
      });
      L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
        {
          attribution: '&copy; OpenStreetMap &copy; CARTO',
          subdomains: "abcd",
          maxZoom: 19,
          crossOrigin: true,
        },
      ).addTo(mapRef.current);
    }

    const map = mapRef.current;

    // Overlay layer that holds the HTML marker dots. Created once, on top of the
    // tiles; pointer-events:none so it never blocks panning/zooming.
    if (!overlayRef.current) {
      const overlay = document.createElement("div");
      overlay.style.position = "absolute";
      overlay.style.inset = "0";
      overlay.style.pointerEvents = "none";
      overlay.style.zIndex = "500";
      containerRef.current.appendChild(overlay);
      overlayRef.current = overlay;
    }
    const overlay = overlayRef.current;

    const positionDots = () => {
      for (const d of dotsRef.current) {
        const p = map.latLngToContainerPoint([d.lat, d.lng]);
        d.el.style.left = `${p.x - d.half}px`;
        d.el.style.top = `${p.y - d.half}px`;
      }
    };

    // Rebuild dots for the current incident set.
    overlay.replaceChildren();
    dotsRef.current = [];

    if (plottable.length === 0) {
      const view = resolveCountryView(countryName);
      if (view) {
        map.setView(view.center, view.zoom);
      } else {
        map.setView([0, 120], 2);
      }
      map.off("move zoom resize viewreset zoomanim", positionDots);
      return;
    }

    // Many country-report records geocode to the SAME city or country centroid,
    // so several incidents legitimately share one coordinate. We deliberately do
    // NOT stack them (which hides all but the top dot) and do NOT fan them out in
    // screen space (a fixed pixel ring pushes coastal-city markers off the
    // coastline into the sea, implying maritime incidents that never happened and
    // there is no reliable client-side way to know which direction is inland).
    // Instead we render ONE dot per distinct coordinate, coloured by the
    // HIGHEST severity present there and badged with the incident COUNT. Each
    // dot therefore stays exactly on land, every incident is accounted for, and
    // an Extreme record is never obscured by a lower-severity dot.
    const groups = new Map<string, number[]>();
    plottable.forEach((i, idx) => {
      const key = `${i.latitude},${i.longitude}`;
      const arr = groups.get(key);
      if (arr) arr.push(idx);
      else groups.set(key, [idx]);
    });

    const latLngs: L.LatLngExpression[] = [];

    for (const idxs of groups.values()) {
      const members = idxs.map((gi) => plottable[gi]);
      const lat = members[0].latitude as number;
      const lng = members[0].longitude as number;
      const count = members.length;

      // Highest severity present at this coordinate drives the marker colour.
      let worst = members[0];
      let worstRank = SEV_RANK[(worst.severity ?? "").toLowerCase()] ?? 0;
      for (const m of members) {
        const r = SEV_RANK[(m.severity ?? "").toLowerCase()] ?? 0;
        if (r > worstRank) {
          worst = m;
          worstRank = r;
        }
      }
      const color = SEV_COLOR[(worst.severity ?? "").toLowerCase()] ?? "#999999";

      const size = count > 1 ? 22 : 14;
      const half = size / 2;

      // Plain absolutely-positioned <div> dot — html2canvas rasterises these
      // faithfully (a standalone <canvas> marker is silently dropped from the
      // exported PDF, breaking screen==PDF parity). When several incidents share
      // the coordinate the dot carries the count as a centred white numeral.
      const dot = document.createElement("div");
      dot.style.position = "absolute";
      dot.style.width = `${size}px`;
      dot.style.height = `${size}px`;
      dot.style.borderRadius = "50%";
      dot.style.background = color;
      dot.style.border = "2px solid #ffffff";
      dot.style.boxSizing = "border-box";
      // The overlay is pointer-events:none; re-enable on the dot so the native
      // hover tooltip (dot.title) listing the incidents at this point fires.
      dot.style.pointerEvents = "auto";
      if (count > 1) {
        dot.style.display = "flex";
        dot.style.alignItems = "center";
        dot.style.justifyContent = "center";
        dot.style.color = "#ffffff";
        dot.style.fontFamily = "Roboto, sans-serif";
        dot.style.fontWeight = "700";
        dot.style.fontSize = "11px";
        dot.style.lineHeight = "1";
        // html2canvas renders text slightly low; a small bottom pad re-centres
        // the numeral in the exported PDF without shifting it on screen much.
        dot.style.paddingBottom = "2px";
        dot.textContent = String(count);
      }

      const loc = (members.find((m) => (m.location ?? "").trim())?.location ?? "").trim();
      const lines = members.map((m) => {
        const t = ((m.displayTitle && m.displayTitle.trim()) || m.title || "Incident").trim();
        const sd = SEV_LABEL[(m.severity ?? "").toLowerCase()] ?? m.severity ?? "";
        return sd ? `${t} (${sd})` : t;
      });
      dot.title = [
        loc ? `${loc} — ${count} incident${count === 1 ? "" : "s"}` : `${count} incident${count === 1 ? "" : "s"}`,
        ...lines,
      ].join("\n");

      overlay.appendChild(dot);
      dotsRef.current.push({ el: dot, lat, lng, half });
      latLngs.push([lat, lng]);
    }

    if (latLngs.length === 1) {
      map.setView(latLngs[0] as L.LatLngTuple, 8);
    } else {
      map.fitBounds(L.latLngBounds(latLngs), { padding: [24, 24], maxZoom: 9 });
    }

    positionDots();
    map.off("move zoom resize viewreset zoomanim", positionDots);
    map.on("move zoom resize viewreset zoomanim", positionDots);

    return () => {
      map.off("move zoom resize viewreset zoomanim", positionDots);
    };
  }, [plottable, countryName]);

  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      overlayRef.current = null;
      dotsRef.current = [];
    };
  }, []);

  const unplotted = incidents.length - plottable.length;
  const hasPlotted = plottable.length > 0;

  return (
    <div>
      <div
        id={domId}
        ref={containerRef}
        style={{
          height: 360,
          width: "100%",
          position: "relative",
          border: `1px solid ${POLAR}`,
          borderRadius: 2,
          background: "#fafafa",
        }}
      />
      {hasPlotted ? (
        <>
          {/* Severity legend is shown ONLY when markers are actually plotted, so
              the map never implies incident plotting on an empty/no-coordinate
              window. The HTML dot overlay above guarantees the plotted points
              are present in BOTH the on-screen view and the rasterised PDF, so
              the legend never accompanies a point-less map. */}
          <div className="flex flex-wrap items-center gap-3 mt-3">
            {(["extreme", "high", "moderate", "low", "insignificant"] as const).map((k) => (
              <div key={k} className="flex items-center gap-1.5">
                <span
                  style={{
                    display: "inline-block",
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: SEV_COLOR[k],
                    border: `1px solid ${POLAR}`,
                  }}
                />
                <span style={{ fontFamily: "Roboto, sans-serif", fontSize: 11, color: DUSK }}>
                  {SEV_LABEL[k]}
                </span>
              </div>
            ))}
          </div>
          <div
            style={{ fontFamily: "Roboto, sans-serif", fontSize: 11, color: DUSK, marginTop: 8, fontStyle: "italic" }}
          >
            Where several incidents share a location, one marker shows the incident count and is coloured by the highest severity recorded there.
            {" "}Records without coordinates are included in totals and tables but not plotted on the map.
            {unplotted > 0 ? ` ${unplotted} of ${incidents.length} record${incidents.length === 1 ? "" : "s"} excluded from the map.` : ""}
          </div>
        </>
      ) : (
        // No record in the window carries usable coordinates: do NOT present the
        // basemap as an incident map. Centred on the report country for context
        // only, with an explicit note so no marker plotting is implied.
        <div
          style={{ fontFamily: "Roboto, sans-serif", fontSize: 11, color: DUSK, marginTop: 8, fontStyle: "italic" }}
        >
          Map reflects country operating context only. Incident records in this period do not contain sufficient coordinates for reliable plotting.
        </div>
      )}
    </div>
  );
}
