/**
 * @jest-environment jsdom
 */
//
// Regression guard for the Jakarta "Movement posture this period" rating
// badge in the html2canvas PDF export path (exportPdf.ts).
//
// History: the badge used to render as a plain DOM <span> sized by the
// browser's own text layout (flex `0 0 auto`, auto width). html2canvas
// re-measures text with its own (less accurate) font metrics, so a longer
// label like "ELEVATED"/"MONITORED" could render wider than the box the live
// DOM had sized for it, clipping against the panel edge. A DIFFERENT, more
// severe variant of the same underlying issue (the generic incident-severity
// matcher force-stretching the badge to a hardcoded 112x24 box) previously
// squeezed the zone title onto two lines and made sibling zone rows'
// paragraph text overlap; that variant is guarded by the
// `data-posture-rating-badge` opt-out asserted in this same test file.
//
// The fix: the Jakarta badge now opts into the SAME pre-measured <canvas>
// chip renderer already used for the sidebar severity chips
// (`data-sev-chip` -> `sidebarSeverityChipCanvas`), parameterised with the
// Jakarta badge's own font size / letter-spacing / padding so the exported
// chip matches the on-screen pill. This test drives the real
// `applySeverityBadgeExportLayout` DOM transform (no html2canvas needed) and
// asserts every rating word:
//   1. is swapped for a <canvas> (never left as raw DOM text for html2canvas
//      to mismeasure), and
//   2. is NOT force-stretched to the generic incident-severity 112x24 box.

// jsdom's global scope does not expose TextEncoder/TextDecoder, but exportPdf.ts
// transitively pulls in jspdf -> fast-png -> iobuffer, which requires them at
// module-load time. Polyfill from Node's `util` before importing exportPdf so
// the REAL applySeverityBadgeExportLayout can be exercised directly (rather
// than mocked, as the component-render tests do) in this jsdom suite.
import { TextEncoder, TextDecoder } from "node:util";
Object.assign(globalThis, { TextEncoder, TextDecoder });

import { applySeverityBadgeExportLayout } from "../../artifacts/workbench/src/lib/exportPdf";

function jakartaBadge(label: string, color: string): HTMLElement {
  const span = document.createElement("span");
  span.setAttribute("data-posture-rating-badge", "true");
  span.setAttribute("data-sev-chip", "true");
  span.setAttribute("data-sev-label", label);
  span.setAttribute("data-sev-color", color);
  span.setAttribute("data-sev-height", "16");
  span.setAttribute("data-sev-pad-x", "5");
  span.setAttribute("data-sev-font-size", "9.5");
  span.setAttribute("data-sev-letter-spacing", "0.04");
  span.style.background = color;
  span.textContent = label.toUpperCase();
  return span;
}

describe("Jakarta posture badge PDF export chip", () => {
  it("swaps every zone rating badge for a pre-measured canvas chip, none left as raw text", () => {
    const root = document.createElement("div");
    const high = jakartaBadge("High", "#8b1a1a");
    const elevated = jakartaBadge("Elevated", "#b5651d");
    const monitored = jakartaBadge("Monitored", "#6b6b1a");
    root.append(high, elevated, monitored);

    applySeverityBadgeExportLayout(root);

    // The original spans must be gone — nothing left for html2canvas to
    // mismeasure as raw DOM text.
    expect(root.querySelectorAll('span[data-posture-rating-badge]').length).toBe(0);

    const canvases = Array.from(root.querySelectorAll("canvas"));
    expect(canvases).toHaveLength(3);
  });

  it("sizes each chip from its own label instead of a fixed incident-severity box", () => {
    const root = document.createElement("div");
    const high = jakartaBadge("High", "#8b1a1a");
    const elevated = jakartaBadge("Elevated", "#b5651d");
    root.append(high, elevated);

    applySeverityBadgeExportLayout(root);

    const [highCanvas, elevatedCanvas] = Array.from(root.querySelectorAll("canvas"));
    const widthOf = (c: Element) => parseFloat((c as HTMLElement).style.width);

    // Neither chip may match the generic incident-severity matcher's hardcoded
    // 112x24 box — that hardcoded stretch is exactly what caused the original
    // Jakarta title-wrap / row-overlap bug.
    for (const c of [highCanvas, elevatedCanvas]) {
      expect((c as HTMLElement).style.width).not.toBe("112px");
      expect((c as HTMLElement).style.height).not.toBe("24px");
    }

    // A longer label ("Elevated") must get a wider chip than a shorter one
    // ("High") — proving width tracks the real label text rather than being
    // clipped to a shared/fixed size (the html2canvas overflow variant of
    // this bug).
    expect(widthOf(elevatedCanvas)).toBeGreaterThan(widthOf(highCanvas));
  });

  it("still opts a bare posture badge span out of the generic incident-severity stretcher", () => {
    // Defensive case: even without the data-sev-chip upgrade, a span tagged
    // data-posture-rating-badge with a shared vocabulary word (e.g. "HIGH")
    // must never be force-stretched to the generic 112x24 incident-severity
    // box. This is the original fix that this test file's history refers to.
    const root = document.createElement("div");
    const span = document.createElement("span");
    span.setAttribute("data-posture-rating-badge", "true");
    span.style.background = "#8b1a1a";
    span.textContent = "HIGH";
    root.appendChild(span);

    applySeverityBadgeExportLayout(root);

    expect(root.contains(span)).toBe(true);
    expect(span.style.width).not.toBe("112px");
    expect(span.style.height).not.toBe("24px");
  });
});
