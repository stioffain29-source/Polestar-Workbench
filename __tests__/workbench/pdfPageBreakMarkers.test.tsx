import { renderToStaticMarkup } from "react-dom/server";

import PngCountryReportBody from "../../artifacts/workbench/src/components/PngCountryReportBody";
import FlashpointReportPreview from "../../artifacts/workbench/src/components/FlashpointReportPreview";
import ShippingReportPreview from "../../artifacts/workbench/src/components/ShippingReportPreview";
import type {
  PngReportDataset,
  PngReportItem,
} from "../../artifacts/workbench/src/lib/pngReportDataset";

// Guards the markers the DOM-rasterise PDF exporter (`exportPdf.ts`) depends on
// to find legal page breaks. `pdfPageBreaks.test.ts` proves the slicing MATH is
// correct, but that math only produces good pages if the report body components
// keep EMITTING the break-point markers `collectBreakCandidates` /
// `coverBreakOffset` read off the live DOM:
//   - `data-pdf-row`   on atomic incident cards (never split a card mid-cut)
//   - `data-pdf-flow`  on long prose            (line-level breaks inside it)
//   - `.report-section`/`section`               (section tops)
//   - `.pdf-cover-page`                         (the cover is its own page)
// If a layout silently stops emitting these, pages degrade back to mid-card
// cuts and half-empty pages and nothing else catches it — this test does.

// Count attribute / class occurrences in the rendered static markup. We render
// with react-dom/server (no DOM/layout needed — we only assert the markers are
// present, not where they land geometrically).
function countMatches(html: string, pattern: RegExp): number {
  return (html.match(pattern) ?? []).length;
}

// ---------------------------------------------------------------------------
// PngCountryReportBody — the component the original Papua/PNG page-break fix
// targeted. It is the densest emitter: atomic cards (`data-pdf-row`), long
// prose (`data-pdf-flow`) and section tops (`section.report-section`).
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
  const topItem = makeItem("t1", "Top incident one");
  const ncdConfirmed = makeItem("n1", "Confirmed NCD incident");
  const morobeItem = makeItem("m1", "Morobe incident");
  return {
    periodLabel: "Week of 09–15 Jun 2026",
    executiveSummary:
      "First executive paragraph carrying the lead.\nSecond executive paragraph with continuation prose that runs long enough to want a line-level break inside it.",
    topThree: [topItem],
    buckets: [
      {
        key: "ncd",
        label: "Port Moresby / National Capital District",
        items: [ncdConfirmed],
        hadFeatured: false,
        augmentation: {
          sparseCaveat:
            "Open source incident reporting was limited during the period. This should not be read as an absence of crime.",
          standingOperatingRisk:
            "Port Moresby carries a persistently high baseline of urban crime that holds regardless of week-to-week reporting.",
        },
        strands: {
          confirmed: [ncdConfirmed],
          police: [],
          trend: [],
        },
      },
      {
        key: "morobe",
        label: "Lae / Morobe",
        items: [morobeItem],
        hadFeatured: false,
      },
    ],
    otherNational: [makeItem("o1", "Other national incident")],
    otherNationalHadFeatured: false,
    otherBucketLabel: "Other National Security-Relevant Activity",
    emptyLocationFallback: "No fresh reporting captured this period.",
    featuredAboveNote: "Featured in Top 3 above.",
    businessImpactEmptyNote: "No fresh incident-driven business impact.",
    businessImpact: ["Movement security around settlements.", "Premises protection after hours."],
    outlook: "Expect the standing risk pattern to persist into next week.",
    diagnostics: {
      totalInWindow: 4,
      bySource: [{ source: "Test Source", count: 4 }],
      byConfidence: [{ confidence: "medium", count: 4 }],
      occurredEarlierCount: 0,
      watchlistGaps: [],
      thirtyDayCount: 10,
      ninetyDayCount: 30,
    },
    windowItems: [topItem, ncdConfirmed, morobeItem],
  };
}

describe("PngCountryReportBody page-break markers", () => {
  const html = renderToStaticMarkup(
    <PngCountryReportBody dataset={makePngDataset()} />,
  );

  it("marks every atomic incident card with data-pdf-row", () => {
    // Top 3 (1) + NCD confirmed strand (1) + Morobe (1) + Other (1) = 4 cards.
    expect(countMatches(html, /data-pdf-row="true"/g)).toBe(4);
  });

  it("marks long prose blocks with data-pdf-flow for line-level breaks", () => {
    // Executive summary + standing-operating-risk + outlook prose + the
    // business-impact list are all flow blocks.
    expect(countMatches(html, /data-pdf-flow="true"/g)).toBeGreaterThanOrEqual(3);
  });

  it("emits section tops the exporter breaks on", () => {
    expect(html).toContain('class="report-section"');
    expect(countMatches(html, /<section/g)).toBeGreaterThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// Cover marker — the exporter reads `.pdf-cover-page` to give the cover its own
// page. It lives in the preview chrome, not in PngCountryReportBody, so assert
// it on the report previews that carry a cover. Rendered with empty incidents:
// the dataset builders yield empty sections but the cover chrome still renders.
// ---------------------------------------------------------------------------

describe("report preview cover marker", () => {
  const report = {
    id: 1,
    title: "Test Report",
    topic: "flashpoint" as const,
    issueDate: "2026-06-15",
  };

  it("FlashpointReportPreview emits a .pdf-cover-page cover", () => {
    const html = renderToStaticMarkup(
      <FlashpointReportPreview report={report as never} incidents={[]} />,
    );
    expect(html).toContain('class="pdf-cover-page"');
  });

  it("ShippingReportPreview emits a .pdf-cover-page cover", () => {
    const html = renderToStaticMarkup(
      <ShippingReportPreview
        report={{ ...report, topic: "shipping" } as never}
        incidents={[]}
      />,
    );
    expect(html).toContain('class="pdf-cover-page"');
  });
});
