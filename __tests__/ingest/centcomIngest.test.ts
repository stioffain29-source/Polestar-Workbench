import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  db,
} from "@workspace/db";
import {
  parseCentcomDetail,
  parseCentcomListing,
  parseCentcomRssListing,
  filterCentcomPressReleaseItems,
  isCentcomPressReleaseUrl,
  bodyTextFromRssDescription,
  resolveCentcomUrl,
} from "../../lib/ingest/src/centcomParse";
import {
  runCentcomIngest,
  selectCentcomListingForFetch,
  CENTCOM_SOURCE,
} from "../../lib/ingest/src/centcomIngest";
import { routeOfficialSource } from "../../lib/ingest/src/m15";
import {
  normalizeOfficialSourceUrl,
} from "../../lib/ingest/src/m15/dedupe";
import { parseCentcomImageUrlsFromBody } from "../../lib/ingest/src/m15/centcomEvidence";

const FIXTURE_DIR = join(__dirname, "../fixtures/m15");

function readFixture(name: string): string {
  return readFileSync(join(FIXTURE_DIR, name), "utf8");
}

describe("CENTCOM press-release URL helpers", () => {
  it("recognises official press-release paths", () => {
    expect(
      isCentcomPressReleaseUrl(
        "https://www.centcom.mil/MEDIA/PUBLIC-RELEASES/Article/4538814/foo/",
      ),
    ).toBe(true);
    expect(
      isCentcomPressReleaseUrl(
        "https://www.centcom.mil/MEDIA/NEWS-ARTICLES/News-Article-View/Article/4398492/foo/",
      ),
    ).toBe(false);
  });

  it("filters news RSS items down to press releases only", () => {
    const items = [
      {
        externalId: "4538814",
        title: "Strike release",
        publishedAt: new Date("2026-07-08"),
        sourceUrl:
          "https://www.centcom.mil/MEDIA/PUBLIC-RELEASES/Article/4538814/us-forces/",
        summary: "Hormuz",
      },
      {
        externalId: "4398492",
        title: "Exercise story",
        publishedAt: new Date("2026-02-05"),
        sourceUrl:
          "https://www.centcom.mil/MEDIA/NEWS-ARTICLES/News-Article-View/Article/4398492/foo/",
        summary: "NAVCENT",
      },
    ];
    expect(filterCentcomPressReleaseItems(items).map((i) => i.externalId)).toEqual([
      "4538814",
    ]);
  });

  it("builds plain text from RSS description HTML", () => {
    expect(
      bodyTextFromRssDescription(
        "MANAMA, Bahrain – <b>forces</b> conducted strikes.<br />",
      ),
    ).toBe("MANAMA, Bahrain – forces conducted strikes.");
  });
});

describe("CENTCOM RSS listing parser", () => {
  const rssXml = readFixture("centcom-press-releases-rss.xml");

  it("parses press-release RSS items with ids, titles, dates, and absolute URLs", () => {
    const items = parseCentcomRssListing(rssXml);
    expect(items.length).toBeGreaterThanOrEqual(2);

    const strike = items.find((i) => i.externalId === "4015365");
    expect(strike).toMatchObject({
      externalId: "4015365",
      title:
        "CENTCOM Conducts Airstrikes Against Iran-Backed Houthi Missile Storage and Command/Control Facilities in Yemen",
      sourceUrl:
        "https://www.centcom.mil/MEDIA/PRESS-RELEASES/Press-Release-View/Article/4015365/centcom-conducts-airstrikes-against-iran-backed-houthi-missile-storage-and-comm/",
    });
    expect(strike?.publishedAt).toEqual(new Date("Sat, 21 Dec 2024 00:00:00 GMT"));
    expect(strike?.summary).toMatch(/Red Sea/);

    const hormuz = items.find((i) => i.externalId === "4538814");
    expect(hormuz?.publishedAt).toEqual(new Date("Tue, 08 Jul 2026 00:00:00 GMT"));
  });
});

describe("CENTCOM listing parser (Step 1)", () => {
  const listingHtml = readFixture("centcom-press-releases-listing.html");

  it("parses ≥2 releases with ids, titles, dates, and absolute URLs", () => {
    const items = parseCentcomListing(listingHtml);
    expect(items.length).toBeGreaterThanOrEqual(2);

    const strike = items.find((i) => i.externalId === "4015365");
    expect(strike).toMatchObject({
      externalId: "4015365",
      title:
        "CENTCOM Conducts Airstrikes Against Iran-Backed Houthi Missile Storage and Command/Control Facilities in Yemen",
      sourceUrl:
        "https://www.centcom.mil/MEDIA/PRESS-RELEASES/Press-Release-View/Article/4015365/centcom-conducts-airstrikes-against-iran-backed-houthi-missile-storage-and-comm/",
    });
    expect(strike?.publishedAt).toEqual(new Date("2024-12-21"));
    expect(strike?.summary).toMatch(/Red Sea/);

    const hormuz = items.find((i) => i.externalId === "4538814");
    expect(hormuz).toMatchObject({
      externalId: "4538814",
      title: "U.S. Forces Complete Another Round of Strikes Against Iran",
      sourceUrl:
        "https://www.centcom.mil/MEDIA/PUBLIC-RELEASES/Article/4538814/us-forces-complete-another-round-of-strikes-against-iran/",
    });
    expect(hormuz?.publishedAt).toEqual(new Date("2026-07-08"));
  });

  it("resolves relative hrefs against centcom.mil", () => {
    expect(resolveCentcomUrl("/MEDIA/PRESS-RELEASES/")).toBe(
      "https://www.centcom.mil/MEDIA/PRESS-RELEASES/",
    );
  });
});

