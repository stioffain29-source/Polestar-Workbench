import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { SPOT_SEV_COLOR, SPOT_SEV_LABEL, NAVY, POLAR, DUSK, ELECTRIC } from "@/lib/spotReport";

export interface IncidentMapPoint {
  lat: number;
  lng: number;
  severity?: string | null;
  title?: string | null;
  /** The primary point is drawn larger with a ring; related points are plain. */
  primary?: boolean;
  /** Optional caption drawn as text beside this marker on the map. */
  label?: string | null;
}

export interface IncidentMapProps {
  points: IncidentMapPoint[];
  /** DOM id used by html2canvas during PDF export. */
  domId?: string;
  /** Optional affected-area radius (km) drawn around the primary point. */
  affectedRadiusKm?: number | null;
  /** Show the location text label beside the primary point. */
  showLabels?: boolean;
  /** Text shown as the primary point's label when showLabels is on. */
  locationLabel?: string;
  height?: number;
}

/**
 * Reusable incident map. Markers are absolutely-positioned HTML <div> dots in
 * an overlay over the Leaflet container (NOT Leaflet circleMarkers): the in-app
 * "Download PDF" rasterises the on-screen DOM with html2canvas, which does NOT
 * reliably capture Leaflet's canvas/SVG panes. Plain HTML dots — and an HTML
 * radius ring and HTML labels — rasterise faithfully, so screen == PDF. All
 * overlay elements are re-projected on every map move/zoom.
 */
