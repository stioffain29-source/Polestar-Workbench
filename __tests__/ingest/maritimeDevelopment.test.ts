import {
  compareMaritimeDevelopmentPair,
  MARITIME_DEVELOPMENT_VERSION,
  maritimeDevelopmentEventFromSemantic,
  resolveCanonicalMaritimeDevelopmentId,
  type MaritimeDevelopmentEvent,
} from "../../lib/ingest/src/maritimeDevelopment";

const base: MaritimeDevelopmentEvent = {
  incidentId: 1,
  canonicalDevelopmentId: "maritime-development-v3:existing",
  eventClass: "commercial_attack",
  commercialTarget: "vessel",
  commercialTargetName: "Tanker A",
  physicalLocation: "off Muscat",
  country: "Oman",
  routeName: "Gulf of Oman",
  eventDate: new Date("2026-06-18T00:00:00.000Z"),
  severity: "high",
  consequenceStatus: "none",
  title: "Tanker A attacked off Muscat",
  summary: "The vessel was attacked in the Gulf of Oman.",
  source: "Maritime Desk",
  sourceUrl: "https://example.test/tanker-a-attack",
  sourceQuotes: [
    {
      quote: "Tanker A attacked off Muscat",
      claim: "commercial attack",
    },
  ],
};

describe("relational maritime development resolution", () => {
  it("merges syndicated rewrites across publication/event-date drift", async () => {
    const rewrite = {
      ...base,
      incidentId: 2,
      canonicalDevelopmentId: null,
      eventDate: new Date("2026-06-20T00:00:00.000Z"),
      severity: "moderate",
      title: "Updated report on the earlier attack on Tanker A off Muscat",
      sourceQuotes: [
        {
          quote: "Updated report on the earlier attack on Tanker A off Muscat",
          claim: "same occurrence",
        },
      ],
    };
    expect(compareMaritimeDevelopmentPair(base, rewrite)).toBe("ambiguous");
    let adjudicatorInput:
      | { left: MaritimeDevelopmentEvent; right: MaritimeDevelopmentEvent }
      | undefined;
    const resolved = await resolveCanonicalMaritimeDevelopmentId(
      rewrite,
      [base],
      async (left, right) => {
        adjudicatorInput = { left, right };
        return "same";
      },
    );
    expect(resolved.id).toBe(base.canonicalDevelopmentId);
    expect(resolved.mergedIncidentIds).toEqual([1]);
    expect(adjudicatorInput?.left.title).toContain("Updated report");
    expect(adjudicatorInput?.right.summary).toContain("vessel was attacked");
    expect(adjudicatorInput?.right.source).toBe("Maritime Desk");
  });

  it("keeps a new target/location as a separate development", async () => {
    const material = {
      ...base,
      incidentId: 3,
      canonicalDevelopmentId: null,
      commercialTargetName: "Tanker B",
      physicalLocation: "off Salalah",
    };
    expect(compareMaritimeDevelopmentPair(base, material)).toBe("different");
    const resolved = await resolveCanonicalMaritimeDevelopmentId(material, [base]);
    expect(resolved.id).not.toBe(base.canonicalDevelopmentId);
    expect(resolved.mergedIncidentIds).toEqual([]);
  });

  it("preserves semantic fields while the persistence layer replaces provider keys", async () => {
    const semantic = maritimeDevelopmentEventFromSemantic(9, {
      eventClass: "commercial_attack",
      commercialTarget: "vessel",
      commercialTargetName: "Tanker A",
      physicalLocation: "off Muscat",
      country: "Oman",
      routeRelationship: {
        kind: "direct_passage",
        routeName: "Gulf of Oman",
        evidence: "Gulf of Oman",
      },
      eventDate: "2026-06-18",
      severity: "high",
      routingConsequence: {
        status: "none",
        claim: null,
        evidenceQuote: null,
        confidence: 0,
        kind: "none",
        description: null,
        evidence: null,
      },
    }, "provider-article-key");
    expect(semantic.canonicalDevelopmentId).toBe("provider-article-key");
    const resolved = await resolveCanonicalMaritimeDevelopmentId(
      { ...semantic, canonicalDevelopmentId: null },
      [{ ...base, canonicalDevelopmentId: null }],
    );
    expect(resolved.id).not.toBe("provider-article-key");
  });

  it("keeps repeated piracy at the same place on different dates separate", () => {
    const repeated = {
      ...base,
      incidentId: 10,
      eventClass: "piracy_or_armed_robbery",
      commercialTargetName: "tanker",
      eventDate: new Date("2026-06-19T00:00:00.000Z"),
      title: "Pirates board a tanker off Muscat",
      sourceUrl: "https://example.test/piracy-2",
      sourceQuotes: [],
    };
    const first = {
      ...repeated,
      incidentId: 11,
      eventDate: new Date("2026-06-18T00:00:00.000Z"),
      sourceUrl: "https://example.test/piracy-1",
    };
    expect(compareMaritimeDevelopmentPair(first, repeated)).toBe("different");
  });

  it("holds unnamed same-day attacks even when class and place match", async () => {
    const unnamed = {
      ...base,
      incidentId: 12,
      commercialTargetName: "tanker",
      title: "Tanker attacked off Muscat",
      sourceUrl: "https://example.test/unnamed-2",
      sourceQuotes: [],
    };
    const resolved = await resolveCanonicalMaritimeDevelopmentId(
      unnamed,
      [{ ...unnamed, incidentId: 13, sourceUrl: "https://example.test/unnamed-1" }],
      async () => "same",
    );
    expect(compareMaritimeDevelopmentPair(unnamed, {
      ...unnamed,
      incidentId: 14,
      sourceUrl: "https://example.test/unnamed-3",
    })).toBe("ambiguous");
    expect(resolved.mergedIncidentIds).toEqual([]);
  });

  it("rejects a material follow-on attack despite a shared named target", () => {
    const followOn = {
      ...base,
      incidentId: 15,
      eventDate: new Date("2026-06-18T00:00:00.000Z"),
      title: "A second attack struck Tanker A off Muscat",
      sourceUrl: "https://example.test/tanker-a-follow-on",
      sourceQuotes: [
        {
          quote: "A second attack struck Tanker A off Muscat",
          claim: "new attack",
        },
      ],
    };
    expect(compareMaritimeDevelopmentPair(base, followOn)).toBe("different");
  });

  it("uses v3 canonical IDs rather than legacy resolver keys", async () => {
    const resolved = await resolveCanonicalMaritimeDevelopmentId(
      { ...base, canonicalDevelopmentId: null },
      [],
    );
    expect(resolved.id.startsWith(`${MARITIME_DEVELOPMENT_VERSION}:`)).toBe(true);
  });
});
