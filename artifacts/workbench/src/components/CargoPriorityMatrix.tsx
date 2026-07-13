// Priority matrix graphic for the Cargo Watch pattern report.
//
// A 2x2 frequency (x) by consequence (y) matrix. Each dominant pattern is a
// numbered dot placed WITHIN its model-assigned quadrant cell, so the visual
// position can never disagree with the quadrant label. A legend beneath maps
// numbers to pattern names. Shared by preview and PDF (rasterised).

import type { CargoMatrix, CargoQuadrant } from "@/lib/cargoPatternModel";
import { G } from "@/lib/cargoGraphicsTheme";
import { GraphicFrame } from "./CargoGraphicPrimitives";

export interface CargoPriorityMatrixProps {
  matrix: CargoMatrix;
}

const PLOT_H = 380;
// Cap and centre the plot so a full-width column can't stretch the 2x2 matrix
// into a wide, squashed rectangle; a near-square cell grid reads correctly.
const PLOT_MAX_W = 480;

// Quadrant cell rectangles as percentages of the plot (x from left, y from
// top). x = frequency (right is higher), y = consequence (top is higher).
const CELL: Record<CargoQuadrant, { x0: number; x1: number; y0: number; y1: number }> = {
  "Emerging Concern": { x0: 0, x1: 50, y0: 0, y1: 50 }, // low freq, high consequence
  "Priority Action": { x0: 50, x1: 100, y0: 0, y1: 50 }, // high freq, high consequence
  Monitor: { x0: 0, x1: 50, y0: 50, y1: 100 }, // low freq, low consequence
  "Persistent Exposure": { x0: 50, x1: 100, y0: 50, y1: 100 }, // high freq, low consequence
};

const CELL_TINT: Record<CargoQuadrant, string> = {
  Monitor: "#F6F7FB",
  "Emerging Concern": "#EDEFF7",
  "Persistent Exposure": "#EDEFF7",
  "Priority Action": "#E4E7F5",
};

/** Even grid layout for the points that fall inside one quadrant cell. */
function positionInCell(
  q: CargoQuadrant,
  index: number,
  count: number,
): { left: number; top: number } {
  const cell = CELL[q];
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const col = index % cols;
  const row = Math.floor(index / cols);
  const padX = (cell.x1 - cell.x0) * 0.18;
  const padY = (cell.y1 - cell.y0) * 0.18;
  const usableX = cell.x1 - cell.x0 - padX * 2;
  const usableY = cell.y1 - cell.y0 - padY * 2;
  const left =
    cell.x0 + padX + (cols === 1 ? usableX / 2 : (usableX / (cols - 1)) * col);
  const top =
    cell.y0 + padY + (rows === 1 ? usableY / 2 : (usableY / (rows - 1)) * row);
  return { left, top };
}

