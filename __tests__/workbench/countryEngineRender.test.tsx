import { renderToStaticMarkup } from "react-dom/server";

import PngCountryReportBody from "../../artifacts/workbench/src/components/PngCountryReportBody";
import {
  buildPngReportDataset,
  buildWestPapuaReportDataset,
  buildJakartaReportDataset,
  type PngSourceIncident,
  type PngReportDataset,
} from "../../artifacts/workbench/src/lib/pngReportDataset";

// Proves the country reports are wired to the SHARED @workspace/country-engine
// through the single dataset builder, and that the shared renderer honours the
// engine's output (owner brief §14–23, §25, §27, §33, §36):
//   - the dataset carries the engine wiring (engineResult, engineNarrative,
//     mapPoints, gate) so preview / in-app PDF / headless PDF read one source;
//   - the rendered analytical prose is the ENGINE narrative text, not the old
//     uncontrolled generator;
//   - the map card wrapper is break-inside: avoid (§25) so it never splits;
//   - a sparse (quiet) week OMITS the analytical sections rather than padding.

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
    country: "Papua New Guinea",
    location: null,
    ...over,
  };
}

const POPULATED: PngSourceIncident[] = [
  inc({
    id: "p1",
    title: "Gunmen kill four in a highlands ambush near Mount Hagen",
    severity: "High",
    location: "Mount Hagen",
    summary: "Four people were killed when gunmen ambushed a vehicle.",
  }),
  inc({
    id: "p2",
    title: "Protesters block the Highlands Highway near Lae over pay",
    severity: "Moderate",
    location: "Lae",
    summary: "A crowd blocked the highway for several hours.",
  }),
  inc({
    id: "p3",
    title: "Armed robbery wounds a security guard at a bank in Port Moresby",
    severity: "High",
    location: "Port Moresby",
    summary: "A guard was wounded during an armed robbery.",
  }),
];

function build(incidents: PngSourceIncident[]): PngReportDataset {
  return buildPngReportDataset({
    windowIncidents: incidents,
    thirtyDay: incidents,
    ninetyDay: incidents,
    baselineWatchlist: [],
    periodLabel: PERIOD,
  });
}

function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

describe("country reports — shared engine wiring", () => {
  const ds = build(POPULATED);

  it("carries the engine wiring on the dataset (one source of truth)", () => {
    expect(ds.engineResult).toBeDefined();
    expect(ds.engineNarrative).toBeDefined();
    expect(Array.isArray(ds.mapPoints)).toBe(true);
    expect(ds.gate).toBeDefined();
    expect(typeof ds.gate.passed).toBe("boolean");
    // The included canonical events feed every surface; excluded/held never do.
    expect(ds.engineResult.included.length).toBeGreaterThan(0);
  });

  it("renders the ENGINE narrative prose in the brief", () => {
    const html = renderToStaticMarkup(<PngCountryReportBody dataset={ds} />);
    const text = textOf(html);
    // The engine BLUF text must appear verbatim in the rendered Bottom Line.
    expect(ds.engineNarrative.bluf.length).toBeGreaterThan(0);
    expect(text).toContain(ds.engineNarrative.bluf);
    // No leaked record/incident/event counts in the narrative.
    expect(text).not.toMatch(/\b\d+\s+(records?|incidents?|events?)\b/i);
  });

  it("wraps the map card with break-inside: avoid (§25)", () => {
    const html = renderToStaticMarkup(
      <PngCountryReportBody
        dataset={ds}
        mapPlacement="before-outlook"
        mapNode={<div>MAP_NODE_MARKER</div>}
      />,
    );
    expect(html).toContain("MAP_NODE_MARKER");
    // The wrapper the map is injected into carries the no-split rule.
    expect(html).toMatch(/data-map-card="true"[^>]*break-inside:\s*avoid/);
  });

  it("plots only credible, included events on the map (§23)", () => {
    for (const p of ds.mapPoints) {
      expect(["Exact site", "Town or city", "District", "Province or state"]).toContain(
        p.precision,
      );
      expect(ds.engineResult.included.some((e) => e.eventId === p.eventId)).toBe(true);
    }
    expect(ds.mapPoints.length).toBeLessThanOrEqual(ds.engineResult.included.length);
  });
});

describe("country reports — sparse week omits analytical sections (§27)", () => {
  const ds = build([]);
  const html = renderToStaticMarkup(<PngCountryReportBody dataset={ds} />);

  it("marks the narrative sparse and empties the analytical fields", () => {
    expect(ds.engineNarrative.isSparse).toBe(true);
    expect(ds.executiveSummary).toBe("");
    expect(ds.outlook).toBe("");
    expect(ds.polestarView).toBe("");
    expect(ds.topThree).toHaveLength(0);
  });

  it("omits the analytical section headings from the render", () => {
    for (const title of [
      "Current Situation",
      "Operational Impact",
      "Recommended Actions",
      "Outlook: Next Seven Days",
      "Polestar View",
    ]) {
      expect(html.indexOf(title)).toBe(-1);
    }
  });
});

// §33 DATA physical-country check must compare against the ENGINE's canonical
// country name for the slug, never the display label. "West Papua" (display)
// runs under engine country "Papua"; "Jakarta" (city display) runs under
// "Indonesia". A display-label comparison would flag every valid included
// event as foreign and fail-close the gate, blocking PDF export for those
// theatres even with valid data.
describe("country reports — gate country identity uses engine config, not display label", () => {
  it("West Papua (engineSlug: papua): valid included events do not trip the foreign-event check", () => {
    const incidents: PngSourceIncident[] = [
      inc({
        id: "wp1",
        title: "Gunmen ambush a convoy near Wamena, wounding two",
        severity: "High",
        country: "Indonesia",
        location: "Wamena",
        summary: "Two people were wounded when gunmen ambushed a convoy.",
      }),
    ];
    const ds = buildWestPapuaReportDataset({
      windowIncidents: incidents,
      thirtyDay: incidents,
      ninetyDay: incidents,
      baselineWatchlist: [],
      periodLabel: PERIOD,
    });
    expect(ds.gateReport.countryName).toBe("Papua");
    expect(
      ds.gate.failures.filter((f) => f.check === "no_foreign_included_event"),
    ).toHaveLength(0);
  });

  it("Jakarta (engineSlug: jakarta): valid included events do not trip the foreign-event check", () => {
    const incidents: PngSourceIncident[] = [
      inc({
        id: "jk1",
        title: "Armed robbery wounds a shopkeeper in Tanah Abang, Jakarta",
        severity: "Moderate",
        country: "Indonesia",
        location: "Jakarta",
        summary: "A shopkeeper was wounded during an armed robbery.",
      }),
    ];
    const ds = buildJakartaReportDataset({
      windowIncidents: incidents,
      thirtyDay: incidents,
      ninetyDay: incidents,
      baselineWatchlist: [],
      periodLabel: PERIOD,
    });
    expect(ds.gateReport.countryName).toBe("Indonesia");
    expect(
      ds.gate.failures.filter((f) => f.check === "no_foreign_included_event"),
    ).toHaveLength(0);
  });
});
