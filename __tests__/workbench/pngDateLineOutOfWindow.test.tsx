/**
 * @jest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";

import PngCountryReportBody from "../../artifacts/workbench/src/components/PngCountryReportBody";
import {
  buildPngReportDataset,
  type PngSourceIncident,
} from "../../artifacts/workbench/src/lib/pngReportDataset";

// dateLine() inside PngCountryReportBody.tsx only ever rendered "Occurred X ·
// reported Y" for ANY item carrying an incidentDate, whether that date fell
// inside the reporting window (occurredEarlier) or genuinely predated it
// (occurredOutOfWindow). The two cases must read differently: an
// occurredOutOfWindow item is old news resurfacing, and spec §13 + the
// matching QC check (countryReportQc.ts) require the brief to state BOTH
// full dates so it is never mistaken for a fresh development. This guards
// that dateLine() actually distinguishes the out-of-window case in the
// rendered card, not just in the underlying dataset flag.
describe("PngCountryReportBody — dateLine occurredOutOfWindow rendering", () => {
  it("labels an out-of-window item with both full dates and an explicit window caveat", () => {
    const windowStart = new Date("2026-07-15T00:00:00.000Z");
    const oldIncident: PngSourceIncident = {
      id: "old-1",
      title: "Ambush near Ilaga leaves two dead",
      summary: "An earlier ambush resurfaced in wire coverage this week.",
      severity: "high",
      occurredAt: "2026-07-16T00:00:00.000Z",
      country: "Papua New Guinea",
      location: "Ilaga, Puncak",
      incidentDate: "2026-07-01T00:00:00.000Z", // well before windowStart
    };
    const dataset = buildPngReportDataset({
      windowIncidents: [oldIncident],
      previousWindowIncidents: [],
      thirtyDay: [oldIncident],
      ninetyDay: [oldIncident],
      baselineWatchlist: [],
      periodLabel: "past week",
      windowStart,
    });

    const html = renderToStaticMarkup(<PngCountryReportBody dataset={dataset} />);

    expect(html).toContain("outside this reporting window");
    // Full "d MMM yyyy"-style dates for BOTH the occurrence and the report,
    // matching the format countryReportQc.ts checks the narrative against.
    expect(html).toContain("01 Jul 2026");
    expect(html).toContain("16 Jul 2026");
  });

  it("keeps the short in-window phrasing for an item merely reported a day after it occurred (occurredEarlier only)", () => {
    const windowStart = new Date("2026-07-01T00:00:00.000Z");
    const recentIncident: PngSourceIncident = {
      id: "recent-1",
      title: "Clash reported in Wamena",
      summary: "A clash was reported a day after it occurred.",
      severity: "high",
      occurredAt: "2026-07-16T00:00:00.000Z",
      country: "Papua New Guinea",
      location: "Wamena",
      incidentDate: "2026-07-15T00:00:00.000Z", // inside the window, just earlier
    };
    const dataset = buildPngReportDataset({
      windowIncidents: [recentIncident],
      previousWindowIncidents: [],
      thirtyDay: [recentIncident],
      ninetyDay: [recentIncident],
      baselineWatchlist: [],
      periodLabel: "past week",
      windowStart,
    });

    const html = renderToStaticMarkup(<PngCountryReportBody dataset={dataset} />);

    expect(html).not.toContain("outside this reporting window");
    expect(html).toContain("15 Jul");
  });
});
