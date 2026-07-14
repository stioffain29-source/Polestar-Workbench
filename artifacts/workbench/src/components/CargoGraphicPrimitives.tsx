// Shared primitives for the Cargo Watch pattern-report graphics.
//
// Pure, DOM-only building blocks (no window/document access) so the same
// elements render on screen and rasterise cleanly through
// embedReactChartInPdf for the PDF. Inline styles only — the off-screen
// html2canvas host does not carry the app stylesheet.

import type { ReactNode } from "react";
import { G, sevChipColors, sevLabel } from "@/lib/cargoGraphicsTheme";

export function SevChip({
  severityKey,
  small,
}: {
  severityKey: string | null | undefined;
  small?: boolean;
}) {
  const { bg, fg } = sevChipColors(severityKey ?? "");
  const label = sevLabel(severityKey);
  const fontSize = small ? 9 : 10;
  return (
    <span
      // Tagged so the PDF export path (embedReactChartInPdf) can swap this pill
      // for a pixel-centred <canvas> — html2canvas draws CSS text low. On screen
      // the inline-flex centring below keeps the label centred too (preview==PDF).
      data-raster-chip=""
      data-chip-label={label}
      data-chip-bg={bg}
      data-chip-fg={fg}
      data-chip-font={String(fontSize)}
      data-chip-weight="700"
      data-chip-radius="2"
      data-chip-tracking="0.3"
      data-chip-upper="1"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        boxSizing: "border-box",
        background: bg,
        color: fg,
        fontSize,
        fontWeight: 700,
        lineHeight: 1,
        padding: small ? "3px 6px" : "4px 8px",
        borderRadius: 2,
        letterSpacing: 0.3,
        whiteSpace: "nowrap",
        textTransform: "uppercase",
      }}
    >
      {label}
    </span>
  );
}

export function TagChip({ children }: { children: ReactNode }) {
  return (
    <span
      // Tagged for the same canvas swap as SevChip in the PDF export path.
      data-raster-chip=""
      data-chip-bg={G.track}
      data-chip-fg={G.dusk}
      data-chip-font="9"
      data-chip-weight="600"
      data-chip-radius="2"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        boxSizing: "border-box",
        background: G.track,
        color: G.dusk,
        fontSize: 9,
        fontWeight: 600,
        lineHeight: 1,
        padding: "3px 6px",
        borderRadius: 2,
        marginRight: 4,
        marginBottom: 4,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

export function ShareBar({
  pct,
  color = G.electric,
  height = 7,
}: {
  pct: number;
  color?: string;
  height?: number;
}) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <div
      style={{
        background: G.track,
        borderRadius: 4,
        height,
        width: "100%",
        overflow: "hidden",
      }}
    >
      <div style={{ background: color, height: "100%", width: `${w}%` }} />
    </div>
  );
}

/**
 * Outer frame every report graphic shares: a light panel with a navy title and
 * optional subtitle above the body, and an optional footnote below. The title
 * is rasterised into the graphic (like CargoTrendChart's own title), so the
 * on-screen preview and the PDF image can never disagree.
 */
export function GraphicFrame({
  title,
  subtitle,
  footnote,
  children,
}: {
  title: string;
  subtitle?: string;
  footnote?: string;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        fontFamily: "Roboto, sans-serif",
        color: G.dusk,
        background: G.panel,
        border: `1px solid ${G.line}`,
        borderRadius: 4,
        padding: 14,
        boxSizing: "border-box",
        width: "100%",
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, color: G.navy }}>{title}</div>
      {subtitle ? (
        <div style={{ fontSize: 10.5, color: G.muted, marginTop: 3 }}>
          {subtitle}
        </div>
      ) : null}
      <div style={{ marginTop: 12 }}>{children}</div>
      {footnote ? (
        <div style={{ fontSize: 9.5, color: G.muted, marginTop: 10 }}>
          {footnote}
        </div>
      ) : null}
    </div>
  );
}
