import { summarizeFuelDevelopmentClause, buildFuelRegionalHighlights } from "@/lib/fuelNarratives";
import {
  buildFuelCanonicalFacts,
  buildFuelCanonicalSections,
} from "@/lib/fuelCanonicalFacts";
import type { TopicFastFactsIncident } from "@/lib/topicFastFacts";

describe("summarizeFuelDevelopmentClause", () => {
  it("rewrites ADNOC Hormuz attack without mangling the acronym", () => {
    const clause = summarizeFuelDevelopmentClause({
      title: "ADNOC vessel attacked in Strait of Hormuz, no injuries",
    });
    expect(clause).toMatch(/^an ADNOC-linked vessel/i);
    expect(clause).not.toMatch(/\| Videos/i);
  });

  it("places Indian gasoline to Russia in Russia, not the publisher country", () => {
    const clause = summarizeFuelDevelopmentClause({
      title: "Indian gasoline fails to ease Russia's fuel shortage",
      country: "Ukraine",
    });
    expect(clause).toMatch(/Indian gasoline shipments failed to ease Russia/i);
  });

  it("strips tabloid headline debris from Moscow rationing stories", () => {
    const clause = summarizeFuelDevelopmentClause({
      title: "Moscow's fuel Crisis: Inside Russia's petrol Rationing crisis 2026",
    });
    expect(clause).toMatch(/Moscow tightened petrol purchase limits/i);
    expect(clause).not.toMatch(/Inside Russia/i);
    expect(clause).not.toMatch(/2026/);
  });

  it("keeps Red Sea and Hormuz vessel attacks as separate summaries", () => {
    const redSea = summarizeFuelDevelopmentClause({
      title: "Bodies of 4 Seafarers Killed in Houthi Missile Attack in Red Sea Taken from Yemen to Saudi Arabia",
    });
    const hormuz = summarizeFuelDevelopmentClause({
      title: "Chief Engineer Killed as Bulker is Attacked Exiting Strait of Hormuz",
    });
    expect(redSea).toMatch(/Red Sea/i);
    expect(redSea).toMatch(/separate from Hormuz/i);
    expect(hormuz).toMatch(/Strait of Hormuz/i);
    expect(hormuz).not.toMatch(/Red Sea/i);
  });
});

describe("Fuel Watch What Happened prose", () => {
  function inc(
    id: number,
    title: string,
    country: string,
    date: string,
    extra: Partial<TopicFastFactsIncident> = {},
  ): TopicFastFactsIncident {
    return {
      id,
      topic: "fuel",
      title,
      summary: title,
      country,
      location: country,
      severity: "high",
      occurredAt: `${date}T12:00:00Z`,
      ...extra,
    } as TopicFastFactsIncident;
  }

  it("renders dated operational prose without raw headline fragments", () => {
    const facts = buildFuelCanonicalFacts({
      issueDate: "2026-08-21",
      incidents: [
        inc(1, "ADNOC vessel attacked in Strait of Hormuz, no injuries", "UAE", "2026-08-15"),
        inc(2, "Indian gasoline fails to ease Russia's fuel shortage", "Ukraine", "2026-08-17"),
        inc(3, "Moscow's fuel Crisis: Inside Russia's petrol Rationing crisis 2026", "Russia", "2026-08-20"),
        inc(4, "Houthis claim drone strike on Saudi Aramco as unmanned vessel is destroyed | Videos", "Saudi Arabia", "2026-08-19"),
      ],
      marketCards: [{ label: "Brent", value: 90, change: "+1.0% 7d" }],
    });
    const whatHappened = buildFuelCanonicalSections(facts).whatHappened;
    expect(whatHappened).not.toMatch(/authorities confirmed indian gasoline/i);
    expect(whatHappened).not.toMatch(/\| Videos/i);
    expect(whatHappened).toMatch(/Indian gasoline shipments failed to ease Russia/i);
    expect(whatHappened).toMatch(/On 20 August 2026, Moscow tightened petrol purchase limits/i);
    expect(whatHappened).not.toMatch(/in the Strait of Hormuz, an ADNOC-linked vessel was attacked in the Strait of Hormuz/i);
  });

  it("prioritises rationing and policy ahead of duplicate chokepoint lines in What Matters", () => {
    const incidents = [
      inc(1, "ADNOC vessel attacked in Strait of Hormuz, no injuries", "UAE", "2026-08-15"),
      inc(2, "Chief Engineer Killed as Bulker is Attacked Exiting Strait of Hormuz", "Iran", "2026-08-16"),
      inc(3, "Moscow's fuel Crisis: Inside Russia's petrol Rationing crisis 2026", "Russia", "2026-08-20"),
      inc(4, "India cuts windfall tax on petrol, diesel, aviation-fuel exports", "India", "2026-08-16"),
    ];
    const facts = buildFuelCanonicalFacts({
      issueDate: "2026-08-21",
      incidents,
      marketCards: [{ label: "Brent", value: 90, change: "+1.0% 7d" }],
    });
    const whatMatters = buildFuelCanonicalSections(facts).whatMatters;
    expect(whatMatters).toMatch(/^The development with the greatest business significance.*Forecourt rationing/s);
    expect(whatMatters).toMatch(/Duty changes reset export economics/i);
    expect((whatMatters.match(/Hormuz transit pressure/g) ?? []).length).toBeLessThanOrEqual(1);
  });

  it("varies regional highlight framing instead of repeating a template opener", () => {
    const incidents = [
      inc(1, "Chief Engineer Killed as Bulker is Attacked Exiting Strait of Hormuz", "Iran", "2026-08-16"),
      inc(2, "Bodies of 4 Seafarers Killed in Houthi Missile Attack in Red Sea Taken from Yemen to Saudi Arabia", "Yemen", "2026-08-20"),
    ];
    const highlights = buildFuelRegionalHighlights({
      issueDate: "2026-08-21",
      incidents,
      window: incidents,
    });
    expect(highlights).not.toBeNull();
    expect(highlights).not.toMatch(/Recent activity points to/i);
    expect(highlights).toMatch(/Hormuz transit disruption/i);
    expect(highlights).toMatch(/Red Sea kinetic reporting/i);
  });

  it("writes distinct business significance lines in What Matters", () => {
    const facts = buildFuelCanonicalFacts({
      issueDate: "2026-08-21",
      incidents: [
        inc(1, "Moscow's fuel Crisis: Inside Russia's petrol Rationing crisis 2026", "Russia", "2026-08-20"),
        inc(2, "India cuts windfall tax on petrol, diesel, aviation-fuel exports", "India", "2026-08-16"),
        inc(3, "Bodies of 4 Seafarers Killed in Houthi Missile Attack in Red Sea Taken from Yemen to Saudi Arabia", "Yemen", "2026-08-20"),
      ],
      marketCards: [{ label: "Brent", value: 90, change: "+1.0% 7d" }],
    });
    const whatMatters = buildFuelCanonicalSections(facts).whatMatters;
    const lines = whatMatters.split("\n\n");
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(new Set(lines).size).toBe(lines.length);
    expect(whatMatters).toMatch(/Forecourt rationing/i);
    expect(whatMatters).toMatch(/Duty changes reset export economics/i);
    expect(lines.every((line, idx) => idx === 0 || !lines.slice(0, idx).includes(line))).toBe(true);
  });
});
