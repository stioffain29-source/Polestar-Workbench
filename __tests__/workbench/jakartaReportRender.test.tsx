import { renderToStaticMarkup } from "react-dom/server";

import PngCountryReportBody from "../../artifacts/workbench/src/components/PngCountryReportBody";
import { buildJakartaReportDataset } from "../../artifacts/workbench/src/lib/pngReportDataset";
import type { PngReportDataset, PngSourceIncident } from "../../artifacts/workbench/src/lib/pngReportDataset";

const PERIOD = "2–8 August 2026";
const now = new Date();
const recent = (daysAgo: number) =>
  new Date(now.getTime() - daysAgo * 86_400_000).toISOString();

const JAKARTA_WINDOW: PngSourceIncident[] = [
  {
    id: "j1",
    title: "Protesters rally near Monas and police divert traffic",
    severity: "high",
    occurredAt: recent(1),
    country: "Indonesia",
    location: "Central Jakarta",
    summary: "Police diverted traffic from the government district.",
    source: "Test Wire",
  },
  {
    id: "j2",
    title: "Flooding delays container access roads at Tanjung Priok",
    severity: "moderate",
    occurredAt: recent(2),
    country: "Indonesia",
    location: "North Jakarta",
    summary: "Flooding slowed access roads near the port.",
    source: "Test Wire",
  },
  {
    id: "j3",
    title: "Armed robbery reported at a South Jakarta hotel",
    severity: "moderate",
    occurredAt: recent(3),
    country: "Indonesia",
    location: "South Jakarta",
    summary: "Hotel guests were advised to use booked transport.",
    source: "Test Wire",
  },
];

function build(incidents: PngSourceIncident[]): PngReportDataset {
  return buildJakartaReportDataset({
    windowIncidents: incidents,
    thirtyDay: incidents,
    ninetyDay: incidents,
    baselineWatchlist: [],
    periodLabel: PERIOD,
  });
}

function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();
}

const APPROVED_SECTIONS = [
  "Bottom Line Up Front",
  "Top 3 Developments",
  "Operating Picture This Week",
  "Crime & Escalation Watch",
  "Recommended Actions",
];

const RETIRED_SECTIONS = [
  "Current Situation",
  "Operational Impact",
  "Outlook: Next Seven Days",
  "Polestar View",
  "Crime Trends and Business Impact",
  "Priority Areas This Week",
  "Staff Movement Impact",
  "Airport Transfer Impact",
  "Port and Logistics Impact",
  "Route and Timing Guidance",
];

describe("Jakarta report — consolidated weekly layout", () => {
  it("renders exactly the approved compact section order and one operating table", () => {
    const dataset = build(JAKARTA_WINDOW);
    const html = renderToStaticMarkup(<PngCountryReportBody dataset={dataset} />);

    const markupTitle = (title: string) => `>${title.replace("&", "&amp;")}<`;
    const positions = APPROVED_SECTIONS.map((title) => html.indexOf(markupTitle(title)));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    for (const retired of RETIRED_SECTIONS) expect(html).not.toContain(markupTitle(retired));

    expect(html).toContain(">Area<");
    expect(html).toContain(">Driver<");
    expect(html).toContain(">Impact<");
    expect(html).toContain(">Action<");
    expect(html).toContain("Central Jakarta government district");
    expect(html).toContain("North Jakarta &amp; port area");
    expect(html).not.toContain("Greater Jakarta commuter belt</td>");
    expect(html).toContain("Crime:");
    expect(html).toContain("Escalation triggers:");
  });

  it("uses the sparse-week note rather than rendering an empty operating table", () => {
    const html = renderToStaticMarkup(<PngCountryReportBody dataset={build([])} />);
    expect(html).toContain("No area-specific operational driver was identified this period");
    expect(html).not.toContain(">Area<");
    expect(html).toContain("No fresh crime-specific reporting this period");
  });

  it("does not leak a record, incident, or event count into the compact brief", () => {
    const html = renderToStaticMarkup(<PngCountryReportBody dataset={build(JAKARTA_WINDOW)} />);
    const text = textOf(html);
    expect(text).not.toMatch(/\b\d+\s+(records?|incidents?|events?)\b/i);
  });
});
