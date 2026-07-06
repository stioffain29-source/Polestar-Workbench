/**
 * @jest-environment jsdom
 *
 * The Facility & Incident Overlay map opens a Leaflet POPUP on click. The popup
 * content is the analyst's jump-off point, so it must carry the right links:
 *   - a facility popup carries the "Open in registry →" deep link
 *     (`/registry/data-centres?facility=<id>`), and an "Open source ↗" link
 *     ONLY when the facility has a `sourceUrl`.
 *   - an incident popup carries an "Open source article ↗" link ONLY when the
 *     incident has a `resolvedUrl` or `sourceUrl`, else the honest
 *     "Source link not reported" fallback.
 *
 * The app is owner-gated (Replit Auth), so this cannot be checked with a live
 * screenshot. react-leaflet is stubbed to a passthrough so the popup markup is
 * produced by `renderToStaticMarkup` (the render body runs; the effect that
 * mounts the real Leaflet map does not) for assertion — mirroring the
 * owner-gated-safe substitute used by the other map render tests.
 */

// react-leaflet needs a live Leaflet map context to render its map children.
// Stub every export to an inert passthrough so the popup/tooltip markup renders
// in jsdom without a real map. `useMap` returns a no-op stub for FitBounds.
jest.mock("react-leaflet", () => {
  const React = require("react") as typeof import("react");
  const Passthrough = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children);
  return {
    __esModule: true,
    MapContainer: Passthrough,
    TileLayer: () => null,
    CircleMarker: Passthrough,
    Polyline: () => null,
    Tooltip: Passthrough,
    Popup: Passthrough,
    useMap: () => ({ setView() {}, fitBounds() {} }),
  };
});

// `wouter` ships untransformed ESM; the map only uses its <Link>. Stub it to a
// plain anchor so the registry deep-link href is assertable.
jest.mock("wouter", () => {
  const React = require("react") as typeof import("react");
  return {
    __esModule: true,
    Link: ({ children, href }: { children: React.ReactNode; href?: string }) =>
      React.createElement("a", { href }, children),
  };
});

// `leaflet` touches the DOM/window at import; the passthrough map never calls
// into it, so a tiny stub keeps the import cheap and side-effect free.
jest.mock("leaflet", () => ({
  __esModule: true,
  default: {
    latLngBounds: () => ({}),
    latLng: () => ({}),
  },
}));

import { renderToStaticMarkup } from "react-dom/server";
import {
  DataCentreFacilityMap,
  type OverlayIncident,
} from "../../artifacts/workbench/src/components/DataCentreFacilityMap";
import type { DataCentreFacility } from "@workspace/api-client-react";

function facility(fields: Partial<DataCentreFacility> = {}): DataCentreFacility {
  return {
    id: 1,
    name: "Test Facility",
    operator: "Test Operator",
    country: "Singapore",
    city: "Singapore",
    latitude: 1.35,
    longitude: 103.8,
    status: "Operational",
    planningRisk: "No known issue",
    capacityMw: null,
    itLoadMw: null,
    statusChanged: false,
    previousStatus: null,
    sourceUrl: null,
    linkedIncidentId: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...fields,
  } as DataCentreFacility;
}

function incident(fields: Partial<OverlayIncident> = {}): OverlayIncident {
  return {
    id: 100,
    title: "Fibre cut near landing station",
    severity: "moderate",
    country: "Singapore",
    occurredAt: "2026-07-04T00:00:00.000Z",
    latitude: 1.29,
    longitude: 103.85,
    resolvedUrl: null,
    sourceUrl: null,
    ...fields,
  };
}

describe("DataCentreFacilityMap — facility popup links", () => {
  it("always carries the 'Open in registry' deep link with the facility id", () => {
    const markup = renderToStaticMarkup(
      <DataCentreFacilityMap facilities={[facility({ id: 42 })]} incidents={[]} />,
    );
    expect(markup).toContain("Open in registry");
    expect(markup).toContain("/registry/data-centres?facility=42");
  });

  it("shows the 'Open source' link only when the facility has a sourceUrl", () => {
    const withSource = renderToStaticMarkup(
      <DataCentreFacilityMap
        facilities={[facility({ id: 7, sourceUrl: "https://example.com/dc-7" })]}
        incidents={[]}
      />,
    );
    expect(withSource).toContain("Open source");
    expect(withSource).toContain("https://example.com/dc-7");

    const withoutSource = renderToStaticMarkup(
      <DataCentreFacilityMap facilities={[facility({ id: 7, sourceUrl: null })]} incidents={[]} />,
    );
    // The deep link is still present, but no external source anchor is emitted.
    expect(withoutSource).toContain("Open in registry");
    expect(withoutSource).not.toContain("Open source");
  });
});

describe("DataCentreFacilityMap — incident popup source link", () => {
  it("renders the source link when the incident has a resolvedUrl", () => {
    const markup = renderToStaticMarkup(
      <DataCentreFacilityMap
        facilities={[facility()]}
        incidents={[incident({ resolvedUrl: "https://publisher.example/story", sourceUrl: null })]}
      />,
    );
    expect(markup).toContain("Open source article");
    expect(markup).toContain("https://publisher.example/story");
    expect(markup).not.toContain("Source link not reported");
  });

  it("falls back to sourceUrl when there is no resolvedUrl", () => {
    const markup = renderToStaticMarkup(
      <DataCentreFacilityMap
        facilities={[facility()]}
        incidents={[
          incident({ resolvedUrl: null, sourceUrl: "https://news.google.com/rss/articles/abc" }),
        ]}
      />,
    );
    expect(markup).toContain("Open source article");
    expect(markup).toContain("https://news.google.com/rss/articles/abc");
    expect(markup).not.toContain("Source link not reported");
  });

  it("shows the honest 'not reported' fallback when the incident has no link at all", () => {
    const markup = renderToStaticMarkup(
      <DataCentreFacilityMap
        facilities={[facility()]}
        incidents={[incident({ resolvedUrl: null, sourceUrl: null })]}
      />,
    );
    expect(markup).toContain("Source link not reported");
    expect(markup).not.toContain("Open source article");
  });
});
