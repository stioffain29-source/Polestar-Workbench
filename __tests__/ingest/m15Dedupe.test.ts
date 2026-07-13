import { db } from "@workspace/db";
import {
  normalizeOfficialSourceUrl,
  partitionOfficialInserts,
} from "../../lib/ingest/src/m15/dedupe";

describe("M1.5 official URL normalisation (Step 10)", () => {
  it("collapses scheme, www, query, and trailing slash", () => {
    const raw =
      "https://www.centcom.mil/MEDIA/PRESS-RELEASES/Article/4015365/foo/?utm=1";
    const norm = normalizeOfficialSourceUrl(raw);
    expect(norm).toBe("centcom.mil/media/press-releases/article/4015365/foo");
    expect(normalizeOfficialSourceUrl(`http://${norm}`)).toBe(norm);
    expect(normalizeOfficialSourceUrl(`https://www.${norm}/`)).toBe(norm);
  });
});

describe("partitionOfficialInserts (M1.5-T7)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("skips official-table duplicates and news echoes separately", async () => {
    const centcomUrl =
      "https://www.centcom.mil/MEDIA/PRESS-RELEASES/Press-Release-View/Article/4015365/centcom-conducts-airstrikes-against-iran-backed-houthi-missile-storage-and-comm/";

    jest.spyOn(db, "select").mockImplementation((fields?: unknown) => {
      const shape = fields as Record<string, unknown> | undefined;
      const selectsExternalId = shape != null && "externalId" in shape;

      return {
        from: () => ({
          where: () => {
            if (selectsExternalId) {
              return Promise.resolve([{ externalId: "4015365" }]);
            }
            return Promise.resolve([]);
          },
        }),
      } as never;
    });

    const items = [
      {
        externalId: "4015365",
        sourceUrl: centcomUrl,
        title: "dup id",
      },
      {
        externalId: "9999999",
        sourceUrl: `${centcomUrl}?ref=news`,
        title: "news echo",
      },
      {
        externalId: "8888888",
        sourceUrl: "https://www.ukmto.org/note/8888888",
        title: "fresh",
      },
    ];

    const partitioned = await partitionOfficialInserts(items, "centcom", {
      lookupNewsEcho: async () => new Set([normalizeOfficialSourceUrl(centcomUrl)!]),
    });

    expect(partitioned.duplicateInDb).toBe(1);
    expect(partitioned.newsEchoSkipped).toBe(1);
    expect(partitioned.toInsert).toHaveLength(1);
    expect(partitioned.toInsert[0]?.externalId).toBe("8888888");
  });
});
