import type { MaritimeMovement } from "@workspace/api-client-react";
import {
  buildMaritimeIntelligence,
  type MaritimeIncidentInput,
} from "../../artifacts/workbench/src/lib/maritimeIntelligence";
import {
  buildShippingCanonicalIncidents,
  buildShippingReportDataset,
  type ShippingReportIncident,
} from "../../artifacts/workbench/src/lib/shippingReportDataset";
import {
  deriveIncidentCountry,
  LOCATION_NOT_IDENTIFIED,
} from "../../artifacts/workbench/src/lib/shippingCountry";
import {
  classifyVesselIncident,
  classifyPiracy,
  detectChokepoints,
} from "../../artifacts/workbench/src/lib/shippingAnalysis";
import { semanticIncident } from "./maritimeSemanticTestHelpers";

const issueDate = "2026-06-18";
const windowStart = new Date("2026-06-09T00:00:00.000Z");
const windowEnd = new Date("2026-06-19T00:00:00.000Z");

function canonical(rows: ReturnType<typeof semanticIncident>[]) {
  return buildShippingCanonicalIncidents(
    rows as unknown as ShippingReportIncident[],
    "shipping",
  );
}

function board(rows: ReturnType<typeof semanticIncident>[], movement: MaritimeMovement[] = []) {
  const built = canonical(rows);
  return {
    built,
    board: buildMaritimeIntelligence({
      incidents: built.canonicalIncidents as unknown as MaritimeIncidentInput[],
      movement,
      windowStart,
      windowEnd,
      inputMode: "prevalidated",
    }),
  };
}

