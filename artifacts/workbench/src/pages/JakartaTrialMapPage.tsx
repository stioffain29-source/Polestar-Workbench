import { useMemo, useRef, useState } from "react";
import { useListIncidents } from "@workspace/api-client-react";
import { Download, Loader2 } from "lucide-react";
import { isJakartaScoped } from "@workspace/ingest/jakartaExtract";
import {
  incidentMatchesCountry,
  isForeignSubjectForIndonesia,
} from "@/lib/countryMatch";
import { clampIssueDateToLatestRecord } from "@/lib/reportWindow";
import { exportElementToPdf } from "@/lib/exportPdf";
import type { CountryFastFactsIncident } from "@/lib/countryFastFacts";
import JakartaTrialMap from "@/components/JakartaTrialMap";

const NAVY = "#0B0B3D";
const DUSK = "#303030";
const ELECTRIC = "#4655FF";

// TRIAL page (Task #290). Owner-gated by App's AuthGate (this route lives inside
// the authenticated Router). SEPARATE from the live Jakarta city report — a
// throwaway design surface reachable by direct URL only.
export default function JakartaTrialMapPage() {
  const reportRef = useRef<HTMLDivElement | null>(null);
  const [exporting, setExporting] = useState(false);

  const { data: incidentsData } = useListIncidents({
    days: 90,
    includeIrrelevant: true,
  } as never);

  // Jakarta-scoped Indonesia incidents (mirrors the live CountryReport gate).
  const jakartaIncidents = useMemo<CountryFastFactsIncident[]>(() => {
    return ((incidentsData ?? []) as CountryFastFactsIncident[]).filter((i) => {
      if (!incidentMatchesCountry(i.country, "Indonesia")) return false;
      if (!isJakartaScoped(i.title, i.summary, i.location)) return false;
      const tr = i as { ln?: string | null; displayTitle?: string | null };
      const en = `${tr.ln ?? tr.displayTitle ?? ""} ${i.title ?? ""}`;
      if (isForeignSubjectForIndonesia(en)) return false;
      return true;
    });
  }, [incidentsData]);

  const issueDate = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return clampIssueDateToLatestRecord(
      today,
      jakartaIncidents as { occurredAt: string; topic?: string }[],
    );
  }, [jakartaIncidents]);

  // 7-day operating window ending at the issue date.
  const windowIncidents = useMemo<CountryFastFactsIncident[]>(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) return jakartaIncidents;
    const end = new Date(`${issueDate}T23:59:59Z`).getTime();
    const start = end - 7 * 24 * 3600 * 1000;
    return jakartaIncidents.filter((i) => {
      const t = new Date(i.occurredAt).getTime();
      return Number.isFinite(t) && t >= start && t <= end;
    });
  }, [jakartaIncidents, issueDate]);

  const downloadPdf = async () => {
    setExporting(true);
    try {
      const el =
        reportRef.current?.querySelector<HTMLElement>(".print-report") ??
        reportRef.current;
      if (!el) throw new Error("PDF export failed: preview is not ready.");
      await exportElementToPdf(el, "jakarta-trial-exposure-map.pdf");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div style={{ padding: "20px 24px", maxWidth: 1180, margin: "0 auto" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 14,
          gap: 12,
        }}
      >
        <div>
          <div
            style={{
              fontFamily: "'Roboto Condensed', Roboto, sans-serif",
              fontSize: 20,
              fontWeight: 700,
              color: NAVY,
            }}
          >
            Jakarta city movement posture — trial
          </div>
          <div style={{ fontSize: 12, color: DUSK, marginTop: 2 }}>
            Throwaway design surface — not the live Jakarta city report.
          </div>
        </div>
        <button
          type="button"
          onClick={downloadPdf}
          disabled={exporting}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            background: ELECTRIC,
            color: "#fff",
            border: "none",
            padding: "8px 14px",
            fontFamily: "Roboto, sans-serif",
            fontSize: 13,
            fontWeight: 600,
            cursor: exporting ? "default" : "pointer",
            opacity: exporting ? 0.7 : 1,
          }}
        >
          {exporting ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Download className="w-3.5 h-3.5" />
          )}
          {exporting ? "Generating trial PDF..." : "Download trial PDF"}
        </button>
      </div>

      <div
        ref={reportRef}
        className="print-report bg-white"
        style={{
          background: "#fff",
          border: `1px solid ${DUSK}`,
          padding: 18,
        }}
      >
        <JakartaTrialMap incidents={windowIncidents} issueDate={issueDate} />
      </div>
    </div>
  );
}
