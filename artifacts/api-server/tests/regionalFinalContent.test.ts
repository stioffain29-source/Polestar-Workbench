import {
  applyRegionalFinalContentCorrections,
  type RegionalFinalContentEntry,
} from "../src/lib/regionalFinalContent";
import deliveredManifest from "../src/lib/seed/regionalFinalContent.json";
import {
  regionalCanonicalReportFromHardNumbers,
  validateRegionalCanonicalStructure,
  type RegionalCanonicalReport,
  type RegionalWeeklyTopic,
} from "../../workbench/src/lib/regionalWeekly";

test("both delivered editions pass the same gate used by saved preview and PDF", () => {
  for (const entry of deliveredManifest) {
    expect(validateRegionalCanonicalStructure(
      entry.hardNumbers.regionalCanonicalReport as unknown as RegionalCanonicalReport,
    )).toEqual([]);
    expect(regionalCanonicalReportFromHardNumbers(
      entry.hardNumbers, entry.topic as RegionalWeeklyTopic, entry.issueDate,
    )).not.toBeNull();
  }
});

const expectedUpdatedAt = "2026-09-22T12:00:00.123Z";

function hardNumbers(topic: "apac_weekly" | "middle_east_weekly") {
  const domains = Array.from({ length: topic === "apac_weekly" ? 7 : 9 }, (_, index) => `domain-${index}`);
  const check = (domain: string) => ({
    domain,
    status: "checked" as const,
    sourceNames: ["Official source"],
    itemsFetched: 1,
    candidatesAccepted: 1,
    errors: [],
  });
  const country = topic === "apac_weekly" ? "Japan" : "Jordan";
  const development = {
    eventKey: `${topic}:event`,
    confirmedFacts: ["A verified disruption affected operations."],
    country,
    location: topic === "apac_weekly" ? "Tokyo" : "Amman",
    eventDate: "2026-09-21",
    dateVerified: true as const,
    title: "Verified disruption",
    severity: "High" as const,
    category: "Operational Disruption" as const,
    whatChanged: "A verified disruption affected operations.",
    operationalSignificance: "Operators face disruption.",
    whatToWatch: "Watch official operating notices.",
    watchDate: null,
    evidenceIds: [`${topic}:source`],
  };
  return {
    regionalCanonicalReport: {
      schemaVersion: "regional-weekly-canonical-v1" as const,
      topic,
      issueDate: "2026-09-22",
      developments: [development],
      regionalOutlook: "Conditions remain exposed to verified disruption.",
      polestarOutlook: "Monitor the verified operational disruption.",
      riskPicture: "Elevated",
      domainBriefs: [
        { domain: "Security" as const, heading: "Security", assessment: "Verified conditions remain material." },
        { domain: "Political" as const, heading: "Political", assessment: "Verified conditions remain material." },
        { domain: "Regulatory" as const, heading: "Regulatory", assessment: "Verified conditions remain material." },
        { domain: "Weather & Natural Hazards" as const, heading: "Weather", assessment: "Verified conditions remain material." },
        { domain: "Cyber" as const, heading: "Cyber", assessment: "Verified conditions remain material." },
        { domain: "Operational Disruption" as const, heading: "Operations", assessment: "Verified disruption is affecting operations." },
      ],
      businessImplications: [],
      businessImplicationsNarrative: "Operators should review contingency plans.",
      watchItems: [],
      glanceMetrics: [],
      mapPoints: [{
        lat: 35, lng: 139, severity: "High", title: development.title,
        label: country, summary: development.whatChanged, eventDate: development.eventDate,
      }],
      visualSummary: { byCategory: [], byCountry: [] },
      coverageManifest: {
        requiredDomains: domains,
        domains: domains.map(check),
        forwardSearch: check("forward"),
        requiredGeographies: [country],
        searchedGeographies: [country],
      },
    },
    regenerated: true,
  };
}

