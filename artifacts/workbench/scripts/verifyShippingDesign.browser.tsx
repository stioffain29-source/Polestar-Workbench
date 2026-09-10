import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { jsPDF } from "jspdf";
import ShippingReportPreview from "../src/components/ShippingReportPreview";
import { exportShippingReportPdf } from "../src/lib/exportShippingReportPdf";
import { finalizeShippingPublication } from "../src/lib/shippingPublication";

type ProofOptions = Parameters<typeof ShippingReportPreview>[0];
declare global {
  interface Window {
    renderShippingProof: (options: ProofOptions) => Promise<void>;
    exportShippingProof: () => Promise<{ base64: string; pages: number }>;
    shippingProofFacts: { incomplete: boolean; incidentCount: number };
  }
}
let data: ProofOptions;
window.renderShippingProof = async (options) => {
  data = options;
  const publication = finalizeShippingPublication(options);
  window.shippingProofFacts = {
    incomplete: !publication.completeness.complete,
    incidentCount: publication.maritimeBoard.confirmedIncidents.length,
  };
  const mount = document.createElement("div");
  document.body.append(mount);
  flushSync(() => createRoot(mount).render(<ShippingReportPreview {...options} />));
  await document.fonts.ready;
  await Promise.all(Array.from(document.images).map((image) =>
    image.complete ? Promise.resolve() : new Promise<void>((resolve) => {
      image.onload = () => resolve();
      image.onerror = () => resolve();
    })));
};
window.exportShippingProof = async () => {
  let result: { base64: string; pages: number } | undefined;
  const api = jsPDF.API as unknown as { save: () => jsPDF };
  const original = api.save;
  api.save = function (this: jsPDF) {
    const bytes = new Uint8Array(this.output("arraybuffer"));
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    result = { base64: btoa(binary), pages: this.getNumberOfPages() };
    return this;
  };
  try {
    await exportShippingReportPdf(
      data.report as Parameters<typeof exportShippingReportPdf>[0],
      data.incidents, "shipping-watch.pdf", data.movement,
      data.maritimeSecurityEvents, data.incidentSummaries, data.aiProse,
      data.hiddenSections, data.sectionOverrides,
    );
    if (!result) throw new Error("The Shipping PDF exporter did not save a PDF.");
    return result;
  } finally {
    api.save = original;
  }
};