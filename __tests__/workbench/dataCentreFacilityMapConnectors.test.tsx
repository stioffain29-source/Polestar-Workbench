/**
 * @jest-environment jsdom
 *
 * The Facility & Incident Overlay map draws two analyst-facing map signals that
 * the popup test (`dataCentreFacilityMapPopups.test.tsx`) does not cover and
 * that could silently regress:
 *   - a dashed CONNECTOR line between a facility and its linked incident, drawn
 *     ONLY when the facility's `linkedIncidentId` resolves to a plotted,
 *     coordinate-bearing incident.
 *   - a "recent status mover" RING around a facility pin, drawn ONLY when the
 *     facility's `statusChanged` is true; the legend mover tally must match.
 * STRICT no-fabrication: facilities / incidents WITHOUT coordinates are never
 * plotted, and when no facility carries coordinates the map shows an honest
 * empty state instead of an invented map.
 *
 * The app is owner-gated (Replit Auth), so this cannot be checked with a live
 * screenshot. react-leaflet is stubbed to inspectable passthroughs so the
 * connector (`Polyline`) and rings/markers (`CircleMarker`) surface as DOM
 * nodes carrying their key props for assertion — a richer variant of the
 * owner-gated-safe substitute the popup render test uses.
 */

// Stub react-leaflet so the map body renders in jsdom without a live Leaflet
// map. Unlike the popup test, `Polyline` and `CircleMarker` are rendered as
// tagged <span>s that echo their key props (positions, radius, colour,
// interactivity) so the connector line and the mover ring are assertable.
jest.mock("react-leaflet", () => {
  const React = require("react") as typeof import("react");
  const Passthrough = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children);
  return {
    __esModule: true,
    MapContainer: Passthrough,
    TileLayer: () => null,
    CircleMarker: ({
      children,
      radius,
      interactive,
      center,
      pathOptions,
    }: {
      children?: React.ReactNode;
      radius?: number;
      interactive?: boolean;
      center?: [number, number];
      pathOptions?: { color?: string; fillOpacity?: number };
    }) =>
      React.createElement(
        "span",
        {
          "data-testid": "circle-marker",
          "data-radius": radius != null ? String(radius) : undefined,
          "data-interactive": interactive === false ? "false" : "true",
          "data-center": JSON.stringify(center),
          "data-color": pathOptions?.color,
        },
        children,
      ),
    Polyline: ({
      positions,
      pathOptions,
    }: {
      positions: Array<[number, number]>;
      pathOptions?: { color?: string };
    }) =>
      React.createElement("span", {
        "data-testid": "connector",
        "data-positions": JSON.stringify(positions),
        "data-color": pathOptions?.color,
      }),
    Tooltip: Passthrough,
    Popup: Passthrough,
    useMap: () => ({ setView() {}, fitBounds() {} }),
  };
});

// `wouter` ships untransformed ESM; the map only uses its <Link>. Stub it to a
// plain anchor (mirrors the popup test).
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

// Parse the static markup into a queryable DOM fragment.
function parse(markup: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = markup;
  return host;
}

function connectors(host: HTMLElement): Element[] {
  return Array.from(host.querySelectorAll('[data-testid="connector"]'));
}

// The mover ring is the only CircleMarker rendered at radius 11 (facility pins
// are radius 7, incident markers radius 5).
function rings(host: HTMLElement): Element[] {
  return Array.from(
    host.querySelectorAll('[data-testid="circle-marker"][data-radius="11"]'),
  );
}

describe("DataCentreFacilityMap — linked-incident connector line", () => {
  it("draws a connector only when linkedIncidentId resolves to a plotted incident", () => {
    const host = parse(
      renderToStaticMarkup(
        <DataCentreFacilityMap
          facilities={[facility({ id: 1, linkedIncidentId: 100 })]}
          incidents={[incident({ id: 100 })]}
        />,
      ),
    );
    const lines = connectors(host);
    expect(lines).toHaveLength(1);
    // The line runs facility → incident, in that order.
    expect(JSON.parse(lines[0].getAttribute("data-positions")!)).toEqual([
      [1.35, 103.8],
      [1.29, 103.85],
    ]);
  });

  it("draws no connector when linkedIncidentId points at an incident that is not plotted", () => {
    const host = parse(
      renderToStaticMarkup(
        <DataCentreFacilityMap
          facilities={[facility({ id: 1, linkedIncidentId: 999 })]}
          incidents={[incident({ id: 100 })]}
        />,
      ),
    );
    expect(connectors(host)).toHaveLength(0);
  });

  it("draws no connector when the linked incident has no coordinates", () => {
    const host = parse(
      renderToStaticMarkup(
        <DataCentreFacilityMap
          facilities={[facility({ id: 1, linkedIncidentId: 100 })]}
          incidents={[incident({ id: 100, latitude: null, longitude: null })]}
        />,
      ),
    );
    expect(connectors(host)).toHaveLength(0);
  });

  it("draws no connector when the facility has no linkedIncidentId", () => {
    const host = parse(
      renderToStaticMarkup(
        <DataCentreFacilityMap
          facilities={[facility({ id: 1, linkedIncidentId: null })]}
          incidents={[incident({ id: 100 })]}
        />,
      ),
    );
    expect(connectors(host)).toHaveLength(0);
  });

  it("draws a connector per resolved facility, ignoring facilities whose link does not resolve", () => {
    const host = parse(
      renderToStaticMarkup(
        <DataCentreFacilityMap
          facilities={[
            facility({ id: 1, latitude: 1.35, longitude: 103.8, linkedIncidentId: 100 }),
            facility({ id: 2, latitude: 3.0, longitude: 101.0, linkedIncidentId: 101 }),
            facility({ id: 3, latitude: 5.0, longitude: 100.0, linkedIncidentId: 500 }),
          ]}
          incidents={[
            incident({ id: 100, latitude: 1.29, longitude: 103.85 }),
            incident({ id: 101, latitude: 3.1, longitude: 101.1 }),
          ]}
        />,
      ),
    );
    // Facilities 1 and 2 resolve; facility 3 (link 500) has no plotted incident.
    expect(connectors(host)).toHaveLength(2);
  });
});

