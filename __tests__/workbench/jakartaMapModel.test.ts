import {
  buildJakartaMapModel,
  categoriseJakartaMapIncident,
  geocodeJakartaIncident,
  JAKARTA_MAP_PLOT_BBOX,
} from "../../artifacts/workbench/src/lib/jakartaMapModel";
import type { CountryFastFactsIncident } from "../../artifacts/workbench/src/lib/countryFastFacts";

function inc(p: Partial<CountryFastFactsIncident>): CountryFastFactsIncident {
  return {
    topic: "flashpoint",
    title: "",
    severity: "Moderate",
    occurredAt: "2026-06-20T00:00:00Z",
    ...p,
  };
}

describe("geocodeJakartaIncident — named gazetteer matches", () => {
  it("matches Monas from the headline → govt zone", () => {
    const g = geocodeJakartaIncident(inc({ title: "Protest near Monas draws crowds" }));
    expect(g).not.toBeNull();
    expect(g!.confidence).toBe("named");
    expect(g!.zoneId).toBe("govt");
    expect(g!.matchedName).toBe("monas");
  });

  it("matches Tanjung Priok from the location → priok zone", () => {
    const g = geocodeJakartaIncident(
      inc({ location: "Tanjung Priok, North Jakarta", title: "Container backlog" }),
    );
    expect(g!.confidence).toBe("named");
    expect(g!.zoneId).toBe("priok");
  });

  it("matches SCBD from the headline → scbd-senayan zone", () => {
    const g = geocodeJakartaIncident(inc({ title: "Office evacuation in SCBD" }));
    expect(g!.zoneId).toBe("scbd-senayan");
  });

  it("matches Mega Kuningan from the location → kuningan zone", () => {
    const g = geocodeJakartaIncident(inc({ location: "Mega Kuningan" }));
    expect(g!.zoneId).toBe("kuningan");
  });

  it("matches Soekarno-Hatta from the location → airport zone", () => {
    const g = geocodeJakartaIncident(
      inc({ location: "Soekarno-Hatta airport", title: "Long delays reported" }),
    );
    expect(g!.zoneId).toBe("airport");
  });

  it("a hyphenated place at the tail of a headline is lost to the masthead strip", () => {
    // Documented limitation (mirrors the corridor attribution helper): the
    // trailing "-Hatta airport" is treated as a masthead tail and stripped, so
    // a title-only Soekarno-Hatta mention does not geocode. Such records are
    // carried honestly in the "not mapped" note — never placed at a guessed
    // point. The fix in real data is to carry the term in the location field.
    const g = geocodeJakartaIncident(inc({ title: "Long delays at Soekarno-Hatta airport" }));
    expect(g).toBeNull();
  });

  it("prefers a location match over a conflicting title match", () => {
    const g = geocodeJakartaIncident(
      inc({ location: "Tanjung Priok", title: "Protest at Monas" }),
    );
    // Location wins → Priok, not the title's Monas.
    expect(g!.zoneId).toBe("priok");
  });

  it("does not match a place that only appears in the stripped masthead", () => {
    const g = geocodeJakartaIncident(inc({ title: "Citywide rally planned - SCBD Post" }));
    expect(g).toBeNull();
  });

  it("excludes coarse regency names (Tangerang / Bekasi / Depok)", () => {
    expect(geocodeJakartaIncident(inc({ location: "Tangerang" }))).toBeNull();
    expect(geocodeJakartaIncident(inc({ title: "Flooding hits Bekasi" }))).toBeNull();
    expect(geocodeJakartaIncident(inc({ location: "Depok" }))).toBeNull();
  });

  it("returns null when there is no resolvable location", () => {
    expect(geocodeJakartaIncident(inc({ title: "Cabinet reshuffle announced" }))).toBeNull();
  });
});

