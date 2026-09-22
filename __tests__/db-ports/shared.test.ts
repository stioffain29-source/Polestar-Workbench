import {
  DEFAULT_DB_PORTS_PARAMETERS,
  DEFAULT_DB_PORTS_SETTINGS,
  assessDbPortsItem,
  buildDbPortsQuality,
  canonicalDbPortsCountry,
  editionWindow,
  emptyDbPortsItem,
  flagDuplicates,
  importDbPortsDiscovery,
  isCalendarDate,
  normaliseParameters,
  normaliseStoredItem,
  type DbPortsDiscoveryRow,
  type DbPortsEvidence,
  type DbPortsItem,
  type DbPortsItemContent,
  type DbPortsParameters,
} from "../../lib/db-ports/src/index";

const window = editionWindow("2026-09-22");
const now = "2026-09-22T06:00:00.000Z";

/** Body text of a stated length, so word-count rules are exercised exactly. */
function filler(count: number): string {
  return Array.from({ length: count }, (_, index) => `word${index % 9}`).join(" ");
}

function evidence(overrides: Partial<DbPortsEvidence> = {}): DbPortsEvidence {
  return {
    id: "e1",
    sourceName: "Maritime and Port Authority",
    sourceUrl: "https://authority.example/notices/1",
    sourceType: "official",
    publishedDate: "2026-09-21",
    sourceDate: "2026-09-21",
    retrievedAt: now,
    excerpt: "The gate is closed for repairs.",
    originalTitle: "Gate closure notice",
    sourceRecord: null,
    verified: true,
    ...overrides,
  };
}

function content(overrides: Partial<DbPortsItemContent> = {}): DbPortsItemContent {
  return {
    ...emptyDbPortsItem(),
    headline: "Container terminal gate closed after a quay crane failure",
    country: "Singapore",
    location: "Port of Singapore",
    assets: ["Terminal 3"],
    eventDate: "2026-09-21",
    theme: "port_terminal_operations",
    disposition: "selected",
    severity: "Moderate",
    confidence: "corroborated",
    summary: filler(110),
    operationalImpact: filler(25),
    polestarView: filler(25),
    outlook: filler(15),
    materialityReason: "The closure removes one of three landside access gates.",
    impactAreas: ["landside_access"],
    evidence: [
      evidence(),
      evidence({ id: "e2", sourceName: "Independent newspaper", sourceUrl: "https://newspaper.example/story", sourceType: "news" }),
    ],
    ...overrides,
  };
}

function item(id = "i1", overrides: Partial<DbPortsItemContent> = {}): DbPortsItem {
  const body = content(overrides);
  return { ...body, id, mergedInto: null, updatedAt: now, drafted: false, warnings: assessDbPortsItem(body, window) };
}

function codes(body: DbPortsItemContent, parameters?: DbPortsParameters): string[] {
  return assessDbPortsItem(body, window, parameters).map((entry) => entry.code);
}

function row(overrides: Partial<DbPortsDiscoveryRow> = {}): DbPortsDiscoveryRow {
  return {
    id: "incident:1",
    title: "Container terminal access suspended at named Singapore port after a power outage",
    summary: "Source-reported disruption; actual duration still requires checking.",
    country: "Singapore",
    location: "Port of Singapore",
    sourceName: "Discovery publisher",
    sourceUrl: "https://publisher.example/story",
    sourceDate: "2026-09-21",
    eventDate: null,
    ...overrides,
  };
}

describe("Ports and Logistics reporting period and geography", () => {
  test("the inclusive calendar window is exactly 14 days and timezone-independent", () => {
    expect(window).toEqual({ startDate: "2026-09-09", endDate: "2026-09-22" });
    expect(editionWindow("2028-03-01").startDate).toBe("2028-02-17");
    expect(isCalendarDate("2026-02-30")).toBe(false);
    expect(() => editionWindow("2026-02-30")).toThrow();
  });

  test("scope is APAC and Oceania, with Hong Kong independently attributed", () => {
    expect(canonicalDbPortsCountry("Hong Kong SAR")).toBe("Hong Kong");
    expect(canonicalDbPortsCountry("PNG")).toBe("Papua New Guinea");
    for (const country of ["India", "Bangladesh", "Pakistan", "Sri Lanka", "Iran", "Yemen", "Unknown"]) {
      expect(codes(content({ country }))).toContain("excluded_geography");
    }
  });
});

