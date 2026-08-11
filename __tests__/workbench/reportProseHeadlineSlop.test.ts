/**
 * Regression: reader-facing cargo/shipping prose must not paste article
 * headlines or lead with "Most recent example is \"…\"" (natural-prose standard).
 */
import {
  buildCargoSecurityRead,
  buildCargoWhatHappened,
  buildLogisticsHubRead,
} from "../../artifacts/workbench/src/lib/cargoNarratives";
import {
  describeShippingLead,
  type EnrichedIncident,
} from "../../artifacts/workbench/src/lib/shippingReportDataset";

const CARGO_ROUTE = {
  id: 1,
  topic: "cargo_watch",
  title: 'Truck hijacked on Jakarta highway — "local crew" blamed | Reuters',
  severity: "high",
  occurredAt: "2026-08-04T10:00:00.000Z",
  country: "Indonesia",
  summary: "Armed men hijacked a container truck on the highway outside Jakarta.",
  location: "Jakarta highway",
};

const CARGO_HUB = {
  id: 2,
  topic: "cargo_watch",
  title: "Warehouse raid empties bonded store overnight - Port News",
  severity: "moderate",
  occurredAt: "2026-08-03T08:00:00.000Z",
  country: "Malaysia",
  summary: "Thieves broke into a bonded warehouse at the depot and removed cargo.",
  location: "Port Klang depot",
};

describe("cargo prose — no headline paste / Most-recent opener", () => {
  it("security read paraphrases the lead without quoting the title", () => {
    const prose = buildCargoSecurityRead([CARGO_ROUTE]);
    expect(prose).toMatch(/One recent case involved/i);
    expect(prose).not.toMatch(/most recent example/i);
    expect(prose).not.toContain(CARGO_ROUTE.title);
    expect(prose).not.toMatch(/"[^"]{10,}"/);
  });

  it("hub read paraphrases the lead without quoting the title", () => {
    const prose = buildLogisticsHubRead([CARGO_HUB]);
    expect(prose).toMatch(/One recent case involved/i);
    expect(prose).not.toMatch(/most recent example/i);
    expect(prose).not.toContain(CARGO_HUB.title);
    expect(prose).not.toMatch(/"[^"]{10,}"/);
  });

  it("what-happened paraphrases route and hub leads", () => {
    const prose = buildCargoWhatHappened([CARGO_ROUTE, CARGO_HUB]);
    expect(prose).toMatch(/one recent case involved/i);
    expect(prose).not.toMatch(/most recent example/i);
    expect(prose).not.toContain(CARGO_ROUTE.title);
    expect(prose).not.toContain(CARGO_HUB.title);
    expect(prose).not.toMatch(/"[^"]{10,}"/);
  });
});

describe("shipping lead paraphrase — no headline paste", () => {
  const base: EnrichedIncident = {
    id: 9,
    title: "US-Iran deal, Strait of Hormuz to reopen - News and Statistics",
    topic: "shipping",
    severity: "high",
    occurredAt: "2026-08-05T12:00:00.000Z",
    summary: "Diplomats say the Strait of Hormuz may reopen under a new deal.",
    country: "Iran",
    date: new Date("2026-08-05T12:00:00.000Z"),
    incidentCountry: "Iran",
    region: "Middle East",
    issue: "Chokepoint disruption",
  };

  it("describes a Hormuz reopening without quoting the headline", () => {
    const phrase = describeShippingLead(base);
    expect(phrase).toMatch(/hormuz/i);
    expect(phrase).toMatch(/reopen/i);
    expect(phrase).not.toContain('"');
    expect(phrase).not.toContain(base.title);
  });

  it("falls back to chokepoint + issue without pasting title text", () => {
    const phrase = describeShippingLead({
      ...base,
      title: "Quiet advisory update near Bab el-Mandeb approaches tonight",
      summary: "Operators note a fresh advisory near Bab el-Mandeb.",
      issue: "Naval advisory",
    });
    expect(phrase).toMatch(/advisory|bab/i);
    expect(phrase).not.toContain('"');
    expect(phrase).not.toMatch(/Quiet advisory update/);
  });
});
