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

// Sibling to `reportFastFactsTiles.test.tsx` (which guards the SHARED
// `ReportPreview` topic/cargo/fuel tiles) and to `pdfPageBreakMarkers.test.tsx`
// (which renders the BESPOKE previews EMPTY and only checks structural break
// markers). Neither covers the data summary tiles the BESPOKE previews build
// themselves — `FlashpointReportPreview`, `ShippingReportPreview`,
// `ConflictReportPreview` and `PngCountryReportBody` each construct their own
// Fast Facts / stat blocks. A regression that silently rendered a hollow
// summary block in any of them (e.g. a broken dataset call yielding empty KPI
// values) would still ship undetected.
//
// This test feeds each bespoke preview a small representative incident set and
// asserts its expected summary tiles render WITH real values — labels present
// AND non-placeholder values — not just when empty. It reuses the jest
// moduleNameMapper chart/map/asset stubs (jest.config.js) so renderToStaticMarkup
// is enough; no DOM or layout engine is needed.

// renderToStaticMarkup emits no whitespace between adjacent elements. The KPI
// grid renders an accent <div>, then the label <div>, then the value <div>, so
// the value div immediately follows the label div. Capture the value rendered
// directly under a given tile label.
function tileValue(html: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = html.match(new RegExp(`>${escaped}</div><div[^>]*>([^<]*)</div>`));
  return m ? m[1] : null;
}

function hasTile(html: string, label: string): boolean {
  return html.includes(`>${label}</div>`);
}

const report = {
  id: 1,
  title: "Test Report",
  issueDate: "2026-06-15",
};

// ---------------------------------------------------------------------------
// FlashpointReportPreview — six Fast Facts tiles built from the protest /
// civil-unrest dataset. Titles carry unambiguous public-order cues so they
// survive selectFlashpointUsable into the enriched set.
// ---------------------------------------------------------------------------

describe("FlashpointReportPreview Fast Facts tiles", () => {
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

  it("emits the flashpoint Fast Facts tile labels", () => {
    for (const label of [
      "Reporting Period",
      "Records In Window",
      "Highest Severity",
      "Top Issue Type",
      "Most Affected Country",
      "Latest Incident",
    ]) {
      expect(hasTile(html, label)).toBe(true);
    }
  });

  it("fills Records In Window with the enriched count, not a placeholder", () => {
    expect(tileValue(html, "Records In Window")).toBe("3");
  });

  it("derives Highest Severity from the incident set", () => {
    expect(tileValue(html, "Highest Severity")).toBe("High");
  });

  it("derives Most Affected Country from attributed countries", () => {
    expect(tileValue(html, "Most Affected Country")).toBe("Indonesia");
  });

  it("derives Latest Incident from the newest in-window record", () => {
    expect(tileValue(html, "Latest Incident")).toBe("14 Jun 2026");
  });
});

// ---------------------------------------------------------------------------
// ShippingReportPreview — TWO summary blocks: the Maritime Intelligence
// executive KPI cards (maritimeExecCards) and the Fast Facts grid built from
// buildShippingReportDataset. Titles carry maritime-security cues so they land
// in the confirmed-incident pool.
// ---------------------------------------------------------------------------

describe("ShippingReportPreview summary tiles", () => {
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

  it("emits the Maritime Intelligence executive KPI tiles", () => {
    for (const label of [
      "Maritime Risk Level",
      "Confirmed Incidents \u00b7 7d",
      "Chokepoints Affected",
      "Business Impact",
    ]) {
      expect(hasTile(html, label)).toBe(true);
    }
  });

  it("fills the Maritime Risk Level tile with a real level, not a placeholder", () => {
    const v = tileValue(html, "Maritime Risk Level");
    expect(v).toMatch(/^L[1-5] \u00b7 /);
  });

  it("emits the shipping Fast Facts tile labels", () => {
    for (const label of [
      "Reporting Period",
      "Confirmed Incidents",
      "Highest Severity",
      "Main Affected Chokepoint",
      "Vessel Attacks / Seizures",
      "Piracy / Armed Robbery",
      "Latest Significant Incident",
    ]) {
      expect(hasTile(html, label)).toBe(true);
    }
  });

  it("counts the confirmed incidents into the Fast Facts tile", () => {
    expect(tileValue(html, "Confirmed Incidents")).toBe("2");
  });

  it("derives Highest Severity from the incident set", () => {
    expect(tileValue(html, "Highest Severity")).toBe("High");
  });
});

// ---------------------------------------------------------------------------
// ConflictReportPreview — six Fast Facts tiles built from buildConflictReport
// Dataset. Titles carry unambiguous armed-conflict actor cues so they survive
// the conflict relevance gate (mirrors conflictReportDataset.test.ts).
// ---------------------------------------------------------------------------

describe("ConflictReportPreview Fast Facts tiles", () => {
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

  it("emits the conflict Fast Facts tile labels", () => {
    for (const label of [
      "Reporting Period",
      "Total Records",
      "Highest Severity",
      "Top Event Type",
      "Most Affected Country",
      "Latest Incident",
    ]) {
      expect(hasTile(html, label)).toBe(true);
    }
  });

  it("fills Total Records with the in-window count, not a placeholder", () => {
    expect(tileValue(html, "Total Records")).toBe("3");
  });

  it("derives Highest Severity from the incident set", () => {
    expect(tileValue(html, "Highest Severity")).toBe("Extreme");
  });

  it("derives Most Affected Country from attributed countries", () => {
    expect(tileValue(html, "Most Affected Country")).toBe("Myanmar");
  });

  it("derives Latest Incident from the newest in-window record", () => {
    expect(tileValue(html, "Latest Incident")).toBe("14 Jun 2026");
  });
});

// ---------------------------------------------------------------------------
// PngCountryReportBody — dataset-driven narrative body (no Fast Facts tile
// grid; the dataset's `diagnostics` block is computed but not rendered by this
// component anywhere in the workbench). Its real stat-bearing output is the
// incident cards: a severity chip, the title, and the source meta line. Feed a
// representative dataset and assert those carry real values rather than a
// hollow / empty-fallback block.
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
  const ncdConfirmed = makeItem("n1", "Confirmed NCD incident");
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
    otherNational: [makeItem("o1", "Other national incident")],
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
    whatMattersBullets: ["Urban crime remains the dominant exposure this week."],
    keyDevelopments: [],
    escalationIndicators: ["A sustained rise in armed robberies around Port Moresby."],
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
    incidentDetailsItems: [ncdConfirmed],
    recommendedActions: [
      {
        key: "movement",
        heading: "Movement security",
        actions: ["Vary routes and timings, and confirm route status before travel."],
      },
    ],
  };
}

describe("PngCountryReportBody stat blocks", () => {
  const html = renderToStaticMarkup(
    <PngCountryReportBody dataset={makePngDataset()} />,
  );

  it("renders severity chips with real labels on incident cards", () => {
    // The Top 3 / location cards carry a SeverityChip showing the label.
    expect(html).toContain(">High</span>");
  });

  it("renders the Top 3 incident cards with their real titles", () => {
    expect(html).toContain("Armed robbery reported in Port Moresby");
  });

  it("renders the incident source on the card meta line", () => {
    expect(html).toContain("Test Source");
  });

  it("does not show the empty-location fallback when incidents exist", () => {
    expect(html).not.toContain("No fresh reporting captured this period.");
  });
});
