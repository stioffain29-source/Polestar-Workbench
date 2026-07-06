/**
 * @jest-environment jsdom
 *
 * The Facility & Incident Overlay map colours each facility pin by registry
 * status (`statusColor`) and renders a legend of colour swatches beneath the
 * map. If a status is added whose colour is NOT covered by a legend swatch —
 * or a brand-new status falls through to the `#8A94A6` grey fallback — analysts
 * see an unexplained pin colour with no key entry.
 *
 * These tests guard that:
 *   - every colour an explicitly-mapped status plots has a matching legend
 *     swatch colour, and
 *   - an unmapped status is caught falling through to the `#8A94A6` fallback.
 *
 * The app is owner-gated (Replit Auth), so this cannot be checked with a live
 * screenshot. react-leaflet is stubbed to inspectable passthroughs; the
 * `CircleMarker` stub echoes its `fillColor` (facility pins fill with the
 * status colour) so the plotted pin colour is assertable.
 */

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
      pathOptions,
    }: {
      children?: React.ReactNode;
      radius?: number;
      pathOptions?: { color?: string; fillColor?: string };
    }) =>
      React.createElement(
        "span",
        {
          "data-testid": "circle-marker",
          "data-radius": radius != null ? String(radius) : undefined,
          "data-color": pathOptions?.color,
          "data-fillcolor": pathOptions?.fillColor,
        },
        children,
      ),
    Polyline: () => null,
    Tooltip: Passthrough,
    Popup: Passthrough,
    useMap: () => ({ setView() {}, fitBounds() {} }),
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
  STATUS_COLOR,
  STATUS_FALLBACK_COLOR,
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

function parse(markup: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = markup;
  return host;
}

// Facility pins are the radius-7 CircleMarkers; their fill is the status colour.
function facilityPinColours(host: HTMLElement): string[] {
  return Array.from(
    host.querySelectorAll('[data-testid="circle-marker"][data-radius="7"]'),
  )
    .map((el) => el.getAttribute("data-fillcolor"))
    .filter((c): c is string => c != null)
    .map((c) => c.toLowerCase());
}

// Legend swatches are the only elements carrying an inline `background:` hex.
function legendSwatchColours(host: HTMLElement): Set<string> {
  const found = new Set<string>();
  host.querySelectorAll("[style]").forEach((el) => {
    const style = el.getAttribute("style") ?? "";
    const m = style.match(/background:\s*(#[0-9a-fA-F]{6})/);
    if (m) found.add(m[1].toLowerCase());
  });
  return found;
}

describe("DataCentreFacilityMap — status legend covers every pin colour", () => {
  it("draws a legend swatch for every colour an explicitly-mapped status plots", () => {
    const statuses = Object.keys(STATUS_COLOR);
    const host = parse(
      renderToStaticMarkup(
        <DataCentreFacilityMap
          facilities={statuses.map((status, idx) =>
            facility({ id: idx + 1, status }),
          )}
          incidents={[]}
        />,
      ),
    );

    const swatches = legendSwatchColours(host);
    const pinColours = facilityPinColours(host);

    // Every mapped status actually plotted a pin.
    expect(pinColours).toHaveLength(statuses.length);

    // Each plotted pin colour has a matching legend swatch colour.
    for (const colour of pinColours) {
      expect(swatches.has(colour)).toBe(true);
    }
  });

  it("includes the #8A94A6 fallback colour in the legend so grey pins are explained", () => {
    const host = parse(
      renderToStaticMarkup(
        <DataCentreFacilityMap facilities={[facility()]} incidents={[]} />,
      ),
    );
    expect(legendSwatchColours(host).has(STATUS_FALLBACK_COLOR.toLowerCase())).toBe(
      true,
    );
  });
});

describe("DataCentreFacilityMap — fallback status detection", () => {
  it("catches a status whose colour falls through to the #8A94A6 fallback", () => {
    // A status not present in STATUS_COLOR must not silently borrow a mapped
    // colour — it falls through to the grey fallback.
    const brandNewStatus = "Under environmental review";
    expect(STATUS_COLOR).not.toHaveProperty(brandNewStatus);

    const host = parse(
      renderToStaticMarkup(
        <DataCentreFacilityMap
          facilities={[facility({ status: brandNewStatus })]}
          incidents={[]}
        />,
      ),
    );

    expect(facilityPinColours(host)).toEqual([
      STATUS_FALLBACK_COLOR.toLowerCase(),
    ]);
  });
});
