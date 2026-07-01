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
//  - ESCALATION TRIGGERS is its OWN section, BEFORE Recommended Actions (the
//    decision tool comes before the role-based actions that act on it).
//  - The Priority Areas table is data-driven: an area that carried live
//    reporting is flagged in-cell ("(active this week)") — raise-not-invent.
//  - The exposure tables carry their column headers (Area / Why it matters /
//    Action for the venue table; Operational relevance / Required action for the
//    port table).
//  - The OLD generic-country headings (Top 3 Developments, Incident Details,
//    Outlook: Next Seven Days) and the SUPERSEDED first-draft Jakarta headings
//    (Key Flashpoints This Week, Movement and Access Impact, Map and Area
//    Summary) are GONE — proving the dedicated tactical renderer is used.
//  - The corridor map is injected once, inside §13 (Operational Map).
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
// the priority table from reading all-standing.
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
  "Tactical Operating Picture",
  "Priority Areas This Week",
  "Staff Movement Impact",
  "Airport Transfer Impact",
  "Port and Logistics Impact",
  "Office, Hotel and Meeting Venue Exposure",
  "Route and Timing Guidance",
  "Escalation Triggers",
  "Recommended Actions",
  "Seven Day Outlook",
  "Polestar View",
  "Operational Map",
];

// Headings that must NOT appear: the OLD shared generic-country renderer's
// headings, plus the SUPERSEDED first-draft Jakarta section titles. None may
// appear in the dedicated tactical body.
const RETIRED_HEADINGS = [
  "Top 3 Developments",
  "Incident Details",
  "Outlook: Next Seven Days",
  "Key Flashpoints This Week",
  "Movement and Access Impact",
  "Business District Exposure",
  "Map and Area Summary",
];

describe("Jakarta report — dataset wires the tactical brief", () => {
  const d = build(JAKARTA_WINDOW);

  it("populates the jakartaTacticalBrief the dedicated renderer reads", () => {
    expect(d.proseVariant).toBe("operating-risk");
    expect(d.jakartaTacticalBrief).toBeTruthy();
    const t = d.jakartaTacticalBrief!;
    expect(t.priorityAreas.length).toBeGreaterThan(0);
    expect(t.staffMovement.officeAccess.length).toBeGreaterThan(0);
    expect(t.staffMovement.airportTransfer.length).toBeGreaterThan(0);
    expect(t.airportTransfer.length).toBeGreaterThan(0);
    expect(t.portLogistics.rows.length).toBeGreaterThan(0);
    expect(t.portLogistics.actions.length).toBeGreaterThan(0);
    expect(t.officeHotelVenue.rows.length).toBeGreaterThan(0);
    expect(t.routeTiming.length).toBeGreaterThan(0);
    expect(t.roleActions.length).toBeGreaterThan(0);
    expect(t.areaSummary.length).toBeGreaterThan(0);
  });

  it("raises live corridor areas in the priority table (raise-not-invent)", () => {
    const elevated = d.jakartaTacticalBrief!.priorityAreas.filter(
      (r) => r.elevated,
    );
    expect(elevated.length).toBeGreaterThan(0);
    expect(d.jakartaTacticalBrief!.areaSummary).toMatch(
      /^Reporting this period was attributed to/,
    );
  });

  it("falls back to the standing profile when no area carried reporting", () => {
    const empty = build([]);
    const t = empty.jakartaTacticalBrief!;
    expect(t.priorityAreas.some((r) => r.elevated)).toBe(false);
    expect(t.areaSummary).toMatch(/^No area carried fresh reporting this period/);
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

  it("leads the crime section with the reporting-period read before the standing baseline", () => {
    const ct = d.jakartaTacticalBrief!.crimeTrends;
    const start = html.indexOf("Crime Trends and Business Impact");
    expect(start).toBeGreaterThanOrEqual(0);
    const pReported = html.indexOf(esc(ct.reportedThisPeriod), start);
    const pStanding = html.indexOf(esc(ct.standingPattern), start);
    const pTrend = html.indexOf(esc(ct.trendRead), start);
    expect(pReported).toBeGreaterThanOrEqual(0);
    expect(pStanding).toBeGreaterThan(pReported);
    expect(pTrend).toBeGreaterThan(pStanding);
  });

  it("renders Escalation Triggers as its own section before Recommended Actions", () => {
    const escAt = html.indexOf("Escalation Triggers");
    const ra = html.indexOf("Recommended Actions");
    const outlook = html.indexOf("Seven Day Outlook");
    expect(escAt).toBeGreaterThanOrEqual(0);
    expect(ra).toBeGreaterThan(escAt);
    expect(outlook).toBeGreaterThan(ra);
  });

  it("drops every retired generic-country and first-draft Jakarta heading", () => {
    for (const h of RETIRED_HEADINGS) {
      expect(html.indexOf(h)).toBe(-1);
    }
  });

  it("flags an active corridor in the priority table cell", () => {
    expect(html.indexOf("(active this week)")).toBeGreaterThanOrEqual(0);
  });

  it("renders the venue exposure table with Area / Why it matters / Action headers", () => {
    expect(html.indexOf("Why it matters")).toBeGreaterThanOrEqual(0);
    const rows = d.jakartaTacticalBrief!.officeHotelVenue.rows;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(html.indexOf(esc(r.area))).toBeGreaterThanOrEqual(0);
    }
  });

  it("renders the 4-column Port and Logistics table with its action bullets", () => {
    expect(html.indexOf("Operational relevance")).toBeGreaterThanOrEqual(0);
    expect(html.indexOf("Required action")).toBeGreaterThanOrEqual(0);
    const start = html.indexOf("Port and Logistics Impact");
    const end = html.indexOf("Office, Hotel and Meeting Venue Exposure");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const section = html.slice(start, end);
    expect(section.indexOf("Port Actions")).toBeGreaterThanOrEqual(0);
    const actions = d.jakartaTacticalBrief!.portLogistics.actions;
    expect(actions.length).toBeGreaterThan(0);
    for (const a of actions) {
      expect(section.indexOf(esc(a))).toBeGreaterThanOrEqual(0);
    }
  });

  it("breaks Staff Movement out by movement type", () => {
    const start = html.indexOf("Staff Movement Impact");
    const end = html.indexOf("Airport Transfer Impact");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const section = html.slice(start, end);
    for (const label of [
      "Office access",
      "Hotel to office movement",
      "Airport transfer",
      "Client meeting movement",
      "Staff commute",
      "Driver route planning",
      "After hours movement",
    ]) {
      expect(section.indexOf(label)).toBeGreaterThanOrEqual(0);
    }
  });

  it("injects the corridor map once, inside the Operational Map section", () => {
    const mapAt = html.indexOf("JKT_MAP_SENTINEL");
    const sectionAt = html.indexOf("Operational Map");
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
