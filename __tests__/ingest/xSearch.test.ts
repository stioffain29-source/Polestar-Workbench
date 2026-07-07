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

// Fixture-driven precedence ladder. Each fixture is a representative, realistic
// (if ambiguous) post that MUST route to the tier named as `want`. The engine
// order is data-centre → conflict → flashpoint → shipping → cargo_watch: the
// first tier whose own rules judge the post relevant wins. These lock the full
// ladder so a keyword-set or RELEVANCE_RULE_VERSION change that quietly reorders
// precedence is caught.
type RouteFixture = {
  name: string;
  text: string;
  want: "conflict" | "flashpoint" | "shipping" | "cargo_watch";
};

const ROUTE_FIXTURES: RouteFixture[] = [
  {
    name: "insurgent ambush → conflict",
    text: "Insurgent militants ambush an army patrol in a deadly firefight in Mindanao, Philippines.",
    want: "conflict",
  },
  {
    name: "labour protest rally → flashpoint",
    text: "Workers stage a protest rally in Jakarta, Indonesia over fuel prices.",
    want: "flashpoint",
  },
  {
    name: "tanker sea robbery → shipping",
    text: "Pirates boarded a tanker in the Singapore Strait near Indonesia in a sea robbery.",
    want: "shipping",
  },
  {
    name: "warehouse cargo theft → cargo_watch",
    text: "Thieves carried out a cargo theft from a warehouse in Jakarta, Indonesia.",
    want: "cargo_watch",
  },
];

describe("routeTopic — full precedence ladder", () => {
  it.each(ROUTE_FIXTURES)("$name", ({ text, want }) => {
    const r = routeTopic({
      title: text,
      summary: text,
      source: "X",
      sourceUrl: "https://x.com/i/status/1",
    });
    expect(r).toEqual({ kind: "topic", topic: want });
  });

  it("decideXIncident stamps the same topic the router chose", () => {
    for (const { text, want } of ROUTE_FIXTURES) {
      const d = decideXIncident(tweet({ text }));
      expect(d.insert).toBe(true);
      if (!d.insert) return;
      expect(d.topic).toBe(want);
      expect(d.row.topic).toBe(want);
    }
  });

  it("a higher tier wins when a post satisfies more than one tier", () => {
    // Contains both maritime (tanker/strait) AND conflict (armed men, seized)
    // cues; conflict outranks shipping so conflict must win.
    const r = routeTopic({
      title: "Oil tanker seized by armed militants in the Singapore Strait near Indonesia.",
      summary: "Oil tanker seized by armed militants in the Singapore Strait near Indonesia.",
      source: "X",
      sourceUrl: "https://x.com/i/status/1",
    });
    expect(r).toEqual({ kind: "topic", topic: "conflict" });
  });
});

describe("no-fabrication regression guards", () => {
  it("a data-centre post ALWAYS holds and never inserts, whatever else it says", () => {
    const dcTexts = [
      "Company opens a hyperscale data centre in Jakarta, Indonesia",
      "Militants clash near the new data centre in Mindanao, Philippines",
      "Protest rally outside a colocation facility in Bangkok, Thailand",
      "Cargo theft reported at a server farm site in Manila, Philippines",
    ];
    for (const text of dcTexts) {
      expect(matchesDataCentre(text)).toBe(true);
      const r = routeTopic({ title: text, summary: text, source: "X", sourceUrl: "https://x.com/i/status/1" });
      expect(r.kind).toBe("data_centre_candidate");
      const d = decideXIncident(tweet({ text }));
      expect(d).toEqual({ insert: false, reason: "data-centre-hold" });
    }
  });

  it("a country-less post is ALWAYS skipped (never stamped on a guessed centroid)", () => {
    // One routable post per tier, each with NO tracked country in its text.
    const countryLessByTier = [
      "Insurgent militants ambush an army patrol in a deadly firefight downtown.",
      "Workers stage a protest rally over fuel prices in the city centre.",
      "Pirates boarded a tanker in a sea robbery off the coast.",
      "Thieves carried out a cargo theft from a warehouse overnight.",
    ];
    for (const text of countryLessByTier) {
      const route = routeTopic({ title: text, summary: text, source: "X", sourceUrl: "https://x.com/i/status/1" });
      expect(route.kind).toBe("topic");
      const d = decideXIncident(tweet({ text }));
      expect(d).toEqual({ insert: false, reason: "no-country" });
    }
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
