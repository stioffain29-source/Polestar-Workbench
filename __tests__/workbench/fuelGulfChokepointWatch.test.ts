import { buildFuelGulfChokepointWatch } from "@/lib/fuelNarratives";
import type { TopicFastFactsIncident } from "@/lib/topicFastFacts";

// The Fuel Watch "Gulf and Hormuz Chokepoint Watch" section is auto-derived
// from live fuel incidents whose TITLE names a Gulf/Hormuz chokepoint. The
// section is anchored on the report ISSUE DATE (the same window the rest of the
// report uses) and is scoped STRICTLY to that current-period window — records
// from before the reporting period are excluded entirely, never shown and
// never referenced in prose. These tests lock the no-fabrication gates:
//   1. The "dominant / marked concentration" opener may fire ONLY when current
//      coverage is broad (several distinct deduped events across several days).
//   2. "The strait subsequently reopened" may fire ONLY when a reopen record
//      actually post-dates the peak anchor.
//   3. The section returns null entirely when nothing falls in the current
//      reporting period — no older material is ever substituted in.

const ISSUE_DATE = "2026-07-15"; // weekly fuel window: 2026-07-09 .. 2026-07-15

function mk(
  id: number,
  title: string,
  occurredAt: string,
  severity: string,
): TopicFastFactsIncident {
  return {
    id,
    topic: "fuel",
    title,
    severity,
    occurredAt: `${occurredAt}T12:00:00+00:00`,
    sourceUrl: `https://example.test/${id}`,
  };
}

