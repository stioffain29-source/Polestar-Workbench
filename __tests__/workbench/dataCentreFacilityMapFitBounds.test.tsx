/**
 * @jest-environment jsdom
 *
 * The Facility & Incident Overlay map's `FitBounds` child gathers every plotted
 * facility + incident coordinate and either:
 *   - `map.setView(point, 6)` when exactly ONE coordinate is plotted, or
 *   - `map.fitBounds(bounds, …)` over the FULL set when several are plotted, or
 *   - does NOTHING when there is nothing to plot.
 * If this silently regresses, analysts see a map centred on the wrong region or
 * zoomed past the data. The app is owner-gated (Replit Auth) so a live
 * screenshot cannot catch it.
 *
 * `FitBounds` runs inside a `useEffect`, which `renderToStaticMarkup` never
 * fires, so — unlike the connector/ring render test — this suite CLIENT-renders
 * the map under `act()` so effects run, and spies on the shared `useMap` stub's
 * `setView` / `fitBounds`. `leaflet`'s `latLngBounds` is stubbed to capture the
 * exact coordinate set fed to `fitBounds`.
 */

const setViewSpy = jest.fn();
const fitBoundsSpy = jest.fn();
// Records the coordinate arrays passed to L.latLngBounds so we can assert
// fitBounds received the full facility + incident set.
const latLngBoundsSpy = jest.fn();

// Stub react-leaflet: every map child is inert, but `useMap` returns a stable
// object whose setView/fitBounds are the spies under test.
jest.mock("react-leaflet", () => {
  const React = require("react") as typeof import("react");
  const Passthrough = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children);
  const map = { setView: setViewSpy, fitBounds: fitBoundsSpy };
  return {
    __esModule: true,
    MapContainer: Passthrough,
    TileLayer: () => null,
    CircleMarker: Passthrough,
    Polyline: () => null,
    Tooltip: Passthrough,
    Popup: Passthrough,
    useMap: () => map,
  };
});

jest.mock("wouter", () => {
  const React = require("react") as typeof import("react");
  return {
    __esModule: true,
    Link: ({ children, href }: { children: React.ReactNode; href?: string }) =>
      React.createElement("a", { href }, children),
  };
});

// `leaflet`'s latLngBounds/latLng are captured so the exact coordinate set fed
// to fitBounds is assertable; latLng is an identity so latLngBounds sees the
// raw [lat, lng] tuples.
jest.mock("leaflet", () => ({
  __esModule: true,
  default: {
    latLngBounds: (coords: Array<[number, number]>) => {
      latLngBoundsSpy(coords);
      return { __bounds: coords };
    },
    latLng: (lat: number, lng: number) => [lat, lng] as [number, number],
  },
}));

// react-dom/client's concurrent renderer requires this global to run effects
// under act() outside of @testing-library.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

import { act } from "react";
import { createRoot } from "react-dom/client";
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

// Client-render the map into a detached container under act() so the FitBounds
// effect actually runs.
function renderMap(
  facilities: DataCentreFacility[],
  incidents: OverlayIncident[],
): void {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <DataCentreFacilityMap facilities={facilities} incidents={incidents} />,
    );
  });
}

beforeEach(() => {
  setViewSpy.mockClear();
  fitBoundsSpy.mockClear();
  latLngBoundsSpy.mockClear();
});

describe("DataCentreFacilityMap — FitBounds fit-to-points", () => {
  it("calls setView on the single point (and never fitBounds) when exactly one coordinate is plotted", () => {
    renderMap(
      [facility({ id: 1, latitude: 1.35, longitude: 103.8 })],
      [incident({ id: 100, latitude: null, longitude: null })],
    );
    expect(setViewSpy).toHaveBeenCalledTimes(1);
    expect(setViewSpy).toHaveBeenCalledWith([1.35, 103.8], 6);
    expect(fitBoundsSpy).not.toHaveBeenCalled();
  });

  it("calls fitBounds over the full facility + incident coordinate set (and never setView) when several are plotted", () => {
    renderMap(
      [
        facility({ id: 1, latitude: 1.35, longitude: 103.8 }),
        facility({ id: 2, latitude: 3.0, longitude: 101.0 }),
      ],
      [incident({ id: 100, latitude: 1.29, longitude: 103.85 })],
    );
    expect(fitBoundsSpy).toHaveBeenCalledTimes(1);
    expect(setViewSpy).not.toHaveBeenCalled();
    // Bounds are built from every plotted facility THEN every plotted incident.
    expect(latLngBoundsSpy).toHaveBeenCalledWith([
      [1.35, 103.8],
      [3.0, 101.0],
      [1.29, 103.85],
    ]);
  });

  it("calls neither setView nor fitBounds when there are no plotted points", () => {
    // A facility without coordinates yields the honest empty state — nothing is
    // plotted, so FitBounds must be a no-op.
    renderMap([facility({ id: 1, latitude: null, longitude: null })], []);
    expect(setViewSpy).not.toHaveBeenCalled();
    expect(fitBoundsSpy).not.toHaveBeenCalled();
  });
});
