import React, { useMemo, useState } from "react";
import { CARTO_POSITRON_TILE_URL, CARTO_SUBDOMAINS, CARTO_ATTRIBUTION } from "@/lib/cartoBasemap";
import { buildRegionalReportMap } from "@/lib/regionalReportMap";
import type { RegionalMapPoint } from "@/lib/regionalWeekly";
import { SEV_COLOR, sevKey, ELECTRIC, DUSK, NAVY } from "@/lib/pdfChrome";

interface RegionalReportMapProps {
  points: RegionalMapPoint[];
  topic: string | undefined;
}

export function RegionalReportMap({ points, topic }: RegionalReportMapProps) {
  const mapWidth = 680;
  const mapHeight = 560;

  const layout = useMemo(() => {
    if (points.length === 0) {
      return null;
    }
    return buildRegionalReportMap(points, topic, mapWidth, mapHeight);
  }, [points, topic]);

  const [erroredTiles, setErroredTiles] = useState<Set<string>>(new Set());

  if (points.length === 0 || !layout) {
    return (
      <p className="text-[12px] text-muted-foreground italic" style={{ fontFamily: "Roboto, sans-serif" }}>
        No selected development has a verified plottable location.
      </p>
    );
  }

  const handleTileError = (key: string) => {
    setErroredTiles((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  };

  return (
    <div 
      className="border border-[#bdc8d6] bg-white overflow-hidden flex flex-col font-sans" 
      data-regional-map-root
      data-report-raster-scale
    >
      <div className="relative bg-[#e5e5e5] w-full">
        <div style={{ position: "relative", width: "100%", paddingBottom: `${(layout.height / layout.width) * 100}%`, overflow: "hidden" }}>
          
          {/* Tiles Layer */}
          <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}>
            {layout.tiles.map((tile) => {
              const getTileUrl = (x: number, y: number, z: number): string => {
                const s = CARTO_SUBDOMAINS[(x + y) % CARTO_SUBDOMAINS.length];
                return CARTO_POSITRON_TILE_URL
                  .replace("{s}", s)
                  .replace("{z}", String(z))
                  .replace("{x}", String(x))
                  .replace("{y}", String(y))
                  .replace("{r}", "@2x");
              };
              const url = getTileUrl(tile.x, tile.y, tile.z);
              const isErrored = erroredTiles.has(tile.key);
              
              const widthPct = (tile.size / layout.width) * 100;
              const heightPct = (tile.size / layout.height) * 100;
              const leftPct = (tile.left / layout.width) * 100;
              const topPct = (tile.top / layout.height) * 100;

              return (
                <div 
                  key={tile.key} 
                  style={{
                    position: "absolute",
                    left: `${leftPct}%`,
                    top: `${topPct}%`,
                    width: `${widthPct}%`,
                    height: `${heightPct}%`,
                    backgroundColor: isErrored ? "#f3f4f6" : "transparent"
                  }}
                >
                  {!isErrored && (
                    <img 
                      src={url} 
                      data-regional-map-tile 
                      crossOrigin="anonymous"
                      alt=""
                      style={{ width: "100%", height: "100%", display: "block" }}
                      onError={() => handleTileError(tile.key)}
                    />
                  )}
                  {isErrored && (
                    <div className="w-full h-full flex items-center justify-center text-gray-400 text-[10px] border border-gray-200 bg-gray-50 text-center p-1">
                      Tile Error
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          
          {/* HTML Overlay for Lines, Regions, and Scale */}
          <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
            {/* Leader Lines */}
            {layout.markers.map(marker => {
              if (marker.displaced) {
                const dx = marker.anchorX - marker.x;
                const dy = marker.anchorY - marker.y;
                const length = Math.hypot(dx, dy);
                const angle = Math.atan2(dy, dx);
                
                const leftPct = (marker.x / layout.width) * 100;
                const topPct = (marker.y / layout.height) * 100;
                const widthPct = (length / layout.width) * 100;

                return (
                  <div
                    key={`line-${marker.number}`}
                    style={{
                      position: "absolute",
                      left: `${leftPct}%`,
                      top: `${topPct}%`,
                      width: `${widthPct}%`,
                      height: "0px",
                      borderTop: "1.5px dashed #475569",
                      transformOrigin: "0 0",
                      transform: `rotate(${angle}rad)`
                    }}
                  />
                );
              }
              return null;
            })}
            
            {/* Region Label */}
            <div style={{ position: "absolute", top: "16px", left: "16px" }}>
              <div 
                style={{
                  backgroundColor: "rgba(255, 255, 255, 0.9)",
                  padding: "6px 12px",
                  borderRadius: "4px",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.1)",
                  border: "1px solid #bdc8d6",
                  color: "#0b0a3d",
                  fontSize: "13px",
                  fontWeight: "bold",
                  fontFamily: "Roboto, sans-serif"
                }}
              >
                {layout.regionLabel}
              </div>
            </div>

            {/* Scale Bar HTML Replacement */}
            <div style={{
              position: "absolute",
              left: `${((layout.width - layout.scaleBar.width - 16) / layout.width) * 100}%`,
              top: `${((layout.height - 24) / layout.height) * 100}%`,
              width: `${(layout.scaleBar.width / layout.width) * 100}%`,
              height: "5px",
              borderLeft: "2px solid #334155",
              borderRight: "2px solid #334155",
              borderBottom: "2px solid #334155",
              boxSizing: "border-box"
            }}>
              <div style={{
                position: "absolute",
                top: "-18px",
                width: "100%",
                textAlign: "center",
                whiteSpace: "nowrap",
                fontSize: "clamp(9px, 1.8vw, 12px)",
                fontFamily: "Roboto, sans-serif",
                color: "#334155",
                fontWeight: "700",
                textShadow: "0 0 4px #ffffff, 0 0 4px #ffffff"
              }}>
                {layout.scaleBar.label}
              </div>
            </div>

            {/* Anchor Dots */}
            {layout.markers.map(marker => {
              if (marker.displaced) {
                const anchorLeft = (marker.anchorX / layout.width) * 100;
                const anchorTop = (marker.anchorY / layout.height) * 100;
                const anchorWidthPct = (6 / layout.width) * 100;
                const anchorHeightPct = (6 / layout.height) * 100;
                const bgColor = SEV_COLOR[sevKey(marker.point.severity)] ?? ELECTRIC;
                return (
                  <div
                    key={`anchor-${marker.number}`}
                    style={{
                      position: "absolute",
                      left: `${anchorLeft}%`,
                      top: `${anchorTop}%`,
                      transform: "translate(-50%, -50%)",
                      width: `${anchorWidthPct}%`,
                      height: `${anchorHeightPct}%`,
                      backgroundColor: bgColor,
                      borderRadius: "50%",
                      border: "1px solid #ffffff",
                      boxShadow: "0 0 2px rgba(0,0,0,0.5)"
                    }}
                  />
                );
              }
              return null;
            })}

            {/* Badge Markers */}
            {layout.markers.map(marker => {
              const leftPct = (marker.x / layout.width) * 100;
              const topPct = (marker.y / layout.height) * 100;
              const badgeWidthPct = (24 / layout.width) * 100;
              const badgeHeightPct = (24 / layout.height) * 100;
              const bgColor = SEV_COLOR[sevKey(marker.point.severity)] ?? ELECTRIC;
              return (
                <div
                  key={`marker-${marker.number}`}
                  data-regional-map-marker
                  style={{
                    position: "absolute",
                    left: `${leftPct}%`,
                    top: `${topPct}%`,
                    transform: "translate(-50%, -50%)",
                    width: `${badgeWidthPct}%`,
                    height: `${badgeHeightPct}%`,
                    backgroundColor: bgColor,
                    color: "#ffffff",
                    borderRadius: "50%",
                    border: "2px solid #ffffff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "clamp(8px, 1.8vw, 12px)",
                    fontWeight: "bold",
                    fontFamily: "Roboto, sans-serif",
                    lineHeight: 1,
                    boxShadow: "0 1.5px 4px rgba(0,0,0,0.4)",
                    boxSizing: "border-box"
                  }}
                >
                  {marker.number}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div style={{ backgroundColor: "#ffffff" }}>
        <div 
          style={{ 
            display: "grid", 
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))", 
            gap: "1px", 
            backgroundColor: "#d9e0e8", 
            borderTop: "1px solid #bdc8d6" 
          }}
        >
          {layout.markers.map((marker) => {
            const pt = marker.point;
            return (
              <div
                key={marker.number}
                style={{ 
                  display: "flex", 
                  gap: "10px", 
                  padding: "12px", 
                  backgroundColor: "#ffffff",
                  boxSizing: "border-box" 
                }}
                title={pt.summary}
              >
                <div
                  style={{ 
                    marginTop: "2px",
                    width: "20px", 
                    height: "20px", 
                    borderRadius: "50%", 
                    flexShrink: 0, 
                    color: "#ffffff", 
                    fontSize: "10px", 
                    fontWeight: "bold", 
                    display: "flex", 
                    alignItems: "center", 
                    justifyContent: "center",
                    backgroundColor: SEV_COLOR[sevKey(pt.severity)] ?? ELECTRIC,
                    fontFamily: "Roboto, sans-serif",
                    lineHeight: 1
                  }}
                >
                  {marker.number}
                </div>
                <div style={{ minWidth: 0 }}>
                  <h4 
                    style={{ 
                      fontSize: "10px", 
                      fontWeight: "bold", 
                      textTransform: "uppercase", 
                      letterSpacing: "0.025em", 
                      lineHeight: 1.25, 
                      marginBottom: "4px", 
                      color: NAVY,
                      fontFamily: "Roboto, sans-serif",
                      margin: 0,
                      paddingBottom: "4px"
                    }}
                  >
                    {pt.label}
                  </h4>
                  <p 
                    style={{ 
                      fontSize: "10.5px", 
                      lineHeight: 1.35, 
                      margin: 0, 
                      color: DUSK,
                      fontFamily: "Roboto, sans-serif" 
                    }}
                  >
                    {pt.title}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
        
        <div 
          style={{ 
            padding: "8px 12px", 
            borderTop: "1px solid #bdc8d6", 
            backgroundColor: "#f7f9fc", 
            display: "flex", 
            flexDirection: "column", 
            gap: "4px", 
            fontSize: "9px", 
            color: "#64748b", 
            fontFamily: "Roboto, sans-serif" 
          }}
          className="sm:flex-row sm:justify-between"
        >
          <div>
            Note: Developments without precise coordinates are mapped to country or region centers.
          </div>
          <style dangerouslySetInnerHTML={{ __html: `
            .regional-map-attribution a { color: inherit; text-decoration: underline; }
            .regional-map-attribution a:hover { color: #334155; }
          `}} />
          <div 
            className="sm:text-right regional-map-attribution" 
            dangerouslySetInnerHTML={{ __html: CARTO_ATTRIBUTION }}
            style={{ color: "#64748b" }}
          />
        </div>
      </div>
    </div>
  );
}