describe("buildFuelGulfChokepointWatch — no-fabrication gates", () => {
  it("returns null when no title names a Gulf/Hormuz chokepoint", () => {
    const incidents = [
      mk(1, "Pump prices rise across Jakarta amid subsidy debate", "2026-07-10", "low"),
      mk(2, "Diesel shortage eases as supply arrivals resume", "2026-07-12", "low"),
    ];
    expect(
      buildFuelGulfChokepointWatch({ issueDate: ISSUE_DATE, incidents }),
    ).toBeNull();
  });

  it("uses the neutral opener on sparse current coverage (few events / few days)", () => {
    const incidents = [
      mk(1, "Tanker attacked near Strait of Hormuz", "2026-07-10", "moderate"),
      mk(2, "Persian Gulf oil terminal disrupted by drone", "2026-07-12", "moderate"),
    ];
    const built = buildFuelGulfChokepointWatch({ issueDate: ISSUE_DATE, incidents });
    expect(built).not.toBeNull();
    expect(built!.read).toMatch(/featured in this reporting period's fuel-route reporting/i);
    expect(built!.read).not.toMatch(/dominant fuel-route risk/i);
    expect(built!.read).not.toMatch(/marked concentration/i);
  });

  it("uses the dominant opener when current coverage is broad", () => {
    const incidents = [
      mk(1, "Strait of Hormuz closure halts tanker traffic", "2026-07-09", "high"),
      mk(2, "Persian Gulf refinery struck in drone attack", "2026-07-11", "high"),
      mk(3, "Bab el-Mandeb shipping disrupted amid Red Sea tensions", "2026-07-13", "moderate"),
      mk(4, "Arabian Gulf crude flows cut by Hormuz crisis", "2026-07-15", "moderate"),
    ];
    const built = buildFuelGulfChokepointWatch({ issueDate: ISSUE_DATE, incidents });
    expect(built).not.toBeNull();
    expect(built!.read).toMatch(/dominant fuel-route risk/i);
    expect(built!.read).toMatch(/marked concentration/i);
    // Concentration is backed by a real count, not left as a bare adjective.
    expect(built!.read).toMatch(/4 distinct chokepoint incidents were logged across 4 separate days/i);
  });

  it("grounds the peak-pressure sentence in severity and location, not a bare headline repeat", () => {
    const incidents = [
      {
        id: 1,
        topic: "fuel",
        title: "Strait of Hormuz refinery struck in missile attack",
        country: "Iran",
        severity: "extreme",
        occurredAt: "2026-07-12T12:00:00+00:00",
        sourceUrl: "https://example.test/1",
      } as TopicFastFactsIncident,
    ];
    const built = buildFuelGulfChokepointWatch({ issueDate: ISSUE_DATE, incidents });
    expect(built).not.toBeNull();
    expect(built!.read).toMatch(/extreme-severity incident near Iran/i);
  });

  it("omits the reopening clause when reopen headlines predate the peak anchor", () => {
    const incidents = [
      mk(1, "Persian Gulf refinery struck in missile attack", "2026-07-14", "high"),
      mk(2, "Tankers reopen transit through Strait of Hormuz", "2026-07-10", "moderate"),
    ];
    const built = buildFuelGulfChokepointWatch({ issueDate: ISSUE_DATE, incidents });
    expect(built).not.toBeNull();
    expect(built!.read).not.toMatch(/subsequently reopened/i);
  });

  it("asserts the reopening clause only when a reopen record post-dates the peak", () => {
    const incidents = [
      mk(1, "Persian Gulf refinery struck in missile attack", "2026-07-10", "high"),
      mk(2, "Tankers resume passage through Strait of Hormuz", "2026-07-14", "moderate"),
    ];
    const built = buildFuelGulfChokepointWatch({ issueDate: ISSUE_DATE, incidents });
    expect(built).not.toBeNull();
    expect(built!.read).toMatch(/subsequently reopened/i);
  });
});

describe("buildFuelGulfChokepointWatch — current period only, no older material", () => {
  it("includes only current-period items and never surfaces older material", () => {
    const incidents = [
      // Fresh current-week Hormuz items.
      mk(1, "Tankers reroute as Strait of Hormuz tension flares", "2026-07-09", "moderate"),
      mk(2, "Hormuz shipping advisory issued after Gulf incident", "2026-07-12", "moderate"),
      mk(3, "Strait of Hormuz transit delays reported", "2026-07-14", "moderate"),
      // Old high-severity May event — must be excluded entirely, not shown anywhere.
      mk(4, "Strait of Hormuz closure halts tanker traffic", "2026-05-20", "high"),
    ];
    const built = buildFuelGulfChokepointWatch({ issueDate: ISSUE_DATE, incidents });
    expect(built).not.toBeNull();
    expect(built!.read).not.toMatch(/no fresh/i);
    expect(built!.currentItems.length).toBeGreaterThan(0);
    // Older material is never surfaced anywhere, in any field.
    expect(built!.standingItems.length).toBe(0);
    expect(built!.standingItemLines.length).toBe(0);
    expect(built!.standingNote).toBeNull();
    const currentTitles = built!.currentItemLines.join(" ");
    expect(currentTitles).not.toMatch(/closure halts tanker traffic/i);
    expect(built!.read).not.toMatch(/closure halts tanker traffic/i);
  });

  it("admits shipping-topic chokepoint items (they appear in the Producer/Buyer table) so it never contradicts them", () => {
    const shippingHormuz: TopicFastFactsIncident = {
      id: 99,
      // Filed under `shipping` by ingestion, but a genuine fuel-route chokepoint
      // event with a fuel-market signal ("oil tankers") — cross-read into the
      // Fuel Watch Producer/Buyer table. It must lead the chokepoint watch too.
      topic: "shipping",
      title: "Iranian missiles struck oil tankers in Strait of Hormuz, one sailor killed",
      severity: "high",
      occurredAt: "2026-07-13T12:00:00+00:00",
      sourceUrl: "https://example.test/99",
    };
    const built = buildFuelGulfChokepointWatch({
      issueDate: ISSUE_DATE,
      incidents: [shippingHormuz],
    });
    expect(built).not.toBeNull();
    expect(built!.read).not.toMatch(/no fresh/i);
    expect(built!.currentItems.length).toBeGreaterThan(0);
    expect(built!.currentItemLines.join(" ")).toMatch(/struck oil tankers in Strait of Hormuz/i);
  });

  it("ignores shipping-topic rows with no fuel-market signal", () => {
    const containerShip: TopicFastFactsIncident = {
      id: 98,
      topic: "shipping",
      title: "Container ship grounded in Strait of Hormuz after steering failure",
      severity: "moderate",
      occurredAt: "2026-07-13T12:00:00+00:00",
      sourceUrl: "https://example.test/98",
    };
    expect(
      buildFuelGulfChokepointWatch({ issueDate: ISSUE_DATE, incidents: [containerShip] }),
    ).toBeNull();
  });

  it("returns null (section omitted entirely) when only older, out-of-period material exists", () => {
    const incidents = [
      mk(1, "Strait of Hormuz closure halts tanker traffic", "2026-05-20", "high"),
      mk(2, "Persian Gulf refinery struck in drone attack", "2026-05-22", "high"),
    ];
    expect(
      buildFuelGulfChokepointWatch({ issueDate: ISSUE_DATE, incidents }),
    ).toBeNull();
  });

  it("admits a chokepoint incident whose HEADLINE names no chokepoint but whose body clearly describes one (e.g. a corporate statement)", () => {
    // Mirrors a real gap: a company statement titled generically, entirely
    // about vessels struck while transiting Hormuz, carried no chokepoint
    // name in its own headline. Title-only matching silently dropped this.
    const corporateStatement: TopicFastFactsIncident = {
      id: 97,
      topic: "fuel",
      title: "ADNOC issues statement clarifying attacks on facilities",
      summary:
        "ADNOC said 15 of its vessels have been attacked by missiles and drones while transiting the Strait of Hormuz, including three vessels this week alone, with one fatality and 20 injuries to crew members.",
      severity: "extreme",
      occurredAt: "2026-07-14T12:00:00+00:00",
      sourceUrl: "https://example.test/97",
    };
    const built = buildFuelGulfChokepointWatch({
      issueDate: ISSUE_DATE,
      incidents: [corporateStatement],
    });
    expect(built).not.toBeNull();
    expect(built!.currentItems.length).toBeGreaterThan(0);
    expect(built!.currentItemLines.join(" ")).toMatch(/ADNOC issues statement/i);
  });

  it("does NOT admit a story that merely mentions a chokepoint as background colour without an incident verb nearby", () => {
    const backgroundMention: TopicFastFactsIncident = {
      id: 96,
      topic: "fuel",
      title: "Nigeria fuel subsidy removal drives pump prices higher",
      summary:
        "Officials noted Nigeria imports little refined product via the Persian Gulf, with most cargoes sourced from Europe.",
      severity: "moderate",
      occurredAt: "2026-07-11T12:00:00+00:00",
      sourceUrl: "https://example.test/96",
    };
    expect(
      buildFuelGulfChokepointWatch({
        issueDate: ISSUE_DATE,
        incidents: [backgroundMention],
      }),
    ).toBeNull();
  });
});
