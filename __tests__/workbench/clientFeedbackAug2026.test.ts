import {
  buildFuelCanonicalFacts,
  buildFuelCanonicalSections,
} from "../../artifacts/workbench/src/lib/fuelCanonicalFacts";
import {
  buildFuelProducerBuyerActions,
  capFuelMarketSeverity,
} from "../../artifacts/workbench/src/lib/fuelNarratives";
import { deriveIncidentCountry } from "../../artifacts/workbench/src/lib/shippingCountry";
import {
  buildFlashpointReportDataset,
  selectFlashpointUsable,
  type FlashpointReportIncident,
} from "../../artifacts/workbench/src/lib/flashpointReportDataset";
import { draftTopicReportProse } from "../../artifacts/workbench/src/lib/draftReportProse";

const FUEL_ISSUE = "2026-08-17";
const FP_ISSUE = "2026-08-17";

function fuel(
  id: number,
  title: string,
  severity: string,
  country?: string,
  summary?: string,
): TopicFastFactsIncident {
  return {
    id,
    topic: "fuel",
    title,
    summary: summary ?? "",
    severity,
    country,
    occurredAt: "2026-08-14T12:00:00Z",
    sourceUrl: `https://example.test/fuel/${id}`,
  };
}

function fp(over: Partial<FlashpointReportIncident>): FlashpointReportIncident {
  return {
    id: over.id ?? 1,
    title: over.title ?? "Workers protest in Tokyo",
    summary: over.summary ?? "Demonstrators marched through the city centre.",
    topic: "flashpoint",
    country: over.country ?? "Japan",
    location: over.location ?? "Tokyo",
    severity: over.severity ?? "low",
    occurredAt: over.occurredAt ?? "2026-08-14T08:00:00Z",
    ...over,
  } as FlashpointReportIncident;
}

describe("Fuel Watch — client feedback Aug 2026", () => {
  it("classifies Orenburg rationing under Russia, not Ukraine as location", () => {
    expect(
      deriveIncidentCountry({
        title: "Ukraine drone strike hits fuel depot near Orenburg as rationing begins",
        country: "Ukraine",
      }),
    ).toBe("Russia");
  });

  it("downgrades maritime-only fatalities without fuel continuity signal", () => {
    expect(
      capFuelMarketSeverity(
        "extreme",
        "Three sailors killed in Red Sea tanker attack",
        "Crew fatalities reported after missile strike on vessel",
      ),
    ).toBe("moderate");
  });

  it("downgrades maritime missile attack without fuel continuity signal", () => {
    expect(
      capFuelMarketSeverity(
        "high",
        "Houthis Claim Ballistic Missile Attack On Saudi Military Landing Ship Off Red Seaport Of Mocha",
        "Missile strike on naval vessel in Red Sea",
      ),
    ).toBe("moderate");
  });

  it("prefers Russia continuity over Red Sea corridor for primary pressure", () => {
    const facts = buildFuelCanonicalFacts({
      issueDate: FUEL_ISSUE,
      incidents: [
        fuel(1, "Orenburg imposes diesel rationing as queues grow", "high", "Russia", "Fuel rationing and forecourt shortages spread."),
        fuel(2, "Crew killed in Red Sea tanker missile strike", "extreme", "Yemen", "Three sailors dead after attack in Red Sea."),
        fuel(3, "Second report: Bab-el-Mandeb shipping attack kills crew", "extreme", "Yemen", "Fatal strike on tanker near Bab-el-Mandeb."),
      ],
      marketCards: [{ label: "Brent", value: 80, change: "+1.0% 7d" }],
    });
    expect(facts.primaryPressurePoint.label).toBe("Russia");
    expect(facts.incidentCount).toBe(2);
    const sections = buildFuelCanonicalSections(facts);
    expect(sections.regionalHighlights).toMatch(/Russia anchors the regional picture/i);
    expect(sections.whatMatters).toMatch(/Russia is the primary pressure point/i);
  });

  it("excludes electric aviation commentary from operator responses table", () => {
    const rows = buildFuelProducerBuyerActions({
      issueDate: FUEL_ISSUE,
      incidents: [
        fuel(1, "Electric aviation could reshape regional jet fuel demand, analysts say", "moderate"),
        fuel(2, "IndiGo cuts flights as jet fuel costs surge", "moderate", "India"),
      ],
    });
    expect(rows.some((r) => /electric aviation/i.test(r.action))).toBe(false);
    expect(rows.some((r) => /IndiGo/i.test(r.action))).toBe(true);
  });
});

