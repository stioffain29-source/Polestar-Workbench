import { runResolveGoogleNewsUrls } from "../../lib/ingest/src/googleNewsUrl";
import { db } from "@workspace/db";

// The fairness logic in runResolveGoogleNewsUrls spends a bounded per-run budget
// across all news topics with a round-robin so a high-volume topic
// (shipping/flashpoint) cannot starve the smaller ones. These tests lock in that
// candidate selection/interleave behaviour with stubbed per-topic candidate
// lists. The network resolver is stubbed at the fetch layer so the test is fully
// deterministic and offline (no real news.google.com calls).

interface Candidate {
  id: number;
  sourceUrl: string | null;
  topic: string;
}

// db.select is called once per topic, synchronously, in `topics` order (via
// Promise.all over topics.map(...)). So queue the per-topic candidate lists in
// the same order and return them by call index. Each call returns a chainable
// stub whose terminal .limit() resolves to that topic's list.
function mockPerTopicSelect(lists: Candidate[][]): void {
  let call = 0;
  jest.spyOn(db, "select").mockImplementation(() => {
    const result = lists[call++] ?? [];
    const chain: any = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => Promise.resolve(result),
    };
    return chain;
  });
}

// Deterministic offline stand-in for resolveGoogleNewsUrl's two network calls.
// A redirect id containing "FAIL" yields an article page with no signature →
// resolveGoogleNewsUrl returns null (a failed candidate). Every other id
// resolves to a fixed publisher URL. No request leaves the process.
function stubResolverNetwork(): jest.SpyInstance {
  const makeResponse = (text: string) =>
    ({ text: () => Promise.resolve(text) }) as any;
  return jest
    .spyOn(global, "fetch")
    .mockImplementation((input: any): Promise<any> => {
      const url = typeof input === "string" ? input : input.url;
      if (url.startsWith("https://news.google.com/rss/articles/")) {
        const id = url.split("/articles/")[1].split("?")[0];
        if (id.includes("FAIL")) {
          return Promise.resolve(makeResponse("<html>no signature here</html>"));
        }
        return Promise.resolve(
          makeResponse(`<html data-n-a-sg="SG_${id}" data-n-a-ts="123"></html>`),
        );
      }
      if (url.includes("batchexecute")) {
        const inner = JSON.stringify(["x", "https://publisher.example/resolved"]);
        const chunk = JSON.stringify([["wrb.fr", "Fbv4je", inner]]);
        return Promise.resolve(makeResponse(")]}'\n\n" + chunk));
      }
      throw new Error("unexpected fetch to " + url);
    });
}

function makeCandidates(
  topic: string,
  count: number,
  startId: number,
): Candidate[] {
  return Array.from({ length: count }, (_, i) => ({
    id: startId + i,
    sourceUrl: `https://news.google.com/rss/articles/${topic}${i}?oc=5`,
    topic,
  }));
}

afterEach(() => jest.restoreAllMocks());

describe("runResolveGoogleNewsUrls — fair round-robin candidate selection", () => {
  it("splits the budget evenly when every topic has more candidates than its share", async () => {
    stubResolverNetwork();
    // Three topics, 12 candidates each, budget 9 → an even 3/3/3 split.
    mockPerTopicSelect([
      makeCandidates("shipping", 12, 100),
      makeCandidates("flashpoint", 12, 200),
      makeCandidates("energy", 12, 300),
    ]);

    const summary = await runResolveGoogleNewsUrls({
      topics: ["shipping", "flashpoint", "energy"],
      limit: 9,
    });

    expect(summary.candidates).toBe(9);
    expect(summary.byTopic.shipping.candidates).toBe(3);
    expect(summary.byTopic.flashpoint.candidates).toBe(3);
    expect(summary.byTopic.energy.candidates).toBe(3);
  });

  it("redistributes the slack of a thin topic to the topics that still have work", async () => {
    stubResolverNetwork();
    // flashpoint has only 1 candidate; its unused share flows to shipping/energy.
    // Round-robin with budget 9 → shipping 4, flashpoint 1, energy 4.
    mockPerTopicSelect([
      makeCandidates("shipping", 12, 100),
      makeCandidates("flashpoint", 1, 200),
      makeCandidates("energy", 12, 300),
    ]);

    const summary = await runResolveGoogleNewsUrls({
      topics: ["shipping", "flashpoint", "energy"],
      limit: 9,
    });

    expect(summary.candidates).toBe(9);
    expect(summary.byTopic.shipping.candidates).toBe(4);
    expect(summary.byTopic.flashpoint.candidates).toBe(1);
    expect(summary.byTopic.energy.candidates).toBe(4);
  });

  it("never exceeds the total available candidates when the budget is larger", async () => {
    stubResolverNetwork();
    // Only 4 candidates exist across two topics; a budget of 50 must not invent
    // work — selection stops once every topic is exhausted.
    mockPerTopicSelect([
      makeCandidates("shipping", 3, 100),
      makeCandidates("energy", 1, 300),
    ]);

    const summary = await runResolveGoogleNewsUrls({
      topics: ["shipping", "energy"],
      limit: 50,
    });

    expect(summary.candidates).toBe(4);
    expect(summary.byTopic.shipping.candidates).toBe(3);
    expect(summary.byTopic.energy.candidates).toBe(1);
  });

  it("interleaves candidates topic-by-topic rather than draining one topic first", async () => {
    stubResolverNetwork();
    // With a tiny budget the round-robin must hand the first slots out one per
    // topic, not consume the whole budget from the first (high-volume) topic.
    mockPerTopicSelect([
      makeCandidates("shipping", 10, 100),
      makeCandidates("flashpoint", 10, 200),
    ]);

    const summary = await runResolveGoogleNewsUrls({
      topics: ["shipping", "flashpoint"],
      limit: 2,
    });

    expect(summary.candidates).toBe(2);
    expect(summary.byTopic.shipping.candidates).toBe(1);
    expect(summary.byTopic.flashpoint.candidates).toBe(1);
  });

  it("counts resolved vs failed per topic and writes nothing on a dry run", async () => {
    const fetchSpy = stubResolverNetwork();
    const updateSpy = jest.spyOn(db, "update");
    // shipping: one resolvable id + one that fails; energy: one resolvable id.
    mockPerTopicSelect([
      [
        { id: 1, sourceUrl: "https://news.google.com/rss/articles/shipOK?oc=5", topic: "shipping" },
        { id: 2, sourceUrl: "https://news.google.com/rss/articles/shipFAIL?oc=5", topic: "shipping" },
      ],
      [
        { id: 3, sourceUrl: "https://news.google.com/rss/articles/enOK?oc=5", topic: "energy" },
      ],
    ]);

    const summary = await runResolveGoogleNewsUrls({
      topics: ["shipping", "energy"],
      limit: 10,
    });

    expect(summary.candidates).toBe(3);
    expect(summary.resolved).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.byTopic.shipping).toEqual({
      candidates: 2,
      resolved: 1,
      failed: 1,
    });
    expect(summary.byTopic.energy).toEqual({
      candidates: 1,
      resolved: 1,
      failed: 0,
    });
    // The resolver actually ran offline against the stubbed fetch...
    expect(fetchSpy).toHaveBeenCalled();
    // ...and a dry run (commit defaulting to false) persists nothing.
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
