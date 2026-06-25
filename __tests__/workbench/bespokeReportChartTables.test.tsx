import { renderToStaticMarkup } from "react-dom/server";

import FlashpointReportPreview from "../../artifacts/workbench/src/components/FlashpointReportPreview";
import ShippingReportPreview from "../../artifacts/workbench/src/components/ShippingReportPreview";
import ConflictReportPreview from "../../artifacts/workbench/src/components/ConflictReportPreview";
import PngCountryReportBody from "../../artifacts/workbench/src/components/PngCountryReportBody";
import type { FlashpointReportIncident } from "../../artifacts/workbench/src/lib/flashpointReportDataset";
import type { ShippingReportIncident } from "../../artifacts/workbench/src/lib/shippingReportDataset";
import type { ConflictReportIncident } from "../../artifacts/workbench/src/lib/conflictReportDataset";
import type {
  PngReportDataset,
  PngReportItem,
} from "../../artifacts/workbench/src/lib/pngReportDataset";

// Sibling to `bespokeReportFastFactsTiles.test.tsx` (which guards the Fast Facts
// / stat-tile CONTENT of the four bespoke previews) and to
// `pdfPageBreakMarkers.test.tsx` (which renders the bespoke previews EMPTY and
// only checks structural break markers). Neither asserts the data-driven CHART
// and TABLE BODIES the previews build — `FlashpointReportPreview`,
// `ShippingReportPreview`, `ConflictReportPreview` and `PngCountryReportBody`
// each render country bar charts, chokepoint tables, vessel/piracy tables,
// incident tables and conflict theatre cards from their datasets. A regression
// that silently produced empty rows or dropped row labels after a dataset
// change (e.g. a broken selector yielding `[]`) would still pass the tile test
// and ship a report with hollow charts/tables.
//
// This test feeds each bespoke preview a small representative incident set and
// asserts the chart/table BODIES carry real rows — bar labels, table cell text,
// theatre card headings — not just the section headings. It reuses the jest
// moduleNameMapper chart/map/asset stubs (jest.config.js) so
// renderToStaticMarkup is enough; no DOM or layout engine is needed.

// ---------------------------------------------------------------------------
// renderToStaticMarkup emits no whitespace between adjacent elements and turns
// inline styles into `style="prop:value;..."`. The `HorizontalBarChart` shared
// by Flashpoint and Shipping renders, per row, a fixed-width bold label div
// (`width:<labelW>px;flex-shrink:0;font-weight:700`) carrying the label, then a
// track div, then a right-aligned value div (`width:34px;text-align:right;...`).
// Capture the label text rendered in the bar label cells so we can assert the
// chart body, not just a label that also appears in prose elsewhere.
// ---------------------------------------------------------------------------
function barLabels(html: string, labelW: number): string[] {
  const re = new RegExp(
    `<div style="width:${labelW}px;flex-shrink:0;font-weight:700">([^<]+)</div>`,
    "g",
  );
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out;
}

// The bar VALUE cell follows the track. Match the value rendered for a given
// bar label so we can assert the count, not only that the label appears.
function barValueAfter(html: string, labelW: number, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = html.match(
    new RegExp(
      `<div style="width:${labelW}px;flex-shrink:0;font-weight:700">${escaped}</div>.*?<div style="width:34px;text-align:right[^"]*">([0-9]+)</div>`,
    ),
  );
  return m ? m[1] : null;
}

const report = {
  id: 1,
  title: "Test Report",
  issueDate: "2026-06-15",
};

// ---------------------------------------------------------------------------
// FlashpointReportPreview — "Records by Country" HorizontalBarChart (labelW
// 180) plus the activism / civil-unrest IncidentTables and the Related
// Incidents table. Same incident set as the tiles sibling test so the rows
// survive selectFlashpointUsable.
// ---------------------------------------------------------------------------

