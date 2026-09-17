import { dedupeMapIncidents, type MapIncidentDedupeRow } from "../mapIncidentDedupe";

function row(
  id: number,
  title: string,
  overrides: Partial<MapIncidentDedupeRow> = {},
): MapIncidentDedupeRow {
  return {
    id,
    topic: "apac_local",
    title,
    summary: "",
    country: "Thailand",
    occurredAt: "2026-09-16T08:00:00.000Z",
    severity: "moderate",
    source: `Source ${id}`,
    sourceUrl: `https://example.com/${id}`,
    corroborations: [],
    ...overrides,
  };
}

describe("dedupeMapIncidents", () => {
  it("renders one incident for an authoritative event cluster and preserves every source", () => {
    const result = dedupeMapIncidents([
      row(1, "Haze reaches southern Thailand", { eventClusterKey: "haze-2026-09-16" }),
      row(2, "Indonesia fires send smoke across border", {
        eventClusterKey: "haze-2026-09-16",
        severity: "high",
      }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(2);
    expect(result[0].corroborations?.map((source) => source.url)).toEqual([
      "https://example.com/1",
      "https://example.com/2",
    ]);
  });

  it("collapses syndicated same-story headlines without merging different countries", () => {
    const result = dedupeMapIncidents([
      row(1, "Port closure disrupts regional freight - Reuters"),
      row(2, "Port closure disrupts regional freight | AP"),
      row(3, "Port closure disrupts regional freight", { country: "Malaysia" }),
    ]);

    expect(result).toHaveLength(2);
    expect(result.find((incident) => incident.country === "Thailand")?.corroborations).toHaveLength(2);
    expect(result.find((incident) => incident.country === "Malaysia")?.corroborations).toHaveLength(1);
  });

  it("keeps distinct incidents in the same country as separate markers", () => {
    const result = dedupeMapIncidents([
      row(1, "Flood closes bridge in Chiang Mai"),
      row(2, "Factory fire reported in Bangkok"),
    ]);

    expect(result).toHaveLength(2);
  });
});