describe("CENTCOM detail parser (Step 2)", () => {
  const detailHtml = readFixture("centcom-press-release-4015365.html");
  const baseUrl =
    "https://www.centcom.mil/MEDIA/PRESS-RELEASES/Press-Release-View/Article/4015365/centcom-conducts-airstrikes-against-iran-backed-houthi-missile-storage-and-comm/";

  it("populates required CENTCOM fields from the fixture", () => {
    const detail = parseCentcomDetail(detailHtml, baseUrl);

    expect(detail.externalId).toBe("4015365");
    expect(detail.title).toBe(
      "CENTCOM Conducts Airstrikes Against Iran-Backed Houthi Missile Storage and Command/Control Facilities in Yemen",
    );
    expect(detail.publishedAt).toEqual(new Date("2024-12-21"));
    expect(detail.bodyText.length).toBeGreaterThan(100);
    expect(detail.bodyText).toMatch(/Red Sea/);
    expect(detail.bodyText).toMatch(/anti-ship cruise missile/i);
    expect(detail.sourceUrl).toContain("/Article/4015365/");

    expect(detail.imageUrls).toEqual([
      "https://www.centcom.mil/-/media/centcom/press-releases/2024/12/21/houthi-strike-release.jpg",
    ]);

    expect(detail.regionTags).toEqual(
      expect.arrayContaining(["yemen", "red sea"]),
    );
    expect(detail.categories).toEqual(
      expect.arrayContaining(["conflict", "military", "escalation"]),
    );
  });
});

describe("CENTCOM live fetch selection (Step 4)", () => {
  const listingHtml = readFixture("centcom-press-releases-listing.html");
  const listing = parseCentcomListing(listingHtml);

  it("selects newest items first and caps detail fetches", () => {
    const selected = selectCentcomListingForFetch(listing, { maxItems: 2 });
    expect(selected).toHaveLength(2);
    expect(selected[0]?.externalId).toBe("4538814");
    expect(selected[1]?.externalId).toBe("4538801");
  });

  it("skips items at or before sincePublishedAt", () => {
    const selected = selectCentcomListingForFetch(listing, {
      maxItems: 10,
      sincePublishedAt: new Date("2026-07-01"),
    });
    expect(selected.map((i) => i.externalId)).toEqual(["4538814", "4538801"]);
  });

  it("skips external ids already stored", () => {
    const selected = selectCentcomListingForFetch(listing, {
      maxItems: 10,
      existingExternalIds: new Set(["4538814", "4015365"]),
    });
    expect(selected.map((i) => i.externalId)).toEqual(["4538801"]);
  });
});

