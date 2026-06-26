import { renderToStaticMarkup } from "react-dom/server";

import PngCountryReportBody from "../../artifacts/workbench/src/components/PngCountryReportBody";
import { buildCountryOperatingRiskDataset } from "../../artifacts/workbench/src/lib/countryOperatingRiskDataset";
import type {
  PngSourceIncident,
  PngReportDataset,
} from "../../artifacts/workbench/src/lib/pngReportDataset";

// Render-level sibling to `countryOperatingRiskDataset.test.ts` (which pins the
// DATASET the generic builder emits). That test proves the data is well-formed;
// this one proves the SHARED renderer turns it into the operating-risk brief the
// screen and the DOM-rasterised PDF actually show — same component, so screen ==
// PDF. The dataset test alone could pass while the renderer dropped a section,
// reordered the brief or leaked a count into narrative.
//
// Pins three render invariants for a generic (non-structured) country:
//  - SECTION ORDER: the seven brief sections render in the example's order,
//    closing with Reporting Confidence — Bottom Line Up Front first, Polestar
//    View last of the prose sections.
//  - "Business impact:" LABEL + real card content: Key Developments renders the
//    themed tile cards with a Business impact line and the window's localities,
//    not a hollow shell.
//  - NO-COUNT brief: the rendered narrative carries no record/incident/event
//    count annotation. (The map figure caption — a permitted chart caption — is
//    rendered by CountryReportVisuals, NOT this component, so it is correctly
//    out of scope here.)

const PERIOD = "23–29 June 2026";

function inc(
  over: Partial<PngSourceIncident> & {
    id: number | string;
    title: string;
    severity: string;
  },
): PngSourceIncident {
  return {
    occurredAt: "2026-06-27T08:00:00+00:00",
    summary: null,
    source: "Test Wire",
    sourceUrl: `https://example.test/${over.id}`,
    country: "Philippines",
    location: null,
    ...over,
  };
}

const POPULATED: PngSourceIncident[] = [
  inc({
    id: "p1",
    title: "Thousands join a street protest in Manila over fuel price rises",
    severity: "Moderate",
    location: "Manila",
  }),
  inc({
    id: "p2",
    title: "Police disperse a large demonstration and rally in Cebu",
    severity: "Low",
    location: "Cebu",
  }),
  inc({
    id: "l1",
    title: "Factory workers strike as the trade union calls industrial action in Davao",
    severity: "Moderate",
    location: "Davao",
  }),
  inc({
    id: "u1",
    title: "A power blackout hits Quezon City after a grid failure",
    severity: "High",
    location: "Quezon City",
  }),
];

function build(incidents: PngSourceIncident[]): PngReportDataset {
  return buildCountryOperatingRiskDataset(
    {
      windowIncidents: incidents,
      thirtyDay: incidents,
      ninetyDay: incidents,
      baselineWatchlist: [],
      periodLabel: PERIOD,
    },
    "Philippines",
  );
}

// renderToStaticMarkup emits attributes (inline styles, widths, hex colours)
// that carry digits, so the no-count assertion must run on TEXT only. Strip all
// tags first, then collapse whitespace.
function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// The seven brief sections, in the example's order; Reporting Confidence closes.
const SECTION_ORDER = [
  "Bottom Line Up Front",
  "What Matters This Week",
  "Key Developments",
  "Location Watchlist",
  "Priorities for Clients This Week",
  "Outlook: Next Seven Days",
  "Polestar View",
  "Reporting Confidence",
];

describe("PngCountryReportBody — operating-risk render", () => {
  const html = renderToStaticMarkup(
    <PngCountryReportBody dataset={build(POPULATED)} />,
  );

  it("renders the seven brief sections in the example's order", () => {
    const positions = SECTION_ORDER.map((title) => ({
      title,
      at: html.indexOf(title),
    }));
    for (const p of positions) {
      expect(p.at).toBeGreaterThanOrEqual(0); // every section present
    }
    const ats = positions.map((p) => p.at);
    const sorted = [...ats].sort((a, b) => a - b);
    expect(ats).toEqual(sorted); // strictly in order, none reordered
  });

  it("renders Key Developments tile cards with a Business impact line and real localities", () => {
    expect(html).toContain("Business impact:");
    const text = textOf(html);
    // Cards carry the window's actual localities — not a hollow shell.
    expect(
      ["Manila", "Cebu", "Davao", "Quezon City"].some((l) => text.includes(l)),
    ).toBe(true);
  });

  it("leaks no record/incident/event count into the narrative brief", () => {
    const text = textOf(html);
    expect(text).not.toMatch(/\b\d+\s+(records?|incidents?|events?)\b/i);
    expect(text).not.toMatch(/\(\s*\d+\s*\)/); // bare "(3)"
    expect(text).not.toMatch(
      /\(\s*\d+\s+(of\s+\d+\s+)?(records?|incidents?|events?)/i,
    ); // "(2 of 5 incidents)"
  });
});

describe("PngCountryReportBody — operating-risk render, quiet window", () => {
  const html = renderToStaticMarkup(<PngCountryReportBody dataset={build([])} />);

  it("still renders the brief sections with no fabricated developments", () => {
    for (const title of SECTION_ORDER) {
      expect(html.indexOf(title)).toBeGreaterThanOrEqual(0);
    }
    const text = textOf(html);
    expect(text).toMatch(/no fresh open-source reporting/i);
    // A quiet week must not invent counts either.
    expect(text).not.toMatch(/\b\d+\s+(records?|incidents?|events?)\b/i);
  });
});