describe("Shipping semantic-v3 canonical invariants", () => {
  it("fails closed for missing, stale, and invalid semantic evidence with no raw-text fallback", () => {
    const rawAttack = {
      id: 1,
      topic: "shipping" as const,
      title: "Missile struck tanker in Strait of Hormuz",
      severity: "extreme",
      occurredAt: "2026-06-16T08:00:00.000Z",
      country: "Iran",
    };
    const valid = semanticIncident(2, rawAttack.title);
    const stale = semanticIncident(3, "Another missile attack in Strait of Hormuz");
    stale.maritimeSemantic.version = "maritime-semantic-v1";
    const invalid = semanticIncident(4, "Invalid semantic record");
    invalid.maritimeSemantic.verdict = "needs_review";

    const result = canonical([
      rawAttack as ReturnType<typeof semanticIncident>,
      stale,
      invalid,
    ]);
    expect(result.canonicalIncidents).toHaveLength(0);
  });

  it("excludes naval and drone activity without a validated commercial target", () => {
    const naval = semanticIncident(1, "Naval exercise near Strait of Hormuz", {
      eventClass: "naval_activity",
      commercialTargetValidated: false,
      commercialTarget: "none",
      commercialTargetEvidence: null,
    });
    const drone = semanticIncident(2, "Drone activity over Red Sea", {
      eventClass: "drone_activity",
      commercialTargetValidated: false,
      commercialTarget: "none",
      commercialTargetEvidence: null,
    });

    expect(canonical([naval, drone]).canonicalIncidents).toHaveLength(0);
  });

  it("keeps a validated commercial seizure distinct from an attack", () => {
    const attack = semanticIncident(1, "Commercial tanker attacked in Hormuz", {
      eventClass: "commercial_attack",
      developmentKey: "attack-development",
    });
    const seizure = semanticIncident(2, "Commercial tanker seized in Hormuz", {
      eventClass: "commercial_seizure",
      developmentKey: "seizure-development",
    });
    const result = canonical([attack, seizure]);
    expect(result.canonicalIncidents).toHaveLength(2);
    expect(result.canonicalIncidents.map((r) => classifyVesselIncident(r)).sort())
      .toEqual(["Attack", "Seized"]);
  });

  it("keeps pure piracy / armed robbery out of attack totals", () => {
    const robbery = semanticIncident(1, "Armed robbers boarded a tanker at anchorage", {
      eventClass: "piracy_or_armed_robbery",
      commercialTargetValidated: true,
      commercialTarget: "vessel",
      commercialTargetEvidence: "Armed robbers boarded a tanker at anchorage",
      severity: "high",
    });
    const result = canonical([robbery]);
    const report = buildShippingReportDataset(
      [robbery] as unknown as ShippingReportIncident[],
      "shipping",
      issueDate,
    );
    const intelligence = board([robbery]).board;

    expect(classifyVesselIncident(result.canonicalIncidents[0])).toBeNull();
    expect(classifyPiracy(result.canonicalIncidents[0])).toBe("Piracy");
    expect(report.vesselRows).toHaveLength(0);
    expect(report.piracyRows).toHaveLength(1);
    expect(report.fastFacts.find((f) => f.label === "Vessel Attacks / Seizures")?.value).toBe("0");
    expect(report.fastFacts.find((f) => f.label === "Piracy / Armed Robbery")?.value).toBe("1");
    expect(intelligence.incidentSnapshot.byCategory).toEqual([
      expect.objectContaining({ category: "Piracy / armed robbery", count: 1 }),
    ]);
  });

  it("does not count indirect route relationships even when port geography is physical", () => {
    const port = semanticIncident(1, "Port Klang closure disrupts vessel operations", {
      eventClass: "port_disruption",
      commercialTargetValidated: true,
      commercialTarget: "port_facility",
      commercialTargetEvidence: "Port Klang closure disrupts vessel operations",
      physicalLocation: "Port Klang",
      physicalLocationEvidence: "Port Klang closure disrupts vessel operations",
      country: "Malaysia",
      routeRelationship: {
        kind: "indirect",
        routeName: "Strait of Malacca",
        evidence: "Port Klang closure disrupts vessel operations",
      },
    });
    const result = canonical([port]);
    expect(result.canonicalIncidents).toHaveLength(1);
    expect(result.canonicalIncidents[0].incidentCountry).toBe("Malaysia");
    expect(detectChokepoints(result.canonicalIncidents[0])).toEqual([]);
    const report = buildShippingReportDataset(
      [port] as unknown as ShippingReportIncident[],
      "shipping",
      issueDate,
    );
    expect(report.chokepointRows.find((r) => r.name === "Malacca Strait")?.count).toBe(0);
  });

  it("folds the same development across event dates without gaining count or risk", () => {
    const first = semanticIncident(1, "Tanker attack first report", {
      eventClass: "commercial_attack",
      developmentKey: "same-attack-development",
      eventDate: "2026-06-15",
      severity: "high",
    });
    const followup = semanticIncident(2, "Tanker attack follow-up report", {
      eventClass: "commercial_attack",
      developmentKey: "same-attack-development",
      eventDate: "2026-06-16",
      severity: "high",
    });
    const folded = board([first, followup]);
    const duplicateInputBoard = buildMaritimeIntelligence({
      incidents: [first, followup] as unknown as MaritimeIncidentInput[],
      movement: [],
      windowStart,
      windowEnd,
      inputMode: "prevalidated",
    });

    expect(folded.built.canonicalIncidents).toHaveLength(1);
    expect(folded.built.canonicalIncidents[0].supportingArticles).toHaveLength(1);
    expect(folded.board.incidentSnapshot.total).toBe(1);
    expect(duplicateInputBoard.incidentSnapshot.total).toBe(2);
    expect(folded.board.risk.level).toBe(4);
    expect(duplicateInputBoard.risk.level).toBe(5);
  });

  it("keeps materially different validated development keys separate", () => {
    const a = semanticIncident(1, "Tanker attack reported in Hormuz", {
      eventClass: "commercial_attack",
      developmentKey: "attack-a",
    });
    const b = semanticIncident(2, "Tanker attack reported in Hormuz", {
      eventClass: "commercial_attack",
      developmentKey: "attack-b",
    });
    expect(canonical([a, b]).canonicalIncidents).toHaveLength(2);
  });

  it("counts countries only from physical semantic evidence, never raw country", () => {
    const unknownPhysical = semanticIncident(1, "Attack with no physical location evidence", {
      eventClass: "commercial_attack",
      physicalLocation: null,
      physicalLocationEvidence: null,
      country: null,
    });
    unknownPhysical.country = "United States";
    unknownPhysical.location = "United States";
    const result = canonical([unknownPhysical]);
    expect(result.canonicalIncidents[0].incidentCountry).toBeNull();
    expect(deriveIncidentCountry(unknownPhysical)).toBeNull();
    const report = buildShippingReportDataset(
      [unknownPhysical] as unknown as ShippingReportIncident[],
      "shipping",
      issueDate,
    );
    expect(report.locationNotIdentifiedCount).toBe(1);
    expect(report.countryRows.some((r) => r.label === LOCATION_NOT_IDENTIFIED)).toBe(false);
  });

  it("keeps AIS movement invariant for incidents, severity, routes, and risk", () => {
    const row = semanticIncident(1, "Extreme tanker attack in Hormuz", {
      eventClass: "commercial_attack",
      severity: "extreme",
      routeRelationship: {
        kind: "direct_passage",
        routeName: "Strait of Hormuz",
        evidence: "Extreme tanker attack in Hormuz",
      },
    });
    const movement: MaritimeMovement[] = [{
      id: 1,
      theatre: "Strait of Hormuz",
      chokepoint: "Strait of Hormuz",
      dataAsOf: "2026-06-18T00:00:00.000Z",
      totalVessels: 100,
      inboundCount: 40,
      outboundCount: 60,
      aisDarkOrGapCount: 80,
      anchoredOrWaitingCount: 90,
      confidence: "high",
      sourceName: "Licensed AIS test source",
      createdAt: "2026-06-18T00:00:00.000Z",
      updatedAt: "2026-06-18T00:00:00.000Z",
    }];
    const without = board([row]);
    const withMovement = board([row], movement);
    expect(withMovement.board.incidentSnapshot).toEqual(without.board.incidentSnapshot);
    expect(withMovement.board.highestIndividualSeverity).toBe(without.board.highestIndividualSeverity);
    expect(withMovement.board.overallRisk).toEqual(without.board.overallRisk);
    expect(withMovement.board.chokepointCards.map((c) => c.incidentCount))
      .toEqual(without.board.chokepointCards.map((c) => c.incidentCount));
  });

  it("separates highest individual Extreme severity from the overall risk rollup", () => {
    const row = semanticIncident(1, "One extreme tanker attack", {
      eventClass: "commercial_attack",
      severity: "extreme",
    });
    const result = board([row]).board;
    expect(result.highestIndividualSeverity).toBe("extreme");
    expect(result.overallRisk.level).toBe(4);
    expect(result.overallRisk.label).not.toBe("Extreme");
    expect(result.risk).toEqual(result.overallRisk);
  });

  it("keeps monitor/report canonical IDs aligned and only direct/physical routes counted", () => {
    const direct = semanticIncident(1, "Direct passage incident in Hormuz", {
      eventClass: "commercial_attack",
      developmentKey: "direct-route-development",
      routeRelationship: {
        kind: "direct_passage",
        routeName: "Strait of Hormuz",
        evidence: "Direct passage incident in Hormuz",
      },
    });
    const indirect = semanticIncident(2, "Indirect route incident in Hormuz", {
      eventClass: "port_disruption",
      developmentKey: "indirect-route-development",
      commercialTargetValidated: true,
      commercialTarget: "port_facility",
      commercialTargetEvidence: "Indirect route incident in Hormuz",
      routeRelationship: {
        kind: "indirect",
        routeName: "Strait of Hormuz",
        evidence: "Indirect route incident in Hormuz",
      },
    });
    const monitor = canonical([direct, indirect]);
    const report = buildShippingReportDataset(
      [direct, indirect] as unknown as ShippingReportIncident[],
      "shipping",
      issueDate,
    );
    expect(monitor.canonicalIncidents.map((r) => r.id).sort())
      .toEqual(report.canonicalIncidents.map((r) => r.id).sort());
    expect(report.chokepointRows.find((r) => r.name === "Strait of Hormuz")?.count).toBe(1);
    expect(Number(report.fastFacts.find((f) => f.label === "Confirmed Incidents")?.value)).toBe(2);
  });
});