function manifest(): RegionalFinalContentEntry[] {
  return [
    { id: 166, topic: "apac_weekly", issueDate: "2026-09-22", expectedUpdatedAt, hardNumbers: hardNumbers("apac_weekly") },
    { id: 167, topic: "middle_east_weekly", issueDate: "2026-09-22", expectedUpdatedAt, hardNumbers: hardNumbers("middle_east_weekly") },
  ];
}

function store(rows = manifest().map((entry) => ({
  ...entry,
  updatedAt: new Date(entry.expectedUpdatedAt),
  hardNumbers: { retained: { analyst: true }, oldEngineValue: true },
}))) {
  const updates: Array<{ id: number; hardNumbers: unknown; updatedAt: Date }> = [];
  return {
    rows,
    updates,
    adapter: {
      transaction: async <T>(callback: (tx: {
        lock(ids: number[]): Promise<typeof rows>;
        update(entry: RegionalFinalContentEntry, value: unknown, updatedAt: Date): Promise<boolean>;
      }) => Promise<T>) => callback({
        lock: async (ids) => rows.filter((row) => ids.includes(row.id)),
        update: async (entry, value, updatedAt) => {
          const row = rows.find((candidate) => candidate.id === entry.id);
          if (!row || row.updatedAt.getTime() !== new Date(entry.expectedUpdatedAt).getTime()) return false;
          updates.push({ id: entry.id, hardNumbers: value, updatedAt });
          row.hardNumbers = value as typeof row.hardNumbers;
          row.updatedAt = updatedAt;
          return true;
        },
      }),
    },
  };
}

describe("regional final content correction", () => {
  it.each([
    ["id", (items: RegionalFinalContentEntry[]) => { items[0].id = 999; }],
    ["topic", (items: RegionalFinalContentEntry[]) => { items[0].topic = "middle_east_weekly"; }],
    ["date", (items: RegionalFinalContentEntry[]) => { items[0].issueDate = "2026-09-23"; }],
  ])("rejects a wrong target %s", async (_name, alter) => {
    const items = manifest();
    alter(items);
    await expect(applyRegionalFinalContentCorrections(items)).rejects.toThrow("target identity");
  });

  it("aborts the whole pair when either saved report changed", async () => {
    const fake = store();
    fake.rows[1].updatedAt = new Date("2026-09-22T12:00:01.123Z");
    await expect(applyRegionalFinalContentCorrections(manifest(), { store: fake.adapter }))
      .resolves.toEqual({ status: "skipped", reason: "target_changed" });
    expect(fake.updates).toHaveLength(0);
  });

  it("updates only merged hard numbers and preserves existing metadata", async () => {
    const fake = store();
    const metadata = { title: "Analyst title", status: "published" };
    Object.assign(fake.rows[0], metadata);
    await expect(applyRegionalFinalContentCorrections(manifest(), {
      store: fake.adapter,
      now: () => new Date("2026-09-23T00:00:00.000Z"),
    })).resolves.toEqual({ status: "applied" });
    expect(fake.updates).toHaveLength(2);
    expect(fake.updates[0].hardNumbers).toMatchObject({
      retained: { analyst: true },
      regenerated: true,
    });
    expect(fake.rows[0]).toMatchObject(metadata);
  });

  it("is idempotent and supports a non-writing dry run", async () => {
    const fake = store();
    const items = manifest();
    await expect(applyRegionalFinalContentCorrections(items, { store: fake.adapter, dryRun: true }))
      .resolves.toEqual({ status: "dry-run" });
    expect(fake.updates).toHaveLength(0);
    await applyRegionalFinalContentCorrections(items, {
      store: fake.adapter,
      now: () => new Date("2026-09-23T00:00:00.000Z"),
    });
    await expect(applyRegionalFinalContentCorrections(items, { store: fake.adapter }))
      .resolves.toEqual({ status: "skipped", reason: "target_changed" });
    expect(fake.updates).toHaveLength(2);
  });
});