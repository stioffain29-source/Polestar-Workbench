import {
  buildFlashpointReportDataset,
  selectFlashpointUsable,
  validateFlashpointReportDataset,
  FLASHPOINT_TABLE_ROW_CAP,
  type FlashpointReportIncident,
} from "../../artifacts/workbench/src/lib/flashpointReportDataset";

const ISSUE = "2026-05-31";

function fp(
  id: number,
  over: Partial<FlashpointReportIncident>,
): FlashpointReportIncident {
  return {
    id,
    title: over.title ?? "Workers protest in Dhaka over wages",
    summary: over.summary ?? "Demonstrators marched through the city centre.",
    topic: "flashpoint",
    country: over.country ?? "Bangladesh",
    location: over.location ?? "Dhaka",
    severity: over.severity ?? "moderate",
    occurredAt: over.occurredAt ?? "2026-05-28T08:00:00Z",
    ...over,
  } as FlashpointReportIncident;
}

describe("Flashpoint selection parity (FP-03)", () => {
  const rows: FlashpointReportIncident[] = [
    fp(1, {
      title: "Violence Erupts in Bangladesh as Police Clash with Dhaka University Students",
      severity: "high",
    }),
    fp(2, {
      title: "Thousands rally in Tokyo against Takaichi moves under 'No War' banner",
      country: "Japan",
      location: "Tokyo",
    }),
    fp(3, {
      title: "Former Nepal PM K P Sharma Oli arrested over Gen Z protest crackdown",
      country: "Nepal",
      location: "Kathmandu",
    }),
    fp(4, {
      title: "BAYAN, labor leaders face raps over May 1 rally in Manila",
      country: "Philippines",
      location: "Manila",
      severity: "low",
    }),
    fp(5, {
      title: "Protest vs tree cutting in Manila",
      country: "Philippines",
      location: "Manila",
      severity: "low",
    }),
    fp(6, {
      title: "Cab and auto strike in Delhi NCR: three-day Chakka jam in Capital",
      country: "India",
      location: "Delhi",
    }),
  ];

  it("selectFlashpointUsable enriched set matches buildFlashpointReportDataset enriched", () => {
    const sel = selectFlashpointUsable(rows, "flashpoint", ISSUE);
    const ds = buildFlashpointReportDataset(rows, "flashpoint", ISSUE);
    const selInPeriod = sel.enriched.filter((r) =>
      ds.enriched.some((d) => d.id === r.id),
    );
    expect(ds.enriched.map((r) => r.id).sort()).toEqual(
      selInPeriod.map((r) => r.id).sort(),
    );
  });

  it("Distinct Incidents KPI equals enriched count", () => {
    const ds = buildFlashpointReportDataset(rows, "flashpoint", ISSUE);
    const distinct = ds.fastFacts.find((k) => k.label === "Distinct Incidents");
    expect(distinct?.value).toBe(String(ds.enriched.length));
  });

  it("Activism + Unrest table rows are subsets of enriched set", () => {
    const ds = buildFlashpointReportDataset(rows, "flashpoint", ISSUE);
    const enrichedIds = new Set(ds.enriched.map((r) => r.id));
    for (const r of [
      ...ds.activismRows.slice(0, FLASHPOINT_TABLE_ROW_CAP),
      ...ds.unrestRows.slice(0, FLASHPOINT_TABLE_ROW_CAP),
    ]) {
      expect(enrichedIds.has(r.id)).toBe(true);
    }
  });

  it("country chart totals match enriched volume", () => {
    const ds = buildFlashpointReportDataset(rows, "flashpoint", ISSUE);
    const chartTotal = ds.countryRows.reduce((sum, row) => sum + row.value, 0);
    expect(chartTotal).toBe(ds.enriched.length);
  });

  it("validateFlashpointReportDataset passes on audit-style mixed set", () => {
    const ds = buildFlashpointReportDataset(rows, "flashpoint", ISSUE);
    expect(validateFlashpointReportDataset(ds)).toEqual([]);
  });
});