describe("FlashpointReportPreview charts & tables", () => {
  const incidents: FlashpointReportIncident[] = [
    {
      id: "f1",
      topic: "flashpoint",
      title: "Thousands join protest rally against fuel prices in Jakarta",
      severity: "high",
      occurredAt: "2026-06-14T08:00:00+00:00",
      country: "Indonesia",
      summary: "A large protest rally gathered in the capital over fuel prices.",
      source: "Test Wire",
      sourceUrl: "https://example.com/f1",
    },
    {
      id: "f2",
      topic: "flashpoint",
      title: "Workers stage strike and street demonstration in Manila",
      severity: "moderate",
      occurredAt: "2026-06-12T08:00:00+00:00",
      country: "Philippines",
      summary: "Union workers held a demonstration and strike action.",
      source: "Test Wire",
      sourceUrl: "https://example.com/f2",
    },
    {
      id: "f3",
      topic: "flashpoint",
      title: "Riot police disperse protesters during anti-government demonstration in Jakarta",
      severity: "low",
      occurredAt: "2026-06-10T08:00:00+00:00",
      country: "Indonesia",
      summary: "Police dispersed a crowd of demonstrators.",
      source: "Test Wire",
      sourceUrl: "https://example.com/f3",
    },
  ];

  const html = renderToStaticMarkup(
    <FlashpointReportPreview
      report={{ ...report, topic: "flashpoint" } as never}
      incidents={incidents}
    />,
  );

  it("renders the Records by Country bar chart with real country labels", () => {
    const labels = barLabels(html, 180);
    expect(labels).toContain("Indonesia");
    expect(labels).toContain("Philippines");
  });

  it("totals the country bar values from the attributed incidents", () => {
    expect(barValueAfter(html, 180, "Indonesia")).toBe("2");
    expect(barValueAfter(html, 180, "Philippines")).toBe("1");
  });

  it("renders an incident table body carrying a real incident title", () => {
    expect(html).toContain(
      "Thousands join protest rally against fuel prices in Jakarta",
    );
  });

  it("does not fall back to the empty-bar-chart placeholder", () => {
    expect(html).not.toContain("No countries with reported activity this week.");
  });
});

// ---------------------------------------------------------------------------
// ShippingReportPreview — ChokepointTable (rows keyed on detected chokepoint
// name), vessel/piracy IncidentTables, and region/country HorizontalBarCharts
// (labelW 180). Titles carry maritime-security cues and named chokepoints
// (Gulf of Aden, Singapore Strait) so the dataset detects them.
// ---------------------------------------------------------------------------

describe("ShippingReportPreview charts & tables", () => {
  const incidents: ShippingReportIncident[] = [
    {
      id: "s1",
      topic: "shipping",
      title: "Tanker attacked by armed skiffs in the Gulf of Aden",
      severity: "high",
      occurredAt: "2026-06-14T08:00:00+00:00",
      country: "Yemen",
      summary: "Armed men in skiffs attacked a tanker underway.",
      source: "Test Wire",
      sourceUrl: "https://example.com/s1",
    },
    {
      id: "s2",
      topic: "shipping",
      title: "Cargo vessel boarded and crew robbed in the Singapore Strait",
      severity: "moderate",
      occurredAt: "2026-06-12T08:00:00+00:00",
      country: "Singapore",
      summary: "Robbers boarded a bulk carrier and stole stores.",
      source: "Test Wire",
      sourceUrl: "https://example.com/s2",
    },
  ];

  const html = renderToStaticMarkup(
    <ShippingReportPreview
      report={{ ...report, topic: "shipping" } as never}
      incidents={incidents}
    />,
  );

  it("renders chokepoint table rows with detected chokepoint names", () => {
    expect(html).toContain("Gulf of Aden");
    expect(html).toContain("Singapore Strait");
  });

  it("renders vessel/piracy table bodies carrying real incident titles", () => {
    expect(html).toContain("Tanker attacked by armed skiffs in the Gulf of Aden");
    expect(html).toContain(
      "Cargo vessel boarded and crew robbed in the Singapore Strait",
    );
  });

  it("renders the region/country bar charts with real labels", () => {
    // Both the regional and country HorizontalBarCharts use labelW 180. The
    // region pass classifies the Gulf of Aden / Singapore Strait incidents and
    // the country pass surfaces the attributed country.
    const labels = barLabels(html, 180);
    expect(labels.length).toBeGreaterThan(0);
    expect(labels).toContain("Singapore");
  });

  it("does not fall back to the empty chokepoint/bar placeholders", () => {
    expect(html).not.toContain("No identified incident countries reported this week.");
  });
});

// ---------------------------------------------------------------------------
// ConflictReportPreview — "Top Activity Areas" theatre cards (AreaBlock h3 =
// area.theatre) and the Related Incidents table. Titles carry armed-conflict
// actor cues so they survive the conflict relevance gate (mirrors
// conflictReportDataset.test.ts).
// ---------------------------------------------------------------------------

