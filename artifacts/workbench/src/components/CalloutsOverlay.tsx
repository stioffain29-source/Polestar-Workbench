import { useEffect, useRef, useState } from "react";
import { useMap } from "react-leaflet";
import { type CalloutPlacement, layoutCallouts } from "@/lib/calloutLayout";
const POLAR = "#e2e2e2";
const NAVY = "#0b0a3d";
const DUSK = "#363636";

export interface CalloutPoint {
  id: string;
  lat: number;
  lng: number;
  title: string;
  summary: string;
  severityColor: string;
}

export function CalloutsOverlay({ points }: { points: CalloutPoint[] }) {
  const map = useMap();
  const [placements, setPlacements] = useState<CalloutPlacement[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const update = () => {
      if (!containerRef.current) return;
      const mapW = map.getSize().x;
      const mapH = map.getSize().y;

      const inputs = points.map((p, i) => {
        const pt = map.latLngToContainerPoint([p.lat, p.lng]);
        // We assume a fixed box width and estimate height based on text length
        const boxW = 160;
        const estLines = Math.ceil((p.summary.length * 5) / (boxW - 16));
        const boxH = 24 + estLines * 12 + 12; // Rough estimate
        return {
          id: p.id || `c-${i}`,
          px: pt.x,
          py: pt.y,
          boxW,
          boxH,
        };
      });

      const newPlacements = layoutCallouts(mapW, mapH, inputs);
      setPlacements(newPlacements);
    };

    update();
    map.on("move zoom zoomend resize", update);
    return () => {
      map.off("move zoom zoomend resize", update);
    };
  }, [map, points]);

  return (
    <div ref={containerRef} style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 1000 }}>
      {placements.map((pos) => {
        const p = points.find(pt => pt.id === pos.id || pt.id === undefined);
        if (!p) return null;

        // Calculate leader line angle and length
        const dx = pos.leaderX2 - pos.leaderX1;
        const dy = pos.leaderY2 - pos.leaderY1;
        const length = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx) * (180 / Math.PI);

        return (
          <div key={pos.id}>
            <div
              style={{
                position: "absolute",
                left: pos.leaderX1,
                top: pos.leaderY1,
                width: length,
                height: 1,
                background: "#888888",
                transformOrigin: "0 0",
                transform: `rotate(${angle}deg)`,
                zIndex: 400,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: pos.boxX,
                top: pos.boxY,
                width: 160,
                background: "#ffffff",
                border: `1px solid ${POLAR}`,
                borderLeft: `3px solid ${p.severityColor}`,
                padding: "6px 8px",
                borderRadius: "2px",
                boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
                zIndex: 1000,
                pointerEvents: "auto",
              }}
            >
              <div style={{ font: "700 11px/1.2 Roboto, sans-serif", color: NAVY, marginBottom: "3px" }}>
                {p.title}
              </div>
              <div style={{ font: "400 10px/1.35 Roboto, sans-serif", color: DUSK }}>
                {p.summary}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
