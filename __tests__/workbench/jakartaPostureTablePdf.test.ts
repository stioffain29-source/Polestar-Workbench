import { buildJakartaTacticalBrief } from "@/lib/jakartaBrief";
import { buildJakartaCorridorStatuses } from "@/lib/jakartaCorridors";
import type { CountryFastFactsIncident } from "@/lib/countryFastFacts";

describe("Jakarta map-panel caption", () => {
  it("replaces the retired seven-zone PDF table with one small exposure caption", () => {
    const statuses = buildJakartaCorridorStatuses([
      {
        id: 1,
        topic: "flashpoint",
        title: "Protesters rally near Monas",
        severity: "high",
        occurredAt: "2026-08-07T00:00:00.000Z",
        location: "Central Jakarta",
      },
    ] as CountryFastFactsIncident[]).statuses;
    const brief = buildJakartaTacticalBrief(statuses, []);

    expect(brief.mapCaption).toContain("Central Jakarta government district");
    expect(brief.mapCaption).toContain("exposure guide");
    expect(brief.mapCaption).not.toMatch(/\b1\.\s|\b2\.\s|\bZONE\b/i);
  });
});
