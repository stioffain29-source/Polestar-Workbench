import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export interface CardMapProps {
  lat: number;
  lng: number;
  zoom?: number;
  /** Marker dot fill colour (defaults to Electric Blue). */
  color?: string;
  /** Optional location label drawn as a chip at the bottom-left. */
  label?: string;
  /** DOM id passed through for html2canvas capture. */
  domId?: string;
}

/**
 * Single-point Leaflet map for the social card's visual panel.
 *
 * Uses the same CartoDB Positron basemap as the rest of the workbench. The
 * marker is a plain absolutely-positioned HTML <div> dot in an overlay over the
 * Leaflet container (NOT a Leaflet circleMarker): the card PNG export clones the
 * card DOM and rasterises it with html2canvas, which does NOT reliably capture
 * Leaflet's canvas/SVG panes. Plain HTML dots — and the tile <img> elements —
 * rasterise faithfully, so the on-screen card and the exported PNG agree. The
 * dot is re-projected on every map move/zoom. Zoom animation is disabled so the
 * overlay never drifts from the tiles mid-zoom.
 */
export default function CardMap({
  lat,
  lng,
  zoom = 6,
  color = "#4655FF",
  label,
  domId,
}: CardMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const dotRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    if (!mapRef.current) {
      mapRef.current = L.map(containerRef.current, {
        zoomControl: false,
        attributionControl: true,
        zoomAnimation: false,
        markerZoomAnimation: false,
        // Card is a static graphic — disable interaction so the rendered map is
        // a clean, fixed framing the analyst sets via lat/lng/zoom.
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false,
        touchZoom: false,
      });
      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        attribution: "&copy; OpenStreetMap &copy; CARTO",
        subdomains: "abcd",
        maxZoom: 19,
        crossOrigin: true,
      }).addTo(mapRef.current);
    }

    const map = mapRef.current;
    // The card region sizes the container after mount; ensure Leaflet measures
    // the real box so tiles fill the panel.
    map.invalidateSize();

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

    overlay.replaceChildren();
    const dot = document.createElement("div");
    dot.style.position = "absolute";
    dot.style.width = "28px";
    dot.style.height = "28px";
    dot.style.borderRadius = "50%";
    dot.style.background = color;
    dot.style.border = "4px solid #ffffff";
    dot.style.boxSizing = "border-box";
    overlay.appendChild(dot);
    dotRef.current = dot;

    const positionDot = () => {
      if (!dotRef.current) return;
      const p = map.latLngToContainerPoint([lat, lng]);
      dotRef.current.style.left = `${p.x - 14}px`;
      dotRef.current.style.top = `${p.y - 14}px`;
    };

    map.setView([lat, lng], zoom);
    positionDot();
    map.off("move zoom zoomend resize viewreset", positionDot);
    map.on("move zoom zoomend resize viewreset", positionDot);

    return () => {
      map.off("move zoom zoomend resize viewreset", positionDot);
    };
  }, [lat, lng, zoom, color]);

  // The visual panel is a flex region whose height settles after sibling
  // regions (BLUF text, key points) lay out. Re-measure the map when the
  // container box changes so tiles always fill the panel.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      mapRef.current?.invalidateSize();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      overlayRef.current = null;
      dotRef.current = null;
    };
  }, []);

  return (
    <div
      id={domId}
      ref={containerRef}
      style={{ width: "100%", height: "100%", position: "relative", background: "#fafafa" }}
    >
      {label ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            bottom: 0,
            zIndex: 600,
            background: "#0B0B3D",
            color: "#ffffff",
            fontFamily: "Roboto, sans-serif",
            fontSize: 24,
            padding: "12px 22px",
          }}
        >
          {label}
        </div>
      ) : null}
    </div>
  );
}
