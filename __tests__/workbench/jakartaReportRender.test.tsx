import { renderToStaticMarkup } from "react-dom/server";

import PngCountryReportBody from "../../artifacts/workbench/src/components/PngCountryReportBody";
import { buildJakartaReportDataset } from "../../artifacts/workbench/src/lib/pngReportDataset";
import type {
  PngSourceIncident,
  PngReportDataset,
} from "../../artifacts/workbench/src/lib/pngReportDataset";

// Render-level sibling to `jakartaBrief.test.ts` (which pins the Jakarta section
// BUILDERS in isolation). This proves the integration: that
// `buildJakartaReportDataset` wires the tactical builders into the dataset's
// `jakartaTacticalBrief` field, and that the UNIFIED canonical renderer
// (PngCountryReportBody — the same component every theatre uses, for screen and
// the DOM-rasterised PDF, so screen == PDF) FOLDS those tactical tables inside
// the eight canonical sections without losing any analytical content.
//
// Pins the unified Jakarta render contract:
//  - The eight CANONICAL sections render in the fixed order (Bottom Line Up
//    Front → Polestar View). Jakarta uses the same top-level sections as PNG /
//    West Papua / Indonesia; mapping is the only per-theatre variation and the
//    map slot is injected by the PAGE (mapNode), not this body.
//  - Jakarta's tactical evidence tables are FOLDED in as strand labels:
//      · Crime Trends + Priority Areas → inside Incident Details
//      · Staff Movement / Airport / Port (+ actions) / Venue → Operational Impact
//      · Route and Timing Guidance → Recommended Actions
//      · Escalation Indicators → Outlook: Next Seven Days
//  - The Priority Areas table is data-driven: an area that carried live
//    reporting is flagged in-cell ("(active this week)") — raise-not-invent.
//  - The exposure tables keep their column headers.
//  - The OLD dedicated-Jakarta section headings (Tactical Operating Picture,
//    Seven Day Outlook, Operational Map, Key Flashpoints This Week, …) are GONE
//    as top-level sections — proving the unified canonical body is used.
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

// The fixed seven canonical sections, shared by every theatre. "Incident
// Details" was merged into "Current Situation" (owner ruling, 28 Jul 2026):
// one prose narrative, no per-incident card lists.
const SECTION_ORDER = [
  "Bottom Line Up Front",
  "Top 3 Developments",
  "Current Situation",
  "Operational Impact",
  "Recommended Actions",
  "Outlook: Next Seven Days",
  "Polestar View",
];

// Top-level headings that must NOT appear: the OLD dedicated-Jakarta renderer's
// section titles and superseded first-draft headings. Their CONTENT survives as
// strand labels inside the canonical sections, but none may open a section.
const RETIRED_HEADINGS = [
  "Tactical Operating Picture",
  "Seven Day Outlook",
  "Escalation Triggers",
  "Key Flashpoints This Week",
  "Movement and Access Impact",
  "Business District Exposure",
  "Map and Area Summary",
];

describe("Jakarta report — dataset wires the tactical brief", () => {
  const d = build(JAKARTA_WINDOW);

  it("populates the jakartaTacticalBrief the unified renderer folds in", () => {
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

describe("PngCountryReportBody — Jakarta folded into canonical sections", () => {
  const d = build(JAKARTA_WINDOW);
  const html = renderToStaticMarkup(<PngCountryReportBody dataset={d} />);

  it("renders the seven canonical sections in the fixed order", () => {
    const ats = SECTION_ORDER.map((title) => html.indexOf(`>${title}<`));
    for (let i = 0; i < SECTION_ORDER.length; i++) {
      expect(ats[i]).toBeGreaterThanOrEqual(0);
    }
    expect(ats).toEqual([...ats].sort((a, b) => a - b));
  });

  it("drops every retired dedicated-Jakarta top-level section heading", () => {
    for (const h of RETIRED_HEADINGS) {
      expect(html.indexOf(`>${h}<`)).toBe(-1);
    }
  });

  it("folds Crime Trends and Priority Areas inside Current Situation", () => {
    const start = html.indexOf(">Current Situation<");
    const end = html.indexOf(">Operational Impact<");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const section = html.slice(start, end);
    expect(section.indexOf("Crime Trends and Business Impact")).toBeGreaterThanOrEqual(0);
    expect(section.indexOf("Priority Areas This Week")).toBeGreaterThanOrEqual(0);
    // Crime exposure table keyed to named operating contexts.
    expect(section.indexOf("Operating context")).toBeGreaterThanOrEqual(0);
    expect(section.indexOf("Crime exposure")).toBeGreaterThanOrEqual(0);
    const rows = d.jakartaTacticalBrief!.crimeTrends.businessImpact;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(section.indexOf(esc(r.context))).toBeGreaterThanOrEqual(0);
      expect(section.indexOf(esc(r.exposure))).toBeGreaterThanOrEqual(0);
    }
    // Active corridor flagged in-cell.
    expect(section.indexOf("(active this week)")).toBeGreaterThanOrEqual(0);
  });

  it("folds Staff Movement, Airport, Port and Venue inside Operational Impact", () => {
    const start = html.indexOf(">Operational Impact<");
    const end = html.indexOf(">Recommended Actions<");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const section = html.slice(start, end);
    for (const label of [
      "Staff Movement Impact",
      "Airport Transfer Impact",
      "Port and Logistics Impact",
      "Port Actions",
      "Office, Hotel and Meeting Venue Exposure",
    ]) {
      expect(section.indexOf(label)).toBeGreaterThanOrEqual(0);
    }
    // Staff movement broken out by movement type.
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
    // Port table headers + action bullets.
    expect(section.indexOf("Operational relevance")).toBeGreaterThanOrEqual(0);
    expect(section.indexOf("Required action")).toBeGreaterThanOrEqual(0);
    const actions = d.jakartaTacticalBrief!.portLogistics.actions;
    expect(actions.length).toBeGreaterThan(0);
    for (const a of actions) {
      expect(section.indexOf(esc(a))).toBeGreaterThanOrEqual(0);
    }
    // Venue exposure table headers + rows.
    expect(section.indexOf("Why it matters")).toBeGreaterThanOrEqual(0);
    const venueRows = d.jakartaTacticalBrief!.officeHotelVenue.rows;
    expect(venueRows.length).toBeGreaterThan(0);
    for (const r of venueRows) {
      expect(section.indexOf(esc(r.area))).toBeGreaterThanOrEqual(0);
    }
  });

  it("folds Route and Timing Guidance inside Recommended Actions", () => {
    const start = html.indexOf(">Recommended Actions<");
    const end = html.indexOf(">Outlook: Next Seven Days<");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const section = html.slice(start, end);
    expect(section.indexOf("Route and Timing Guidance")).toBeGreaterThanOrEqual(0);
  });

  it("folds Escalation Indicators inside Outlook: Next Seven Days", () => {
    const start = html.indexOf(">Outlook: Next Seven Days<");
    const end = html.indexOf(">Polestar View<");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const section = html.slice(start, end);
    expect(section.indexOf("Escalation Indicators")).toBeGreaterThanOrEqual(0);
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
