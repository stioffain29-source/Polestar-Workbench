import {
  assessDbPortsItem, buildDbPortsQuality, canonicalDbPortsCountry, DEFAULT_DB_PORTS_SETTINGS,
  emptyDbPortsItem, editionWindow, importDbPortsDiscovery, isCalendarDate,
  type DbPortsDiscoveryRow, type DbPortsEdition, type DbPortsItem, type DbPortsItemContent,
} from "../../lib/db-ports/src/index";

const window = editionWindow("2026-09-22");
const now = "2026-09-22T06:00:00.000Z";

function content(overrides: Partial<DbPortsItemContent> = {}): DbPortsItemContent {
  return {
    ...emptyDbPortsItem(), headline: "A named terminal closes its gate for a confirmed short repair",
    country: "Singapore", location: "Named terminal", eventDate: "2026-09-21",
    disposition: "selected", severity: "Low", confidence: "official",
    confirmedFacts: "The authority confirms that the terminal access gate was closed for repairs.",
    operationalImplications: "Use the authority's stated alternate gate during the repair.",
    materialityReason: "The notice identifies an actual gate closure and alternate access.",
    outlook: "Watch for the authority's gate reopening notice.",
    impactAreas: ["landside_access"], reviewed: true, reviewer: "Primary reviewer",
    evidence: [{
      id: "e1", sourceName: "Test port authority", sourceUrl: "https://authority.example/notice-1",
      sourceType: "official", publishedDate: "2026-09-21", sourceDate: "2026-09-21",
      retrievedAt: now, excerpt: "The gate is closed for repairs. Use the alternate gate.",
      originalTitle: "Gate closure", sourceRecord: null, verified: true,
    }],
    ...overrides,
  };
}

function item(id = "i1", overrides: Partial<DbPortsItemContent> = {}): DbPortsItem {
  const body = content(overrides);
  return { ...body, id, mergedInto: null, updatedAt: now, ...assessDbPortsItem(body, window) };
}

function edition(overrides: Partial<DbPortsEdition> = {}): DbPortsEdition {
  const body = {
    id: 1, title: "TEST — unpublished pilot", ...window, overview: "Evidence ".repeat(160).trim(),
    status: "draft" as const, revision: 1, items: [item()],
    worklog: [{ id: "w1", activity: "verification" as const, minutes: 45, notes: "Checked notice.", createdAt: now }],
    coverage: [{ sourceId: "recaap", status: "checked" as const, checkedAt: now, notes: "Manual source check." }],
    history: [], createdAt: now, updatedAt: now, approvedAt: null, ...overrides,
  };
  return { ...body, quality: buildDbPortsQuality(body) };
}

function row(overrides: Partial<DbPortsDiscoveryRow> = {}): DbPortsDiscoveryRow {
  return {
    id: "incident:1", title: "Container terminal access suspended at named Singapore port after a power outage",
    summary: "Source-reported disruption; actual duration still requires checking.", country: "Singapore",
    location: "Port of Singapore", sourceName: "Discovery publisher",
    sourceUrl: "https://publisher.example/story", sourceDate: "2026-09-21", eventDate: null,
    ...overrides,
  };
}

