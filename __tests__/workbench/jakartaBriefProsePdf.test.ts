import { buildJakartaTacticalBrief } from "@/lib/jakartaBrief";
import { buildJakartaCorridorStatuses } from "@/lib/jakartaCorridors";
import type { CountryFastFactsIncident } from "@/lib/countryFastFacts";

describe("Jakarta compact watch prose", () => {
  it("folds the sharper control judgment into the crime line and keeps a small map caption", () => {
    const statuses = buildJakartaCorridorStatuses([
      {
        id: 1,
        topic: "flashpoint",
        title: "Protest closes access near Monas",
        severity: "high",
        occurredAt: "2026-08-07T00:00:00.000Z",
        location: "Central Jakarta",
      },
    ] as CountryFastFactsIncident[]).statuses;
    const brief = buildJakartaTacticalBrief(statuses, []);

    expect(brief.crimeEscalationWatch.crime).toContain("standing control");
    expect(brief.crimeEscalationWatch.escalationTriggers).toContain("protest cordon");
    expect(brief.mapCaption).toContain("exposure guide");
    expect(brief.mapCaption.length).toBeLessThan(220);
  });
});