export default function IncidentMap({
  points,
  domId,
  affectedRadiusKm,
  showLabels,
  locationLabel,
  height = 360,
}: IncidentMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const dotsRef = useRef<Array<{ el: HTMLDivElement; lat: number; lng: number; size: number }>>([]);
  const labelsRef = useRef<Array<{ el: HTMLDivElement; lat: number; lng: number }>>([]);
  const radiusRef = useRef<{ el: HTMLDivElement; lat: number; lng: number; km: number } | null>(null);

  // Memoise the plottable set by a content signature so unrelated form edits
  // (title, narrative, etc.) do NOT produce a new array identity. Without this
  // the effect below re-ran on every keystroke and re-fired fitBounds/setView,
  // resetting the analyst's manual pan/zoom.
  const pointsSig = JSON.stringify(
    points.map((p) => [p.lat, p.lng, p.severity ?? "", p.title ?? "", p.label ?? "", !!p.primary]),
  );
  const plottable = useMemo(
    () =>
      points.filter(
        (p) =>
          typeof p.lat === "number" &&
          typeof p.lng === "number" &&
          !Number.isNaN(p.lat) &&
          !Number.isNaN(p.lng),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pointsSig],
  );

  // The viewport is only re-fitted when the GEOGRAPHIC point set changes —
  // toggling labels or the radius redraws the overlay but must not snap the map
  // back, so the analyst's framing survives.
  const fitKey = useMemo(
    () => JSON.stringify(plottable.map((p) => [p.lat, p.lng])),
    [plottable],
  );
  const lastFitKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    if (!mapRef.current) {
      mapRef.current = L.map(containerRef.current, {
        zoomControl: true,
        // Leaflet's built-in attribution control is disabled: it sits inside the
        // map and clashed with the location label. Instead a clean attribution
        // caption is rendered into the legend row below (in React), so it reads
        // identically on screen and in the rasterised PDF.
        attributionControl: false,
        // The incident markers/labels are a plain HTML overlay (so html2canvas
        // can rasterise them into the PDF), which cannot ride Leaflet's zoom
        // animation — with animation on they visibly drift away from the tiles
        // mid-zoom. Disabling the animation makes every zoom step land cleanly
        // with the overlay locked to the map: stable zoom in and out.
        zoomAnimation: false,
        markerZoomAnimation: false,
      });
      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        attribution: "&copy; OpenStreetMap &copy; CARTO",
        subdomains: "abcd",
        maxZoom: 19,
        crossOrigin: true,
      }).addTo(mapRef.current);
    }

    const map = mapRef.current;

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

    const positionAll = () => {
      for (const d of dotsRef.current) {
        const p = map.latLngToContainerPoint([d.lat, d.lng]);
        d.el.style.left = `${p.x - d.size / 2}px`;
        d.el.style.top = `${p.y - d.size / 2}px`;
      }
      for (const lb of labelsRef.current) {
        const p = map.latLngToContainerPoint([lb.lat, lb.lng]);
        lb.el.style.left = `${p.x + 14}px`;
        lb.el.style.top = `${p.y - 7}px`;
      }
      const r = radiusRef.current;
      if (r) {
        const center = map.latLngToContainerPoint([r.lat, r.lng]);
        const edge = map.latLngToContainerPoint([r.lat + r.km / 111.32, r.lng]);
        const px = Math.abs(center.y - edge.y);
        r.el.style.width = `${px * 2}px`;
        r.el.style.height = `${px * 2}px`;
        r.el.style.left = `${center.x - px}px`;
        r.el.style.top = `${center.y - px}px`;
      }
    };

    overlay.replaceChildren();
    dotsRef.current = [];
    labelsRef.current = [];
    radiusRef.current = null;

    const doFit = lastFitKeyRef.current !== fitKey;

    if (plottable.length === 0) {
      if (doFit) {
        map.setView([0, 120], 2);
        lastFitKeyRef.current = fitKey;
      }
      map.off("move zoom zoomend resize viewreset", positionAll);
      return;
    }

    const primary = plottable.find((p) => p.primary) ?? plottable[0];

    // Affected-area radius ring (HTML circle), drawn under the dots.
    if (affectedRadiusKm && affectedRadiusKm > 0) {
      const ring = document.createElement("div");
      ring.style.position = "absolute";
      ring.style.borderRadius = "50%";
      ring.style.border = `1.5px solid ${ELECTRIC}`;
      ring.style.background = "rgba(70, 91, 255, 0.08)";
      ring.style.boxSizing = "border-box";
      overlay.appendChild(ring);
      radiusRef.current = { el: ring, lat: primary.lat, lng: primary.lng, km: affectedRadiusKm };
    }

    const latLngs: L.LatLngExpression[] = [];
    for (const p of plottable) {
      const sk = (p.severity ?? "").toLowerCase();
      const color = SPOT_SEV_COLOR[sk] ?? "#999999";
      const size = p.primary ? 20 : 14;

      const dot = document.createElement("div");
      dot.style.position = "absolute";
      dot.style.width = `${size}px`;
      dot.style.height = `${size}px`;
      dot.style.borderRadius = "50%";
      dot.style.background = color;
      dot.style.border = p.primary ? "3px solid #ffffff" : "2px solid #ffffff";
      dot.style.boxSizing = "border-box";

      const sevDisplay = SPOT_SEV_LABEL[sk] ?? p.severity ?? "";
      dot.title = [p.title ?? "", sevDisplay ? `Severity: ${sevDisplay}` : ""]
        .filter(Boolean)
        .join(" \u2014 ");

      overlay.appendChild(dot);
      dotsRef.current.push({ el: dot, lat: p.lat, lng: p.lng, size });
      latLngs.push([p.lat, p.lng]);

      // Analyst-typed marker caption (e.g. a manual map point labelled "MINES").
      // The primary point gets its location label from the block below, so it is
      // excluded here to avoid a double label.
      const pointLabel = (p.label ?? "").trim();
      if (showLabels && pointLabel && !p.primary) {
        const lbl = document.createElement("div");
        lbl.style.position = "absolute";
        lbl.style.color = NAVY;
        lbl.style.font = "700 12px/1.2 Roboto, sans-serif";
        lbl.style.letterSpacing = "0.01em";
        lbl.style.whiteSpace = "nowrap";
        lbl.textContent = pointLabel;
        overlay.appendChild(lbl);
        labelsRef.current.push({ el: lbl, lat: p.lat, lng: p.lng });
      }
    }

    if (showLabels && locationLabel) {
      const label = document.createElement("div");
      label.style.position = "absolute";
      label.style.color = NAVY;
      label.style.font = "700 12px/1.2 Roboto, sans-serif";
      label.style.letterSpacing = "0.01em";
      label.style.whiteSpace = "nowrap";
      label.textContent = locationLabel;
      overlay.appendChild(label);
      labelsRef.current.push({ el: label, lat: primary.lat, lng: primary.lng });
    }

    if (doFit) {
      if (latLngs.length === 1) {
        // A single incident opens close enough to read the surrounding street
        // grid (it used to open at a wide regional zoom). The analyst can zoom
        // in further still and — because the auto-fit only re-runs when the
        // plotted point set changes — that manual framing is preserved through
        // edits and the PDF export.
        map.setView(latLngs[0] as L.LatLngTuple, 14);
      } else {
        map.fitBounds(L.latLngBounds(latLngs), { padding: [32, 32], maxZoom: 14 });
      }
      lastFitKeyRef.current = fitKey;
    }

    positionAll();
    map.off("move zoom zoomend resize viewreset", positionAll);
    map.on("move zoom zoomend resize viewreset", positionAll);

    return () => {
      map.off("move zoom zoomend resize viewreset", positionAll);
    };
  }, [plottable, affectedRadiusKm, showLabels, locationLabel, fitKey]);

  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      overlayRef.current = null;
      dotsRef.current = [];
      labelsRef.current = [];
      radiusRef.current = null;
    };
  }, []);

  const hasPlotted = plottable.length > 0;

  return (
    <div>
      <div
        id={domId}
        ref={containerRef}
        style={{
          height,
          width: "100%",
          position: "relative",
          border: `1px solid ${POLAR}`,
          borderRadius: 2,
          background: "#fafafa",
        }}
      />
      {hasPlotted ? (
        <div className="flex flex-wrap items-center gap-3 mt-3">
          {(["extreme", "high", "moderate", "low", "insignificant"] as const).map((k) => (
            <div key={k} className="flex items-center gap-1.5">
              <span
                style={{
                  display: "inline-block",
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: SPOT_SEV_COLOR[k],
                  border: `1px solid ${POLAR}`,
                }}
              />
              <span style={{ fontFamily: "Roboto, sans-serif", fontSize: 11, color: DUSK }}>
                {SPOT_SEV_LABEL[k]}
              </span>
            </div>
          ))}
          <span
            style={{
              marginLeft: "auto",
              fontFamily: "Roboto, sans-serif",
              fontSize: 10,
              color: DUSK,
              whiteSpace: "nowrap",
            }}
          >
            Leaflet | (c) OpenStreetMap (c) CARTO
          </span>
        </div>
      ) : (
        <div
          style={{
            fontFamily: "Roboto, sans-serif",
            fontSize: 11,
            color: DUSK,
            marginTop: 8,
            fontStyle: "italic",
          }}
        >
          No coordinates are available for the linked records, so no points are plotted.
        </div>
      )}
    </div>
  );
}
