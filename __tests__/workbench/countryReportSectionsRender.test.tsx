/**
 * @jest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";

import PngCountryReportBody from "../../artifacts/workbench/src/components/PngCountryReportBody";
import {
  buildIndonesiaReportDataset,
  buildPngReportDataset,
  buildWestPapuaReportDataset,
  buildJakartaReportDataset,
  type PngSourceIncident,
  type PngReportDataset,
} from "../../artifacts/workbench/src/lib/pngReportDataset";
import {
  computeCountryFastFacts,
  filterCountryReportIncidents,
  type CountryFastFactsIncident,
} from "../../artifacts/workbench/src/lib/countryFastFacts";
import {
  incidentMatchesCountry,
  acceptedCountryTokens,
  countryFetchTokens,
} from "../../artifacts/workbench/src/lib/countryMatch";

// The country-brief Operational Map once shipped broken because a shared pure
// helper (operationalPinchPoints.ts) renamed/removed exports while the consumer
// kept calling the old names — nothing failed until a full typecheck ran.
// countryReportMapRender.test.tsx guards THAT consumer. This suite extends the
// same producer/consumer drift guard to the OTHER major country-brief consumers:
//   - the structured brief prose/section builders (buildStructuredReportDataset
//     via the four theatre wrappers) + their render component PngCountryReportBody
//   - the generic CountryReport page helpers (computeCountryFastFacts,
//     filterCountryReportIncidents) and the countryMatch predicates
//
// A rename/removal of any of these shared exports breaks this test at compile
// time (the pinned API-shape block) or at render (renderToStaticMarkup runs the
// section builders), before it can silently reach a broken runtime brief.

const incident = (over: Partial<PngSourceIncident>): PngSourceIncident => ({
  id: "i1",
  title: "Protesters block the main road in Jakarta, halting traffic",
  summary: "A demonstration disrupted movement through the corridor.",
  severity: "moderate",
  occurredAt: "2026-06-14T00:00:00.000Z",
  country: "Indonesia",
  location: "Jakarta",
  ...over,
});

const buildArgs = (rows: PngSourceIncident[]) => ({
  windowIncidents: rows,
  previousWindowIncidents: [],
  thirtyDay: rows,
  ninetyDay: rows,
  baselineWatchlist: [],
  periodLabel: "past week",
});

const renderBrief = (dataset: PngReportDataset) =>
  renderToStaticMarkup(<PngCountryReportBody dataset={dataset} />);

describe("structured brief render (producer/consumer drift guard)", () => {
  const rows = [
    incident({}),
    incident({
      id: "i2",
      title: "Armed robbery reported at a store in Medan",
      severity: "high",
      location: "Medan",
    }),
  ];

  it("builds + renders the Indonesia structured brief without throwing", () => {
    const html = renderBrief(buildIndonesiaReportDataset(buildArgs(rows)));
    expect(html).toContain("Bottom Line Up Front");
    expect(html).toContain("Top 3 Developments");
  });

  it("builds + renders the PNG structured brief without throwing", () => {
    const html = renderBrief(
      buildPngReportDataset(
        buildArgs([incident({ country: "Papua New Guinea", location: "Port Moresby" })]),
      ),
    );
    expect(html).toContain("Bottom Line Up Front");
  });

  it("builds + renders the West Papua structured brief without throwing", () => {
    const html = renderBrief(
      buildWestPapuaReportDataset(
        buildArgs([incident({ country: "Indonesia", location: "Jayapura" })]),
      ),
    );
    expect(html).toContain("Bottom Line Up Front");
  });

  it("builds + renders the Jakarta structured brief without throwing", () => {
    const html = renderBrief(buildJakartaReportDataset(buildArgs(rows)));
    expect(html).toContain("Bottom Line Up Front");
  });

  it("renders the empty-window brief (no records this period)", () => {
    expect(() => renderBrief(buildIndonesiaReportDataset(buildArgs([])))).not.toThrow();
  });
});

describe("countryFastFacts API shape (fails if exports are renamed)", () => {
  const facts: CountryFastFactsIncident[] = [
    {
      id: "f1",
      topic: "flashpoint",
      title: "Protesters block the highway, halting traffic",
      severity: "high",
      occurredAt: "2026-06-14T00:00:00.000Z",
      country: "Indonesia",
      location: "Jakarta",
    },
    {
      id: "f2",
      topic: "flashpoint",
      title: "Armed robbery at a store",
      severity: "moderate",
      occurredAt: "2026-06-13T00:00:00.000Z",
      country: "Indonesia",
      location: "Medan",
    },
  ];

  it("filters a country's incidents to the report window", () => {
    const filtered = filterCountryReportIncidents(facts, "2026-06-15");
    expect(Array.isArray(filtered)).toBe(true);
  });

  it("computes Fast Facts breakdown with severity + card fields", () => {
    const result = computeCountryFastFacts({
      incidents: facts,
      countryName: "Indonesia",
      issueDate: "2026-06-15",
    });
    expect(Array.isArray(result.cards)).toBe(true);
    expect(result.cards.length).toBeGreaterThan(0);
  });
});

describe("countryMatch API shape (fails if exports are renamed)", () => {
  it("accepts and derives country tokens", () => {
    expect(acceptedCountryTokens("Indonesia").length).toBeGreaterThan(0);
    expect(countryFetchTokens("Indonesia").length).toBeGreaterThan(0);
  });

  it("matches an incident country to its report via the two-arg predicate", () => {
    expect(incidentMatchesCountry("Indonesia", "Indonesia")).toBe(true);
    expect(incidentMatchesCountry("Philippines", "Indonesia")).toBe(false);
  });
});
