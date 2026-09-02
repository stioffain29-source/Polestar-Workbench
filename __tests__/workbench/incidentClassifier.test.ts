import { classifyIncidentType } from "../../artifacts/workbench/src/lib/incidentClassifier";

const row = (topic: string, title: string, summary = "") => ({
  topic,
  title,
  summary,
});

describe("classifyIncidentType — energy plural regex (TC-02)", () => {
  it("classifies plural power outages as Power outage", () => {
    expect(
      classifyIncidentType(row("energy", "Power outages hit Jakarta and Surabaya overnight")),
    ).toBe("Power outage");
  });

  it("classifies plural grid failures as Grid disruption", () => {
    expect(
      classifyIncidentType(row("energy", "Grid failures leave Manila districts without electricity")),
    ).toBe("Grid disruption");
  });

  it("classifies plural substation trips as Substation incident", () => {
    expect(
      classifyIncidentType(row("energy", "Substations tripped across Kerala after storm damage")),
    ).toBe("Substation incident");
  });
});

describe("classifyIncidentType — data centres buckets (TC-01/TC-02)", () => {
  it("classifies a facility outage", () => {
    expect(
      classifyIncidentType(
        row("data_centres", "Hyperscale data centre outage disrupts cloud region in Jakarta"),
      ),
    ).toBe("DC outage / downtime");
  });

  it("classifies a planning refusal", () => {
    expect(
      classifyIncidentType(
        row("data_centres", "Planning refused for new data centre near Selangor water reserve"),
      ),
    ).toBe("Planning / permit risk");
  });

  it("classifies community opposition", () => {
    expect(
      classifyIncidentType(
        row("data_centres", "Community opposition grows to hyperscale data centre in Johor"),
      ),
    ).toBe("Community opposition");
  });
});