describe("DB Ports pilot editorial gates", () => {
  test("the inclusive calendar window is exactly14 days and timezone-independent", () => {
    expect(window).toEqual({ startDate: "2026-09-09", endDate: "2026-09-22" });
    expect(editionWindow("2028-03-01").startDate).toBe("2028-02-17");
    expect(isCalendarDate("2026-02-30")).toBe(false);
    expect(() => editionWindow("2026-02-30")).toThrow();
  });

  test("scope is explicit, with Hong Kong independently attributed", () => {
    expect(canonicalDbPortsCountry("Hong Kong SAR")).toBe("Hong Kong");
    expect(canonicalDbPortsCountry("PNG")).toBe("Papua New Guinea");
    for (const country of ["India", "Bangladesh", "Pakistan", "Sri Lanka", "Nepal", "Iran", "Yemen", "Unknown"]) {
      expect(assessDbPortsItem(content({ country }), window).blockers.join(" ")).toContain("outside");
    }
    expect(assessDbPortsItem(content({ headline: "Red Sea attacks force port rerouting" }), window).blockers.join(" ")).toContain("excluded");
  });

  test("a discovery date, URL and headline are not verification", () => {
    const body = content();
    body.evidence[0]!.verified = false;
    body.evidence[0]!.publishedDate = null;
    expect(assessDbPortsItem(body, window).blockers.join(" ")).toContain("publication date");
    body.evidence[0]!.verified = true;
    body.evidence[0]!.publishedDate = "2026-09-01";
    expect(assessDbPortsItem(body, window).blockers.join(" ")).toContain("14-day window");
  });

  test("severity and confidence remain independent of source authority", () => {
    expect(assessDbPortsItem(content(), window).blockers).toEqual([]);
    const result = assessDbPortsItem(content({ severity: null }), window);
    expect(result.blockers.join(" ")).toContain("current severity");
    expect(result.secondaryReviewRequired).toBe(false);
  });

  test("High/Extreme and sensitive claims need an independent recorded second review", () => {
    const body = content({ severity: "High" });
    expect(assessDbPortsItem(body, window).secondaryReviewRequired).toBe(true);
    expect(assessDbPortsItem(body, window).blockers.join(" ")).toContain("second review");
    body.secondReviewer = body.reviewer;
    body.secondReviewNote = "I looked twice.";
    expect(assessDbPortsItem(body, window).blockers.join(" ")).toContain("second review");
    body.secondReviewer = "Independent reviewer";
    expect(assessDbPortsItem(body, window).blockers).toEqual([]);
    expect(assessDbPortsItem(content({ headline: "Port worker killed in accident" }), window).secondaryReviewRequired).toBe(true);
    expect(assessDbPortsItem(content({ country: "Taiwan", theme: "geopolitical" }), window).secondaryReviewRequired).toBe(true);
  });

  test("syndication is not two independent confirmations", () => {
    const body = content({ confidence: "corroborated" });
    body.evidence[0]!.sourceType = "news";
    body.evidence.push({ ...body.evidence[0]!, id: "e2", sourceUrl: "https://authority.example/followup" });
    expect(assessDbPortsItem(body, window).blockers.join(" ")).toContain("independent");
    body.evidence[1]!.sourceUrl = "https://independent.example/news";
    expect(assessDbPortsItem(body, window).blockers.join(" ")).toContain("independent");
    body.evidence[1]!.sourceName = "Independent newspaper";
    expect(assessDbPortsItem(body, window).blockers).toEqual([]);
  });

  test("future events stay on watch, with uncertainty visibly recorded", () => {
    const body = content({ eventDate: "2026-09-25" });
    expect(assessDbPortsItem(body, window).blockers.join(" ")).toContain("future event");
    body.disposition = "watch";
    body.missingInfo = "Whether planned activity affects terminal access is not established.";
    body.confidence = "unverified";
    expect(assessDbPortsItem(body, window).blockers).toEqual([]);
  });

  test("one verified item is preferable to quota padding; six/five are hard caps", () => {
    expect(edition().quality.readyForReview).toBe(true);
    expect(edition().quality.warnings.join(" ")).toContain("shorter verified edition");
    const selected = Array.from({ length: 7 }, (_, i) => item(`s${i}`));
    const watch = Array.from({ length: 6 }, (_, i) => item(`w${i}`, { disposition: "watch", missingInfo: "Pending confirmation." }));
    const quality = edition({ items: [...selected, ...watch] }).quality;
    expect(quality.blockers.join(" ")).toContain("six priority");
    expect(quality.blockers.join(" ")).toContain("five watch");
    expect(quality.readyForReview).toBe(false);
  });

  test("a zero-result edition stays unapproved and measured effort is never fabricated", () => {
    const quality = edition({ items: [], overview: "", worklog: [], coverage: [] }).quality;
    expect(quality.readyForReview).toBe(false);
    expect(quality.totalMinutes).toBe(0);
    expect(quality.warnings.join(" ")).toContain("zero recorded hours does not mean zero work");
    expect(quality.blockers.join(" ")).toContain("No verified priority");
    const long = edition({ worklog: [{ id: "w2", activity: "review", minutes: 2400, notes: "Actual logged work.", createdAt: now }] });
    expect(long.quality.warnings.join(" ")).toContain("40-hour");
  });
});

describe("DB Ports read-only discovery and provisional roster", () => {
  test("initial targets are never asserted to be client assets or checked feeds", () => {
    expect(DEFAULT_DB_PORTS_SETTINGS.watchlist.every(target => !target.confirmedClientAsset)).toBe(true);
    expect(DEFAULT_DB_PORTS_SETTINGS.sources.every(source => source.status === "pending" && source.accessMode === "manual")).toBe(true);
    expect(DEFAULT_DB_PORTS_SETTINGS.sources.some(source => source.id === "recaap")).toBe(true);
  });

  test("imports preserve provenance but never infer verified facts, publication date or severity", () => {
    const result = importDbPortsDiscovery([row()], [], window, DEFAULT_DB_PORTS_SETTINGS.watchlist, now);
    expect(result.added).toBe(1);
    const imported = result.items[0]!;
    expect(imported.disposition).toBe("inbox");
    expect(imported.severity).toBeNull();
    expect(imported.confirmedFacts).toBe("");
    expect(imported.unverifiedClaims).toContain("Source-reported");
    expect(imported.evidence[0]).toMatchObject({ sourceRecord: "incident:1", publishedDate: null, sourceDate: "2026-09-21", verified: false });
    expect(imported.blockers.length).toBeGreaterThan(0);
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

  test("same-source URLs and exact event titles fold conservatively while retaining corroboration", () => {
    const rows = [
      row(), row({ id: "gdelt:2", sourceUrl: "https://publisher.example/story?utm_source=test" }),
      row({ id: "gdelt:3", sourceUrl: "https://second.example/corroboration", sourceName: "Second publisher" }),
      row({ id: "different", title: "Container terminal access suspended at different Malaysia port after an unrelated outage", country: "Malaysia", sourceUrl: "https://third.example/distinct" }),
    ];
    const result = importDbPortsDiscovery(rows, [], window, [], now);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]!.evidence).toHaveLength(2);
    expect(result.duplicates).toBe(2);
  });

  test("new evidence invalidates a previous selection, rather than silently extending its approval", () => {
    const selected = item("i1", { secondReviewer: "Independent reviewer", secondReviewNote: "Prior assessment." });
    const extra = row({ title: selected.headline, sourceUrl: "https://new.example/update" });
    const result = importDbPortsDiscovery([extra], [selected], window, [], now);
    expect(result.items[0]).toMatchObject({ disposition: "hold", reviewed: false, confidence: "unverified" });
    expect(result.items[0]!.evidence).toHaveLength(2);
    expect(result.items[0]!.confirmedFacts).toBe(selected.confirmedFacts);
    expect(result.items[0]!.secondReviewer).toBe("");
    expect(result.items[0]!.secondReviewNote).toBe("");
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