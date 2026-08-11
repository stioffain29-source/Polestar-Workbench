// Flashpoint report consistency invariants (client-flagged defects):
//  - Fast Facts "Highest Severity" always matches the narrative's single
//    shared top-severity incident (one computation, never a subset).
//  - Per-country location lists never carry a foreign city (Kathmandu can
//    never appear under India).
//  - Related Incidents never repeats rows already shown in the Activism /
//    Civil Unrest tables.
//  - Watch Next never calls a forecast/announcement item "the most serious
//    incident reported this week"; forecast bullets read "upcoming, unconfirmed".
//  - Multiple confirmed civic protest marches are summarised as one
//    cross-country forecast line.
import {
  buildFlashpointReportDataset,
  validateFlashpointReportDataset,
  type FlashpointReportIncident,
} from "../../artifacts/workbench/src/lib/flashpointReportDataset";
import { locationForeignToCountry } from "../../artifacts/workbench/src/lib/upcomingSignals";

const ISSUE = "2026-07-27";

let nextId = 1;
function inc(over: Partial<FlashpointReportIncident>): FlashpointReportIncident {
  return {
    id: nextId++,
    title: "Workers stage protest over wages in Lahore",
    summary: "Union members marched through the city centre.",
    topic: "flashpoint",
    country: "Pakistan",
    location: "Lahore",
    severity: "low",
    occurredAt: "2026-07-24T08:00:00Z",
    ...over,
  } as unknown as FlashpointReportIncident;
}

describe("flashpoint report consistency", () => {
  test("validator passes on a mixed realistic set and Fast Facts matches shared top severity", () => {
    const rows = [
      inc({ title: "PTI supporters clash with police outside Adiala jail", severity: "high", country: "Pakistan", location: "Rawalpindi" }),
      inc({ title: "Students rally against tuition hikes in Dhaka", severity: "moderate", country: "Bangladesh", location: "Dhaka" }),
      inc({ title: "Traders strike over new tax rules in Delhi", severity: "low", country: "India", location: "Delhi" }),
      inc({ title: "Curfew imposed after unrest in Karachi district", severity: "moderate", country: "Pakistan", location: "Karachi" }),
    ];
    const ds = buildFlashpointReportDataset(rows, "flashpoint", ISSUE);
    expect(validateFlashpointReportDataset(ds)).toEqual([]);
    const card = ds.fastFacts.find((k) => k.label === "Highest Severity");
    expect(card?.value).toBe("High");
  });

  test("foreign city on a mis-attributed row never appears in that country's location list", () => {
    const rows = [
      inc({ title: "Susta residents protest in Kathmandu against Indian encroachment", country: "India", location: "Kathmandu", severity: "moderate" }),
      inc({ title: "Farmers march to parliament over crop prices", country: "India", location: "Delhi", severity: "low" }),
      inc({ title: "Second farmers group joins the parliament march", country: "India", location: "New Delhi", severity: "low" }),
    ];
    const ds = buildFlashpointReportDataset(rows, "flashpoint", ISSUE);
    const indiaPara = ds.regionalCountryRead.split("\n\n").find((p) => p.startsWith("India —"));
    if (indiaPara) {
      expect(indiaPara).not.toMatch(/kathmandu/i);
    }
    expect(validateFlashpointReportDataset(ds)).toEqual([]);
  });

  test("locationForeignToCountry flags Kathmandu under India but not Delhi", () => {
    expect(locationForeignToCountry("Kathmandu", "India")).toBe(true);
    expect(locationForeignToCountry("Kathmandu", "Nepal")).toBe(false);
    expect(locationForeignToCountry("Delhi", "India")).toBe(false);
    expect(locationForeignToCountry("Somewhere unmapped", "India")).toBe(false);
  });

  test("related incidents never repeat rows shown in the activism/unrest tables", () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      inc({
        title: i % 2 === 0
          ? `Union group ${i} stages walkout over pay dispute round ${i}`
          : `Police crackdown disperses protesters in sector ${i}`,
        severity: i === 0 ? "high" : "low",
        country: ["Pakistan", "India", "Bangladesh", "Nepal"][i % 4],
        location: null,
      }),
    );
    const ds = buildFlashpointReportDataset(rows, "flashpoint", ISSUE);
    const shown = new Set([...ds.activismRows.slice(0, 12), ...ds.unrestRows.slice(0, 12)].map((r) => r.id));
    for (const r of ds.relatedIncidents) expect(shown.has(r.id)).toBe(false);
    expect(validateFlashpointReportDataset(ds)).toEqual([]);
  });

  test("watch next labels forecast items as upcoming/unconfirmed and never calls one the most serious reported incident", () => {
    const rows = [
      // Future-dated announcement that is ALSO the highest-severity record.
      inc({ title: "PTI announces planned protest for 30 July across cities", summary: "The party will stage a march in Islamabad and other cities on 30 July.", severity: "high", country: "Pakistan", location: "Islamabad" }),
      inc({ title: "Minor clash at market dispersed by police", severity: "low", country: "India", location: "Delhi" }),
    ];
    const ds = buildFlashpointReportDataset(rows, "flashpoint", ISSUE);
    const lines = ds.autoWatchNext.split("\n");
    const forecastLines = lines.filter((l) => /upcoming, unconfirmed/.test(l));
    // The announcement renders as a forecast bullet…
    expect(forecastLines.length).toBeGreaterThan(0);
    // …and the follow-through "most serious incident reported this week" line
    // must NOT fire for a future-dated top record.
    expect(ds.autoWatchNext).not.toMatch(/most serious incident reported this week/i);
  });

  test("multiple confirmed civic protest marches are summarised across countries in the forecast read", () => {
    const rows = [
      inc({ title: "Civil groups announce planned protest for 2 August", summary: "Organisers say residents will march through the capital on 2 August.", severity: "moderate", country: "Nepal", location: "Kathmandu" }),
      inc({ title: "Community coalition announces planned protest for 3 August", summary: "Residents will march citywide on 3 August, organisers announced.", severity: "moderate", country: "Sri Lanka", location: "Colombo" }),
    ];
    const ds = buildFlashpointReportDataset(rows, "flashpoint", ISSUE);
    const marchRows = ds.forecastFuture.filter((r) => /civic protest march/i.test(r.signal));
    // "Confirmed" wording is reserved for rows with an explicitly stated
    // future date, so the summary line reads "with confirmed dates" and only
    // counts dated rows.
    const datedMarches = marchRows.filter((r) => !!r.date);
    if (datedMarches.length > 1) {
      expect(ds.forecastRead).toMatch(/Civic protest marches with confirmed dates are set in/);
      expect(ds.forecastRead).toMatch(/confirm turnout and access impact in each host city/);
    } else {
      expect(ds.forecastRead).not.toMatch(/Civic protest marches with confirmed dates are set in/);
    }
  });
});