describe("CENTCOM persist + routing (Step 3)", () => {
  const listingHtml = readFixture("centcom-press-releases-listing.html");
  const detail4015365 = readFixture("centcom-press-release-4015365.html");

  type StoredRow = {
    sourceName: string;
    externalId: string;
    sourceUrl: string;
    title: string;
    bodyText: string;
    primaryWatch: string;
    watchTags: string[];
  };

  const stored: StoredRow[] = [];

  function setupDbMock() {
    jest.spyOn(db, "select").mockImplementation((fields?: unknown) => {
      const shape = fields as Record<string, unknown> | undefined;
      const isCount = shape != null && "n" in shape;
      const isLatest = shape != null && "latest" in shape;
      const isNewsEcho =
        shape != null && ("resolvedUrl" in shape || "primaryStoryUrl" in shape);
      return {
        from: () => ({
          where: () => {
            if (isNewsEcho) return Promise.resolve([]);
            if (isCount) return Promise.resolve([{ n: stored.length }]);
            if (isLatest) return Promise.resolve([{ latest: null }]);
            return Promise.resolve(
              stored.map((r) => ({
                externalId: r.externalId,
                sourceUrl: r.sourceUrl,
              })),
            );
          },
        }),
      } as never;
    });

    jest.spyOn(db, "insert").mockImplementation(
      () =>
        ({
          values: (batch: StoredRow | StoredRow[]) => {
            const values = Array.isArray(batch) ? batch : [batch];
            const inserted: { id: number }[] = [];
            for (const row of values) {
              const dup = stored.some(
                (s) =>
                  s.sourceName === row.sourceName &&
                  (s.externalId === row.externalId || s.sourceUrl === row.sourceUrl),
              );
              if (!dup) {
                stored.push(row);
                inserted.push({ id: stored.length });
              }
            }
            return {
              onConflictDoNothing: () => ({
                returning: () => Promise.resolve(inserted),
              }),
            };
          },
        }) as never,
    );
  }

  afterEach(() => {
    stored.length = 0;
    jest.restoreAllMocks();
  });

  const fetchDetail = async (item: { externalId: string }) => {
    if (item.externalId === "4015365") return detail4015365;
    return null;
  };

  it("inserts one row on first commit and dedupes on re-run", async () => {
    setupDbMock();

    const first = await runCentcomIngest({
      commit: true,
      listingHtml,
      fetchDetailHtml: fetchDetail,
      externalIds: ["4015365"],
      sincePublishedAt: null,
    });

    expect(first.inserted).toBe(1);
    expect(first.duplicateInDb).toBe(0);
    expect(first.newsEchoSkipped).toBe(0);
    expect(first.itemsFetched).toBe(1);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      sourceName: CENTCOM_SOURCE,
      externalId: "4015365",
      title: expect.stringContaining("Houthi"),
    });
    expect(stored[0]?.bodyText).toMatch(/\[Image URLs\]/);
    expect(parseCentcomImageUrlsFromBody(stored[0]?.bodyText)).toEqual([
      "https://www.centcom.mil/-/media/centcom/press-releases/2024/12/21/houthi-strike-release.jpg",
    ]);

    const second = await runCentcomIngest({
      commit: true,
      listingHtml,
      fetchDetailHtml: fetchDetail,
      externalIds: ["4015365"],
      sincePublishedAt: null,
    });

    expect(second.inserted).toBe(0);
    expect(second.duplicateInDb).toBe(1);
    expect(second.newsEchoSkipped).toBe(0);
    expect(stored).toHaveLength(1);
  });

  it("skips insert when the URL already exists as a news incident (news echo)", async () => {
    setupDbMock();
    const listingItem = parseCentcomListing(listingHtml).find(
      (i) => i.externalId === "4015365",
    )!;
    const norm = normalizeOfficialSourceUrl(listingItem.sourceUrl)!;

    const summary = await runCentcomIngest({
      commit: true,
      listingHtml,
      fetchDetailHtml: fetchDetail,
      externalIds: ["4015365"],
      sincePublishedAt: null,
      lookupNewsEchoUrls: async () => new Set([norm]),
    });

    expect(summary.inserted).toBe(0);
    expect(summary.duplicateInDb).toBe(0);
    expect(summary.newsEchoSkipped).toBe(1);
  });

  it("routes military release to conflict and maritime terms to both watches", async () => {
    const detail = parseCentcomDetail(
      detail4015365,
      "https://www.centcom.mil/MEDIA/PRESS-RELEASES/Press-Release-View/Article/4015365/",
    );
    const routed = routeOfficialSource({
      source: "centcom",
      title: detail.title,
      body: detail.bodyText,
    });
    expect(routed.primaryWatch).toBe("conflict");
    expect(routed.watchTags).toEqual(["conflict", "shipping"]);

    setupDbMock();
    await runCentcomIngest({
      commit: true,
      listingHtml,
      fetchDetailHtml: fetchDetail,
      externalIds: ["4015365"],
      sincePublishedAt: null,
    });
    expect(stored[0]?.primaryWatch).toBe("conflict");
    expect(stored[0]?.watchTags).toEqual(["conflict", "shipping"]);
  });

  it("dry-run does not write rows", async () => {
    setupDbMock();
    const summary = await runCentcomIngest({
      commit: false,
      listingHtml,
      fetchDetailHtml: fetchDetail,
      externalIds: ["4015365"],
      sincePublishedAt: null,
    });
    expect(summary.inserted).toBe(0);
    expect(stored).toHaveLength(0);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("ingests from RSS description when detail pages return 403", async () => {
    setupDbMock();
    const rssXml = readFixture("centcom-press-releases-rss.xml");
    const listingItem = parseCentcomRssListing(rssXml).find(
      (i) => i.externalId === "4538814",
    )!;
    expect(listingItem.rssDescriptionHtml).toBeTruthy();

    const summary = await runCentcomIngest({
      commit: true,
      listingItems: [listingItem],
      fetchDetailHtml: async () => {
        throw new Error("Status code 403");
      },
      sincePublishedAt: null,
    });

    expect(summary.inserted).toBe(1);
    expect(summary.errors).toEqual([]);
    expect(stored[0]).toMatchObject({
      externalId: "4538814",
      title: expect.stringContaining("Strikes Against Iran"),
    });
    expect(stored[0]?.bodyText).toMatch(/Strait of Hormuz/);
  });
});
