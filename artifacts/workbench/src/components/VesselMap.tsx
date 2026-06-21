import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  useListMaritimeVessels,
  getListMaritimeVesselsQueryKey,
} from "@workspace/api-client-react";
import type { MaritimeVessel } from "@workspace/api-client-react";
import { NAVY, POLAR, DUSK, ELECTRIC } from "@/lib/spotReport";

// The generated MaritimeVessel.vesselClass is optional (string | undefined);
// the map only ever colours by these three concrete classes, with "other" as
// the fall-back for any vessel the API leaves unclassified.
type VClass = "tanker" | "cargo" | "other";
function classOf(v: MaritimeVessel): VClass {
  return v.vesselClass === "tanker" || v.vesselClass === "cargo" ? v.vesselClass : "other";
}

// The tracked chokepoint bounding boxes, mirrored from AIS_THEATRES in
// lib/ingest/src/maritimeMovement.ts. Drawn as thin outlines so the analyst can
// see the live-tracking footprint (Middle East + Asia-Pacific only — no Europe).
// Keep these in step with the ingest boxes if those ever change.
const THEATRE_BOXES: Array<{
  theatre: string;
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}> = [
  { theatre: "Strait of Hormuz", minLat: 24.0, maxLat: 27.5, minLon: 54.0, maxLon: 58.5 },
  { theatre: "Bab el-Mandeb", minLat: 12.0, maxLat: 14.0, minLon: 42.5, maxLon: 44.5 },
  { theatre: "Gulf of Aden", minLat: 10.5, maxLat: 15.0, minLon: 44.5, maxLon: 51.5 },
  { theatre: "Singapore Strait", minLat: 1.0, maxLat: 1.5, minLon: 103.4, maxLon: 104.2 },
  { theatre: "Malacca Strait", minLat: 1.0, maxLat: 6.5, minLon: 98.0, maxLon: 103.4 },
  { theatre: "Red Sea", minLat: 14.0, maxLat: 28.0, minLon: 32.0, maxLon: 43.5 },
  { theatre: "Suez Canal", minLat: 29.8, maxLat: 31.4, minLon: 32.2, maxLon: 32.7 },
];

// Brand-only vessel-class palette. Tanker = Electric Blue, cargo = Midnight,
// everything else = Dusk Gray. RED IS DELIBERATELY UNUSED — it is reserved for
// the Extreme severity tier and a vessel position is context, never a severity.
const CLASS_COLOR: Record<VClass, string> = {
  tanker: ELECTRIC,
  cargo: NAVY,
  other: DUSK,
};
const CLASS_LABEL: Record<VClass, string> = {
  tanker: "Tanker",
  cargo: "Cargo",
  other: "Other",
};

// AIS navigational-status codes worth naming in the detail panel.
const NAV_STATUS_LABEL: Record<number, string> = {
  0: "Under way (engine)",
  1: "At anchor",
  2: "Not under command",
  3: "Restricted manoeuvrability",
  4: "Constrained by draught",
  5: "Moored",
  6: "Aground",
  7: "Engaged in fishing",
  8: "Under way (sailing)",
};

function courseText(cog: number | null): string {
  return cog === null ? "Course not reported" : `Course ${Math.round(cog)}\u00B0`;
}
function speedText(sog: number | null): string {
  return sog === null ? "Speed not reported" : `${sog.toFixed(1)} kn`;
}
function shipTypeText(t: number | null): string {
  return t === null ? "Type not reported" : `AIS type ${t}`;
}
function lastSeenText(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  return `${hrs} h ago`;
}

interface VesselDot {
  el: HTMLDivElement;
  lat: number;
  lng: number;
  size: number;
}

export interface VesselMapProps {
  height?: number;
}

/**
 * Interactive LIVE vessel map for the tracked Middle East + Asia-Pacific
 * chokepoints. Each marker is one vessel's most recent transmitted AIS position
 * (CONTEXT only — a position is never an incident). Markers are absolutely
 * positioned HTML elements in an overlay over the Leaflet container (the same
 * pattern as IncidentMap), re-projected on every move/zoom, so the brand-styled
 * arrows render predictably and stay locked to the tiles. Heading arrows point
 * along course-over-ground; vessels with no course render as a dot. Clicking a
 * vessel shows its details below the map.
 */
