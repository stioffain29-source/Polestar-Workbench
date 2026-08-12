// Weekly Activity by Pattern — a frequency matrix for the Cargo Watch report.
//
// Rows are the six supply-chain stages; columns are the reporting weeks (plus a
// TOTAL column and, only when needed, a "Date unconfirmed" column). Each cell
// shows how many unique incidents fell in that stage x week, shaded LIGHT BLUE
// by FREQUENCY (not severity) — the denser the reporting, the stronger the
// tint. A "Weekly total" row closes the table and reconciles with the report's
// unique-incident count. Beneath the matrix a single data-derived sentence
// characterises the distribution.
//
// Pure, DOM-only (no window/document access) so the same element renders on
// screen and rasterises cleanly through embedReactChartInPdf for the PDF.
// Inline styles only — the off-screen html2canvas host carries no stylesheet.

import { G } from "@/lib/cargoGraphicsTheme";
import type { CargoActivityMatrix as CargoActivityMatrixModel } from "@/lib/cargoPatternModel";
import { GraphicFrame, SevChip } from "@/components/CargoGraphicPrimitives";

export interface CargoActivityMatrixProps {
  activity: CargoActivityMatrixModel;
}

const TITLE = "Weekly Activity by Pattern";
const SHADE_FOOTNOTE =
  "Cell shading reflects reporting frequency, not severity — a stronger blue means more incidents were reported in that pattern and week.";

// Light-blue frequency ramp (four steps), tinted from the Electric Blue brand
// hue. Zero cells carry no fill and a muted numeral so the eye reads the busy
// cells first. No severity meaning is attached to any shade.
const FREQ_TINTS = ["#EEF1FF", "#DCE1FF", "#C3CBFF", "#AAB5FF"] as const;
const ZERO_FG = "#C3C6D4";
const NEUTRAL_BG = "#E8EAF2"; // TOTAL column + Weekly total row
const HEADER_BG = "#F0F2FA";

function freqCell(count: number, maxCell: number): { bg: string; fg: string } {
  if (count <= 0) return { bg: "transparent", fg: ZERO_FG };
  const ratio = maxCell > 0 ? count / maxCell : 1;
  const idx =
    ratio <= 0.25 ? 0 : ratio <= 0.5 ? 1 : ratio <= 0.75 ? 2 : 3;
  return { bg: FREQ_TINTS[idx], fg: G.navy };
}

const TH_BASE: React.CSSProperties = {
  fontFamily: "Roboto, sans-serif",
  fontSize: 9,
  fontWeight: 700,
  color: G.navy,
  background: HEADER_BG,
  border: `1px solid ${G.line}`,
  lineHeight: 1.15,
  padding: "5px 4px",
  whiteSpace: "normal",
  wordBreak: "break-word",
};

const TD_BASE: React.CSSProperties = {
  fontFamily: "Roboto, sans-serif",
  fontSize: 10,
  border: `1px solid ${G.line}`,
  lineHeight: 1,
  padding: "5px 4px",
  textAlign: "center",
};

