/**
 * Sprint 1b — Steve PDF hygiene (FP-04–FP-11).
 * Regression fixture: polestar-report-flashpoint-202609072120.pdf
 */
import { explainRelevance, RELEVANCE_RULE_VERSION } from "@workspace/relevance";
import { classifyIncidentType } from "../../artifacts/workbench/src/lib/incidentClassifier";
import {
  buildFlashpointReportDataset,
  selectFlashpointUsable,
  validateFlashpointReportDataset,
  type FlashpointReportIncident,
} from "../../artifacts/workbench/src/lib/flashpointReportDataset";

const ISSUE = "2026-09-07";

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
    occurredAt: "2026-09-04T08:00:00Z",
    ...over,
  } as unknown as FlashpointReportIncident;
}

describe("Sprint 1b Steve PDF hygiene", () => {
  it("bumps RELEVANCE_RULE_VERSION for backfill", () => {
    expect(RELEVANCE_RULE_VERSION).toBe("2026-09-08.1");
  });

  describe("FP-04 strike homonyms", () => {
    it("drops carrier strike group at relevance", () => {
      const v = explainRelevance("flashpoint", {
        topic: "flashpoint",
        title: "US carrier strike group enters South China Sea amid tensions",
      });
      expect(v.relevant).toBe(false);
    });

    it("does not classify carrier strike group as labour action", () => {
      const issue = classifyIncidentType({
        topic: "flashpoint",
        title: "Carrier strike group departs Yokosuka after exercises",
        summary: "",
        source: null,
        sourceUrl: null,
        location: null,
      });
      expect(issue).not.toBe("Strike / labour action");
    });
  });

  describe("FP-05 sports/entertainment hard exclude", () => {
    it("drops Scott Kuggeleijn cricket story at relevance", () => {
      const v = explainRelevance("flashpoint", {
        topic: "flashpoint",
        title: "Scott Kuggeleijn takes five wickets as Black Caps dominate",
        summary: "The fast bowler struck twice in the powerplay before lunch.",
      });
      expect(v.relevant).toBe(false);
      expect(v.reason).toMatch(/sports|fixture|entertainment|homonym/i);
    });

    it("classifies cricket copy as Sports / entertainment", () => {
      const issue = classifyIncidentType({
        topic: "flashpoint",
        title: "Scott Kuggeleijn shines with hat-trick in Super Smash final",
        summary: "",
        source: null,
        sourceUrl: null,
        location: null,
      });
      expect(issue).toBe("Sports / entertainment");
    });

    it("never enters Flashpoint final set", () => {
      const rows = [
        inc({
          title: "Scott Kuggeleijn shines with hat-trick in Super Smash final",
          summary: "The fast bowler struck twice in the powerplay.",
          country: "New Zealand",
          severity: "high",
        }),
        inc({ title: "Farmers march to parliament over crop prices", country: "India", location: "Delhi" }),
      ];
      const sel = selectFlashpointUsable(rows, "flashpoint", ISSUE);
      expect(sel.enriched.some((r) => /kuggeleijn/i.test(r.title ?? ""))).toBe(false);
    });
  });

  describe("FP-06 event location not subject-country", () => {
    it("drops diaspora Bangladesh protest in London", () => {
      const v = explainRelevance("flashpoint", {
        topic: "flashpoint",
        title: "Bangladesh solidarity protest held outside London embassy",
        summary: "Hundreds gathered in central London to demand justice.",
      });
      expect(v.relevant).toBe(false);
      expect(v.reason).toMatch(/overseas|diaspora|venue/i);
    });

    it("selector drops APAC-tagged row with US venue", () => {
      const rows = [
        inc({
          title: "Bangladesh activists rally in Washington over election dispute",
          summary: "Protesters gathered near the Capitol.",
          country: "Bangladesh",
          location: "Washington",
          severity: "moderate",
        }),
        inc({ title: "Students rally in Dhaka over tuition hikes", country: "Bangladesh", location: "Dhaka" }),
      ];
      const sel = selectFlashpointUsable(rows, "flashpoint", ISSUE);
      expect(sel.enriched.some((r) => /washington/i.test(`${r.title} ${r.location}`))).toBe(false);
      expect(sel.enriched.some((r) => /dhaka/i.test(`${r.title} ${r.location}`))).toBe(true);
    });
  });

  describe("FP-07 commentary filter", () => {
    it("drops Thai lawmaker sympathy story at relevance", () => {
      const v = explainRelevance("flashpoint", {
        topic: "flashpoint",
        title: "Thai lawmaker gets messages of support from Myanmar citizens after protest",
      });
      expect(v.relevant).toBe(false);
      expect(v.reason).toMatch(/commentary|reaction/i);
    });
  });

  describe("FP-08 Related Incidents", () => {
    it("excludes sympathy/commentary rows from Related Incidents", () => {
      const rows = [
        inc({ title: "PTI supporters clash with police outside Adiala jail", severity: "high", country: "Pakistan" }),
        inc({ title: "Students rally against tuition hikes in Dhaka", country: "Bangladesh" }),
        inc({
          title: "Thai lawmaker gets messages of support from Myanmar citizens after protest",
          country: "Thailand",
          severity: "moderate",
        }),
        inc({ title: "Traders strike over new tax rules in Delhi", country: "India" }),
      ];
      const ds = buildFlashpointReportDataset(rows, "flashpoint", ISSUE);
      expect(ds.relatedIncidents.some((r) => /messages of support/i.test(r.title ?? ""))).toBe(false);
      const shown = new Set([...ds.activismRows, ...ds.unrestRows].map((r) => r.id));
      for (const r of ds.relatedIncidents) expect(shown.has(r.id)).toBe(false);
    });
  });

  describe("FP-09/10/11 metrics and narrative consistency", () => {
    it("Fast Facts distinct count matches enriched set only", () => {
      const rows = [
        inc({ title: "PTI supporters clash with police", severity: "high", country: "Pakistan" }),
        inc({ title: "Students rally in Dhaka", country: "Bangladesh" }),
        inc({
          title: "PTI announces planned protest for 15 September across cities",
          summary: "The party will stage a march on 15 September.",
          severity: "high",
          country: "Pakistan",
          occurredAt: "2026-09-05T08:00:00Z",
        }),
      ];
      const ds = buildFlashpointReportDataset(rows, "flashpoint", ISSUE);
      const distinct = ds.fastFacts.find((k) => k.label === "Distinct Incidents");
      expect(distinct?.value).toBe(String(ds.enriched.length));
      expect(validateFlashpointReportDataset(ds)).toEqual([]);
    });

    it("NZ What Matters severity matches table severity", () => {
      const rows = [
        inc({
          title: "Large protest march shuts central Auckland",
          summary: "Thousands marched through Queen Street; police deployed tear gas.",
          country: "New Zealand",
          location: "Auckland",
          severity: "high",
        }),
        inc({ title: "Minor market protest in Wellington", country: "New Zealand", location: "Wellington", severity: "low" }),
      ];
      const ds = buildFlashpointReportDataset(rows, "flashpoint", ISSUE);
      expect(ds.autoWhatMatters).toMatch(/High severity/i);
      expect(validateFlashpointReportDataset(ds)).toEqual([]);
    });

    it("does not call Seoul upcoming-only when confirmed incidents name Seoul", () => {
      const rows = [
        inc({
          title: "Metro disruption after protest near Yongsan station in Seoul",
          summary: "Protesters blocked access near central Seoul.",
          country: "South Korea",
          location: "Seoul",
          severity: "moderate",
        }),
        inc({
          title: "Union plans Seoul rally for 20 September",
          summary: "Workers announced a rally in Seoul on 20 September.",
          country: "South Korea",
          location: "Seoul",
          severity: "low",
          occurredAt: "2026-09-05T08:00:00Z",
        }),
      ];
      const ds = buildFlashpointReportDataset(rows, "flashpoint", ISSUE);
      expect(ds.autoWhatMatters).not.toMatch(/Seoul appears in upcoming or unconfirmed/i);
      expect(validateFlashpointReportDataset(ds)).toEqual([]);
    });
  });
});
