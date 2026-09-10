import { BOARD_CHOKEPOINTS } from "../../artifacts/workbench/src/lib/maritimeIntelligence";
import {
  buildShippingSevenPagePresentation,
  type ShippingSevenPagePublicationSource,
} from "../../artifacts/workbench/src/lib/shippingSevenPagePresentation";
import type { CanonicalIncident } from "../../artifacts/workbench/src/lib/shippingReportDataset";
import { semanticFixture } from "./maritimeSemanticTestHelpers";

function canonical(
  id: number,
  title: string,
  semantic: ReturnType<typeof semanticFixture>,
  region: "Middle East" | "APAC" | "Country not identified",
  date: string,
): CanonicalIncident {
  return {
    id,
    title,
    displayTitle: null,
    topic: "shipping",
    severity: semantic.severity ?? "moderate",
    occurredAt: date,
    country: semantic.country,
    summary: title,
    latitude: null,
    longitude: null,
    source: "Test source",
    sourceUrl: `https://example.test/${id}`,
    location: semantic.physicalLocation,
    maritimeSemantic: semantic,
    maritimeValidation: { status: "validated", version: semantic.version },
    date: new Date(date),
    incidentCountry: semantic.country,
    physicalLocation: semantic.physicalLocation,
    region,
    issue: "Vessel attack",
    developmentKey: `development-${id}`,
    supportingArticles: [],
  };
}

function source(
  canonicalIncidents: CanonicalIncident[],
  complete = false,
): ShippingSevenPagePublicationSource {
  const latest = canonicalIncidents[0];
  const cardRows = BOARD_CHOKEPOINTS.map((key) => {
    const isAffected = key === "Strait of Hormuz" && Boolean(latest);
    return {
      key,
      risk: {
        level: isAffected ? 5 : 1,
        label: isAffected ? "Extreme" : "Not assessed",
        rationale: "",
        confidence: "high" as const,
      },
      incidentCount: isAffected ? 1 : 0,
      lastConfirmed: isAffected
        ? {
            id: latest.id,
            title: "Masked title must not be used",
            category: "Attack" as const,
            severity: latest.severity,
            occurredAt: latest.occurredAt,
            chokepoint: key,
            country: latest.incidentCountry,
            source: latest.source,
            sourceUrl: latest.sourceUrl,
          }
        : null,
      movement: null,
      businessImpact: [],
      confidence: "high" as const,
    };
  });

  return {
    dataset: { canonicalIncidents },
    completeness: { complete },
    maritimeBoard: {
      windowStart: new Date("2026-09-03T00:00:00.000Z"),
      windowEnd: new Date("2026-09-10T23:59:59.999Z"),
      chokepointCards: cardRows,
      confirmedIncidents: canonicalIncidents.map((row) => ({
        id: row.id,
        title: row.title,
        category: "Attack" as const,
        severity: row.severity,
        occurredAt: row.occurredAt,
        chokepoint: "Strait of Hormuz",
        country: row.incidentCountry,
        source: row.source,
        sourceUrl: row.sourceUrl,
      })),
      movementSnapshot: {
        theatres: [
          {
            theatre: "Strait of Hormuz",
            chokepoint: "Strait of Hormuz",
            dataAsOf: "2026-09-09T00:00:00.000Z",
            totalVessels: 4,
            inboundCount: 2,
            outboundCount: 2,
            tankersCount: null,
            bulkCarriersCount: null,
            containerCount: null,
            lngLpgCount: null,
            anchoredOrWaitingCount: null,
            aisVisibleCount: null,
            aisDarkOrGapCount: null,
            changeVs7DayBaseline: null,
            confidence: "high",
            sourceName: "Test AIS",
            sourceUrl: null,
            notes: null,
          },
          {
            theatre: "Strait of Hormuz",
            chokepoint: "Strait of Hormuz",
            dataAsOf: "2026-09-01T00:00:00.000Z",
            totalVessels: 99,
            inboundCount: null,
            outboundCount: null,
            tankersCount: null,
            bulkCarriersCount: null,
            containerCount: null,
            lngLpgCount: null,
            anchoredOrWaitingCount: null,
            aisVisibleCount: null,
            aisDarkOrGapCount: null,
            changeVs7DayBaseline: null,
            confidence: "high",
            sourceName: "Test AIS",
            sourceUrl: null,
            notes: null,
          },
        ],
        asOf: "2026-09-09T00:00:00.000Z",
        sourceName: "Test AIS",
        confidence: "high",
      },
    },
  };
}

