/**
 * @jest-environment jsdom
 *
 * Regression guard for the reworked country-report output standard: the country
 * report body must NOT render the Severity Distribution or Incident Breakdown by
 * Type charts by default (a chart may only appear where it supports the written
 * assessment). Those two charts used to live in `CountryReportVisuals`, so this
 * test renders the real component and asserts neither chart heading appears.
 *
 * `SituationalContextSection` (the one remaining child of `CountryReportVisuals`)
 * is globally stubbed to an inert placeholder by the jest `moduleNameMapper`, so
 * the body renders cleanly here; the guarantee under test is simply that no chart
 * heading is reintroduced into this block.
 */
import { render } from "@testing-library/react";
import CountryReportVisuals from "@/components/CountryReportVisuals";

describe("CountryReportVisuals — charts off by default", () => {
  it("renders neither the Severity Distribution nor the Incident Breakdown by Type chart", () => {
    const { queryByText } = render(
      <CountryReportVisuals countryName="Papua" situationalReports={[]} />,
    );

    expect(queryByText(/Severity Distribution/i)).toBeNull();
    expect(queryByText(/Incident Breakdown by Type/i)).toBeNull();
  });

  it("still renders without a chart when supporting reports are present", () => {
    const { queryByText } = render(
      <CountryReportVisuals
        countryName="Papua"
        situationalReports={[{ id: "1", title: "Context report" } as never]}
      />,
    );

    expect(queryByText(/Severity Distribution/i)).toBeNull();
    expect(queryByText(/Incident Breakdown by Type/i)).toBeNull();
  });
});
