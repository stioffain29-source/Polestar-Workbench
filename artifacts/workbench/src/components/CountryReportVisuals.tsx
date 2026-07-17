import type { GdeltStructuredItem, ReliefWebReport } from "@workspace/api-client-react";
import SituationalContextSection from "@/components/SituationalContextSection";
import GdeltContextSection from "@/components/GdeltContextSection";
import { isGdeltMonitoredReport } from "@/lib/gdeltContext";

// The shared supporting layer that sits BELOW the written country brief for every
// country report (structured and generic). Per the reworked country-report
// standard, the Severity Distribution and Incident Breakdown by Type charts are
// NOT shown by default: a chart must support the written assessment, not appear
// merely because the data exists. This block carries the standalone reference
// layers (UN OCHA ReliefWeb and, for GDELT-monitored theatres, GDELT Cloud
// open-source context) surfaced as background and never counted as incidents.
// The incident map is an analyst-placed block injected by the page at the
// chosen position.
export default function CountryReportVisuals({
  countryName,
  situationalReports,
  gdeltItems,
  promotedGdeltExternalIds,
}: {
  countryName: string;
  situationalReports: ReliefWebReport[] | undefined | null;
  gdeltItems?: GdeltStructuredItem[] | undefined | null;
  promotedGdeltExternalIds?: Set<string>;
}) {
  const showGdelt = isGdeltMonitoredReport(countryName);
  return (
    <>
      <SituationalContextSection reports={situationalReports} country={countryName} max={6} />
      {showGdelt && (
        <GdeltContextSection
          items={gdeltItems}
          country={countryName}
          promotedExternalIds={promotedGdeltExternalIds}
          max={12}
        />
      )}
    </>
  );
}