describe("Editor-only item warnings", () => {
  test("a complete, corroborated, in-window item raises nothing", () => {
    expect(assessDbPortsItem(content(), window, DEFAULT_DB_PORTS_PARAMETERS)).toEqual([]);
  });

  test("each defect is reported under its own code", () => {
    expect(codes(content({ evidence: [] }))).toContain("missing_source");
    expect(codes(content({
      evidence: [evidence({ publishedDate: null, sourceDate: null })],
    }))).toContain("missing_source");
    expect(codes(content({ eventDate: null }))).toContain("missing_event_date");
    expect(codes(content({ eventDate: "2026-09-30" }))).toContain("missing_event_date");
    expect(codes(content({ location: "", assets: [] }))).toContain("missing_location");
    expect(codes(content({ impactAreas: [], operationalImpact: "" }))).toContain("weak_operational_connection");
    expect(codes(content({ evidence: [evidence()] }))).toContain("single_source");
    expect(codes(content({
      evidence: [evidence({ sourceType: "discovery" }), evidence({ id: "e2", sourceUrl: "https://news.google.com/read/abc", sourceType: "news" })],
    }))).toContain("aggregator_only");
    expect(codes(content({ summary: filler(20) }))).toContain("item_length");
    expect(codes(content({ summary: filler(400) }))).toContain("item_length");
  });

  test("configured exclusions are matched against the item's own text", () => {
    const flagged = assessDbPortsItem(
      content({ headline: "Red Sea rerouting lengthens Singapore transhipment calls" }),
      window,
      DEFAULT_DB_PORTS_PARAMETERS,
    );
    expect(flagged.map((entry) => entry.message).join(" ")).toContain('excluded term "Red Sea"');
    const narrowed = { ...DEFAULT_DB_PORTS_PARAMETERS, includedCountries: ["Malaysia"] };
    expect(codes(content(), narrowed)).toContain("excluded_geography");
  });

  test("the maximum item word count comes from the configuration panel", () => {
    const longer = { ...DEFAULT_DB_PORTS_PARAMETERS, itemWordTarget: 400 };
    expect(codes(content({ summary: filler(300) }))).toContain("item_length");
    expect(codes(content({ summary: filler(300) }), longer)).not.toContain("item_length");
  });

  test("watchlist entries are short by design and exempt from item-length and impact rules", () => {
    const watch = content({ disposition: "watch", summary: "", operationalImpact: "", impactAreas: [], polestarView: "", outlook: "Trigger: a further gate closure." });
    expect(codes(watch)).not.toContain("item_length");
    expect(codes(watch)).not.toContain("weak_operational_connection");
  });
});

