import {
  buildMiddleEastBreadthQueries,
  collectMiddleEastBreadthWithFetcher,
  deriveMiddleEastSearchedGeographies,
  MIDDLE_EAST_REQUIRED_GEOGRAPHIES,
  collectRegionalForwardSearchWithFetcher,
  MIDDLE_EAST_REQUIRED_DOMAINS,
  REGIONAL_FORWARD_AREAS,
  type RegionalFeedFetcher,
} from "../../lib/ingest/src/regionalCollector";

describe("regional weekly collectors", () => {
  it("builds an issue-date-anchored, auditable Middle East breadth plan", () => {
    const queries = buildMiddleEastBreadthQueries("2025-02-12");
    const security = queries.filter((query) => query.domain === "security");
    const combined = queries.map((query) => query.query).join("\n");

    expect(security.map((query) => query.country)).toEqual([
      "Saudi Arabia",
      "Iran",
      "Iraq",
      "Israel",
      "Lebanon",
      "Syria",
      "Jordan",
      "Yemen",
      "Gulf states",
    ]);
    expect(combined).toContain("after:2025-02-05 before:2025-02-13");
    expect(combined).toMatch(/Strait of Hormuz/);
    expect(combined).toMatch(/Red Sea/);
    expect(combined).toMatch(/Bab el Mandeb/);
    expect(combined).toMatch(/insurance/);
    expect(combined).toMatch(/routing/);
    expect(new Set(queries.map((query) => query.domain))).toEqual(
      new Set(MIDDLE_EAST_REQUIRED_DOMAINS),
    );
  });

  it("does not mark a multi-query lane checked when one required fetch fails", async () => {
    const fetcher: RegionalFeedFetcher = async (url) => {
      const decoded = decodeURIComponent(decodeURIComponent(url));
      if (decoded.includes('"Iran"')) throw new Error("upstream timeout");
      return {
        title: "Test News",
        items: [{
          title: "Material development - Reuters",
          summary: "Confirmed operational consequence.",
          link: `https://example.test/${encodeURIComponent(url).slice(-40)}`,
          publishedAt: "2025-02-11T09:30:00Z",
        }],
      };
    };

    const result = await collectMiddleEastBreadthWithFetcher("2025-02-12", fetcher);
    const security = result.domains.find((domain) => domain.domain === "security")!;

    expect(result.requiredDomains).toEqual([...MIDDLE_EAST_REQUIRED_DOMAINS]);
    expect(security.status).toBe("not_run");
    expect(security.errors).toEqual([
      expect.stringContaining("Middle East security — Iran: upstream timeout"),
    ]);
    expect(result.coverage.status).toBe("not_run");
    // The dedicated Iran query failed, but other successfully fetched broad
    // domain queries explicitly named Iran, so the geography remains audited.
    expect(result.searchedGeographies).toContain("Iran");
    expect(result.searchedGeographies).toContain("Iraq");
    expect(result.sources[0]).toMatchObject({
      title: "Material development",
      source: "Reuters",
      publishedAt: "2025-02-11T09:30:00.000Z",
    });
  });

  it("derives every required geography from completed cached query evidence", () => {
    const broad = `("Middle East" OR Bahrain OR Iran OR Iraq OR Israel OR Jordan OR Kuwait OR Lebanon OR Oman OR Palestine OR Qatar OR "Saudi Arabia" OR Syria OR UAE OR Yemen OR "Red Sea") operational disruption`;
    const coverage = [{
      domain: "operational",
      status: "checked" as const,
      sourceNames: ["Middle East operational"],
      query: broad,
      itemsFetched: 10,
      candidatesAccepted: 2,
      errors: [],
    }];

    expect(deriveMiddleEastSearchedGeographies(coverage)).toEqual([
      ...MIDDLE_EAST_REQUIRED_GEOGRAPHIES,
    ]);
  });

  it("normalizes explicit aliases but never expands Gulf states or failed queries", () => {
    const coverage = [{
      domain: "security",
      status: "not_run" as const,
      sourceNames: ["UAE query", "Failed Qatar", "Gulf umbrella", "Palestine and Red Sea"],
      query: [
        `"UnitedArabEmirates" security`,
        `"Qatar" security`,
        `"Gulf states" security`,
        `"Palestine" "RedSea" security`,
      ].join(" | "),
      itemsFetched: 0,
      candidatesAccepted: 0,
      errors: ["Failed Qatar: timeout"],
    }];

    expect(deriveMiddleEastSearchedGeographies(coverage)).toEqual([
      "UAE",
      "Palestinian Territories",
      "Red Sea approaches",
    ]);
  });

  it("runs eleven distinct forward searches and returns source dates only", async () => {
    const fetchedUrls: string[] = [];
    const fetcher: RegionalFeedFetcher = async (url) => {
      fetchedUrls.push(url);
      return {
        title: "Publisher",
        items: [{
          title: "Authorities publish an update",
          summary: "The source discusses a possible change.",
          link: `https://example.test/${fetchedUrls.length}`,
          publishedAt: "2024-08-19T12:00:00Z",
        }],
      };
    };

    const result = await collectRegionalForwardSearchWithFetcher(
      "middle_east",
      "2024-08-20",
      fetcher,
    );

    expect(fetchedUrls).toHaveLength(11);
    expect(result.requiredDomains).toEqual([...REGIONAL_FORWARD_AREAS]);
    expect(result.domains).toHaveLength(11);
    expect(result.domains.every((domain) => domain.status === "checked")).toBe(true);
    expect(result.coverage.status).toBe("checked");
    expect(result.sources).toHaveLength(11);
    expect(result.sources[0].publishedAt).toBe("2024-08-19T12:00:00.000Z");
    expect(result.sources[0]).not.toHaveProperty("eventDate");
    expect(decodeURIComponent(fetchedUrls[0])).toContain(
      "after:2024-08-06 before:2024-08-21",
    );
  });

  it("rejects invalid historical issue dates before any search", async () => {
    const fetcher = jest.fn<ReturnType<RegionalFeedFetcher>, Parameters<RegionalFeedFetcher>>();
    await expect(
      collectRegionalForwardSearchWithFetcher("apac", "2025-02-30", fetcher),
    ).rejects.toThrow("not a valid calendar date");
    expect(fetcher).not.toHaveBeenCalled();
  });
});