export default function VesselMap({ height = 460 }: VesselMapProps) {
  const vesselParams = { maxAgeHours: 24, limit: 2000 } as const;
  const { data: vessels = [], dataUpdatedAt } = useListMaritimeVessels(
    vesselParams,
    // Poll so the map stays live without a manual refresh.
    {
      query: {
        queryKey: getListMaritimeVesselsQueryKey(vesselParams),
        refetchInterval: 60_000,
      },
    },
  );

  const [theatre, setTheatre] = useState<string>("all");
  const [selectedMmsi, setSelectedMmsi] = useState<number | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const dotsRef = useRef<VesselDot[]>([]);
  const boxLayerRef = useRef<L.LayerGroup | null>(null);

  const plottable = useMemo(
    () =>
      vessels.filter(
        (v) =>
          typeof v.latitude === "number" &&
          typeof v.longitude === "number" &&
          !Number.isNaN(v.latitude) &&
          !Number.isNaN(v.longitude) &&
          (theatre === "all" || v.theatre === theatre),
      ),
    [vessels, theatre],
  );

  const theatresPresent = useMemo(() => {
    const set = new Set(vessels.map((v) => v.theatre));
    return THEATRE_BOXES.filter((b) => set.has(b.theatre)).map((b) => b.theatre);
  }, [vessels]);

  const selected = useMemo(
    () => plottable.find((v) => v.mmsi === selectedMmsi) ?? null,
    [plottable, selectedMmsi],
  );

  // Re-fit only when the focused theatre changes (not on every poll), so the
  // analyst's manual pan/zoom survives a live data refresh.
  const lastFitRef = useRef<string | null>(null);

  // Signature of the plotted set so the draw effect re-runs when positions
  // actually change, not on unrelated re-renders.
  const plottedSig = useMemo(
    () =>
      JSON.stringify(
        plottable.map((v) => [
          v.mmsi,
          v.latitude,
          v.longitude,
          v.courseOverGround ?? "",
          v.vesselClass,
        ]),
      ),
    [plottable],
  );

  useEffect(() => {
    if (!containerRef.current) return;

    if (!mapRef.current) {
      mapRef.current = L.map(containerRef.current, {
        zoomControl: true,
        attributionControl: false,
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

    // Chokepoint outlines (drawn once into a Leaflet pane, under the overlay).
    if (!boxLayerRef.current) {
      const group = L.layerGroup().addTo(map);
      for (const b of THEATRE_BOXES) {
        L.rectangle(
          [
            [b.minLat, b.minLon],
            [b.maxLat, b.maxLon],
          ],
          { color: ELECTRIC, weight: 1, fill: false, opacity: 0.5, interactive: false },
        ).addTo(group);
      }
      boxLayerRef.current = group;
    }

    const positionAll = () => {
      for (const d of dotsRef.current) {
        const p = map.latLngToContainerPoint([d.lat, d.lng]);
        d.el.style.left = `${p.x - d.size / 2}px`;
        d.el.style.top = `${p.y - d.size / 2}px`;
      }
    };

    overlay.replaceChildren();
    dotsRef.current = [];

    const latLngs: L.LatLngExpression[] = [];
    for (const v of plottable) {
      const color = CLASS_COLOR[classOf(v)];
      const cog = v.courseOverGround;
      const isSel = v.mmsi === selectedMmsi;
      const hasCourse = cog !== null && cog !== undefined;
      const size = isSel ? 18 : 13;

      const marker = document.createElement("div");
      marker.style.position = "absolute";
      marker.style.width = `${size}px`;
      marker.style.height = `${size}px`;
      marker.style.pointerEvents = "auto";
      marker.style.cursor = "pointer";
      marker.style.boxSizing = "border-box";

      if (hasCourse) {
        // A triangle arrow pointing along course-over-ground (0 deg = north).
        marker.style.borderLeft = `${size / 2}px solid transparent`;
        marker.style.borderRight = `${size / 2}px solid transparent`;
        marker.style.borderBottom = `${size}px solid ${color}`;
        marker.style.width = "0";
        marker.style.height = "0";
        marker.style.transform = `rotate(${cog}deg)`;
        marker.style.transformOrigin = "50% 50%";
        if (isSel) marker.style.filter = "drop-shadow(0 0 0 #ffffff)";
      } else {
        // No course: a round dot (anchored / stationary / no position-report yet).
        marker.style.borderRadius = "50%";
        marker.style.background = color;
        marker.style.border = isSel ? "3px solid #ffffff" : "2px solid #ffffff";
      }

      marker.title = [
        v.name && v.name.trim().length > 0 ? v.name : `MMSI ${v.mmsi}`,
        `${CLASS_LABEL[classOf(v)]} \u2014 ${v.theatre}`,
        `${speedText(v.speedOverGround ?? null)} \u00B7 ${courseText(cog ?? null)}`,
      ].join("\n");
      marker.addEventListener("click", (e) => {
        e.stopPropagation();
        setSelectedMmsi(v.mmsi);
      });

      overlay.appendChild(marker);
      dotsRef.current.push({ el: marker, lat: v.latitude, lng: v.longitude, size });
      latLngs.push([v.latitude, v.longitude]);
    }

    // Fit the viewport when the focused theatre changes (keyed on theatre, not
    // on the live position signature, so polling never snaps the map back).
    if (lastFitRef.current !== theatre) {
      if (theatre !== "all") {
        const box = THEATRE_BOXES.find((b) => b.theatre === theatre);
        if (box) {
          map.fitBounds(
            L.latLngBounds([
              [box.minLat, box.minLon],
              [box.maxLat, box.maxLon],
            ]),
            { padding: [24, 24], maxZoom: 11 },
          );
        }
      } else if (latLngs.length > 0) {
        map.fitBounds(L.latLngBounds(latLngs), { padding: [32, 32], maxZoom: 9 });
      } else {
        // No live vessels yet: frame the whole tracked footprint.
        map.fitBounds(
          L.latLngBounds([
            [1.0, 32.0],
            [28.0, 104.2],
          ]),
          { padding: [24, 24] },
        );
      }
      lastFitRef.current = theatre;
    }

    positionAll();
    map.off("move zoom zoomend resize viewreset", positionAll);
    map.on("move zoom zoomend resize viewreset", positionAll);
    return () => {
      map.off("move zoom zoomend resize viewreset", positionAll);
    };
    // plottedSig captures the position changes; selectedMmsi re-styles the marker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plottedSig, selectedMmsi, theatre]);

  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      overlayRef.current = null;
      boxLayerRef.current = null;
      dotsRef.current = [];
    };
  }, []);

  const hasVessels = plottable.length > 0;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div className="flex items-center gap-2">
          <span style={{ fontFamily: "Roboto, sans-serif", fontSize: 12, color: DUSK }}>
            Theatre
          </span>
          <select
            value={theatre}
            onChange={(e) => setTheatre(e.target.value)}
            style={{
              fontFamily: "Roboto, sans-serif",
              fontSize: 12,
              color: NAVY,
              border: `1px solid ${POLAR}`,
              borderRadius: 2,
              padding: "3px 8px",
              background: "#ffffff",
            }}
          >
            <option value="all">All tracked chokepoints</option>
            {THEATRE_BOXES.map((b) => (
              <option
                key={b.theatre}
                value={b.theatre}
                disabled={!theatresPresent.includes(b.theatre)}
              >
                {b.theatre}
                {theatresPresent.includes(b.theatre) ? "" : " (no live vessels)"}
              </option>
            ))}
          </select>
        </div>
        <span
          style={{ fontFamily: "Roboto, sans-serif", fontSize: 12, color: DUSK }}
        >
          {plottable.length} vessel{plottable.length === 1 ? "" : "s"} shown
          {dataUpdatedAt ? ` \u00B7 updated ${lastSeenText(new Date(dataUpdatedAt).toISOString())}` : ""}
        </span>
      </div>

      <div
        ref={containerRef}
        onClick={() => setSelectedMmsi(null)}
        style={{
          height,
          width: "100%",
          position: "relative",
          border: `1px solid ${POLAR}`,
          borderRadius: 2,
          background: "#fafafa",
        }}
      />

      <div className="flex flex-wrap items-center gap-3 mt-3">
        {(["tanker", "cargo", "other"] as const).map((k) => (
          <div key={k} className="flex items-center gap-1.5">
            <span
              style={{
                display: "inline-block",
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: CLASS_COLOR[k],
                border: `1px solid ${POLAR}`,
              }}
            />
            <span style={{ fontFamily: "Roboto, sans-serif", fontSize: 11, color: DUSK }}>
              {CLASS_LABEL[k]}
            </span>
          </div>
        ))}
        <span style={{ fontFamily: "Roboto, sans-serif", fontSize: 11, color: DUSK }}>
          Arrow points along course; a dot has no reported course.
        </span>
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

      {selected ? (
        <div
          style={{
            marginTop: 12,
            border: `1px solid ${POLAR}`,
            borderRadius: 2,
            padding: "10px 12px",
            fontFamily: "Roboto, sans-serif",
            color: NAVY,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 700 }}>
            {selected.name && selected.name.trim().length > 0
              ? selected.name
              : `MMSI ${selected.mmsi}`}
          </div>
          <div style={{ fontSize: 12, color: DUSK, marginTop: 4, lineHeight: 1.5 }}>
            {CLASS_LABEL[classOf(selected)]}
            {" \u00B7 "}
            {shipTypeText(selected.shipType ?? null)}
            <br />
            MMSI {selected.mmsi} {" \u00B7 "} {selected.theatre}
            <br />
            {speedText(selected.speedOverGround ?? null)} {" \u00B7 "}{" "}
            {courseText(selected.courseOverGround ?? null)}
            <br />
            {selected.navStatus !== null && selected.navStatus !== undefined
              ? NAV_STATUS_LABEL[selected.navStatus] ?? `Nav status ${selected.navStatus}`
              : "Navigational status not reported"}
            <br />
            Last seen {lastSeenText(selected.lastSeenAt)}
          </div>
        </div>
      ) : (
        <div
          style={{
            marginTop: 12,
            fontFamily: "Roboto, sans-serif",
            fontSize: 11,
            color: DUSK,
            fontStyle: "italic",
          }}
        >
          {hasVessels
            ? "Select a vessel to see its name, type, speed and course. Positions are live AIS context and are never incidents."
            : "No live vessel positions are available for the tracked chokepoints right now. Positions are live AIS context and are never incidents."}
        </div>
      )}
    </div>
  );
}
