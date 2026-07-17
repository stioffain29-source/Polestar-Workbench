import {
  buildGdeltContext,
  gdeltItemMatchesCountryReport,
  isGdeltMonitoredReport,
} from "../../artifacts/workbench/src/lib/gdeltContext";
import type { GdeltStructuredItem } from "@workspace/api-client-react";

function item(
  over: Partial<GdeltStructuredItem> & Pick<GdeltStructuredItem, "externalId" | "title">,
): GdeltStructuredItem {
  return {
    id: 1,
    kind: "story",
    url: "https://example.com/story",
    ...over,
  };
}

describe("isGdeltMonitoredReport", () => {
  it("includes the four primary theatres plus Jakarta and Papua", () => {
    expect(isGdeltMonitoredReport("Indonesia")).toBe(true);
    expect(isGdeltMonitoredReport("Philippines")).toBe(true);
    expect(isGdeltMonitoredReport("Thailand")).toBe(true);
    expect(isGdeltMonitoredReport("Papua New Guinea")).toBe(true);
    expect(isGdeltMonitoredReport("Jakarta")).toBe(true);
    expect(isGdeltMonitoredReport("Papua")).toBe(true);
    expect(isGdeltMonitoredReport("Australia")).toBe(false);
  });
});

describe("gdeltItemMatchesCountryReport", () => {
  it("routes Indonesian Papua to the Papua brief", () => {
    const papua = item({
      externalId: "e1",
      title: "Clash in highlands",
      country: "Indonesia",
      subBucket: "Indonesian Papua",
    });
    expect(gdeltItemMatchesCountryReport(papua, "Papua")).toBe(true);
    expect(gdeltItemMatchesCountryReport(papua, "Indonesia")).toBe(false);
  });

  it("routes Jakarta sub-bucket to the Jakarta brief only", () => {
    const jkt = item({
      externalId: "e2",
      title: "Rally in Gambir",
      country: "Indonesia",
      subBucket: "Jakarta",
    });
    expect(gdeltItemMatchesCountryReport(jkt, "Jakarta")).toBe(true);
    expect(gdeltItemMatchesCountryReport(jkt, "Indonesia")).toBe(false);
  });
});

describe("buildGdeltContext", () => {
  it("keeps stories and drops promoted events", () => {
    const rows = [
      item({
        externalId: "story-1",
        title: "Background piece",
        kind: "story",
        country: "Philippines",
        summary: "Context only.",
      }),
      item({
        externalId: "event-1",
        title: "Protest in Manila",
        kind: "event",
        country: "Philippines",
        lane: "Protests",
        sourceDate: new Date("2026-07-02"),
      }),
    ];
    const promoted = new Set(["event-1"]);
    const out = buildGdeltContext(rows, {
      country: "Philippines",
      promotedExternalIds: promoted,
    });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("story");
  });
});
