// Shared visual constants for the Cargo Watch pattern-report graphics.
//
// One place to hold the brand palette used by the four report graphics
// (supply-chain exposure, pattern dashboard, incident timeline, priority
// matrix) so screen and PDF (rasterised via embedReactChartInPdf) stay in
// lockstep. Brand spec: Midnight Blue #0b0a3d, Electric Blue #465bff, Dusk
// Gray #363636, Polar Gray #e2e2e2. No shadows, blurs, gradients or neon.

import { SEV_COLOR, SEV_LABEL, SEV_RANK, sevKey } from "./pdfChrome";

export const G = {
  navy: "#0b0a3d",
  electric: "#465bff",
  dusk: "#363636",
  polar: "#e2e2e2",
  muted: "#6B6B72",
  panel: "#FFFFFF",
  panelAlt: "#F6F7FB",
  line: "#D8DAE5",
  track: "#ECEDF4",
} as const;

export { SEV_COLOR, SEV_LABEL, SEV_RANK, sevKey };

// White label on every tier except the light-green Low tier, which reads better
// with dark navy text (contrast). Insignificant teal keeps a white label.
const DARK_LABEL_TIERS = new Set(["low"]);

export function sevChipColors(key: string): { bg: string; fg: string } {
  const k = sevKey(key);
  const bg = SEV_COLOR[k] ?? G.muted;
  const fg = DARK_LABEL_TIERS.has(k) ? G.navy : "#FFFFFF";
  return { bg, fg };
}

export function sevColor(key: string | null | undefined): string {
  return SEV_COLOR[sevKey(key ?? "")] ?? G.muted;
}

export function sevLabel(key: string | null | undefined): string {
  const k = sevKey(key ?? "");
  return SEV_LABEL[k] ?? "—";
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "24 Jun" style short date; echoes the input when unparseable. */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const day = d.getUTCDate().toString().padStart(2, "0");
  return `${day} ${MONTHS[d.getUTCMonth()]}`;
}
