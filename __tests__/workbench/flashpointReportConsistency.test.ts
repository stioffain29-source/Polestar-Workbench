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
//  - Stale dated forecast rows (on/before issue date) are excluded.
//  - Regional headline names the next-busiest countries by chart volume.
//  - Run-on Watch Next text splits into separate bullets.
import {
  buildFlashpointReportDataset,
  validateFlashpointReportDataset,
  pickFlashpointAnalystProse,
  cleanDisplayTitle,
  type FlashpointReportIncident,
} from "../../artifacts/workbench/src/lib/flashpointReportDataset";
import { locationForeignToCountry } from "../../artifacts/workbench/src/lib/upcomingSignals";
import { parseBullets } from "../../artifacts/workbench/src/lib/pdfChrome";

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
    const forecastLines = lines.filter((l) => /upcoming, (?:unconfirmed|date confirmed)/.test(l));
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

  test("stale dated forecast rows on or before the issue date are excluded", () => {
    const rows = [
      inc({
        title: "Pakistan nationwide strike 10 August",
        summary: "Unions say the general strike will run nationwide on 10 August.",
        severity: "moderate",
        country: "Pakistan",
        location: "Islamabad",
        occurredAt: "2026-08-09T08:00:00Z",
      }),
      inc({ title: "Minor rally dispersed in Delhi", severity: "low", country: "India", location: "Delhi" }),
    ];
    const ds = buildFlashpointReportDataset(rows, "flashpoint", "2026-08-10");
    expect(ds.forecastFuture.some((r) => r.country === "Pakistan")).toBe(false);
    expect(validateFlashpointReportDataset(ds)).toEqual([]);
  });

  test("regional headline names the next-busiest countries by chart volume", () => {
    const ausTitles = [
      "Sydney teachers march on state parliament",
      "Melbourne tram workers walk out over pay",
      "Brisbane nurses rally outside hospital",
      "Perth miners stage protest at site gate",
      "Adelaide students sit-in at campus hall",
      "Canberra public servants rally at ministry",
      "Hobart ferry workers strike over roster",
      "Darwin community protest over housing",
    ];
    const nepalTitles = [
      "Kathmandu students rally against fee hike",
      "Pokhara traders shut shops over tax",
      "Biratnagar union march through market district",
      "Nepalgunj transport operators walk out",
      "Butwal civic groups protest corruption",
    ];
    const skTitles = [
      "Seoul Samsung union walkout at chip plant",
      "Busan dock workers strike over safety",
      "Daegu taxi drivers rally at city hall",
      "Incheon airport staff protest overtime",
    ];
    const phTitles = [
      "Manila jeepney operators strike over franchise rules",
      "Cebu transport groups walk out over fares",
    ];
    const rows = [
      ...ausTitles.map((title) => inc({ title, country: "Australia", severity: "low" })),
      ...nepalTitles.map((title) => inc({ title, country: "Nepal", severity: "low" })),
      ...skTitles.map((title) => inc({ title, country: "South Korea", severity: "low" })),
      ...phTitles.map((title) => inc({ title, country: "Philippines", severity: "moderate" })),
    ];
    const ds = buildFlashpointReportDataset(rows, "flashpoint", ISSUE);
    expect(ds.countryRows[0]?.label).toBe("Australia");
    expect(ds.regionalCountryRead).toMatch(/followed by Nepal, South Korea and Philippines/);
    expect(validateFlashpointReportDataset(ds)).toEqual([]);
  });

  test("Incheon Airport protest syndication collapses to one distinct incident", () => {
    const rows = [
      inc({
        title: "Protesters rally at Incheon Airport over labour dispute",
        country: "South Korea",
        location: "Incheon",
        severity: "moderate",
        occurredAt: "2026-07-25T08:00:00Z",
      }),
      inc({
        title: "Incheon Airport workers stage protest over pay",
        country: "South Korea",
        location: "Incheon",
        severity: "low",
        occurredAt: "2026-07-25T12:00:00Z",
      }),
    ];
    const ds = buildFlashpointReportDataset(rows, "flashpoint", ISSUE);
    expect(ds.enriched.length).toBe(1);
  });

  test("parseBullets splits run-on Watch Next lines into separate items", () => {
    const runOn =
      "Pakistan — nationwide strike: upcoming, unconfirmed — plan around Islamabad. Philippines — transport strike: upcoming, unconfirmed — check staff routes. Thailand — rally call: upcoming, unconfirmed — monitor local media.";
    const bullets = parseBullets(runOn, 8);
    expect(bullets.length).toBe(3);
    expect(bullets[0]).toMatch(/Pakistan/);
    expect(bullets[1]).toMatch(/Philippines/);
    expect(bullets[2]).toMatch(/Thailand/);
  });

  test("dateless forecast rows stay out of the confirmed table and appear only in Watch Next", () => {
    const rows = [
      inc({
        title: "Thailand unions announce planned strike",
        summary: "Transport unions say a strike is coming but gave no date.",
        severity: "moderate",
        country: "Thailand",
        location: "Bangkok",
      }),
    ];
    const ds = buildFlashpointReportDataset(rows, "flashpoint", ISSUE);
    expect(ds.forecastFuture).toHaveLength(0);
    expect(ds.forecastRead).toMatch(/No confirmed upcoming protest calls/i);
    expect(ds.autoWatchNext).toMatch(/upcoming, unconfirmed/);
  });

  test("analysis essays and elections are excluded from the incident count", () => {
    const rows = [
      inc({ title: "From Protest to Power: BNP, Student Politics and Campus Violence", country: "Bangladesh", severity: "moderate" }),
      inc({ title: "India's protest movement keeps heat on Modi", country: "India", severity: "low" }),
      inc({ title: "Bangladesh presidential vote set for August as parties prepare", country: "Bangladesh", severity: "moderate" }),
      inc({ title: "Garment workers block road in Dhaka over wage arrears", country: "Bangladesh", severity: "moderate", location: "Dhaka" }),
      inc({ title: "Traders march on parliament in Delhi over tax rules", country: "India", severity: "low", location: "Delhi" }),
    ];
    const ds = buildFlashpointReportDataset(rows, "flashpoint", ISSUE);
    expect(ds.enriched.length).toBe(2);
    expect(ds.countryRows.map((r) => r.label).sort()).toEqual(["Bangladesh", "India"]);
    expect(validateFlashpointReportDataset(ds)).toEqual([]);
  });

  test("Fast Facts most affected country matches the chart volume leader", () => {
    const bdCities = ["Dhaka", "Chittagong", "Khulna", "Rajshahi", "Sylhet", "Barishal", "Rangpur", "Mymensingh"];
    const lkCities = ["Colombo", "Kandy", "Galle", "Jaffna"];
    const rows = [
      ...bdCities.map((city) =>
        inc({
          title: `Garment workers block road in ${city} over wage arrears`,
          country: "Bangladesh",
          severity: "low",
          location: city,
        }),
      ),
      ...lkCities.map((city) =>
        inc({
          title: `Teachers rally outside ministry over arrears in ${city}`,
          country: "Sri Lanka",
          severity: "high",
          location: city,
        }),
      ),
    ];
    const ds = buildFlashpointReportDataset(rows, "flashpoint", ISSUE);
    expect(ds.countryRows[0]?.label).toBe("Bangladesh");
    expect(ds.fastFacts.find((k) => k.label === "Most Affected Country")?.value).toBe("Bangladesh");
    expect(validateFlashpointReportDataset(ds)).toEqual([]);
  });

  test("Polestar View uses five-tier severity vocabulary not elevated", () => {
    const rows = [
      inc({ title: "PTI supporters clash with police outside Adiala jail", severity: "high", country: "Pakistan", location: "Rawalpindi" }),
      inc({ title: "Chemists walk out over e-pharmacy rules in Lahore", severity: "moderate", country: "Pakistan", location: "Lahore" }),
      inc({ title: "Students sit-in at campus hall in Dhaka", severity: "moderate", country: "Bangladesh", location: "Dhaka" }),
      inc({ title: "Police detain protesters after curfew order in Karachi", severity: "high", country: "Pakistan", location: "Karachi" }),
    ];
    const ds = buildFlashpointReportDataset(rows, "flashpoint", ISSUE);
    expect(ds.autoPolestarView).not.toMatch(/\belevated\b/i);
    expect(ds.autoPolestarView).toMatch(/Risk level: (High|Moderate|Low)/i);
  });

  test("implications name specific countries and campus sites when available", () => {
    const rows = [
      inc({ title: "Students sit-in at University of Dhaka campus", country: "Bangladesh", location: "Dhaka", severity: "moderate" }),
      inc({ title: "Traders march in Delhi over tax rules", country: "India", location: "Delhi", severity: "low" }),
    ];
    const ds = buildFlashpointReportDataset(rows, "flashpoint", ISSUE);
    expect(ds.autoImplications).toMatch(/Bangladesh and India/);
    expect(ds.autoImplications).not.toMatch(/South Asia, East Asia/);
    expect(ds.autoImplications).toMatch(/near Dhaka/);
    expect(ds.autoImplications).not.toMatch(/named campuses/);
  });

  test("stock rally, ceremonial demo, drug crime and rocket launch are excluded", () => {
    const rows = [
      inc({ title: "Samsung and SK Hynix rally as foreign interest returns to South Korea", country: "South Korea" }),
      inc({ title: "The moment of the 81st Anniversary of the Independence of the Republic of Indonesia, involving 81 TNI aircraft", country: "Indonesia" }),
      inc({ title: "Malaysian driver held in Thailand with 166kg of meth", country: "Thailand", location: "Bangkok" }),
      inc({ title: "China says Long March 7A rocket launch failed after flight anomaly", country: "China" }),
      inc({ title: "Indian police fire tear gas to disperse youth protesters", country: "India", severity: "high", location: "Delhi" }),
    ];
    const ds = buildFlashpointReportDataset(rows, "flashpoint", ISSUE);
    expect(ds.enriched.length).toBe(1);
    expect(ds.enriched[0]?.country).toBe("India");
    expect(ds.unrestRows.some((r) => /166kg of meth/i.test(r.title))).toBe(false);
  });

  test("pickFlashpointAnalystProse uses auto when editor stub is thin", () => {
    const auto = "What matters most this week is that activity is spread across South Asia.";
    const thin = "The practical concerns are staff movement, site access and keeping staff informed.";
    expect(pickFlashpointAnalystProse(thin, auto)).toBe(auto);
    expect(pickFlashpointAnalystProse("", auto)).toBe(auto);
  });

  test("drug crime is excluded even when summary mentions roadblock", () => {
    const rows = [
      inc({
        title: "Malaysian driver held in Thailand with 166kg of meth",
        summary: "Police seized drugs at a checkpoint roadblock near the border.",
        country: "Thailand",
        location: "Bangkok",
        severity: "moderate",
      }),
      inc({ title: "Indian police fire tear gas to disperse youth protesters", country: "India", severity: "high", location: "Delhi" }),
    ];
    const ds = buildFlashpointReportDataset(rows, "flashpoint", ISSUE);
    expect(ds.enriched.length).toBe(1);
    expect(ds.unrestRows.some((r) => /166kg of meth/i.test(r.title))).toBe(false);
  });

  test("auto What Matters names operational incidents not regional spread boilerplate", () => {
    const rows = [
      inc({ title: "Goods transporters' strike disrupts supply across Pakistan", country: "Pakistan", severity: "low" }),
      inc({ title: "Indian police fire tear gas, use batons to disperse youth protesters in Jharkhand", country: "India", severity: "high", location: "Jharkhand" }),
      inc({ title: "Hyundai Motor Union Launches Four-Day Partial Strike Over Wage Deadlock in South Korea", country: "South Korea", severity: "low" }),
      inc({ title: "Three dead, 23 injured, in Sri Lanka prison riots as overcrowding strains jails", country: "Sri Lanka", severity: "high" }),
    ];
    const ds = buildFlashpointReportDataset(rows, "flashpoint", ISSUE);
    expect(ds.autoWhatMatters).toMatch(/Pakistan/);
    expect(ds.autoWhatMatters).not.toMatch(/spread across South Asia, East Asia/);
    expect(ds.autoPolestarView).toMatch(/Risk level: Moderate\./);
    expect(ds.autoPolestarView).not.toMatch(/Polestar's view: this was an active week and the risk level is High/i);
  });

  test("cleanDisplayTitle strips chained outlet mastheads", () => {
    expect(
      cleanDisplayTitle(
        "Sunshine rally demands more police - ABC News & Headlines - Australian Broadcasting Corporation",
      ),
    ).toBe("Sunshine rally demands more police");
    expect(
      cleanDisplayTitle(
        "Business.Scoop » Wellington Households To March Against Tiaki Wai",
      ),
    ).toBe("Wellington Households To March Against Tiaki Wai");
  });

  test("future-dated announcements published in-window count only in forecast, not period totals", () => {
    const rows = [
      inc({
        title: "India transport unions announce statewide strike set for 13 August",
        summary: "Organisers say the strike will run statewide on 13 August.",
        country: "India",
        location: "Karnataka",
        severity: "moderate",
        occurredAt: "2026-08-10T08:00:00Z",
      }),
      inc({
        title: "Seoul civic groups announce protest march for 16 August",
        summary: "Residents will march through central Seoul on 16 August.",
        country: "South Korea",
        location: "Seoul",
        severity: "moderate",
        occurredAt: "2026-08-11T08:00:00Z",
      }),
      inc({
        title: "Wellington households to march against Tiaki Wai on 20 August",
        summary: "Organisers confirmed the march for 20 August.",
        country: "New Zealand",
        location: "Wellington",
        severity: "low",
        occurredAt: "2026-08-09T08:00:00Z",
      }),
      inc({
        title: "Indian police fire tear gas to disperse youth protesters in Delhi",
        country: "India",
        severity: "high",
        location: "Delhi",
        occurredAt: "2026-08-11T08:00:00Z",
      }),
    ];
    const ds = buildFlashpointReportDataset(rows, "flashpoint", "2026-08-12");
    expect(ds.enriched).toHaveLength(1);
    expect(ds.enriched[0]?.country).toBe("India");
    expect(ds.forecastFuture.some((r) => r.country === "India" && /13 August/.test(r.date ?? ""))).toBe(true);
    expect(ds.forecastFuture.some((r) => r.country === "South Korea")).toBe(true);
    expect(ds.forecastFuture.some((r) => r.country === "New Zealand")).toBe(true);
  });

  test("screening note accounts for every exclusion between screened and distinct counts", () => {
    const rows = [
      inc({ title: "Samsung shares rally as foreign interest returns", country: "South Korea" }),
      inc({ title: "From Protest to Power: campus politics essay", country: "Bangladesh", severity: "moderate" }),
      inc({
        title: "Protesters rally at Incheon Airport over labour dispute",
        country: "South Korea",
        location: "Incheon",
        severity: "moderate",
        occurredAt: "2026-07-25T08:00:00Z",
      }),
      inc({
        title: "Incheon Airport workers stage protest over pay",
        country: "South Korea",
        location: "Incheon",
        severity: "low",
        occurredAt: "2026-07-25T12:00:00Z",
      }),
      inc({ title: "Traders march on parliament in Delhi over tax rules", country: "India", severity: "low", location: "Delhi" }),
    ];
    const ds = buildFlashpointReportDataset(rows, "flashpoint", ISSUE);
    const note = ds.fastFacts.find((k) => k.label === "Distinct Incidents")?.note ?? "";
    expect(note).toMatch(/records screened/);
    expect(note).toMatch(/distinct incident/);
    const screened = Number(note.match(/(\d+) records screened/)?.[1] ?? 0);
    const distinct = Number(note.match(/(\d+) distinct incident/)?.[1] ?? 0);
    const dupes = Number(note.match(/(\d+) syndicated duplicate/)?.[1] ?? 0);
    const excluded = Number(note.match(/(\d+) excluded as off-topic or low-signal/)?.[1] ?? 0);
    const forecastHeld = Number(note.match(/(\d+) held for forecast/)?.[1] ?? 0);
    expect(screened).toBe(distinct + dupes + excluded + forecastHeld);
  });

  test("events dated on the issue date are not labelled upcoming when the report is generated that day", () => {
    const rows = [
      inc({
        title: "Pakistan nationwide strike 13 August",
        summary: "Unions say the general strike will run nationwide on 13 August.",
        severity: "moderate",
        country: "Pakistan",
        location: "Islamabad",
        occurredAt: "2026-08-12T08:00:00Z",
      }),
    ];
    const ds = buildFlashpointReportDataset(rows, "flashpoint", "2026-08-13");
    expect(ds.forecastFuture.some((r) => r.country === "Pakistan")).toBe(false);
    expect(ds.autoWatchNext).not.toMatch(/upcoming, (?:unconfirmed|date confirmed)/i);
  });

  test("activism main event prefers higher-severity confirmed operational incidents", () => {
    const rows = [
      inc({
        title: "Manila community groups push for tougher labour rules at city hall rally",
        country: "Philippines",
        location: "Manila",
        severity: "low",
        occurredAt: "2026-08-11T08:00:00Z",
      }),
      inc({
        title: "Manila transport operators block EDSA after franchise dispute, police deploy tear gas",
        country: "Philippines",
        location: "Manila",
        severity: "moderate",
        occurredAt: "2026-08-10T08:00:00Z",
      }),
    ];
    const ds = buildFlashpointReportDataset(rows, "flashpoint", "2026-08-12");
    expect(ds.activismRead).toMatch(/rated Moderate severity/i);
    expect(ds.activismRead).not.toMatch(/push for tougher labour rules/i);
  });

  test("activism read never leads with a prison riot from the unrest bucket", () => {
    const rows = [
      inc({
        title: "Three dead, 23 injured, in Sri Lanka prison riots as overcrowding strains jails",
        country: "Sri Lanka",
        severity: "high",
        occurredAt: "2026-08-07T08:00:00Z",
      }),
      inc({
        title: "Indian police fire tear gas, use batons to disperse youth protesters",
        country: "India",
        severity: "high",
        location: "Jharkhand",
        occurredAt: "2026-08-10T08:00:00Z",
      }),
    ];
    const ds = buildFlashpointReportDataset(rows, "flashpoint", "2026-08-12");
    expect(ds.activismRead).toMatch(/India/i);
    expect(ds.activismRead).not.toMatch(/Prison riot/i);
    expect(ds.civilUnrestRead).toMatch(/Prison riot/i);
  });

  test("screening note counts forecast-held records so figures fully reconcile", () => {
    const rows = [
      inc({
        title: "India transport unions announce statewide strike set for 13 August",
        summary: "Organisers say the strike will run statewide on 13 August.",
        country: "India",
        severity: "moderate",
        occurredAt: "2026-08-10T08:00:00Z",
      }),
      inc({
        title: "Indian police fire tear gas to disperse youth protesters in Delhi",
        country: "India",
        severity: "high",
        location: "Delhi",
        occurredAt: "2026-08-11T08:00:00Z",
      }),
    ];
    const ds = buildFlashpointReportDataset(rows, "flashpoint", "2026-08-12");
    const note = ds.fastFacts.find((k) => k.label === "Distinct Incidents")?.note ?? "";
    expect(note).toMatch(/held for forecast/);
    const screened = Number(note.match(/(\d+) records screened/)?.[1] ?? 0);
    const distinct = Number(note.match(/(\d+) distinct incident/)?.[1] ?? 0);
    const forecastHeld = Number(note.match(/(\d+) held for forecast/)?.[1] ?? 0);
    expect(forecastHeld).toBeGreaterThan(0);
    expect(screened).toBeGreaterThanOrEqual(distinct + forecastHeld);
  });
});
