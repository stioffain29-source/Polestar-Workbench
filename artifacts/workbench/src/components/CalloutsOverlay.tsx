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

export interface CalloutObstaclePoint {
  id: string;
  lat: number;
  lng: number;
  radius: number;
}

export function CalloutsOverlay({
  points,
  obstacles = [],
}: {
  points: CalloutPoint[];
  obstacles?: CalloutObstaclePoint[];
}) {
  const map = useMap();
  const [placements, setPlacements] = useState<CalloutPlacement[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const update = () => {
      if (!containerRef.current) return;
      const mapW = map.getSize().x;
      const mapH = map.getSize().y;

      const boxW = Math.min(280, Math.max(240, mapW * 0.24));
      const inputs = points.map((p, i) => {
        const pt = map.latLngToContainerPoint([p.lat, p.lng]);
        const estLines = Math.max(1, Math.ceil(p.summary.length / 42));
        const boxH = 48 + Math.min(estLines, 3) * 18;
        return {
          id: p.id || `c-${i}`,
          px: pt.x,
          py: pt.y,
          boxW,
          boxH,
        };
      });

      const obstacleRects = obstacles.map((obstacle) => {
        const point = map.latLngToContainerPoint([obstacle.lat, obstacle.lng]);
        return {
          left: point.x - obstacle.radius - 10,
          top: point.y - obstacle.radius - 10,
          right: point.x + obstacle.radius + 10,
          bottom: point.y + obstacle.radius + 10,
        };
      });
      const newPlacements = layoutCallouts(mapW, mapH, inputs, 14, obstacleRects);
      setPlacements(newPlacements);
    };

    update();
    map.on("move zoom zoomend resize", update);
    return () => {
      map.off("move zoom zoomend resize", update);
    };
  }, [map, obstacles, points]);

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
                width: "clamp(240px, 24vw, 280px)",
                background: "#ffffff",
                border: "1px solid #aeb8c8",
                borderTop: `3px solid ${p.severityColor}`,
                padding: "12px 14px 13px",
                borderRadius: "6px",
                boxShadow: "0 4px 14px rgba(11,10,61,0.14)",
                zIndex: 1000,
                pointerEvents: "none",
              }}
            >
              <div style={{ font: "700 15px/1.2 Roboto Condensed, Roboto, sans-serif", color: NAVY, marginBottom: "7px", letterSpacing: "0.02em" }}>
                {p.title}
              </div>
              <div style={{ font: "400 13px/1.42 Roboto, sans-serif", color: DUSK }}>
                {p.summary}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
