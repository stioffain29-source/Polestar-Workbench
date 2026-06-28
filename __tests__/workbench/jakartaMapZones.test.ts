/**
 * @jest-environment jsdom
 */
import {
  JAKARTA_ZONES,
  zoneIndexForIncident,
} from "../../artifacts/workbench/src/components/CountryReportMap";
import type { CountryFastFactsIncident } from "../../artifacts/workbench/src/lib/countryFastFacts";

// Pins the Jakarta map airport-corridor pre-pass. The risk zones are scanned in
// the spec's numbered-callout display order (Central, South, West, North, East,
// Airport, Greater). West Jakarta therefore sits BEFORE the Soekarno-Hatta
// Airport Corridor, so a naive in-order scan grabs "Cengkareng, West Jakarta"
// for West Jakarta even though, in Jakarta reporting, "Cengkareng" denotes the
// airport corridor. The pre-pass must let airport-specific tokens win WITHOUT
// reordering the legend numbering.

const AIRPORT_IDX = JAKARTA_ZONES.findIndex(
  (z) => z.name === "Soekarno-Hatta Airport Corridor",
);
const WEST_IDX = JAKARTA_ZONES.findIndex((z) => z.name === "West Jakarta");
const CENTRAL_IDX = JAKARTA_ZONES.findIndex((z) => z.name === "Central Jakarta");

function incident(
  fields: Partial<CountryFastFactsIncident>,
): CountryFastFactsIncident {
  return {
    topic: "flashpoint",
    title: "Untitled",
    severity: "low",
    occurredAt: "2026-06-20T00:00:00.000Z",
    ...fields,
  };
}

describe("Jakarta map zones — airport-corridor pre-pass", () => {
  it("has the airport corridor after West Jakarta in display order", () => {
    // Guards the precondition the pre-pass exists to handle: if the airport zone
    // were ordered before West Jakarta, the in-order scan would already win and
    // this test would no longer protect against the mis-bucket.
    expect(AIRPORT_IDX).toBeGreaterThan(WEST_IDX);
    expect(WEST_IDX).toBeGreaterThanOrEqual(0);
    expect(CENTRAL_IDX).toBe(0);
  });

  it("routes 'Cengkareng, West Jakarta' to the airport corridor, not West Jakarta", () => {
    const idx = zoneIndexForIncident(
      incident({ location: "Cengkareng, West Jakarta" }),
      JAKARTA_ZONES,
    );
    expect(idx).toBe(AIRPORT_IDX);
  });

  it("routes a Cengkareng headline to the airport corridor", () => {
    const idx = zoneIndexForIncident(
      incident({
        location: null,
        title: "Flights delayed at Cengkareng after security alert",
      }),
      JAKARTA_ZONES,
    );
    expect(idx).toBe(AIRPORT_IDX);
  });

  it("routes explicit airport tokens to the airport corridor", () => {
    for (const loc of ["Soekarno-Hatta", "Soetta terminal 3", "CGK"]) {
      expect(zoneIndexForIncident(incident({ location: loc }), JAKARTA_ZONES)).toBe(
        AIRPORT_IDX,
      );
    }
  });

  it("control: a generic West Jakarta district still resolves to West Jakarta", () => {
    const idx = zoneIndexForIncident(
      incident({ location: "Grogol, West Jakarta" }),
      JAKARTA_ZONES,
    );
    expect(idx).toBe(WEST_IDX);
  });

  it("control: a non-airport district is unaffected by the pre-pass", () => {
    const idx = zoneIndexForIncident(
      incident({ location: "Menteng, Central Jakarta" }),
      JAKARTA_ZONES,
    );
    expect(idx).toBe(CENTRAL_IDX);
  });

  it("returns null when no zone matches", () => {
    const idx = zoneIndexForIncident(
      incident({ location: "Surabaya", title: "Unrelated upcountry item" }),
      JAKARTA_ZONES,
    );
    expect(idx).toBeNull();
  });
});