describe("ConflictReportPreview charts & tables", () => {
  const incidents: ConflictReportIncident[] = [
    {
      id: "c1",
      topic: "conflict",
      title: "Armed clashes between troops and militants left five soldiers killed",
      severity: "extreme",
      occurredAt: "2026-06-14T08:00:00+00:00",
      country: "Myanmar",
      summary: null,
      source: "Test Wire",
      sourceUrl: "https://example.com/c1",
    },
    {
      id: "c2",
      topic: "conflict",
      title: "Armed clashes between troops and militants near the border outpost",
      severity: "high",
      occurredAt: "2026-06-12T08:00:00+00:00",
      country: "Myanmar",
      summary: null,
      source: "Test Wire",
      sourceUrl: "https://example.com/c2",
    },
    {
      id: "c3",
      topic: "conflict",
      title: "Insurgents ambush an army convoy in a roadside attack",
      severity: "moderate",
      occurredAt: "2026-06-10T08:00:00+00:00",
      country: "Philippines",
      summary: null,
      source: "Test Wire",
      sourceUrl: "https://example.com/c3",
    },
  ];

  const html = renderToStaticMarkup(
    <ConflictReportPreview
      report={{ ...report, topic: "conflict" } as never}
      incidents={incidents}
    />,
  );

  it("renders a Top Activity Area theatre card heading from the dataset", () => {
    expect(html).toContain("Myanmar");
    // The theatre name renders inside an uppercased h3 card heading, not only
    // in prose; assert it appears as a card heading element.
    expect(html).toMatch(/<h3[^>]*>Myanmar<\/h3>/);
  });

  it("renders the Related Incidents table body with a real incident title", () => {
    expect(html).toContain(
      "Armed clashes between troops and militants left five soldiers killed",
    );
  });

  it("does not fall back to the empty 'no theatre' placeholder", () => {
    expect(html).not.toContain("No theatre carried notable armed activity");
  });
});

// ---------------------------------------------------------------------------
// PngCountryReportBody — dataset-driven location cards (ItemCard renders the
// incident title + metadata line) and the diagnostics source/confidence lists.
// Reuse the representative dataset shape from the tiles sibling test.
// ---------------------------------------------------------------------------

function makeItem(id: string, title: string): PngReportItem {
  return {
    id,
    title,
    summary: `${title} summary text.`,
    province: "National Capital District",
    category: "Other security",
    businessImpact: "Security-relevant development; monitor for follow-on.",
    severity: "high",
    severityLabel: "High",
    severityRank: 4,
    reportedDate: new Date("2026-06-15T00:00:00.000Z"),
    incidentDate: null,
    occurredEarlier: false,
    source: "Test Source",
    url: "https://example.com/a",
    confidence: "medium",
  };
}

function makePngDataset(): PngReportDataset {
  const topItem = makeItem("t1", "Armed robbery reported in Port Moresby");
  const ncdConfirmed = makeItem("n1", "Confirmed NCD incident reported overnight");
  return {
    periodLabel: "Week of 09–15 Jun 2026",
    executiveSummary: "Lead executive paragraph carrying the week's bottom line.",
    topThree: [topItem],
    buckets: [
      {
        key: "ncd",
        label: "Port Moresby / National Capital District",
        items: [ncdConfirmed],
        hadFeatured: false,
        augmentation: {
          sparseCaveat:
            "Open source incident reporting was limited during the period.",
          standingOperatingRisk:
            "Port Moresby carries a persistently high baseline of urban crime.",
        },
        strands: {
          confirmed: [ncdConfirmed],
          police: [],
          trend: [],
        },
      },
    ],
    otherNational: [makeItem("o1", "Other national incident reported inland")],
    otherNationalHadFeatured: false,
    otherBucketLabel: "Other National Security-Relevant Activity",
    emptyLocationFallback: "No fresh reporting captured this period.",
    featuredAboveNote: "Featured in Top 3 above.",
    businessImpactEmptyNote: "No fresh incident-driven business impact.",
    businessImpact: ["Movement security around settlements."],
    outlook: "Expect the standing risk pattern to persist into next week.",
    reportingConfidence: {
      level: "Moderate",
      rationale: "Confirmed reporting from multiple sources during the period.",
    },
    bluf: "Bottom line up front for the period.",
    whatChanged: "What changed since the previous reporting period.",
    polestarView: "Polestar's standing assessment for the period.",
    locationWatchlist: [],
    diagnostics: {
      totalInWindow: 3,
      bySource: [{ source: "Test Source", count: 3 }],
      byConfidence: [{ confidence: "medium", count: 3 }],
      occurredEarlierCount: 0,
      watchlistGaps: [],
      thirtyDayCount: 10,
      ninetyDayCount: 30,
    },
    windowItems: [topItem, ncdConfirmed],
  };
}

describe("PngCountryReportBody charts & tables", () => {
  const html = renderToStaticMarkup(
    <PngCountryReportBody dataset={makePngDataset()} />,
  );

  it("renders the Top 3 location card body with a real incident title", () => {
    expect(html).toContain("Armed robbery reported in Port Moresby");
  });

  it("renders a location bucket card heading and its incident body", () => {
    expect(html).toContain("Port Moresby / National Capital District");
    expect(html).toContain("Confirmed NCD incident reported overnight");
  });

  it("renders the card metadata line (category · province · source)", () => {
    expect(html).toContain("National Capital District");
    expect(html).toContain("Test Source");
  });

  it("does not fall back to the empty-location placeholder when items exist", () => {
    expect(html).not.toContain("No fresh reporting captured this period.");
  });
});
