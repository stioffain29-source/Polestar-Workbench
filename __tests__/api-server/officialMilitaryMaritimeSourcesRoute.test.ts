import { db } from "@workspace/db";
import {
  getOfficialMilitaryMaritimeSourceById,
  listOfficialMilitaryMaritimeSources,
} from "../../artifacts/api-server/src/lib/officialMilitaryMaritimeSourcesList";
import { ListOfficialMilitaryMaritimeSourcesQueryParams } from "@workspace/api-zod";

type Rows = Record<string, unknown>[];

function stubSelect(rows: Rows) {
  jest.spyOn(db, "select").mockImplementation(() => {
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => Promise.resolve(rows),
    };
    return chain as never;
  });
}

describe("official military maritime sources list", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("validates query params for watch, flag, and flagged filters", () => {
    const parsed = ListOfficialMilitaryMaritimeSourcesQueryParams.parse({
      watch: "shipping",
      flag: "possible_spot_report",
      flagged: true,
      source: "ukmto",
    });
    expect(parsed.watch).toBe("shipping");
    expect(parsed.flag).toBe("possible_spot_report");
    expect(parsed.flagged).toBe(true);
    expect(parsed.source).toBe("ukmto");
  });

  it("returns an empty list when the table has no rows", async () => {
    stubSelect([]);
    const rows = await listOfficialMilitaryMaritimeSources({});
    expect(rows).toEqual([]);
  });

  it("fetches a single row by id", async () => {
    const row = {
      id: 7,
      sourceName: "jmic",
      externalId: "012-26",
      title: "JMIC advisory",
    };
    jest.spyOn(db, "select").mockImplementation(() => {
      const chain: Record<string, unknown> = {
        from: () => chain,
        where: () => chain,
        limit: () => Promise.resolve([row]),
      };
      return chain as never;
    });
    const found = await getOfficialMilitaryMaritimeSourceById(7);
    expect(found).toMatchObject({ id: 7, sourceName: "jmic" });
  });
});
