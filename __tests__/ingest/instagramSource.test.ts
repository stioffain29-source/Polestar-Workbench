import {
  decideInstagramIncident,
  instagramMarker,
  instagramMarkerPostId,
  INSTAGRAM_MARKER_PREFIX,
  type NormalisedIgPost,
} from "@workspace/ingest";
import { RELEVANCE_RULE_VERSION } from "@workspace/relevance";

// Instagram (Papua / separatist) SOURCE PROVIDER — pure-unit coverage.
//
// The provider REUSES the X source provider's routeTopic (relevance-engine
// router) and xDedupeKey (fuzzy dedupe formula), so the full precedence ladder
// and dedupe algebra are already locked by xSearch.test.ts. These tests cover
// only what is DIFFERENT for Instagram:
//   - the decision maps a normalised Instagram post to an incident row,
//   - captions are PII-scrubbed BEFORE storage (privacy + no-fabrication),
//   - the no-country / data-centre / no-date / no-text skips still hold,
//   - the analyst_notes marker round-trips the Instagram post id.

function post(over: Partial<NormalisedIgPost> = {}): NormalisedIgPost {
  return {
    id: "ig_ABC123",
    text: "Massa aksi gelar protes rally di Jayapura, Indonesia soal harga BBM.",
    url: "https://www.instagram.com/p/ABC123/",
    author: "papua_watch",
    createdAt: new Date("2026-07-06T09:00:00.000Z"),
    ...over,
  };
}

describe("decideInstagramIncident", () => {
  it("builds a flashpoint incident from an attributable protest post", () => {
    const d = decideInstagramIncident(
      post({ text: "Workers stage a protest rally in Jakarta, Indonesia over fuel prices." }),
    );
    expect(d.insert).toBe(true);
    if (!d.insert) return;
    expect(d.topic).toBe("flashpoint");
    expect(d.row.topic).toBe("flashpoint");
    expect(d.row.source).toBe("Instagram");
    expect(d.row.country).toBe("Indonesia");
    expect(d.row.confidence).toBe("low");
    expect(d.row.sourceUrl).toBe("https://www.instagram.com/p/ABC123/");
    expect(d.row.occurredAt).toEqual(new Date("2026-07-06T09:00:00.000Z"));
    expect(d.row.relevanceVersion).toBe(RELEVANCE_RULE_VERSION);
    expect(d.row.relevanceStatus).toBe("relevant");
    expect(d.row.analystNotes).toContain(`${INSTAGRAM_MARKER_PREFIX}ig_ABC123`);
  });

  it("routes separatist-armed content to conflict", () => {
    const d = decideInstagramIncident(
      post({
        text: "TPNPB insurgents ambush an army patrol in a deadly firefight in Papua, Indonesia.",
      }),
    );
    expect(d.insert).toBe(true);
    if (!d.insert) return;
    expect(d.topic).toBe("conflict");
    expect(d.row.topic).toBe("conflict");
  });

  it("skips a data-centre post (held, never inserted)", () => {
    const d = decideInstagramIncident(
      post({ text: "Company opens a hyperscale data centre in Jakarta, Indonesia" }),
    );
    expect(d).toEqual({ insert: false, reason: "data-centre-hold" });
  });

  it("skips a post with no tracked country (no fabrication)", () => {
    const d = decideInstagramIncident(
      post({ text: "Protesters clash with police during a rally downtown" }),
    );
    expect(d).toEqual({ insert: false, reason: "no-country" });
  });

  it("skips a post with no date", () => {
    const d = decideInstagramIncident(post({ createdAt: null }));
    expect(d).toEqual({ insert: false, reason: "no-date" });
  });

  it("skips a post with empty text", () => {
    const d = decideInstagramIncident(post({ text: "   " }));
    expect(d).toEqual({ insert: false, reason: "no-text" });
  });

  it("skips unroutable content", () => {
    const d = decideInstagramIncident(
      post({ text: "New coffee shop opened in Jakarta, Indonesia this morning" }),
    );
    expect(d).toEqual({ insert: false, reason: "unroutable" });
  });
});

describe("PII scrubbing before storage", () => {
  it("removes phone / email / messaging handles from the stored incident text", () => {
    const d = decideInstagramIncident(
      post({
        text:
          "Protest rally in Jakarta, Indonesia. Hubungi +62 812 3456 7890 atau " +
          "aksi@example.com. WhatsApp https://wa.me/6281234567890.",
      }),
    );
    expect(d.insert).toBe(true);
    if (!d.insert) return;
    const blob = `${d.row.title} ${d.row.summary}`;
    expect(blob).not.toMatch(/\+62\s*812/);
    expect(blob).not.toMatch(/aksi@example\.com/);
    expect(blob).not.toMatch(/wa\.me/);
  });
});

describe("marker idempotency", () => {
  it("round-trips the Instagram post id through the marker", () => {
    const notes = instagramMarker("ig_ABC123", "papua_watch");
    expect(notes.startsWith(INSTAGRAM_MARKER_PREFIX)).toBe(true);
    expect(instagramMarkerPostId(notes)).toBe("ig_ABC123");
  });

  it("ignores non-instagram markers (they must re-score on a version bump)", () => {
    expect(instagramMarkerPostId("x_search:1900000000000000001")).toBeNull();
    expect(instagramMarkerPostId("gdelt_cloud:conflict_abc")).toBeNull();
    expect(instagramMarkerPostId(null)).toBeNull();
  });
});
