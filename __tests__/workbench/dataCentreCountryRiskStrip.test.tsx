import { renderToStaticMarkup } from "react-dom/server";

import { CountryRiskStrip } from "../../artifacts/workbench/src/components/CountryRiskStrip";
import { RISK_RATING_COLOR } from "../../artifacts/workbench/src/lib/dataCentreRisk";
import type {
  DataCentreCountryRisk,
  DataCentreRiskDimension,
} from "@workspace/api-client-react";

// Read-level guard for the shared per-country risk strip used on BOTH the risk
// framework list and the Data Centres monitor (so the two surfaces can never
// disagree). Pins the STRICT no-fabrication contract:
//  - a dimension with no rating is OMITTED (reads "not reported", never a chip);
//  - a rated dimension renders its label + tier, brand-coloured by tier;
//  - provisional (unreviewed, auto-seeded) ratings surface an amber review line;
//  - a country with zero rated dimensions reads "Not reported".

function dim(over: Partial<DataCentreRiskDimension>): DataCentreRiskDimension {
  return {
    rating: null,
    rationale: "",
    source: "",
    analystNote: "",
    provisional: false,
    overridden: false,
    seededFrom: null,
    ...over,
  };
}

function risk(over: Partial<DataCentreCountryRisk>): DataCentreCountryRisk {
  return {
    id: 1,
    country: "Testland",
    dimensions: {},
    overallNote: null,
    createdBy: null,
    createdAt: "2026-07-01T00:00:00+00:00",
    updatedAt: "2026-07-01T00:00:00+00:00",
    ...over,
  } as DataCentreCountryRisk;
}

describe("CountryRiskStrip", () => {
  it("renders a chip only for RATED dimensions and omits unrated ones", () => {
    const html = renderToStaticMarkup(
      <CountryRiskStrip
        risk={risk({
          country: "Indonesia",
          dimensions: {
            corruption: dim({ rating: "High", rationale: "TI CPI weak." }),
            // A dimension present but with no rating must never surface a chip.
            transparency: dim({ rating: null, rationale: "under review" }),
          },
        })}
        showCountry
      />,
    );
    expect(html).toContain("Indonesia");
    expect(html).toContain("Corruption");
    expect(html).toContain("High");
    // The rated chip is coloured by the brand tier ramp.
    expect(html).toContain(RISK_RATING_COLOR.High);
    // The unrated "Transparency" dimension is omitted entirely.
    expect(html).not.toContain("Transparency");
  });

  it("shows an amber provisional-review line when a rated dimension is provisional", () => {
    const html = renderToStaticMarkup(
      <CountryRiskStrip
        risk={risk({
          dimensions: {
            corruption: dim({
              rating: "Moderate",
              provisional: true,
              seededFrom: "TI CPI 2024",
            }),
          },
        })}
      />,
    );
    expect(html).toContain("1 provisional");
    expect(html).toMatch(/pending analyst review/i);
  });

  it("reads 'Not reported' when no dimension carries a rating", () => {
    const html = renderToStaticMarkup(<CountryRiskStrip risk={risk({})} />);
    expect(html).toContain("Not reported");
  });

  it("reserves petrol #1B6B7A for Insignificant and subdued red #A33232 for Extreme", () => {
    expect(RISK_RATING_COLOR.Insignificant).toBe("#1B6B7A");
    expect(RISK_RATING_COLOR.Extreme).toBe("#A33232");
  });
});
