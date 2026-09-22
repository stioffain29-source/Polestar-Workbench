/** @jest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import type { RegionalMapPoint } from "../../artifacts/workbench/src/lib/regionalWeekly";

const mockTileLayer = jest.fn((_url: string, _options: unknown) => ({ addTo: jest.fn() }));
const mockMap = {
  setView: jest.fn(),
  fitBounds: jest.fn(),
  latLngToContainerPoint: jest.fn(() => ({ x: 120, y: 90 })),
  off: jest.fn(),
  on: jest.fn(),
  remove: jest.fn(),
};

jest.mock("leaflet", () => ({
  __esModule: true,
  default: {
    map: jest.fn(() => mockMap),
    tileLayer: (url: string, options: unknown) => mockTileLayer(url, options),
    latLngBounds: (points: unknown) => points,
  },
}));
jest.mock("jspdf", () => ({ jsPDF: jest.fn() }));
// Bypass the global map stub: this suite exercises the real CARTO component.
jest.mock("@/components/IncidentMap", () =>
  jest.requireActual("../../artifacts/workbench/src/components/IncidentMap"),
);

import { RegionalHotspotMap } from "../../artifacts/workbench/src/components/RegionalHotspotMap";
import { CARTO_POSITRON_TILE_URL } from "../../artifacts/workbench/src/lib/cartoBasemap";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function point(index: number): RegionalMapPoint {
  return {
    lat: 10 + index,
    lng: 105 + index,
    severity: index % 2 ? "High" : "Moderate",
    title: `Test development ${index}`,
    label: `Test location ${index}`,
    summary: `Test evidence ${index}`,
    eventDate: "2026-09-20",
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  window.matchMedia = jest.fn().mockReturnValue({ matches: false });
});

describe("regional report CARTO maps", () => {
  it.each(["apac_weekly", "middle_east_weekly"])(
    "uses keyed Positron and preserves every numbered canonical point for %s",
    (topic) => {
      const points = Array.from({ length: 6 }, (_, index) => point(index));
      const original = JSON.stringify(points);
      const host = document.createElement("div");
      document.body.appendChild(host);
      const root = createRoot(host);
      try {
        act(() => root.render(<RegionalHotspotMap points={points} topic={topic} />));
        expect(mockTileLayer).toHaveBeenCalledWith(CARTO_POSITRON_TILE_URL, expect.objectContaining({ crossOrigin: true }));
        expect(CARTO_POSITRON_TILE_URL).toContain("basemaps.cartocdn.com/light_all/");
        expect(mockMap.fitBounds).toHaveBeenCalledWith(
          points.map((p) => [p.lat, p.lng]),
          expect.objectContaining({ maxZoom: 5 }),
        );
        const markers = host.querySelectorAll("#regional-hotspot-map div[title]");
        expect([...markers].map((marker) => marker.textContent)).toEqual(["1", "2", "3", "4", "5", "6"]);
        expect(host.textContent).toContain("CARTO");
        expect([...host.querySelectorAll("h4")].map((label) => label.textContent)).toEqual(points.map((p) => p.label));
        expect(JSON.stringify(points)).toBe(original);
      } finally {
        act(() => root.unmount());
        host.remove();
      }
    },
  );

  it("keeps a single development at regional scale, not street zoom", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    try {
      act(() => root.render(<RegionalHotspotMap points={[point(0)]} topic="apac_weekly" />));
      expect(mockMap.setView).toHaveBeenCalledWith([10, 105], 5);
    } finally {
      act(() => root.unmount());
    }
  });

  it("does not invent map points when no selected development is plottable", () => {
    const markup = renderToStaticMarkup(<RegionalHotspotMap points={[]} topic="middle_east_weekly" />);
    expect(markup).toContain("No selected development has a verified plottable location.");
    expect(mockTileLayer).not.toHaveBeenCalled();
  });
});