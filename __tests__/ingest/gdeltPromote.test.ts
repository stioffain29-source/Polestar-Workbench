import {
  decidePromotion,
  promotionForLane,
  resolvePromoteCountry,
  promoteMarker,
  markerExternalId,
  gdeltDedupeKey,
  deriveActors,
  IN_SCOPE_COUNTRIES,
  PROMOTE_MARKER_PREFIX,
  type GdeltPromoteInput,
} from "@workspace/ingest";
import { RELEVANCE_RULE_VERSION } from "@workspace/relevance";

// A minimal lane-bearing GDELT event fixture. Callers override the fields the
// test cares about.
function ev(over: Partial<GdeltPromoteInput> = {}): GdeltPromoteInput {
  return {
    kind: "event",
    externalId: "conflict_abc123",
    lane: "Protests",
    subBucket: null,
    country: "Indonesia",
    location: "Central Jakarta",
    latitude: -6.18,
    longitude: 106.83,
    sourceDate: new Date("2026-07-01T00:00:00.000Z"),
    title: "Workers rally outside ministry in Jakarta",
    summary: "Several hundred workers gathered to demand wage protections.",
    url: "https://gdeltcloud.com/events/conflict_abc123",
    primaryStoryUrl: "https://news.example.com/jakarta-rally",
    fatalities: null,
    actors: [],
    ...over,
  };
}

describe("promotionForLane", () => {
  it("maps protests and civil unrest to relevant flashpoint", () => {
    expect(promotionForLane("Protests")).toEqual({
      topic: "flashpoint",
      status: "relevant",
      score: 1,
    });
    expect(promotionForLane("Civil unrest and riots")).toEqual({
      topic: "flashpoint",
      status: "relevant",
      score: 1,
    });
  });

  it("maps security incidents to relevant conflict", () => {
    expect(promotionForLane("Security incidents")).toEqual({
      topic: "conflict",
      status: "relevant",
      score: 1,
    });
  });

  it("maps crime and transport disruption to irrelevant (geography-only) flashpoint", () => {
    expect(promotionForLane("Crime")).toEqual({
      topic: "flashpoint",
      status: "irrelevant",
      score: 0,
    });
    expect(promotionForLane("Transport disruption")).toEqual({
      topic: "flashpoint",
      status: "irrelevant",
      score: 0,
    });
  });

  it("returns null for unknown or missing lanes", () => {
    expect(promotionForLane("Weather")).toBeNull();
    expect(promotionForLane(null)).toBeNull();
    expect(promotionForLane("")).toBeNull();
  });
});

describe("resolvePromoteCountry", () => {
  it("re-homes Indonesian Papua to West Papua", () => {
    expect(resolvePromoteCountry("Indonesia", "Indonesian Papua")).toBe("West Papua");
  });

  it("keeps Jakarta events under Indonesia", () => {
    expect(resolvePromoteCountry("Indonesia", "Jakarta")).toBe("Indonesia");
    expect(resolvePromoteCountry("Indonesia", null)).toBe("Indonesia");
  });

  it("passes other in-scope countries through verbatim", () => {
    expect(resolvePromoteCountry("Philippines", null)).toBe("Philippines");
    expect(resolvePromoteCountry("Papua New Guinea", null)).toBe("Papua New Guinea");
  });

  it("returns null for a blank country", () => {
    expect(resolvePromoteCountry("", null)).toBeNull();
    expect(resolvePromoteCountry(null, null)).toBeNull();
  });
});

describe("IN_SCOPE_COUNTRIES", () => {
  it("contains exactly the four tracked countries", () => {
    expect([...IN_SCOPE_COUNTRIES].sort()).toEqual([
      "Indonesia",
      "Papua New Guinea",
      "Philippines",
      "Thailand",
    ]);
  });
});

describe("promoteMarker / markerExternalId", () => {
  it("round-trips the external id", () => {
    const note = promoteMarker("conflict_xyz");
    expect(note).toBe(`${PROMOTE_MARKER_PREFIX}conflict_xyz`);
    expect(markerExternalId(note)).toBe("conflict_xyz");
  });

  it("returns null for non-promote notes", () => {
    expect(markerExternalId("auto-scraped:flashpoint-national")).toBeNull();
    expect(markerExternalId(null)).toBeNull();
    expect(markerExternalId(PROMOTE_MARKER_PREFIX)).toBeNull();
  });
});

describe("gdeltDedupeKey", () => {
  it("mirrors the news-topic dedupe formula (title|date|country|topic)", () => {
    const key = gdeltDedupeKey(
      "  Workers Rally  ",
      new Date("2026-07-01T18:30:00.000Z"),
      "Indonesia",
      "flashpoint",
    );
    expect(key).toBe("workers rally||2026-07-01||indonesia||flashpoint");
  });
});