describe("Same-event handling and edition quality", () => {
  test("two reports of one event are flagged, and separate countries are not", () => {
    const flagged = flagDuplicates([
      item("a", { headline: "Container terminal gate closed after a quay crane failure" }),
      item("b", { headline: "Quay crane failure closes container terminal gate" }),
      item("c", { headline: "Quay crane failure closes container terminal gate", country: "Malaysia", location: "Port Klang" }),
    ]);
    expect(flagged[0]!.warnings.some((entry) => entry.code === "possible_duplicate")).toBe(true);
    expect(flagged[1]!.warnings.some((entry) => entry.code === "possible_duplicate")).toBe(true);
    expect(flagged[2]!.warnings.some((entry) => entry.code === "possible_duplicate")).toBe(false);
  });

  test("quality counts every disposition and prefers a shorter report to padding", () => {
    const quality = buildDbPortsQuality({
      overview: filler(200),
      parameters: DEFAULT_DB_PORTS_PARAMETERS,
      coverage: [{ sourceId: "recaap", status: "unavailable", checkedAt: now, notes: "Site unreachable." }],
      items: [
        item("s1"),
        item("w1", { disposition: "watch" }),
        item("h1", { disposition: "hold" }),
        item("i1", { disposition: "inbox" }),
        item("r1", { disposition: "rejected" }),
      ],
    });
    expect(quality).toMatchObject({ selectedCount: 1, watchCount: 1, heldCount: 1, inboxCount: 1, rejectedCount: 1, sourceFailures: 1 });
    expect(quality.warnings.join(" ")).toContain("A shorter report is preferable to padding");
    expect(quality.warnings.join(" ")).toContain("coverage gap");
  });

  test("the Regional Overview band and the five-entry Watchlist cap are reported", () => {
    const short = buildDbPortsQuality({
      overview: filler(90),
      parameters: DEFAULT_DB_PORTS_PARAMETERS,
      coverage: [],
      items: Array.from({ length: 6 }, (_, index) => item(`w${index}`, { disposition: "watch" })),
    });
    expect(short.warnings.join(" ")).toContain(
      `the configured length is 150–${DEFAULT_DB_PORTS_PARAMETERS.overviewWordTarget}`,
    );
    expect(short.warnings.join(" ")).toContain("the report allows five");
    expect(short.warnings.join(" ")).toContain("No priority item has been selected yet");
  });

  test("the overview ceiling follows the configured length and stays inside the report standard", () => {
    const long = buildDbPortsQuality({
      overview: filler(240),
      parameters: { ...DEFAULT_DB_PORTS_PARAMETERS, overviewWordTarget: 250 },
      coverage: [],
      items: [item("s1", { disposition: "selected" })],
    });
    expect(long.warnings.join(" ")).not.toContain("Regional Overview runs to");
    const capped = buildDbPortsQuality({
      overview: filler(240),
      parameters: { ...DEFAULT_DB_PORTS_PARAMETERS, overviewWordTarget: 900 },
      coverage: [],
      items: [item("s1", { disposition: "selected" })],
    });
    expect(capped.warnings.join(" ")).not.toContain("Regional Overview runs to");
    const over = buildDbPortsQuality({
      overview: filler(260),
      parameters: { ...DEFAULT_DB_PORTS_PARAMETERS, overviewWordTarget: 900 },
      coverage: [],
      items: [item("s1", { disposition: "selected" })],
    });
    expect(over.warnings.join(" ")).toContain("the configured length is 150–250");
  });
});

describe("Stored report migration", () => {
  test("word targets saved under older limits normalise into the band the server accepts", () => {
    const normalised = normaliseParameters({ itemWordTarget: 60, overviewWordTarget: 80 });
    expect(normalised.itemWordTarget).toBe(150);
    expect(normalised.overviewWordTarget).toBe(150);
    const generous = normaliseParameters({ itemWordTarget: 900, overviewWordTarget: 900 });
    expect(generous.itemWordTarget).toBe(600);
    expect(generous.overviewWordTarget).toBe(250);
  });


  test("text written under the pilot field names is carried across, review fields are dropped", () => {
    const migrated = normaliseStoredItem({
      id: "legacy-1",
      headline: "Legacy item",
      country: "Singapore",
      theme: "operations",
      disposition: "selected",
      confirmedFacts: "What the analyst wrote as confirmed facts.",
      operationalImplications: "What the analyst wrote as operational implications.",
      reviewed: true,
      reviewer: "Analyst",
      secondaryReviewRequired: true,
      blockers: ["Needs a second review."],
      evidence: [{ id: "e1", sourceName: "Publisher", sourceUrl: "https://publisher.example/a", retrievedAt: now }],
    });
    expect(migrated.summary).toBe("What the analyst wrote as confirmed facts.");
    expect(migrated.operationalImpact).toBe("What the analyst wrote as operational implications.");
    expect(migrated.theme).toBe("port_terminal_operations");
    expect(migrated.warnings).toEqual([]);
    expect(migrated.drafted).toBe(false);
    expect(Object.keys(migrated)).not.toContain("blockers");
    expect(Object.keys(migrated)).not.toContain("reviewed");
  });

  test("an older report inherits any parameter it predates from the saved preset", () => {
    const parameters = normaliseParameters({ customerName: "DB Ports", targetItems: 900 });
    expect(parameters.customerName).toBe("DB Ports");
    expect(parameters.targetItems).toBe(40);
    expect(parameters.includedThemes).toEqual(DEFAULT_DB_PORTS_PARAMETERS.includedThemes);
    expect(normaliseParameters(null, { ...DEFAULT_DB_PORTS_PARAMETERS, customerName: "Preset customer" }).customerName)
      .toBe("Preset customer");
  });
});

