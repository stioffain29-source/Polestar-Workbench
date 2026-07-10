import { db } from "@workspace/db";
import { listOfficialMilitaryMaritimeSources } from "../../artifacts/api-server/src/lib/officialMilitaryMaritimeSourcesList";
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

  it("validates query params for watch and flag filters", () => {
    const parsed = ListOfficialMilitaryMaritimeSourcesQueryParams.parse({
      watch: "shipping",
      flag: "possible_spot_report",
      source: "ukmto",
    });
    expect(parsed.watch).toBe("shipping");
    expect(parsed.flag).toBe("possible_spot_report");
    expect(parsed.source).toBe("ukmto");
  });

  it("returns an empty list when the table has no rows", async () => {
    stubSelect([]);
    const rows = await listOfficialMilitaryMaritimeSources({});
    expect(rows).toEqual([]);
  });
});
