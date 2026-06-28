/**
 * @jest-environment jsdom
 */
import {
  JAKARTA_ZONES,
  zoneIndexForIncident,
  aggregateZones,
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

// Pins the Jakarta clean-callout-map contract (spec §6): the six base business
// areas ALWAYS show, in fixed 1–6 config order, even with zero records this
// period (rendered as a neutral-grey marker with no severity — worstKey "").
// The Greater Jakarta fallback is appended as zone 7 only when it carries
// records. Other theatres (no alwaysShow flag) keep the active-only behaviour.
describe("aggregateZones — Jakarta alwaysShow callout map", () => {
  const BASE_NAMES = [
    "Central Jakarta",
    "South Jakarta",
    "West Jakarta",
    "North Jakarta",
    "East Jakarta",
    "Soekarno-Hatta Airport Corridor",
  ];

  it("always shows the six base zones, fixed-numbered 1–6, for an empty window", () => {
    const { active } = aggregateZones([], JAKARTA_ZONES);
    expect(active.map((z) => z.def.name)).toEqual(BASE_NAMES);
    expect(active.map((z) => z.number)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const z of active) {
      expect(z.count).toBe(0);
      expect(z.worstKey).toBe(""); // no severity → neutral grey marker
    }
  });

  it("keeps fixed 1–6 numbering when only some base zones have records", () => {
    const { active } = aggregateZones(
      [incident({ location: "Menteng, Central Jakarta", severity: "high" })],
      JAKARTA_ZONES,
    );
    expect(active.map((z) => z.def.name)).toEqual(BASE_NAMES);
    expect(active.map((z) => z.number)).toEqual([1, 2, 3, 4, 5, 6]);
    const central = active.find((z) => z.def.name === "Central Jakarta")!;
    expect(central.count).toBe(1);
    expect(central.worstKey).toBe("high");
    const south = active.find((z) => z.def.name === "South Jakarta")!;
    expect(south.count).toBe(0);
    expect(south.worstKey).toBe("");
  });

  it("appends the Greater Jakarta fallback as zone 7 only when it has records", () => {
    const none = aggregateZones([], JAKARTA_ZONES).active;
    expect(none.some((z) => z.def.name.startsWith("Greater Jakarta"))).toBe(false);
    const withGtr = aggregateZones(
      [incident({ location: "Bekasi", severity: "moderate" })],
      JAKARTA_ZONES,
    ).active;
    const gtr = withGtr.find((z) => z.def.name.startsWith("Greater Jakarta"));
    expect(gtr).toBeDefined();
    expect(gtr!.number).toBe(7);
  });

  it("regression: zones without alwaysShow omit zero-count zones (other theatres unchanged)", () => {
    const plain = [
      { name: "Alpha", center: [0, 0] as [number, number], places: ["alpha"] },
      { name: "Beta", center: [1, 1] as [number, number], places: ["beta"] },
    ];
    const { active } = aggregateZones(
      [incident({ location: "alpha town", severity: "low" })],
      plain,
    );
    expect(active.map((z) => z.def.name)).toEqual(["Alpha"]);
    expect(active[0].number).toBe(1);
  });
});