describe("Collected-material import", () => {
  test("initial targets are never asserted to be client assets or checked feeds", () => {
    expect(DEFAULT_DB_PORTS_SETTINGS.watchlist.every((target) => !target.confirmedClientAsset)).toBe(true);
    expect(DEFAULT_DB_PORTS_SETTINGS.sources.every((source) => source.status === "pending" && source.accessMode === "manual")).toBe(true);
    expect(DEFAULT_DB_PORTS_SETTINGS.sources.some((source) => source.id === "recaap")).toBe(true);
  });

  test("imports preserve provenance but never infer verified facts, publication date or severity", () => {
    const result = importDbPortsDiscovery([row()], [], window, DEFAULT_DB_PORTS_SETTINGS.watchlist, now);
    expect(result.added).toBe(1);
    const imported = result.items[0]!;
    expect(imported.disposition).toBe("inbox");
    expect(imported.drafted).toBe(false);
    expect(imported.severity).toBeNull();
    expect(imported.summary).toBe("");
    expect(imported.unverifiedClaims).toContain("Source-reported");
    expect(imported.evidence[0]).toMatchObject({ sourceRecord: "incident:1", publishedDate: null, sourceDate: "2026-09-21", verified: false });
    expect(importDbPortsDiscovery([row()], result.items, window, DEFAULT_DB_PORTS_SETTINGS.watchlist, now).added).toBe(0);
  });

  test("out-of-scope, generic, sports and stale records cannot populate the queue", () => {
    const rows = [
      row({ id: "india", country: "India" }),
      row({ id: "unknown", country: "Unknown" }),
      row({ id: "sport", title: "Port Adelaide football striker wins match" }),
      row({ id: "old", sourceDate: "2026-09-08" }),
      row({ id: "sea", title: "Houthi Red Sea attacks affect container terminal operations" }),
      row({ id: "generic", title: "Regional economic performance", summary: "An economic outlook.", location: "" }),
    ];
    expect(importDbPortsDiscovery(rows, [], window, [], now).items).toEqual([]);
  });

  test("same-event reports are combined and every corroborating source is retained", () => {
    const rows = [
      row(),
      row({ id: "gdelt:2", sourceUrl: "https://publisher.example/story?utm_source=test" }),
      row({ id: "gdelt:3", sourceUrl: "https://second.example/corroboration", sourceName: "Second publisher" }),
      row({ id: "different", title: "Container terminal access suspended at different Malaysia port after an unrelated outage", country: "Malaysia", sourceUrl: "https://third.example/distinct" }),
    ];
    const result = importDbPortsDiscovery(rows, [], window, [], now);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]!.evidence).toHaveLength(2);
    expect(result.duplicates).toBe(2);
  });

  test("new evidence on a selected item returns it to the analyst rather than extending the old text", () => {
    const selected = item("i1", { headline: row().title });
    const extra = row({ id: "incident:9", title: selected.headline, sourceUrl: "https://new.example/update" });
    const result = importDbPortsDiscovery([extra], [selected], window, [], now);
    expect(result.items[0]).toMatchObject({ disposition: "hold", confidence: "unverified" });
    expect(result.items[0]!.evidence).toHaveLength(3);
    expect(result.items[0]!.summary).toBe(selected.summary);
  });

  test("explicit cluster links survive repeated imports without mixing countries", () => {
    const original = row({ clusterKey: "same-event" });
    const previous = importDbPortsDiscovery([original], [], window, [], now);
    const followup = row({ id: "incident:2", title: "Named terminal announces restoration of cargo access", sourceUrl: "https://other.example/update", clusterKey: "same-event" });
    const otherCountry = row({ id: "incident:3", country: "Malaysia", sourceUrl: original.sourceUrl, clusterKey: "same-event" });
    const result = importDbPortsDiscovery([followup, original, otherCountry], previous.items, window, [], now);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]!.evidence).toHaveLength(2);
    expect(result.items[1]!.country).toBe("Malaysia");
  });
});
