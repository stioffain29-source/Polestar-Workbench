import { renderToStaticMarkup } from "react-dom/server";

import JakartaReportBody from "../../artifacts/workbench/src/components/JakartaReportBody";
import { buildJakartaReportDataset } from "../../artifacts/workbench/src/lib/pngReportDataset";
import type {
  PngSourceIncident,
  PngReportDataset,
} from "../../artifacts/workbench/src/lib/pngReportDataset";

// Render-level sibling to `jakartaBrief.test.ts` (which pins the Jakarta section
// BUILDERS in isolation). This proves the integration: that
// `buildJakartaReportDataset` wires the tactical builders into the dataset's
// `jakartaTacticalBrief` field, and that the DEDICATED Jakarta renderer
// (JakartaReportBody — the same component for screen and the DOM-rasterised PDF,
// so screen == PDF) consumes them and lays the brief out as the 13-section
// TACTICAL OPERATING BRIEF.
//
// Pins the Jakarta render contract:
//  - The thirteen sections render in the fixed Jakarta order.
//  - ESCALATION INDICATORS is its OWN section (between Recommended Actions and
//    the Seven Day Outlook), not folded into the outlook.
//  - The exposure tables carry the Area / Why it matters / Action headers.
//  - The OLD generic-country headings (Top 3 Developments, Incident Details,
//    Outlook: Next Seven Days) are GONE — proving the dedicated renderer is
//    used, not the shared PngCountryReportBody.
//  - The corridor map is injected once, inside §13.
//  - NO-COUNT brief: no record/incident/event count leaks into the narrative.

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
    country: "Indonesia",
    location: null,
    ...over,
  };
}