describe("deriveActors", () => {
  it("prefers actor1 / actor2 roles", () => {
    expect(
      deriveActors([
        { name: "Protesters", role: "actor1" },
        { name: "Police", role: "actor2" },
      ]),
    ).toBe("Protesters / Police");
  });

  it("falls back to source / target roles", () => {
    expect(
      deriveActors([
        { name: "Militants", role: "source" },
        { name: "Army", role: "target" },
      ]),
    ).toBe("Militants / Army");
  });

  it("falls back to the first two names when roles are absent", () => {
    expect(deriveActors([{ name: "Group A" }, { name: "Group B" }])).toBe("Group A / Group B");
  });

  it("returns null for empty or junk input", () => {
    expect(deriveActors([])).toBeNull();
    expect(deriveActors(null)).toBeNull();
    expect(deriveActors([1, "x", { role: "actor1" }])).toBeNull();
  });
});

describe("decidePromotion", () => {
  it("refuses stories (lane-less)", () => {
    const d = decidePromotion(ev({ kind: "story", lane: null }));
    expect(d).toEqual({ promote: false, reason: "not-event" });
  });

  it("refuses events with an unmapped lane", () => {
    const d = decidePromotion(ev({ lane: "Weather" }));
    expect(d).toEqual({ promote: false, reason: "unmapped-lane" });
  });

  it("refuses events with no source date", () => {
    const d = decidePromotion(ev({ sourceDate: null }));
    expect(d).toEqual({ promote: false, reason: "no-date" });
  });

  it("refuses out-of-scope countries", () => {
    const d = decidePromotion(ev({ country: "Netherlands" }));
    expect(d).toEqual({ promote: false, reason: "out-of-scope" });
  });

  it("promotes a Jakarta protest into a relevant flashpoint incident", () => {
    const d = decidePromotion(ev());
    expect(d.promote).toBe(true);
    if (!d.promote) return;
    expect(d.topic).toBe("flashpoint");
    expect(d.row.topic).toBe("flashpoint");
    expect(d.row.country).toBe("Indonesia");
    expect(d.row.relevanceStatus).toBe("relevant");
    expect(d.row.relevanceScore).toBe(1);
    expect(d.row.relevanceReason).toBe("gdelt lane: Protests");
    expect(d.row.relevanceVersion).toBe(RELEVANCE_RULE_VERSION);
    expect(d.row.category).toBe("Protests");
    expect(d.row.source).toBe("GDELT Cloud");
    // primaryStoryUrl wins over the synthetic gdeltcloud url.
    expect(d.row.sourceUrl).toBe("https://news.example.com/jakarta-rally");
    // idempotency marker.
    expect(d.row.analystNotes).toBe(`${PROMOTE_MARKER_PREFIX}conflict_abc123`);
    // GDELT's own precise coordinates are used directly, not a centroid.
    expect(d.row.latitude).toBe(-6.18);
    expect(d.row.longitude).toBe(106.83);
  });

  it("promotes a security incident into a relevant conflict incident", () => {
    const d = decidePromotion(
      ev({
        lane: "Security incidents",
        country: "Papua New Guinea",
        subBucket: null,
        title: "Tribal clash reported in the Highlands",
        location: "Enga Province",
      }),
    );
    expect(d.promote).toBe(true);
    if (!d.promote) return;
    expect(d.topic).toBe("conflict");
    expect(d.row.topic).toBe("conflict");
    expect(d.row.country).toBe("Papua New Guinea");
    expect(d.row.relevanceStatus).toBe("relevant");
  });

  it("promotes crime as geography-only context (irrelevant)", () => {
    const d = decidePromotion(ev({ lane: "Crime", title: "Robbery reported in Manila", country: "Philippines" }));
    expect(d.promote).toBe(true);
    if (!d.promote) return;
    expect(d.row.topic).toBe("flashpoint");
    expect(d.row.relevanceStatus).toBe("irrelevant");
    expect(d.row.relevanceScore).toBe(0);
  });

  it("re-homes an Indonesian Papua event to West Papua", () => {
    const d = decidePromotion(
      ev({
        lane: "Security incidents",
        subBucket: "Indonesian Papua",
        title: "Security operation in the highlands",
      }),
    );
    expect(d.promote).toBe(true);
    if (!d.promote) return;
    expect(d.row.country).toBe("West Papua");
  });

  it("floors severity on a confirmed fatality count", () => {
    const d = decidePromotion(
      ev({
        lane: "Security incidents",
        title: "Community meeting held peacefully",
        summary: "A routine gathering.",
        fatalities: 1,
      }),
    );
    expect(d.promote).toBe(true);
    if (!d.promote) return;
    // A benign headline would classify low, but one confirmed death floors it to high.
    expect(d.row.severity).toBe("high");
  });

  it("rates a mass-fatality event extreme", () => {
    const d = decidePromotion(
      ev({ lane: "Security incidents", title: "Attack reported", fatalities: 8 }),
    );
    expect(d.promote).toBe(true);
    if (!d.promote) return;
    expect(d.row.severity).toBe("extreme");
  });

  it("falls back to the title when the summary is null", () => {
    const d = decidePromotion(ev({ summary: null, title: "Rally in Bangkok", country: "Thailand" }));
    expect(d.promote).toBe(true);
    if (!d.promote) return;
    expect(d.row.summary).toBe("Rally in Bangkok");
  });
});
