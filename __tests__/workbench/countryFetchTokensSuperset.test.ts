import {
  countryFetchTokens,
  incidentMatchesCountry,
} from "../../artifacts/workbench/src/lib/countryMatch";

// The country report scopes its 90-day incidents fetch with the server
// `countryLike` param (an OR of case-insensitive substring matches on the
// `country` field). For that pre-filter to be safe it MUST return a SUPERSET of
// the rows the page's own `incidentMatchesCountry` gate keeps — otherwise a
// genuine record would silently vanish from the brief. These tests pin that
// invariant, plus the Jakarta trap: Jakarta records carry country="Indonesia"
// (never "Jakarta"), so the fetch must be scoped to the Indonesia group.

// True when the server's countryLike OR-ilike would return this country field.
function serverReturns(country: string, tokens: string[]): boolean {
  const hay = country.toLowerCase();
  return tokens.some((t) => hay.includes(t.toLowerCase()));
}

// The name the PAGE matches an incident against. Jakarta is a city sub-view of
// Indonesia-tagged records, so it matches on the Indonesia group, not "Jakarta".
function clientMatchName(reportName: string): string {
  return reportName.toLowerCase() === "jakarta" ? "Indonesia" : reportName;
}

type Fixture = { report: string; country: string; kept: boolean };

const FIXTURES: Fixture[] = [
  // Plain single-token country.
  { report: "Indonesia", country: "Indonesia", kept: true },
  { report: "Indonesia", country: "Indonesia; Malaysia", kept: true },
  { report: "Indonesia", country: "Malaysia", kept: false },
  // Jakarta city brief — the trap: incident is tagged "Indonesia".
  { report: "Jakarta", country: "Indonesia", kept: true },
  { report: "Jakarta", country: "Indonesia; Singapore", kept: true },
  { report: "Jakarta", country: "Singapore", kept: false },
  // West Papua ("papua" group) vs Papua New Guinea — the cross-border pair.
  { report: "Papua", country: "West Papua", kept: true },
  { report: "Papua", country: "West Papua; Papua New Guinea", kept: true },
  { report: "Papua", country: "Papua New Guinea", kept: false },
  { report: "Papua New Guinea", country: "Papua New Guinea", kept: true },
  {
    report: "Papua New Guinea",
    country: "West Papua; Papua New Guinea",
    kept: true,
  },
  { report: "Papua New Guinea", country: "West Papua", kept: false },
  // Compound tag where the report country is listed second.
  { report: "Iran", country: "United Arab Emirates; Iran", kept: true },
  { report: "South Korea", country: "South Korea; Iran", kept: true },
];

describe("countryFetchTokens superset invariant", () => {
  for (const fx of FIXTURES) {
    const kept = incidentMatchesCountry(fx.country, clientMatchName(fx.report));
    it(`${fx.report} / "${fx.country}" — page ${
      kept ? "keeps" : "drops"
    } it`, () => {
      // The fixture's expectation matches the page's actual gate.
      expect(kept).toBe(fx.kept);
      // The core guarantee: anything the page KEEPS must be RETURNED by the
      // server pre-filter (superset). Extras the server returns are fine — the
      // client gate trims them.
      if (kept) {
        expect(serverReturns(fx.country, countryFetchTokens(fx.report))).toBe(
          true,
        );
      }
    });
  }
});

describe("countryFetchTokens Jakarta scoping", () => {
  it("scopes Jakarta to the Indonesia group, not the literal 'jakarta' token", () => {
    const tokens = countryFetchTokens("Jakarta");
    expect(tokens).toContain("indonesia");
    expect(tokens).not.toContain("jakarta");
  });

  it("empty report name yields no tokens", () => {
    expect(countryFetchTokens("")).toEqual([]);
  });
});
