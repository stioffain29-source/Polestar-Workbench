import { createRoot } from "react-dom/client";
import { jsPDF } from "jspdf";
import "@/index.css";
import JakartaCorridorMap from "@/components/JakartaCorridorMap";
import { exportElementToPdf } from "@/lib/exportPdf";
import type { CountryFastFactsIncident } from "@/lib/countryFastFacts";

// jsPDF copies `save` onto each instance at construction, so patching
// jsPDF.API.save BEFORE any instance exists redirects the download into a
// window global the Playwright driver can read. Same pattern as the existing
// spot-report pdfHarness.
(jsPDF.API as { save: (filename?: string) => void }).save = function (
  this: { output: (t: string) => string },
) {
  (window as unknown as { __pdfData?: string }).__pdfData =
    this.output("datauristring");
};

// Reproduces the reported live state: Central Jakarta government district at
// HIGH (a high-severity record keyed to the govt district keywords) and the
// north-port area (Tanjung Priok / North Jakarta access, same corridorAreaId)
// at ELEVATED (a moderate-severity record keyed to Tanjung Priok).
const incidents: CountryFastFactsIncident[] = [
  {
    id: 1,
    topic: "conflict",
    title: "Protest march reaches parliament complex in central Jakarta",
    severity: "high",
    occurredAt: "2026-07-30",
    country: "Indonesia",
    location: "Jakarta Pusat, near DPR/MPR parliament complex, Central Jakarta",
    summary: "Large demonstration outside the parliament building.",
  },
  {
    id: 2,
    topic: "shipping",
    title: "Berth congestion reported at Tanjung Priok port",
    severity: "moderate",
    occurredAt: "2026-07-29",
    country: "Indonesia",
    location: "Tanjung Priok, North Jakarta",
    summary: "Delays at Tanjung Priok terminal gates.",
  },
];

const root = createRoot(document.getElementById("root")!);
root.render(
  <div className="print-report bg-white" style={{ color: "#0b0a3d", fontFamily: "Roboto, sans-serif" }}>
    <div className="px-10 py-10">
      <JakartaCorridorMap incidents={incidents} issueDate="2026-08-03" />
    </div>
  </div>,
);

(window as unknown as { runExport?: () => Promise<string> }).runExport =
  async () => {
    const el = document.querySelector<HTMLElement>(".print-report");
    if (!el) return "NO_ELEMENT";
    await exportElementToPdf(el, "jakarta_harness.pdf");
    return (window as unknown as { __pdfData?: string }).__pdfData
      ? "OK"
      : "NO_PDF";
  };