export default function CargoActivityMatrix({
  activity,
}: CargoActivityMatrixProps) {
  const {
    total,
    sufficient,
    weeks,
    rows,
    weeklyTotals,
    unconfirmedTotal,
    hasUnconfirmed,
    maxCell,
    statement,
    sparseItems,
  } = activity;

  // Empty period: the report omits this section, but guard defensively so the
  // component never crashes if rendered directly.
  if (total === 0) {
    return (
      <GraphicFrame title={TITLE}>
        <div style={{ fontSize: 10.5, color: G.muted }}>
          No cargo incidents were reported this period.
        </div>
      </GraphicFrame>
    );
  }

  // Sparse period: too few incidents for a meaningful matrix — list them in a
  // compact box instead of drawing a near-empty grid.
  if (!sufficient) {
    return (
      <GraphicFrame
        title={TITLE}
        subtitle="Too few incidents this period for a weekly matrix; individual incidents are listed below."
      >
        <table
          style={{ borderCollapse: "collapse", width: "100%" }}
          cellSpacing={0}
        >
          <thead>
            <tr>
              {["Date", "Pattern", "Location", "Severity"].map((h, i) => (
                <th
                  key={h}
                  style={{ ...TH_BASE, textAlign: i === 3 ? "center" : "left" }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sparseItems.map((it) => (
              <tr key={it.id}>
                <td style={{ ...TD_BASE, textAlign: "left", color: G.dusk }}>
                  {it.dateLabel}
                </td>
                <td style={{ ...TD_BASE, textAlign: "left", color: G.navy }}>
                  {it.pattern}
                </td>
                <td style={{ ...TD_BASE, textAlign: "left", color: G.dusk }}>
                  {it.location || "—"}
                </td>
                <td style={TD_BASE}>
                  <SevChip severityKey={it.severityKey} small />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {statement ? (
          <div style={{ fontSize: 10.5, color: G.dusk, marginTop: 10 }}>
            {statement}
          </div>
        ) : null}
      </GraphicFrame>
    );
  }

  const rowLabelStyle: React.CSSProperties = {
    ...TD_BASE,
    textAlign: "left",
    color: G.navy,
    fontWeight: 600,
    whiteSpace: "normal",
    background: G.panelAlt,
  };
  const neutralCell: React.CSSProperties = {
    ...TD_BASE,
    background: NEUTRAL_BG,
    color: G.navy,
    fontWeight: 700,
  };

  // Drop empty maritime / inland-waterway rows so the matrix stays within the
  // page width on land-dominated windows.
  const visibleRows = rows.filter(
    (r) =>
      !(
        (r.stageKey === "maritime" || r.stageKey === "inland_waterway") &&
        r.total === 0
      ),
  );
  const hasPartialWeek = weeks.some((w) => w.label.includes("*"));

  return (
    <GraphicFrame
      title={TITLE}
      footnote={
        hasPartialWeek
          ? `${SHADE_FOOTNOTE} Weeks marked * are partial (clipped to the reporting period).`
          : SHADE_FOOTNOTE
      }
    >
      <div style={{ width: "100%", overflow: "hidden" }}>
        <table
          style={{
            borderCollapse: "collapse",
            width: "100%",
            tableLayout: "fixed",
          }}
          cellSpacing={0}
        >
          <thead>
            <tr>
              <th style={{ ...TH_BASE, textAlign: "left", width: "18%" }}>
                Pattern
              </th>
              {weeks.map((w) => (
                <th key={w.key} style={TH_BASE}>
                  {w.label}
                </th>
              ))}
              <th style={{ ...TH_BASE, background: NEUTRAL_BG, width: "8%" }}>
                Total
              </th>
              {hasUnconfirmed ? (
                <th style={TH_BASE}>Date unconfirmed</th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((r) => (
              <tr key={r.stageKey}>
                <td style={rowLabelStyle}>{r.label}</td>
                {r.weekCounts.map((c, i) => {
                  const { bg, fg } = freqCell(c, maxCell);
                  return (
                    <td
                      key={weeks[i].key}
                      style={{
                        ...TD_BASE,
                        background: bg,
                        color: fg,
                        fontWeight: c > 0 ? 600 : 400,
                      }}
                    >
                      {c}
                    </td>
                  );
                })}
                <td style={neutralCell}>{r.total}</td>
                {hasUnconfirmed ? (
                  (() => {
                    const { bg, fg } = freqCell(r.unconfirmed, maxCell);
                    return (
                      <td
                        style={{
                          ...TD_BASE,
                          background: bg,
                          color: fg,
                          fontWeight: r.unconfirmed > 0 ? 600 : 400,
                        }}
                      >
                        {r.unconfirmed}
                      </td>
                    );
                  })()
                ) : null}
              </tr>
            ))}
            <tr>
              <td style={{ ...neutralCell, textAlign: "left" }}>Weekly total</td>
              {weeklyTotals.map((t, i) => (
                <td key={weeks[i].key} style={neutralCell}>
                  {t}
                </td>
              ))}
              <td style={neutralCell}>{total}</td>
              {hasUnconfirmed ? (
                <td style={neutralCell}>{unconfirmedTotal}</td>
              ) : null}
            </tr>
          </tbody>
        </table>
      </div>
      {statement ? (
        <div style={{ fontSize: 10.5, color: G.dusk, marginTop: 10 }}>
          {statement}
        </div>
      ) : null}
    </GraphicFrame>
  );
}
