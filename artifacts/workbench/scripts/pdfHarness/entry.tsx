import { createRoot } from "react-dom/client";
import { jsPDF } from "jspdf";
import "@/index.css";
import SpotReportPreview from "@/components/SpotReportPreview";
import { exportElementToPdf, collectBreakCandidates } from "@/lib/exportPdf";
import { buildPageSlices } from "@/lib/pdfPageBreaks";
import type { SpotReport } from "@workspace/api-client-react";

// jsPDF copies `save` onto each instance at construction, so patching
// jsPDF.API.save BEFORE any instance exists redirects the download into a
// window global the Playwright driver can read.
(jsPDF.API as { save: (filename?: string) => void }).save = function (
  this: { output: (t: string) => string },
) {
  (window as unknown as { __pdfData?: string }).__pdfData =
    this.output("datauristring");
};

const para = (lead: string, sentences: number): string => {
  const filler =
    "Reporting from local media and provincial police statements indicates the situation remains fluid, with follow-on demonstrations possible in adjacent districts over the coming days.";
  return [lead, ...Array.from({ length: sentences }, () => filler)].join(" ");
};

const report = {
  id: 9001,
  title: "Spot Report – Indonesia – Danantara Corruption Probe Protests",
  status: "draft",
  severity: "moderate",
  country: "Indonesia",
  location: "Jakarta",
  latitude: null,
  longitude: null,
  mapPoints: null,
  photos: [],
  reportDate: "2026-07-20",
  incidentDate: "2026-07-19",
  bluf: para(
    "Street protests over the Danantara corruption probe escalated in central Jakarta on 19 July, with police deploying tear gas near the parliament complex.",
    2,
  ),
  incidentDetails: [
    para(
      "At approximately 14:30 local time, several hundred demonstrators gathered outside the parliament complex.",
      3,
    ),
    para(
      "Police established a cordon along the main approach road and later used tear gas to disperse elements of the crowd.",
      3,
    ),
  ].join("\n"),
  currentSituation: [
    para(
      "As of the evening of 19 July, the immediate area around the parliament complex has been cleared, though a heavy police presence remains.",
      3,
    ),
    para(
      "Organisers have called for renewed demonstrations later in the week, and student groups in Bandung and Surabaya have signalled solidarity actions.",
      3,
    ),
    para(
      "Public transport in the affected corridor resumed limited service by 20:00, with several stations remaining closed for cleaning and repairs.",
      3,
    ),
    para(
      "Government spokespeople have confirmed the probe will continue and have appealed for calm ahead of the parliamentary session.",
      2,
    ),
  ].join("\n"),
  // The failure mode: an intro line followed by several ONE-LINE paragraphs.
  // Before the fix these short paragraphs produced a candidate desert.
  operationalImpact: [
    "The principal impact on commercial operations is likely to be:",
    "Road closures around the parliament complex during protest windows.",
    "Short-notice disruption to staff movements in the central business district.",
    "Elevated screening at government buildings and adjacent commercial towers.",
    "Possible interruption of last-mile deliveries along the protest corridor.",
    "Reputational exposure for firms perceived as connected to the probe.",
    para(
      "Beyond these immediate effects, prolonged unrest would raise the cost of security escorts and complicate journey management for visiting staff.",
      3,
    ),
  ].join("\n"),
  assessment: [
    para(
      "Polestar assesses that the protests are likely to persist at a moderate tempo while the probe remains in the headlines.",
      3,
    ),
    para(
      "The security force posture suggests the authorities intend to contain rather than suppress the movement, which lowers the likelihood of a violent escalation in the near term.",
      3,
    ),
  ].join("\n"),
  outlook: [
    para(
      "Over the next 24 to 72 hours, further demonstrations are likely in central Jakarta, concentrated around the parliament complex and the main ceremonial roundabout.",
      3,
    ),
    para(
      "A significant escalation would most plausibly follow a high-profile arrest or a heavy-handed dispersal captured on social media.",
      3,
    ),
  ].join("\n"),
  recommendedActions: [
    "Avoid the parliament complex and surrounding roads during announced protest windows.",
    "Brief drivers on alternative routes into the central business district.",
    "Confirm warden and communication trees for staff based in central Jakarta.",
    "Review stand-off distances for offices adjacent to government buildings.",
    "Monitor credible local media for short-notice route closures.",
  ].join("\n"),
  sourcesNotes: null,
  showSourcesInExport: false,
} as unknown as SpotReport;

const root = createRoot(document.getElementById("root")!);
root.render(<SpotReportPreview report={report} incidents={[]} />);

// Debug: dump slice boundaries + every text-line box near each boundary so a
// sliced-line seam can be diagnosed numerically rather than by eyeballing
// raster crops.
(window as unknown as { debugBreaks?: () => unknown }).debugBreaks = () => {
  const el = document.querySelector<HTMLElement>(".print-report");
  if (!el) return "NO_ELEMENT";
  const rootRect = el.getBoundingClientRect();
  const sourceWidth = Math.ceil(rootRect.width || el.scrollWidth);
  const sourceHeight = Math.ceil(el.scrollHeight);
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const bodyAvail = pageHeight - 42 - 14 - 30 - 12;
  const pageCssHeight = bodyAvail / (pageWidth / sourceWidth);
  const { candidates, keepRanges } = collectBreakCandidates(el, pageCssHeight);
  const slices = buildPageSlices(sourceHeight, pageCssHeight, candidates, 0, keepRanges);
  const lines: Array<{ top: number; bottom: number; text: string }> = [];
  const range = document.createRange();
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node: Node | null = walker.nextNode();
  while (node) {
    if (node.textContent && node.textContent.trim()) {
      range.selectNodeContents(node);
      const list = range.getClientRects();
      for (let i = 0; i < list.length; i++) {
        lines.push({
          top: list[i].top - rootRect.top,
          bottom: list[i].bottom - rootRect.top,
          text: (node.textContent || "").slice(0, 40),
        });
      }
    }
    node = walker.nextNode();
  }
  const nearSeams = slices.slice(0, -1).map((s) => ({
    sliceEnd: s.end,
    linesNear: lines
      .filter((l) => l.bottom > s.end - 40 && l.top < s.end + 40)
      .map((l) => ({ top: +l.top.toFixed(2), bottom: +l.bottom.toFixed(2), text: l.text })),
  }));
  return { sourceHeight, pageCssHeight: +pageCssHeight.toFixed(2), slices, nearSeams };
};

(window as unknown as { runExport?: () => Promise<string> }).runExport =
  async () => {
    const el = document.querySelector<HTMLElement>(".print-report");
    if (!el) return "NO_ELEMENT";
    await exportElementToPdf(el, "spot_harness.pdf");
    return (window as unknown as { __pdfData?: string }).__pdfData
      ? "OK"
      : "NO_PDF";
  };
