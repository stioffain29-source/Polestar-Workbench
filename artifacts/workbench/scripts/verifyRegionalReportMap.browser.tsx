import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { jsPDF } from "jspdf";
import ReportPreview from "../src/components/ReportPreview";
import { RegionalReportMap } from "../src/components/RegionalReportMap";
import { exportTopicReportPdf, type TopicReportData } from "../src/lib/exportTopicReportPdf";
import { waitForRegionalMapTiles } from "../src/lib/regionalReportMapAssets";
import { TOPIC_LABELS } from "../src/lib/topics";

const host = document.getElementById("root")!;
const root = createRoot(host);

declare global {
  interface Window {
    renderRegionalVerification: (report: TopicReportData, mapOnly?: boolean) => Promise<unknown>;
    exportRegionalVerification: (report: TopicReportData) => Promise<string>;
  }
}

window.renderRegionalVerification = async (report, mapOnly = false) => {
  const points = (report.hardNumbers as { regionalCanonicalReport: { mapPoints: Parameters<typeof RegionalReportMap>[0]["points"] } })
    .regionalCanonicalReport.mapPoints;
  flushSync(() => root.render(mapOnly
    ? <RegionalReportMap points={points} topic={report.topic} compact />
    : <ReportPreview report={report} />));
  await document.fonts.ready;
  await waitForRegionalMapTiles(host);
  const map = host.querySelector<HTMLElement>("[data-regional-map-root]")!;
  if (!map) throw new Error("The real report preview did not render its regional map.");
  const rects = Array.from(map.querySelectorAll<HTMLElement>("[data-regional-map-marker]"))
    .map((marker) => {
      const rect = marker.getBoundingClientRect();
      return { number: marker.textContent?.trim(), x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
  if (rects.length !== points.length) throw new Error("Preview marker count disagrees with the saved report.");
  for (let i = 0; i < rects.length; i++) {
    for (const other of rects.slice(0, i)) {
      const a = rects[i];
      if (Math.hypot(a.x + a.width / 2 - other.x - other.width / 2, a.y + a.height / 2 - other.y - other.height / 2) <
        (a.width + other.width) / 2) {
        throw new Error(`Map markers ${a.number} and ${other.number} overlap.`);
      }
    }
  }
  const mapRect = map.getBoundingClientRect();
  return {
    markers: rects,
    tiles: map.querySelectorAll("img[data-regional-map-tile]").length,
    width: mapRect.width,
    height: mapRect.height,
    overflow: map.scrollWidth > map.clientWidth + 1,
  };
};

window.exportRegionalVerification = async (report) => {
  let captured = "";
  const previous = jsPDF.API.save;
  jsPDF.API.save = function (this: jsPDF) {
    captured = this.output("datauristring").split(",")[1];
    return this;
  } as typeof jsPDF.API.save;
  try {
    await exportTopicReportPdf(report, [], TOPIC_LABELS, "regional-map-verify.pdf");
    if (!captured) throw new Error("The actual report PDF exporter did not produce a PDF.");
    return captured;
  } finally {
    jsPDF.API.save = previous;
  }
};