export default function CargoPriorityMatrix({
  matrix,
}: CargoPriorityMatrixProps) {
  if (!matrix.sufficient || matrix.points.length === 0) {
    return (
      <GraphicFrame
        title="Priority Matrix"
        subtitle="Frequency against consequence for this period's patterns."
      >
        <div style={{ fontSize: 11, color: G.muted }}>
          Insufficient distinct patterns this period to populate a priority
          matrix. The pattern dashboard above carries the period's exposure.
        </div>
      </GraphicFrame>
    );
  }

  // Stable per-quadrant indexing so points spread evenly within their cell.
  const perQuadrantCounts: Record<CargoQuadrant, number> = {
    Monitor: 0,
    "Emerging Concern": 0,
    "Persistent Exposure": 0,
    "Priority Action": 0,
  };
  for (const p of matrix.points) perQuadrantCounts[p.quadrant] += 1;
  const perQuadrantSeen: Record<CargoQuadrant, number> = {
    Monitor: 0,
    "Emerging Concern": 0,
    "Persistent Exposure": 0,
    "Priority Action": 0,
  };

  const numbered = matrix.points.map((p, i) => {
    const idx = perQuadrantSeen[p.quadrant]++;
    const pos = positionInCell(p.quadrant, idx, perQuadrantCounts[p.quadrant]);
    return { ...p, num: i + 1, left: pos.left, top: pos.top };
  });

  const quadLabelStyle = (align: "left" | "right", top: boolean) =>
    ({
      position: "absolute" as const,
      [top ? "top" : "bottom"]: 6,
      [align]: 8,
      fontSize: 9,
      fontWeight: 700,
      color: G.muted,
      textTransform: "uppercase" as const,
      letterSpacing: 0.3,
    });

  return (
    <GraphicFrame
      title="Priority Matrix"
      subtitle="Each pattern placed by how often it recurs (horizontal) against its consequence (vertical)."
      footnote="Consequence blends severity, confirmed loss, violence and organisation signals. Position is indicative, not to scale."
    >
      <div style={{ display: "flex", maxWidth: PLOT_MAX_W, margin: "0 auto" }}>
        {/* Y axis caption */}
        <div
          style={{
            width: 16,
            flex: "0 0 auto",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 9,
            color: G.muted,
            paddingBottom: 18,
          }}
        >
          <span>High</span>
          <span>Low</span>
        </div>

        <div style={{ flex: 1 }}>
          <div
            style={{
              position: "relative",
              height: PLOT_H,
              border: `1px solid ${G.line}`,
              boxSizing: "border-box",
            }}
          >
            {/* Quadrant cells */}
            {(Object.keys(CELL) as CargoQuadrant[]).map((q) => {
              const c = CELL[q];
              const top = c.y0 < 50;
              const left = c.x0 < 50;
              return (
                <div
                  key={q}
                  style={{
                    position: "absolute",
                    left: `${c.x0}%`,
                    top: `${c.y0}%`,
                    width: `${c.x1 - c.x0}%`,
                    height: `${c.y1 - c.y0}%`,
                    background: CELL_TINT[q],
                    boxSizing: "border-box",
                    borderRight: c.x1 < 100 ? `1px solid ${G.line}` : "none",
                    borderBottom: c.y1 < 100 ? `1px solid ${G.line}` : "none",
                  }}
                >
                  <div style={quadLabelStyle(left ? "left" : "right", top)}>
                    {q}
                  </div>
                </div>
              );
            })}

            {/* Points */}
            {numbered.map((p) => (
              <div
                key={p.id}
                title={`${p.name} — ${p.quadrant}`}
                style={{
                  position: "absolute",
                  left: `${p.left}%`,
                  top: `${p.top}%`,
                  marginLeft: -9,
                  marginTop: -9,
                  width: 18,
                  height: 18,
                  borderRadius: 9,
                  background: G.electric,
                  color: "#FFFFFF",
                  fontSize: 10,
                  fontWeight: 700,
                  lineHeight: "18px",
                  textAlign: "center",
                  border: "1px solid #FFFFFF",
                }}
              >
                {p.num}
              </div>
            ))}
          </div>

          {/* X axis */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 9,
              color: G.muted,
              marginTop: 4,
            }}
          >
            <span>Lower frequency</span>
            <span>Higher frequency</span>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div style={{ marginTop: 12 }}>
        {numbered.map((p) => (
          <div
            key={p.id}
            style={{
              display: "flex",
              alignItems: "center",
              marginBottom: 4,
            }}
          >
            <span
              style={{
                flex: "0 0 auto",
                width: 16,
                height: 16,
                borderRadius: 8,
                background: G.electric,
                color: "#FFFFFF",
                fontSize: 9,
                fontWeight: 700,
                lineHeight: "16px",
                textAlign: "center",
                marginRight: 8,
              }}
            >
              {p.num}
            </span>
            <span style={{ fontSize: 10.5, color: G.dusk }}>
              <span style={{ fontWeight: 600, color: G.navy }}>{p.name}</span>
              {" — "}
              {p.quadrant}
            </span>
          </div>
        ))}
      </div>
    </GraphicFrame>
  );
}