// Jakarta window: titles chosen to categorise across distinct Jakarta themes and
// attribute to several corridor areas (central government / commercial / port /
// cross-city), so the tactical sections have live leads; one genuine High keeps
// the Top-3-equivalent flashpoints from reading all-Low.
const JAKARTA_WINDOW: PngSourceIncident[] = [
  inc({
    id: "j1",
    title: "Thousands join a street protest near the presidential palace over fuel subsidy cuts",
    severity: "High",
    location: "Central Jakarta",
  }),
  inc({
    id: "j2",
    title: "Armed robbery wounds a security guard at a bank branch",
    severity: "Moderate",
    location: "South Jakarta",
  }),
  inc({
    id: "j3",
    title: "Seasonal flooding shuts container terminal access roads at Tanjung Priok",
    severity: "Moderate",
    location: "North Jakarta",
  }),
  inc({
    id: "j4",
    title: "Severe traffic gridlock follows a closure on a main toll road",
    severity: "Moderate",
    location: "East Jakarta",
  }),
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

// Mirror react-dom's text escaping so expected strings can be matched against
// the raw markup (apostrophes → &#x27;, & → &amp;, etc.).
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// The fixed 13-section Jakarta tactical-brief order.
const SECTION_ORDER = [
  "Bottom Line Up Front",
  "Operating Picture",
  "Key Flashpoints This Week",
  "Movement and Access Impact",
  "Business District Exposure",
  "Port and Logistics Implications",
  "Airport, Hotel and Office Implications",
  "Route and Timing Guidance",
  "Recommended Actions",
  "Escalation Indicators",
  "Seven Day Outlook",
  "Polestar View",
  "Map and Area Summary",
];

// Headings that belong to the OLD shared generic-country renderer. None may
// appear in the dedicated Jakarta body.
const RETIRED_HEADINGS = [
  "Top 3 Developments",
  "Incident Details",
  "Outlook: Next Seven Days",
];

describe("Jakarta report — dataset wires the tactical brief", () => {
  const d = build(JAKARTA_WINDOW);

  it("populates the jakartaTacticalBrief the dedicated renderer reads", () => {
    expect(d.proseVariant).toBe("operating-risk");
    expect(d.jakartaTacticalBrief).toBeTruthy();
    const t = d.jakartaTacticalBrief!;
    expect(t.movementAccess.length).toBeGreaterThan(0);
    expect(t.businessDistrict.rows.length).toBeGreaterThan(0);
    expect(t.portLogistics.rows.length).toBeGreaterThan(0);
    expect(t.portLogistics.actions.length).toBeGreaterThan(0);
    expect(t.airportHotelOffice.length).toBeGreaterThan(0);
    expect(t.routeTiming.length).toBeGreaterThan(0);
    expect(t.areaSummary.length).toBeGreaterThan(0);
  });

  it("names live corridor areas in the movement section (raise-not-invent)", () => {
    const movement = d.jakartaTacticalBrief!.movementAccess.join(" ");
    expect(movement).toMatch(/Central Jakarta government district/);
  });
});

describe("JakartaReportBody — 13-section tactical brief render", () => {
  const d = build(JAKARTA_WINDOW);
  const html = renderToStaticMarkup(
    <JakartaReportBody dataset={d} mapNode={<div>JKT_MAP_SENTINEL</div>} />,
  );

  it("renders the thirteen sections in the fixed Jakarta order", () => {
    const ats = SECTION_ORDER.map((title) => html.indexOf(title));
    for (let i = 0; i < SECTION_ORDER.length; i++) {
      expect(ats[i]).toBeGreaterThanOrEqual(0);
    }
    expect(ats).toEqual([...ats].sort((a, b) => a - b));
  });

  it("renders Escalation Indicators as its own section before the Seven Day Outlook", () => {
    const escAt = html.indexOf("Escalation Indicators");
    const ra = html.indexOf("Recommended Actions");
    const outlook = html.indexOf("Seven Day Outlook");
    expect(ra).toBeGreaterThanOrEqual(0);
    expect(escAt).toBeGreaterThan(ra);
    expect(outlook).toBeGreaterThan(escAt);
  });

  it("drops every retired generic-country heading", () => {
    for (const h of RETIRED_HEADINGS) {
      expect(html.indexOf(h)).toBe(-1);
    }
  });

  it("renders the exposure tables with Area / Why it matters / Action headers", () => {
    expect(html.indexOf("Why it matters")).toBeGreaterThanOrEqual(0);
    // Business district table rows render from the override.
    const rows = d.jakartaTacticalBrief!.businessDistrict.rows;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(html.indexOf(esc(r.area))).toBeGreaterThanOrEqual(0);
    }
  });

  it("renders the Port and Logistics implications with their action bullets", () => {
    const start = html.indexOf("Port and Logistics Implications");
    const end = html.indexOf("Airport, Hotel and Office Implications");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const section = html.slice(start, end);
    const actions = d.jakartaTacticalBrief!.portLogistics.actions;
    expect(actions.length).toBeGreaterThan(0);
    for (const a of actions) {
      expect(section.indexOf(esc(a))).toBeGreaterThanOrEqual(0);
    }
  });

  it("injects the corridor map once, inside the Map and Area Summary section", () => {
    const mapAt = html.indexOf("JKT_MAP_SENTINEL");
    const sectionAt = html.indexOf("Map and Area Summary");
    expect(sectionAt).toBeGreaterThanOrEqual(0);
    expect(mapAt).toBeGreaterThan(sectionAt);
    // Rendered exactly once.
    expect(html.indexOf("JKT_MAP_SENTINEL", mapAt + 1)).toBe(-1);
  });

  it("leaks no record/incident/event count into the narrative brief", () => {
    const text = textOf(html);
    expect(text).not.toMatch(/\b\d+\s+(records?|incidents?|events?)\b/i);
    expect(text).not.toMatch(/\(\s*\d+\s*\)/);
    expect(text).not.toMatch(
      /\(\s*\d+\s+(of\s+\d+\s+)?(records?|incidents?|events?)/i,
    );
  });
});
