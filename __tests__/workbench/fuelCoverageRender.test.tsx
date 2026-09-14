import { renderToStaticMarkup } from "react-dom/server";
import FuelCoverageSummary from "../../artifacts/workbench/src/components/FuelCoverageSummary";
import { buildFuelCoverageSummary } from "../../artifacts/workbench/src/lib/fuelCoverage";
import { buildFuelCanonicalFacts } from "../../artifacts/workbench/src/lib/fuelCanonicalFacts";
import type { TopicFastFactsIncident } from "../../artifacts/workbench/src/lib/topicFastFacts";

function row(
  id: number,
  title: string,
  country: string,
  date: string,
  severity: string,
): TopicFastFactsIncident {
  return {
    id,
    topic: "fuel",
    title,
    summary: `${title} in ${country}.`,
    severity,
    occurredAt: date,
    country,
    location: country,
    source: "Example News",
    sourceUrl: `https://example.test/${id}`,
  };
}

it("renders the shared preview/PDF coverage labels and canonical totals", () => {
  const records = [
    row(1, "Fuel shortage in Iran", "Iran", "2031-04-01", "high"),
    row(2, "Refinery fire in Oman", "Oman", "2031-04-02", "moderate"),
    row(3, "Fuel shortage in Jordan", "Jordan", "2031-04-03", "extreme"),
    row(4, "Fuel supply interruption in Qatar", "Qatar", "2031-04-04", "low"),
    row(5, "Depot fire in Bahrain", "Bahrain", "2031-04-05", "high"),
    row(6, "Fuel shortage in Kuwait", "Kuwait", "2031-04-06", "moderate"),
    row(7, "Refinery fire in Iraq", "Iraq", "2031-04-07", "high"),
    row(8, "Fuel shortage in Saudi Arabia", "Saudi Arabia", "2031-04-07", "moderate"),
  ];
  const facts = buildFuelCanonicalFacts({
    issueDate: "2031-04-07",
    incidents: records,
    qualifyingIncidents: records,
    marketCards: [],
    window: { start: "2031-04-01", end: "2031-04-07" },
  });
  const model = buildFuelCoverageSummary(facts);
  const markup = renderToStaticMarkup(<FuelCoverageSummary model={model} />);

  expect(markup).toContain("Reporting-period coverage");
  expect(markup).toContain("Distinct developments");
  expect(markup).toContain("Active countries");
  expect(markup).toContain("Severity distribution");
  expect(markup).toContain("Daily incident trend");
  expect(markup).toContain("Affected countries");
  expect(markup).not.toMatch(
    /relevance|evidence-family|syndicated|raw-ingest|not ranked for impact/i,
  );
  expect(markup).toContain(String(model.totalDistinctDevelopments));
  expect(markup).toContain(String(model.activeCountries));
  expect(markup).toContain("#1B6B7A");
  expect(markup).toContain("#A33232");
  expect(markup).not.toContain("#9AA5B1");
  for (const country of model.affectedCountries) {
    expect(markup).toContain(country.country);
    expect(markup).toContain(String(country.count));
  }

  const continuedMarkup = renderToStaticMarkup(
    <FuelCoverageSummary
      model={model}
      countryRows={model.affectedCountries.slice(0, 1)}
      showMetrics={false}
      continued
    />,
  );
  expect(continuedMarkup).toContain("Reporting-period coverage (continued)");
  expect(continuedMarkup).not.toContain("Distinct developments");
  expect(continuedMarkup).toContain(model.affectedCountries[0].country);
});