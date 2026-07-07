import {
  decideXIncident,
  routeTopic,
  matchesDataCentre,
  xDedupeKey,
  xMarker,
  markerPostId,
  X_MARKER_PREFIX,
  type NormalisedTweet,
} from "@workspace/ingest";
import { RELEVANCE_RULE_VERSION } from "@workspace/relevance";

function tweet(over: Partial<NormalisedTweet> = {}): NormalisedTweet {
  return {
    id: "1900000000000000001",
    text: "Workers stage a protest rally in Jakarta over fuel prices.",
    url: "https://x.com/observer/status/1900000000000000001",
    author: "observer",
    createdAt: new Date("2026-07-06T09:00:00.000Z"),
    queryLabel: "flashpoint",
    ...over,
  };
}

describe("matchesDataCentre", () => {
  it("detects data centre content", () => {
    expect(matchesDataCentre("New hyperscale data centre planned near Jakarta")).toBe(true);
    expect(matchesDataCentre("colocation facility outage")).toBe(true);
  });
  it("does not trip on ordinary text", () => {
    expect(matchesDataCentre("Protesters gather in the city centre")).toBe(false);
  });
});

describe("routeTopic precedence", () => {
  it("holds data-centre posts before any incident topic", () => {
    const r = routeTopic({
      title: "Militants clash near the new data centre in Mindanao",
      summary: "Militants clash near the new data centre in Mindanao",
      source: "X",
      sourceUrl: "https://x.com/i/status/1",
    });
    expect(r.kind).toBe("data_centre_candidate");
  });

  it("routes labour strike / protest content to flashpoint", () => {
    const r = routeTopic({
      title: "Workers stage a protest rally in Jakarta over fuel prices",
      summary: "Workers stage a protest rally in Jakarta over fuel prices",
      source: "X",
      sourceUrl: "https://x.com/i/status/1",
    });
    expect(r).toEqual({ kind: "topic", topic: "flashpoint" });
  });

  it("returns none for unroutable content", () => {
    const r = routeTopic({
      title: "Delicious new coffee shop opened downtown today",
      summary: "Delicious new coffee shop opened downtown today",
      source: "X",
      sourceUrl: "https://x.com/i/status/1",
    });
    expect(r.kind).toBe("none");
  });
});

describe("decideXIncident", () => {
  it("skips a data-centre post (held, never inserted)", () => {
    const d = decideXIncident(
      tweet({ text: "Company opens a hyperscale data centre in Jakarta" }),
    );
    expect(d).toEqual({ insert: false, reason: "data-centre-hold" });
  });

  it("skips a post with no tracked country (no fabrication)", () => {
    const d = decideXIncident(
      tweet({ text: "Protesters clash with police during a rally downtown" }),
    );
    expect(d).toEqual({ insert: false, reason: "no-country" });
  });

  it("skips a post with no date", () => {
    const d = decideXIncident(tweet({ createdAt: null }));
    expect(d).toEqual({ insert: false, reason: "no-date" });
  });

  it("skips a post with empty text", () => {
    const d = decideXIncident(tweet({ text: "   " }));
    expect(d).toEqual({ insert: false, reason: "no-text" });
  });

  it("skips unroutable content", () => {
    const d = decideXIncident(
      tweet({ text: "New coffee shop opened in Jakarta this morning" }),
    );
    expect(d).toEqual({ insert: false, reason: "unroutable" });
  });

  it("builds a flashpoint incident from an attributable protest post", () => {
    const d = decideXIncident(tweet());
    expect(d.insert).toBe(true);
    if (!d.insert) return;
    expect(d.topic).toBe("flashpoint");
    expect(d.row.topic).toBe("flashpoint");
    expect(d.row.source).toBe("X");
    expect(d.row.country).toBe("Indonesia");
    expect(d.row.confidence).toBe("low");
    expect(d.row.sourceUrl).toBe("https://x.com/observer/status/1900000000000000001");
    expect(d.row.occurredAt).toEqual(new Date("2026-07-06T09:00:00.000Z"));
    expect(d.row.relevanceVersion).toBe(RELEVANCE_RULE_VERSION);
    expect(d.row.relevanceStatus).toBe("relevant");
    expect(d.row.analystNotes).toContain(`${X_MARKER_PREFIX}1900000000000000001`);
  });
});

describe("marker idempotency (dedupe dim 1)", () => {
  it("round-trips the post id through the marker", () => {
    const notes = xMarker("1900000000000000001", "observer", "flashpoint");
    expect(notes.startsWith(X_MARKER_PREFIX)).toBe(true);
    expect(markerPostId(notes)).toBe("1900000000000000001");
  });
  it("ignores non-x markers", () => {
    expect(markerPostId("gdelt_cloud:conflict_abc")).toBeNull();
    expect(markerPostId("auto-scraped:flashpoint")).toBeNull();
    expect(markerPostId(null)).toBeNull();
  });
});

describe("fuzzy key + url dedupe (dedupe dims 2 & 3)", () => {
  it("collapses same title/day/country/topic to one key", () => {
    const when = new Date("2026-07-06T09:00:00.000Z");
    const a = xDedupeKey("Workers rally in Jakarta", when, "Indonesia", "flashpoint");
    const b = xDedupeKey(
      "workers rally in jakarta",
      new Date("2026-07-06T23:00:00.000Z"),
      "Indonesia",
      "flashpoint",
    );
    expect(a).toBe(b);
  });
  it("separates different topics / countries / days", () => {
    const when = new Date("2026-07-06T09:00:00.000Z");
    const base = xDedupeKey("Rally", when, "Indonesia", "flashpoint");
    expect(base).not.toBe(xDedupeKey("Rally", when, "Indonesia", "conflict"));
    expect(base).not.toBe(xDedupeKey("Rally", when, "Philippines", "flashpoint"));
    expect(base).not.toBe(
      xDedupeKey("Rally", new Date("2026-07-07T09:00:00.000Z"), "Indonesia", "flashpoint"),
    );
  });
});