describe("geocodeJakartaIncident — explicit coordinates", () => {
  it("accepts explicit coordinates inside the plot box", () => {
    const g = geocodeJakartaIncident(inc({ latitude: -6.2, longitude: 106.82, title: "x" }));
    expect(g).not.toBeNull();
    expect(g!.confidence).toBe("explicit");
    expect(g!.lat).toBeCloseTo(-6.2, 5);
    expect(g!.lon).toBeCloseTo(106.82, 5);
  });

  it("assigns a nearby operating zone to explicit coordinates", () => {
    // Right on the Tanjung Priok point.
    const g = geocodeJakartaIncident(inc({ latitude: -6.105, longitude: 106.881, title: "x" }));
    expect(g!.confidence).toBe("explicit");
    expect(g!.zoneId).toBe("priok");
  });

  it("ignores out-of-box coordinates and falls back to a named match", () => {
    const g = geocodeJakartaIncident(
      inc({ latitude: 10, longitude: 120, title: "Rally at Monas" }),
    );
    expect(g!.confidence).toBe("named");
    expect(g!.zoneId).toBe("govt");
  });

  it("returns null for out-of-box coordinates with no named match", () => {
    expect(
      geocodeJakartaIncident(inc({ latitude: 0, longitude: 0, title: "Summit opens" })),
    ).toBeNull();
  });

  it("plot box is wider than the visible ops frame (airport approach allowed)", () => {
    expect(JAKARTA_MAP_PLOT_BBOX.minLon).toBeLessThan(106.62);
  });
});

describe("categoriseJakartaMapIncident — five operational lanes", () => {
  it("maps protest → protest-policing", () => {
    expect(categoriseJakartaMapIncident(inc({ title: "Protest disrupts Sudirman" }))).toBe(
      "protest-policing",
    );
  });
  it("maps policing → protest-policing", () => {
    expect(categoriseJakartaMapIncident(inc({ title: "Police raid in Tebet" }))).toBe(
      "protest-policing",
    );
  });
  it("maps flooding → flooding-weather", () => {
    expect(categoriseJakartaMapIncident(inc({ title: "Severe flooding in North Jakarta" }))).toBe(
      "flooding-weather",
    );
  });
  it("maps crime → crime-safety", () => {
    expect(categoriseJakartaMapIncident(inc({ title: "Armed robbery at a mall" }))).toBe(
      "crime-safety",
    );
  });
  it("maps fire → fire-emergency", () => {
    expect(categoriseJakartaMapIncident(inc({ title: "Major fire at a warehouse" }))).toBe(
      "fire-emergency",
    );
  });
  it("maps traffic → port-logistics", () => {
    expect(categoriseJakartaMapIncident(inc({ title: "Severe congestion on the toll road" }))).toBe(
      "port-logistics",
    );
  });
  it("returns null for an out-of-scope type", () => {
    expect(categoriseJakartaMapIncident(inc({ title: "Economic summit opens" }))).toBeNull();
  });
});

describe("buildJakartaMapModel — honest plot + not-mapped tallies", () => {
  const incidents = [
    inc({ id: 2, title: "Protest near Monas" }), // mapped: protest-policing, govt
    inc({ id: 1, location: "Tanjung Priok", title: "Container congestion" }), // mapped: port-logistics
    inc({ id: 3, title: "Nationwide cabinet protest" }), // protest but no location → insufficientLocation
    inc({ id: 4, title: "Economic forum at SCBD" }), // located but type not mapped → typeNotMapped
  ];

  const model = buildJakartaMapModel(incidents);

  it("plots only located + categorised incidents", () => {
    expect(model.points).toHaveLength(2);
  });

  it("counts not-mapped reasons separately and never drops a record", () => {
    expect(model.notMapped.insufficientLocation).toBe(1);
    expect(model.notMapped.typeNotMapped).toBe(1);
    expect(model.notMapped.total).toBe(2);
    expect(model.points.length + model.notMapped.total).toBe(incidents.length);
  });

  it("sorts points by id for deterministic rendering", () => {
    expect(model.points.map((p) => p.id)).toEqual(["1", "2"]);
  });

  it("carries category + confidence + zone on each point", () => {
    const monas = model.points.find((p) => p.id === "2")!;
    expect(monas.category).toBe("protest-policing");
    expect(monas.confidence).toBe("named");
    expect(monas.zoneId).toBe("govt");
  });
});
