import {
  curateRegionalWeeklyIncidents,
  regionalIntelligenceCategory,
  selectRegionalKeyDevelopments,
  type RegionalIncident,
} from "../regionalWeekly";
import { cleanRegionalSourceText } from "../regionalSourceText";

function row(
  id: number,
  country: string,
  title: string,
  summary = title,
  source?: string,
): RegionalIncident {
  return {
    id,
    country,
    title,
    summary,
    source,
    severity: "high",
    occurredAt: "2026-09-17T06:00:00Z",
    incidentDate: "2026-09-17",
  };
}

describe("scoped regional curation repairs", () => {
  it("strips source mastheads, domains and feed cruft without losing facts", () => {
    expect(cleanRegionalSourceText(
      "Ratopati: LPG shortage affects 12 districts in Nepal | Ratopati",
      "Ratopati",
    )).toBe("LPG shortage affects 12 districts in Nepal");
    expect(cleanRegionalSourceText(
      "Flooding affects Garut - SuaraGarut.ID",
      "SuaraGarut.ID",
    )).toBe("Flooding affects Garut");
    expect(cleanRegionalSourceText(
      "Airport closure affects 3 routes | The New Indian Express",
      "The New Indian Express",
    )).toBe("Airport closure affects 3 routes");
    expect(cleanRegionalSourceText(
      "Data breach affected 1.9 million customers https://inquirer.net/story",
      "Inquirer.net",
    )).toBe("Data breach affected 1.9 million customers");
  });

  it("admits the two current material cyber rows through the actual gate", () => {
    const incidents = [
      row(
        87063,
        "Philippines",
        "LTFRB probes data breach as platform goes offline",
        "LTFRB probes data breach as platform goes offline Inquirer.net",
        "Inquirer.net",
      ),
      row(
        87901,
        "Australia",
        "Nearly two million Quest Apartment Hotels customers affected by data breach",
        "Nearly two million Quest Apartment Hotels customers affected by data breach SBS",
        "SBS",
      ),
    ];
    const curated = curateRegionalWeeklyIncidents(incidents, "apac_weekly", "2026-09-17");
    expect(curated.map((incident) => incident.id).sort()).toEqual([87063, 87901]);
    expect(curated.every((incident) => regionalIntelligenceCategory(incident) === "Cyber")).toBe(true);
  });

  it("does not turn generic cyber research or advisories into incidents", () => {
    const curated = curateRegionalWeeklyIncidents([
      row(88001, "Singapore", "Cybersecurity study: businesses affected by data breach risk"),
      row(88002, "Japan", "Cyber advisory: how to prevent ransomware disruption"),
    ], "apac_weekly", "2026-09-17");
    expect(curated).toEqual([]);
  });

  it("keeps one Nepal LPG event with every evidence member", () => {
    const curated = curateRegionalWeeklyIncidents([
      row(901, "Nepal", "Nepal faces LPG shortage as imports slow", "LPG supply shortage affects distributors.", "Ratopati"),
      row(902, "Nepal", "Cooking gas queues grow across Kathmandu", "Liquefied petroleum gas distribution remains disrupted."),
      row(903, "Nepal", "LPG scarcity hits households and businesses", "Nepal import and supply disruption continues."),
    ], "apac_weekly", "2026-09-17");

    expect(curated).toHaveLength(1);
    const members = (curated[0] as RegionalIncident & { sourceMembers?: RegionalIncident[] }).sourceMembers;
    expect(members?.map((member) => member.id).sort()).toEqual([901, 902, 903]);
  });

  it("merges the actual LPG, LP Gas and gas-bullet import updates across the report window", () => {
    const incidents = [
      { ...row(81282, "Nepal", "Nepal Faces Severe LPG Gas Shortage Amidst Import Failures"), occurredAt: "2026-09-20T06:36:42Z" },
      { ...row(79564, "Nepal", "Nepal Faces LP Gas Shortage Amidst Supply Chain Questions"), occurredAt: "2026-09-18T10:00:00Z" },
      { ...row(81291, "Nepal", "Nepal to import 160 gas bullets daily to ease shortage"), occurredAt: "2026-09-15T10:00:00Z" },
    ];
    const curated = curateRegionalWeeklyIncidents(incidents, "apac_weekly", "2026-09-21");
    expect(curated).toHaveLength(1);
    const members = (curated[0] as RegionalIncident & { sourceMembers?: RegionalIncident[] }).sourceMembers;
    expect(members?.map((member) => member.id).sort()).toEqual([79564, 81282, 81291]);
  });

  it("classifies the actual Highway 401 flooding as a natural hazard", () => {
    expect(regionalIntelligenceCategory(row(
      78470, "Thailand", "Flooding blocks Highway 401 as officials evacuate tourists",
    ))).toBe("Weather & Natural Hazards");
  });

  it("rejects wrongly assigned US presidential policy but not generic US mentions", () => {
    const curated = curateRegionalWeeklyIncidents([
      row(1, "New Zealand", "Trump's USD 100,000 H-1B visa payment requirement takes effect"),
      row(
        2,
        "New Zealand",
        "New Zealand airport closure disrupts US-bound travel",
        "The closure affected airport operations and US-bound passenger travel.",
      ),
      row(
        3,
        "New Zealand",
        "US company affected by New Zealand telecom outage",
        "The New Zealand telecom outage disrupted business operations.",
      ),
    ], "apac_weekly", "2026-09-17");
    expect(curated.map((incident) => incident.id)).not.toContain(1);
    expect(curated.map((incident) => incident.id)).toEqual(expect.arrayContaining([2, 3]));
  });

  it("reserves cyber category coverage and retains confirmed serious attacks", () => {
    const cyber = row(50, "Australia", "Quest customers affected by data breach");
    const operational = Array.from({ length: 8 }, (_, index) =>
      row(100 + index, "Japan", `Port closure disrupts cargo operations ${index}`));
    expect(selectRegionalKeyDevelopments([...operational, cyber], "apac_weekly")).toContain(cyber);

    const [attack] = curateRegionalWeeklyIncidents([
      row(60, "Pakistan", "Bomb attack killed police officers", "The confirmed bomb attack killed three police officers."),
    ], "apac_weekly", "2026-09-17");
    expect(attack?.id).toBe(60);
  });
});