describe("Flashpoint — client feedback Aug 2026", () => {
  it("drops archival 2008 USS George Washington protest from Aug 2026 window", () => {
    const sel = selectFlashpointUsable(
      [
        fp({
          title: "2008 USS George Washington protest remembered in Yokosuka feature",
          summary: "A look back at the 2008 demonstration against the carrier visit.",
          country: "Japan",
        }),
        fp({ title: "Teachers march on Tokyo ward office over pay", country: "Japan" }),
      ],
      "flashpoint",
      FP_ISSUE,
    );
    expect(sel.enriched.some((r) => /George Washington/i.test(r.title))).toBe(false);
  });

  it("drops sleep tourism demonstration false positive", () => {
    const sel = selectFlashpointUsable(
      [fp({ title: "Sleep Tourism demonstration promotes wellness travel in Osaka", country: "Japan" })],
      "flashpoint",
      FP_ISSUE,
    );
    expect(sel.enriched).toHaveLength(0);
  });

  it("drops Ceuta unrest mis-stamped as Indonesia", () => {
    const sel = selectFlashpointUsable(
      [fp({ title: "Clashes erupt in Ceuta after migrant crossing attempt", country: "Indonesia" })],
      "flashpoint",
      FP_ISSUE,
    );
    expect(sel.enriched).toHaveLength(0);
  });

  it("drops World in Brief Ceuta multi-story syndicated onto Indonesia", () => {
    const sel = selectFlashpointUsable(
      [
        fp({
          title: "World in Brief: Indonesia hit by earthquake; migrants stage protest in Ceuta",
          country: "Indonesia",
        }),
      ],
      "flashpoint",
      FP_ISSUE,
    );
    expect(sel.enriched).toHaveLength(0);
  });

  it("drops diplomatic Japan-Russia Kuril protest commentary", () => {
    const sel = selectFlashpointUsable(
      [
        fp({
          title: "Japan 'crossed line of decency' with protest over Putin's Kuril Islands visit: Russia",
          summary: "Moscow said Tokyo crossed a diplomatic line over the Kuril visit.",
          country: "Japan",
        }),
      ],
      "flashpoint",
      FP_ISSUE,
    );
    expect(sel.enriched).toHaveLength(0);
  });

  it("drops Japan-Russia Northern Territories diplomatic protest commentary", () => {
    const sel = selectFlashpointUsable(
      [
        fp({
          title: "Russia protests after Japan protested over Northern Territories",
          summary: "Moscow and Tokyo traded diplomatic statements over the disputed islands.",
          country: "Japan",
        }),
      ],
      "flashpoint",
      FP_ISSUE,
    );
    expect(sel.enriched).toHaveLength(0);
  });

  it("drops APTOPIX and bare wire photo-desk protest captions", () => {
    for (const title of ["APTOPIX Indonesia Protest", "Indonesia Protest"]) {
      const sel = selectFlashpointUsable(
        [fp({ title, summary: "Photo desk caption with no operational detail.", country: "Indonesia" })],
        "flashpoint",
        FP_ISSUE,
      );
      expect(sel.enriched).toHaveLength(0);
    }
  });

  it("keeps substantive protest headlines that mention a city or issue", () => {
    const sel = selectFlashpointUsable(
      [
        fp({
          title: "Seoul Residents Protest Housing Plans and Tax Increases Amid Growing Tensions",
          country: "South Korea",
        }),
      ],
      "flashpoint",
      FP_ISSUE,
    );
    expect(sel.enriched).toHaveLength(1);
  });

  it("drops non-APAC country stamps without live public-order signal", () => {
    const sel = selectFlashpointUsable(
      [
        fp({
          title: "Israeli cabinet debate over Gaza policy draws regional attention",
          summary: "Analysts reviewed the diplomatic fallout from the cabinet session.",
          country: "Israel",
        }),
      ],
      "flashpoint",
      FP_ISSUE,
    );
    expect(sel.enriched).toHaveLength(0);
  });

  it("folds West Papua into Indonesia country roll-ups", () => {
    const ds = buildFlashpointReportDataset(
      [
        fp({ title: "Large demos across West Papua meet with mixed responses by police", country: "West Papua", location: "West Papua" }),
        fp({ title: "Student protest in Jakarta", country: "Indonesia", location: "Jakarta" }),
      ],
      "flashpoint",
      FP_ISSUE,
    );
    const indonesia = ds.countryRows.find((r) => r.label === "Indonesia");
    expect(indonesia?.value).toBe(2);
    expect(ds.countryRows.some((r) => r.label === "West Papua")).toBe(false);
    expect(ds.activismRows.some((r) => /West Papua, Indonesia/.test(r.title))).toBe(true);
  });

  it("names Japan in What Matters when Japan leads incident volume", () => {
    const tokyoTitles = [
      "Dockworkers walk out at Yokohama port",
      "Nurses rally outside Osaka university hospital",
      "Teachers march on Nagoya city hall",
      "Students sit-in at Kyoto campus over fees",
      "Farm cooperatives protest in Sapporo",
      "Bus drivers strike in Fukuoka",
      "Community rally in Hiroshima over base plans",
      "Retail workers picket in Sendai",
    ];
    const rows = tokyoTitles.map((title, i) =>
      fp({
        id: i + 1,
        title,
        summary: "Protesters marched through the city centre today.",
        country: "Japan",
        severity: "low",
      }),
    );
    rows.push(fp({ id: 99, title: "Farmers protest in Dhaka over crop prices", country: "Bangladesh", severity: "moderate" }));
    const ds = buildFlashpointReportDataset(rows, "flashpoint", FP_ISSUE);
    expect(ds.countryRows[0]?.label).toBe("Japan");
    expect(ds.autoWhatMatters).toMatch(/Japan accounts for/i);
    expect(ds.autoPolestarView).toMatch(/Japan carries the highest incident volume/i);
  });

  it("draft exec summary names the same volume lead as the country chart", () => {
    const tokyoTitles = [
      "Dockworkers walk out at Yokohama port",
      "Nurses rally outside Osaka university hospital",
      "Teachers march on Nagoya city hall",
      "Students sit-in at Kyoto campus over fees",
      "Farm cooperatives protest in Sapporo",
      "Bus drivers strike in Fukuoka",
      "Community rally in Hiroshima over base plans",
      "Retail workers picket in Sendai",
    ];
    const rows = tokyoTitles.map((title, i) =>
      fp({
        id: i + 1,
        title,
        summary: "Protesters marched through the city centre today.",
        country: "Japan",
        severity: "low",
      }),
    );
    rows.push(fp({ id: 99, title: "Farmers protest in Dhaka over crop prices", country: "Bangladesh", severity: "moderate" }));
    const draft = draftTopicReportProse({ topic: "flashpoint", issueDate: FP_ISSUE, incidents: rows });
    expect(draft.executiveSummary).toMatch(/Japan sees the most activity/i);
  });
});
