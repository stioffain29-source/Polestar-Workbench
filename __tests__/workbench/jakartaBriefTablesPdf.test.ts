import { buildJakartaOperatingPicture } from "@/lib/jakartaBrief";
import { buildJakartaCorridorStatuses } from "@/lib/jakartaCorridors";
import type { CountryFastFactsIncident } from "@/lib/countryFastFacts";

describe("Jakarta Operating Picture table payload", () => {
  it("contains only live corridors and complete Area | Driver | Impact | Action cells", () => {
    const statuses = buildJakartaCorridorStatuses([
      {
        id: 1,
        topic: "flashpoint",
        title: "Flooding blocks Tanjung Priok container access roads",
        severity: "high",
        occurredAt: "2026-08-07T00:00:00.000Z",
        location: "North Jakarta",
      },
    ] as CountryFastFactsIncident[]).statuses;
    const table = buildJakartaOperatingPicture(statuses);

    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]).toMatchObject({
      area: "North Jakarta & port area",
      driver: "Flooding / heavy rain",
    });
    expect(Object.values(table.rows[0]).every((value) => value.trim().length > 0)).toBe(true);
  });
});
