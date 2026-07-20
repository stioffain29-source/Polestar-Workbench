import type { ReliefWebReport } from "@workspace/api-client-react";
import SituationalContextSection from "@/components/SituationalContextSection";

// The shared supporting layer that sits BELOW the written country brief for every
// country report (structured and generic). Per the reworked country-report
// standard, the Severity Distribution and Incident Breakdown by Type charts are
// NOT shown by default: a chart must support the written assessment, not appear
// merely because the data exists. This block carries the standalone reference
// layer (UN OCHA ReliefWeb) surfaced as background and never counted as
// incidents. The incident map is an analyst-placed block injected by the page at
// the chosen position.
export default function CountryReportVisuals({
  countryName,
  situationalReports,
}: {
  countryName: string;
  situationalReports: ReliefWebReport[] | undefined | null;
}) {
  return (
    <SituationalContextSection reports={situationalReports} country={countryName} max={6} />
  );
}