describe("DataCentreFacilityMap — recent status mover ring", () => {
  it("renders a ring only when statusChanged is true, and the legend tally matches", () => {
    const host = parse(
      renderToStaticMarkup(
        <DataCentreFacilityMap
          facilities={[facility({ id: 1, statusChanged: true })]}
          incidents={[]}
        />,
      ),
    );
    const ring = rings(host);
    expect(ring).toHaveLength(1);
    // The ring is the non-interactive, electric-blue overlay.
    expect(ring[0].getAttribute("data-interactive")).toBe("false");
    expect(ring[0].getAttribute("data-color")).toBe("#4655FF");
    expect(host.textContent).toContain("1 recent mover");
  });

  it("renders no ring and no mover tally when statusChanged is false", () => {
    const host = parse(
      renderToStaticMarkup(
        <DataCentreFacilityMap
          facilities={[facility({ id: 1, statusChanged: false })]}
          incidents={[]}
        />,
      ),
    );
    expect(rings(host)).toHaveLength(0);
    expect(host.textContent).not.toContain("recent mover");
  });

  it("counts one ring per moving facility and pluralises the legend tally", () => {
    const host = parse(
      renderToStaticMarkup(
        <DataCentreFacilityMap
          facilities={[
            facility({ id: 1, latitude: 1.35, longitude: 103.8, statusChanged: true }),
            facility({ id: 2, latitude: 3.0, longitude: 101.0, statusChanged: true }),
            facility({ id: 3, latitude: 5.0, longitude: 100.0, statusChanged: false }),
          ]}
          incidents={[]}
        />,
      ),
    );
    expect(rings(host)).toHaveLength(2);
    expect(host.textContent).toContain("2 recent movers");
  });
});

describe("DataCentreFacilityMap — STRICT no-fabrication (coordinateless omission)", () => {
  it("shows the empty state only when NEITHER facilities nor incidents carry coordinates", () => {
    const host = parse(
      renderToStaticMarkup(
        <DataCentreFacilityMap
          facilities={[facility({ id: 1, latitude: null, longitude: null })]}
          incidents={[incident({ id: 100, latitude: null, longitude: null })]}
        />,
      ),
    );
    expect(host.textContent).toContain(
      "No facilities or incidents with coordinates on file",
    );
    // Nothing is plotted: no markers, no connector.
    expect(host.querySelectorAll('[data-testid="circle-marker"]')).toHaveLength(0);
    expect(connectors(host)).toHaveLength(0);
  });

  it("renders the incident layer on its own when a plotted incident exists but no facility carries coordinates", () => {
    // Incidents are an independently toggleable layer, so a coordinate-bearing
    // incident maps even when every facility is coordinateless — the map is NOT
    // suppressed to the honest empty state.
    const host = parse(
      renderToStaticMarkup(
        <DataCentreFacilityMap
          facilities={[facility({ id: 1, latitude: null, longitude: null })]}
          incidents={[incident({ id: 100 })]}
        />,
      ),
    );
    expect(host.textContent).not.toContain(
      "No facilities or incidents with coordinates on file",
    );
    // The incident marker (radius 5) is plotted; the coordinateless facility pin
    // (radius 7) is not.
    expect(
      host.querySelectorAll('[data-testid="circle-marker"][data-radius="5"]'),
    ).toHaveLength(1);
    expect(
      host.querySelectorAll('[data-testid="circle-marker"][data-radius="7"]'),
    ).toHaveLength(0);
  });

  it("omits a coordinateless incident from the map while plotting the facility", () => {
    const host = parse(
      renderToStaticMarkup(
        <DataCentreFacilityMap
          facilities={[facility({ id: 1 })]}
          incidents={[incident({ id: 100, latitude: null, longitude: null })]}
        />,
      ),
    );
    // Facility pin (radius 7) is plotted; the coordinateless incident (radius 5)
    // is not.
    expect(
      host.querySelectorAll('[data-testid="circle-marker"][data-radius="7"]'),
    ).toHaveLength(1);
    expect(
      host.querySelectorAll('[data-testid="circle-marker"][data-radius="5"]'),
    ).toHaveLength(0);
    // The legend reflects the honest count: 0 incidents mapped.
    expect(host.textContent).toContain("0 incidents mapped");
  });
});
