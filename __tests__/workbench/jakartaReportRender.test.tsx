import { renderToStaticMarkup } from "react-dom/server";

import PngCountryReportBody from "../../artifacts/workbench/src/components/PngCountryReportBody";
import { buildJakartaReportDataset } from "../../artifacts/workbench/src/lib/pngReportDataset";
import type {
  PngSourceIncident,
  PngReportDataset,
} from "../../artifacts/workbench/src/lib/pngReportDataset";

// Render-level sibling to `jakartaBrief.test.ts` (which pins the Jakarta section
// BUILDERS in isolation). This proves the integration: that
// `buildJakartaReportDataset` wires those builders into the dataset OVERRIDE
// fields, and that the SHARED renderer (PngCountryReportBody — same component
// for screen and the DOM-rasterised PDF, so screen == PDF) actually consumes
// them instead of the generic country builders. The dataset/builder tests alone
// could pass while the renderer ignored an override and silently fell back to
// the generic operating-risk prose.
//
// Pins the Jakarta render contract:
//  - INCIDENT DETAILS render from `incidentThemesOverride` (Jakarta theme
//    headings), not the generic country themes.
//  - OPERATIONAL IMPACT renders from `operationalImpactOverride`.
//  - RECOMMENDED ACTIONS (operating-risk variant) render from `businessImpact`
//    (= Jakarta recommended actions).
//  - TOP 3 cards show the analyst `developmentTitle`, not the raw headline.
//  - TOP 3 is not forced all-Low: a genuine High development surfaces.
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

// Jakarta window: titles chosen to categorise across distinct Jakarta themes
// (protest / crime / flooding / traffic) so multiple override themes form; one
// genuine High keeps the Top 3 from reading all-Low.
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
    title: "Seasonal flooding inundates main roads after heavy overnight rain",
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

const SECTION_ORDER = [
  "Bottom Line Up Front",
  "Top 3 Developments",
  "Incident Details",
  "Current Situation",
  "Operational Impact",
  "Recommended Actions",
  "Outlook: Next Seven Days",
  "Polestar View",
];

const SEV_LOW_RANK = 2;
const SEV_HIGH_RANK = 4;

describe("Jakarta report — dataset wires the analyst-brief overrides", () => {
  const d = build(JAKARTA_WINDOW);

  it("populates the Jakarta override fields the renderer reads", () => {
    expect(d.proseVariant).toBe("operating-risk");
    expect(d.incidentThemesOverride?.length ?? 0).toBeGreaterThan(0);
    expect(d.operationalImpactOverride?.length ?? 0).toBeGreaterThan(0);
    expect(d.businessImpact.length).toBeGreaterThan(0); // recommended actions
    const devTitles = d.topThree
      .map((t) => t.developmentTitle)
      .filter((x): x is string => Boolean(x));
    expect(devTitles.length).toBeGreaterThan(0);
  });

  it("surfaces a genuine High development rather than forcing Top 3 all-Low", () => {
    expect(d.topThree.length).toBeGreaterThan(0);
    expect(d.topThree.every((t) => t.severityRank <= SEV_LOW_RANK)).toBe(false);
    expect(d.topThree.some((t) => t.severityRank >= SEV_HIGH_RANK)).toBe(true);
  });
});

describe("PngCountryReportBody — Jakarta brief render", () => {
  const d = build(JAKARTA_WINDOW);
  const html = renderToStaticMarkup(<PngCountryReportBody dataset={d} />);

  it("renders the brief sections in the fixed order", () => {
    const ats = SECTION_ORDER.map((title) => html.indexOf(title));
    for (const at of ats) expect(at).toBeGreaterThanOrEqual(0);
    expect(ats).toEqual([...ats].sort((a, b) => a - b));
  });

  it("renders Incident Details from the Jakarta theme override", () => {
    const start = html.indexOf("Incident Details");
    const end = html.indexOf("Current Situation");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const section = html.slice(start, end);
    const headings = (d.incidentThemesOverride ?? []).map((t) => t.heading);
    expect(headings.length).toBeGreaterThan(0);
    for (const h of headings) {
      expect(section.indexOf(esc(h))).toBeGreaterThanOrEqual(0);
    }
  });

  it("renders Operational Impact from the Jakarta override bullets", () => {
    const start = html.indexOf("Operational Impact");
    const end = html.indexOf("Recommended Actions");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const section = html.slice(start, end);
    const bullets = d.operationalImpactOverride ?? [];
    expect(bullets.length).toBeGreaterThan(0);
    for (const b of bullets) {
      expect(section.indexOf(esc(b))).toBeGreaterThanOrEqual(0);
    }
  });

  it("renders Recommended Actions from the Jakarta recommended-actions list", () => {
    const start = html.indexOf("Recommended Actions");
    const end = html.indexOf("Outlook: Next Seven Days");
    const section = html.slice(start, end);
    expect(d.businessImpact.length).toBeGreaterThan(0);
    for (const a of d.businessImpact) {
      expect(section.indexOf(esc(a))).toBeGreaterThanOrEqual(0);
    }
  });

  it("shows the analyst development titles on the Top 3 cards", () => {
    const start = html.indexOf("Top 3 Developments");
    const end = html.indexOf("Incident Details");
    const section = html.slice(start, end);
    const devTitles = d.topThree
      .slice(0, 3)
      .map((t) => t.developmentTitle)
      .filter((x): x is string => Boolean(x));
    expect(devTitles.length).toBeGreaterThan(0);
    for (const t of devTitles) {
      expect(section.indexOf(esc(t))).toBeGreaterThanOrEqual(0);
    }
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
