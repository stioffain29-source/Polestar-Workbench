// Instagram KAMMI watch — pure-unit coverage for the collection-time
// normaliser. These lock the NO-FABRICATION + privacy invariants the importer
// and the social_raw table depend on:
//   - a post URL is always derivable (from shortCode when absent) and the
//     externalId is stable;
//   - every persisted URL is token-stripped (sanitiseUrl);
//   - engagement is COUNTS-ONLY and stays null when not reported (never a fake
//     zero), with string counts coerced and negatives/garbage rejected;
//   - epoch-second and epoch-ms timestamps both parse.

import { normaliseInstagramPost } from "@workspace/ingest";

describe("normaliseInstagramPost", () => {
  it("returns null for non-objects / id-less items", () => {
    expect(normaliseInstagramPost(null)).toBeNull();
    expect(normaliseInstagramPost("not an object")).toBeNull();
    expect(normaliseInstagramPost({})).toBeNull();
  });

  it("derives the post URL from shortCode, stamps externalId, strips image tokens", () => {
    const n = normaliseInstagramPost({
      id: "abc123",
      shortCode: "DZ9s2",
      caption: "Aksi demonstrasi mahasiswa",
      ownerUsername: "kammi.pusat",
      ownerFullName: "PP KAMMI",
      timestamp: "2026-06-24T09:49:00.000Z",
      likesCount: 208,
      commentsCount: 0,
      displayUrl: "https://scontent.cdninstagram.com/v/x.jpg?efg=TOKEN&oh=AA",
    });
    expect(n).not.toBeNull();
    expect(n!.externalId).toBe("ig_abc123");
    expect(n!.url).toBe("https://www.instagram.com/p/DZ9s2");
    expect(n!.ownerUsername).toBe("kammi.pusat");
    expect(n!.engagement).toEqual({ reactions: 208, comments: 0 });
    expect(n!.postedAt?.toISOString()).toBe("2026-06-24T09:49:00.000Z");
    expect(n!.imageUrls).toEqual([
      "https://scontent.cdninstagram.com/v/x.jpg",
    ]);
  });

  it("parses epoch-second and epoch-millisecond timestamps", () => {
    const sec = normaliseInstagramPost({
      id: "1",
      url: "https://www.instagram.com/p/a/",
      taken_at: 1_750_000_000,
    });
    const ms = normaliseInstagramPost({
      id: "2",
      url: "https://www.instagram.com/p/b/",
      timestamp: 1_750_000_000_000,
    });
    expect(sec!.postedAt?.getTime()).toBe(1_750_000_000 * 1000);
    expect(ms!.postedAt?.getTime()).toBe(1_750_000_000_000);
  });

  it("leaves engagement null when no counts are reported (never a fake zero)", () => {
    const n = normaliseInstagramPost({
      id: "3",
      url: "https://www.instagram.com/p/c/",
    });
    expect(n!.engagement).toBeNull();
  });

  it("coerces string counts and rejects negatives / garbage", () => {
    const n = normaliseInstagramPost({
      id: "4",
      url: "https://www.instagram.com/p/d/",
      likesCount: "1,234",
      commentsCount: "-5",
    });
    expect(n!.engagement).toEqual({ reactions: 1234 });
  });
});