describe("Shipping seven-page presentation", () => {
  it("keeps all seven board routes, qualifies pending risk, and uses windowed AIS", () => {
    const attack = canonical(
      1,
      "Commercial vessel struck near the route",
      semanticFixture("Commercial vessel struck near the route", {
        eventDate: "2026-09-09T00:00:00.000Z",
        physicalLocation: "Physical incident location",
        country: "Iran",
        routeRelationship: {
          kind: "physical",
          routeName: "Strait of Hormuz",
          evidence: "source",
        },
      }),
      "Middle East",
      "2026-09-09T00:00:00.000Z",
    );
    const result = buildShippingSevenPagePresentation(source([attack]));

    expect(result.matrix).toHaveLength(7);
    expect(result.matrix.map((row) => row.key)).toEqual(BOARD_CHOKEPOINTS);
    expect(result.matrix[0].risk.display).toBe("Assessment pending");
    expect(result.matrix[0].risk.level).toBeNull();
    expect(result.matrix[0].movement?.totalVessels).toBe(4);
    expect(result.matrix[0].movementText).toContain("4 vessels");
    expect(result.matrix[0].latestIncident?.title).toBe(attack.title);
    expect(result.matrix[0].latestIncident?.physicalLocation).toBe(
      "Physical incident location",
    );
  });

  it("does not duplicate piracy, retains source titles, and balances geography totals", () => {
    const attack = canonical(
      1,
      "Commercial vessel struck near the route",
      semanticFixture("Commercial vessel struck near the route", {
        eventDate: "2026-09-09T00:00:00.000Z",
        country: "Iran",
      }),
      "Middle East",
      "2026-09-09T00:00:00.000Z",
    );
    const piracy = canonical(
      2,
      "Piracy boarding reported at anchorage",
      semanticFixture("Piracy boarding reported at anchorage", {
        eventClass: "piracy_or_armed_robbery",
        commercialTargetValidated: true,
        commercialTarget: "vessel",
        eventDate: "2026-09-08T00:00:00.000Z",
        country: null,
        physicalLocation: null,
        physicalLocationEvidence: null,
      }),
      "Country not identified",
      "2026-09-08T00:00:00.000Z",
    );
    const result = buildShippingSevenPagePresentation(
      source([attack, piracy], true),
    );

    expect(result.timeline.totalCount).toBe(1);
    expect(result.piracySecondary.totalCount).toBe(1);
    expect(result.timeline.rows[0].title).toBe(attack.title);
    expect(result.piracySecondary.rows[0].title).toBe(piracy.title);
    expect(result.geography.regions.unknownCount).toBe(1);
    expect(result.geography.countries.unknownCount).toBe(1);
    expect(result.geography.regions.rows.reduce((n, row) => n + row.value, 0)).toBe(2);
    expect(result.geography.countries.rows.reduce((n, row) => n + row.value, 0)).toBe(2);
    expect(result.register.totalCount).toBe(2);
  });

  it("keeps semantic commercial consequence status and evidence explicit", () => {
    const row = canonical(
      3,
      "Route disruption with assessed consequence",
      semanticFixture("Route disruption with assessed consequence", {
        eventClass: "route_disruption",
        routeRelationship: {
          kind: "physical",
          routeName: "Strait of Hormuz",
          evidence: "route source",
        },
        routingConsequence: {
          status: "assessed",
          kind: "reported",
          claim: "Passage plans were changed",
          description: null,
          evidence: "routing source",
          evidenceQuote: "The operator changed its passage plan.",
          confidence: 0.8,
        },
      }),
      "Middle East",
      "2026-09-08T00:00:00.000Z",
    );
    const result = buildShippingSevenPagePresentation(source([row], true));

    expect(result.commercialEffects).toEqual([
      expect.objectContaining({
        id: 3,
        status: "assessed",
        kind: "reported",
        claim: "Passage plans were changed",
        evidence: "The operator changed its passage plan.",
      }),
    ]);
  });

  it("does not present status-only consequences or unreported route effects", () => {
    const noSource = canonical(
      4,
      "Commercial consequence without source quote",
      semanticFixture("Commercial consequence without source quote", {
        eventClass: "other_maritime_event",
        commercialConsequence: {
          status: "assessed",
          claim: "Freight schedules were affected",
          evidenceQuote: null,
          confidence: 0.8,
        },
      }),
      "Middle East",
      "2026-09-07T00:00:00.000Z",
    );
    const unreportedRoute = canonical(
      5,
      "Route consequence with unsupported kind",
      semanticFixture("Route consequence with unsupported kind", {
        eventClass: "route_disruption",
        routingConsequence: {
          status: "assessed",
          kind: "potential",
          claim: "Passage plans may change",
          description: "Potential diversion",
          evidence: "Route source",
          evidenceQuote: "The operator may change its passage plan.",
          confidence: 0.8,
        },
      }),
      "Middle East",
      "2026-09-06T00:00:00.000Z",
    );

    const result = buildShippingSevenPagePresentation(
      source([noSource, unreportedRoute], true),
    );

    expect(result.commercialEffects).toEqual([]);
  });

  it("keeps all eleven current canonical rows in the compact register", () => {
    const rows = Array.from({ length: 11 }, (_, index) =>
      canonical(
        index + 1,
        `Source headline ${index + 1}`,
        semanticFixture(`Source headline ${index + 1}`, {
          eventDate: `2026-09-${String(10 - (index % 7)).padStart(2, "0")}T00:00:00.000Z`,
          country: index === 10 ? null : "Iran",
          physicalLocation: index === 10 ? null : `Physical location ${index + 1}`,
          physicalLocationEvidence: index === 10 ? null : `Source headline ${index + 1}`,
        }),
        index === 10 ? "Country not identified" : "Middle East",
        `2026-09-${String(10 - (index % 7)).padStart(2, "0")}T00:00:00.000Z`,
      ),
    );
    const result = buildShippingSevenPagePresentation(source(rows, true));

    expect(result.canonicalIncidentCount).toBe(11);
    expect(result.register.totalCount).toBe(11);
    expect(result.register.shownCount).toBe(11);
    expect(result.register.capped).toBe(false);
    expect(result.register.countNote).toBeNull();
    expect(result.register.rows.map((row) => row.title)).toContain("Source headline 11");
    expect(result.register.rows.find((row) => row.id === 11)?.physicalLocation).toBeNull();
  });
});
