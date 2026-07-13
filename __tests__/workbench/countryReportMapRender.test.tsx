/**
 * @jest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";

import CountryReportMap from "../../artifacts/workbench/src/components/CountryReportMap";
import {
  impactForIncident,
  impactLevelForSet,
  businessRelevance,
  IMPACT_ORDER,
} from "../../artifacts/workbench/src/lib/operationalPinchPoints";
import type { CountryFastFactsIncident } from "../../artifacts/workbench/src/lib/countryFastFacts";

// The country-brief Operational Map once shipped broken because
// `operationalPinchPoints.ts` renamed/removed exports (`impactLevelFor` ->
// `impactLevelForSet`; single-arg `businessRelevance` -> two-arg) while the
// consumer `CountryReportMap.tsx` kept calling the old names. Nothing failed
// until a full typecheck ran, so a producer/consumer drift could silently reach
// a broken runtime map.
//
// This suite catches that class of drift two ways:
//   1. It renders `CountryReportMap` (via renderToStaticMarkup, the owner-gated
//      test substitute for a live screenshot) with representative incident data
//      in BOTH render modes and asserts it emits impact levels + business-
//      relevance strings without throwing. renderToStaticMarkup runs the render
//      body — which calls impactForIncident/impactLevelForSet/businessRelevance
//      through the card builders — so a renamed/removed export breaks this test.
//   2. It pins the CURRENT `operationalPinchPoints` API shape directly (function
//      names + the two-arg `businessRelevance` signature), so a rename fails at
//      compile time here even before render.

// A dot-mode ("all other countries") incident: precise coordinates + a sub-city
// location so classifyLocationConfidence marks it plottable and the dot path
// (which uses impactLevelForSet + businessRelevance + leadIncident) runs.
const dotIncident: CountryFastFactsIncident = {
  id: "d1",
  topic: "flashpoint",
  title: "Protesters block the Jalan Sudirman highway, halting traffic",
  severity: "high",
  occurredAt: "2026-06-14T00:00:00.000Z",
  country: "Philippines",
  location: "Jalan Sudirman, Manila",
  latitude: 14.6,
  longitude: 120.98,
};

// A zone-mode incident: a configured country (Indonesia) so aggregateZones +
// the zone-path card builder (businessRelevance) run.
const zoneIncident: CountryFastFactsIncident = {
  id: "z1",
  topic: "flashpoint",
  title: "Factory fire disrupts operations in Bekasi industrial estate",
  severity: "moderate",
  occurredAt: "2026-06-13T00:00:00.000Z",
  country: "Indonesia",
  location: "Bekasi",
};

describe("CountryReportMap render (producer/consumer drift guard)", () => {
  it("renders the dot-mode Operational Map with impact + relevance, without throwing", () => {
    const html = renderToStaticMarkup(
      <CountryReportMap incidents={[dotIncident]} countryName="Philippines" />,
    );
    expect(html).toContain("Impact level:");
    expect(html).toContain("Business relevance:");
    // The dot incident describes a confirmed highway closure -> Direct impact.
    expect(html).toContain("Direct impact");
    expect(IMPACT_ORDER.some((lvl) => html.includes(lvl))).toBe(true);
  });

  it("renders the zone-mode Operational Map (configured country) without throwing", () => {
    const html = renderToStaticMarkup(
      <CountryReportMap incidents={[zoneIncident]} countryName="Indonesia" />,
    );
    expect(html).toContain("Impact level:");
    expect(html).toContain("Business relevance:");
  });

  it("renders with an empty incident set (no records this period)", () => {
    expect(() =>
      renderToStaticMarkup(
        <CountryReportMap incidents={[]} countryName="Philippines" />,
      ),
    ).not.toThrow();
  });
});

// Papua New Guinea is a dot-mode country. The Operational Map plots a marker
// only where a row resolved to a real sub-national place (location is a
// non-empty string); a centroid-fallback row (location null) is counted but
// NOT plotted. This is the fix for the map "staying on the same spot each
// week": every centroid-fallback row used to stack invisibly on the one
// national point.
const pngPlacedIncident: CountryFastFactsIncident = {
  id: "png1",
  topic: "flashpoint",
  title: "Tribal clash erupts in Wabag, Enga Province",
  severity: "high",
  occurredAt: "2026-06-14T00:00:00.000Z",
  country: "Papua New Guinea",
  location: "Wabag",
  latitude: -5.49,
  longitude: 143.71,
};

const pngCentroidIncident: CountryFastFactsIncident = {
  id: "png2",
  topic: "flashpoint",
  title: "Countrywide unrest reported",
  severity: "high",
  occurredAt: "2026-06-14T00:00:00.000Z",
  country: "Papua New Guinea",
  location: null,
  latitude: -6.31,
  longitude: 143.96,
};

describe("CountryReportMap dot-mode plottability (location-presence gate)", () => {
  it("plots a PNG row that resolved to a named town", () => {
    const html = renderToStaticMarkup(
      <CountryReportMap
        incidents={[pngPlacedIncident]}
        countryName="Papua New Guinea"
      />,
    );
    // A plotted row produces a dot card carrying the impact/relevance strings.
    expect(html).toContain("Impact level:");
  });

  it("does NOT plot a PNG centroid-fallback row and reports it unplotted", () => {
    const html = renderToStaticMarkup(
      <CountryReportMap
        incidents={[pngCentroidIncident]}
        countryName="Papua New Guinea"
      />,
    );
    expect(html).not.toContain("Impact level:");
    expect(html).toContain(
      "No reported operational issue names a mappable place this period",
    );
  });
});

describe("operationalPinchPoints API shape (fails if exports are renamed)", () => {
  it("classifies a confirmed disruption as Direct impact", () => {
    expect(impactForIncident(dotIncident)).toBe("Direct impact");
  });

  it("aggregates a set to the highest impact via impactLevelForSet", () => {
    const monitorOnly: CountryFastFactsIncident = {
      ...dotIncident,
      id: "m1",
      title: "Man arrested over robbery",
    };
    expect(impactLevelForSet([monitorOnly])).toBe("Monitor only");
    expect(impactLevelForSet([monitorOnly, dotIncident])).toBe("Direct impact");
  });

  it("produces a business-relevance string from the two-arg signature", () => {
    const impact = impactForIncident(dotIncident);
    const relevance = businessRelevance(dotIncident, impact);
    expect(typeof relevance).toBe("string");
    expect(relevance.length).toBeGreaterThan(0);
  });
});
