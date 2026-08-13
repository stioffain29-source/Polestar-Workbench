import { classifySeverity } from "../../lib/ingest/src/severity";
import {
  cargoScope,
  classifyCargoCategory,
  isShipOrAnchorageOnlyTheft,
} from "../../artifacts/workbench/src/lib/cargoAnalysis";
import { isEnforcementOutcome } from "../../artifacts/workbench/src/lib/cargoPatternConfig";
import {
  buildCargoPatternModel,
  buildCargoExecutiveSummary,
  type CargoPatternModelInput,
} from "../../artifacts/workbench/src/lib/cargoPatternModel";
import { buildCargoReportExtras } from "../../artifacts/workbench/src/lib/cargoReportData";
import { buildLogisticsHubRead, buildCargoSecurityRead } from "../../artifacts/workbench/src/lib/cargoNarratives";
import { visibleCountBands } from "../../artifacts/workbench/src/lib/cargoChoropleth";

function inc(p: Partial<CargoPatternModelInput>): CargoPatternModelInput {
  return {
    title: "",
    summary: "",
    occurredAt: "2026-07-20",
    topic: "cargo_watch",
    severity: "moderate",
    country: "India",
    ...p,
  };
}

describe("cargo watch report fixes", () => {
  it("excludes Chittagong-style ship theft from Cargo Watch scope", () => {
    const title = "Thieves steal cargo from ships at Chittagong port";
    expect(isShipOrAnchorageOnlyTheft(title)).toBe(true);
    expect(cargoScope({ title, country: "Bangladesh" })).toBe("excluded_non_cargo");
  });

  it("does not file Al Mukha port looting as enforcement without arrest/seizure/recovery", () => {
    const title = "Looting of cargo at Al Mukha port amid weapons clashes";
    const category = classifyCargoCategory({ title });
    expect(category).not.toMatch(/seizure/i);
    expect(isEnforcementOutcome(category, title)).toBe(false);
  });

  it("keeps a real narcotics seizure as enforcement", () => {
    const title = "Cocaine seized from cargo container at Mundra port";
    const category = classifyCargoCategory({ title });
    expect(category).toBe("Narcotics seizure (cargo / port)");
    expect(isEnforcementOutcome(category, title)).toBe(true);
  });

  it("rates a fatal container theft as High for cargo_watch", () => {
    expect(
      classifySeverity(
        "Driver killed as armed gang steals container from truck park",
        "cargo_watch",
      ),
    ).toBe("high");
  });

  it("clips weekly trend to the report window and marks partial weeks", () => {
    const extras = buildCargoReportExtras(
      [
        { title: "Warehouse theft in India", occurredAt: "2026-07-08", country: "India" },
        { title: "Truck hijacking in India", occurredAt: "2026-08-05", country: "India" },
      ],
      "2026-08-10",
    );
    // Window is 12 Jul–10 Aug; the first Monday-anchored week still starts 6 Jul
    // but its DISPLAY label is clipped to the period start and marked partial.
    expect(extras.trend[0]?.date).toBe("2026-07-06");
    expect(extras.trend[0]?.partial).toBe(true);
    expect(extras.trend[0]?.label).toMatch(/12 Jul/);
    expect(extras.trend.some((t) => t.partial)).toBe(true);
  });

  it("uses modal pattern severity so Moderate-majority sets are not all High", () => {
    const rows = [
      inc({
        id: 1,
        title: "Electronics cargo theft in transit on NH-48 near Delhi, India",
        severity: "moderate",
        occurredAt: "2026-07-12",
      }),
      inc({
        id: 2,
        title: "Pharmaceutical cargo theft in transit on NH-19 near Jaipur, India",
        severity: "moderate",
        occurredAt: "2026-07-20",
      }),
      inc({
        id: 3,
        title: "Textile cargo theft in transit on NH-44 near Mumbai, India",
        severity: "high",
        occurredAt: "2026-07-28",
      }),
    ];
    const m = buildCargoPatternModel(rows, { issueDate: "2026-08-10" });
    const transit = m.patterns.find((p) => /theft in transit/i.test(p.name));
    expect(transit).toBeTruthy();
    expect(transit!.count).toBeGreaterThanOrEqual(3);
    expect(transit!.highestSeverityKey).toBe("moderate");
    expect(transit!.peakSeverityKey).toBe("high");
    expect(buildCargoExecutiveSummary(m)).toMatch(/predominantly moderate/i);
  });

  it("drops the unsupported one-to-two-week insurance lead-time claim", () => {
    const prose = buildLogisticsHubRead([
      {
        topic: "cargo_watch",
        title: "Warehouse theft at a depot in Malaysia",
        severity: "moderate",
        occurredAt: "2026-07-20",
        country: "Malaysia",
      },
    ]);
    expect(prose).not.toMatch(/one to two weeks/i);
  });

  it("does not claim corroborating volume in Polestar View", () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      inc({
        id: i + 1,
        title: `Distinct cargo theft in transit of commodity-${i} on corridor-${i} in India`,
        severity: "moderate",
        occurredAt: `2026-07-${String(12 + (i % 18)).padStart(2, "0")}`,
      }),
    );
    const m = buildCargoPatternModel(rows, { issueDate: "2026-08-10" });
    expect(m.assessment.polestarView).not.toMatch(/corroborating volume/i);
    expect(m.assessment.polestarView).toMatch(
      /single-source|thin open-source|open-source coverage/i,
    );
  });

  it("explains India vs Bangladesh route-side vs overall leads without contradiction", () => {
    const rows = [
      {
        topic: "cargo_watch",
        title: "Warehouse theft at a depot in India",
        severity: "moderate",
        occurredAt: "2026-07-20",
        country: "India",
      },
      {
        topic: "cargo_watch",
        title: "Warehouse theft at a second depot in India",
        severity: "moderate",
        occurredAt: "2026-07-21",
        country: "India",
      },
      {
        topic: "cargo_watch",
        title: "Truck hijacking and cargo theft in transit near Dhaka, Bangladesh",
        severity: "moderate",
        occurredAt: "2026-07-22",
        country: "Bangladesh",
      },
      {
        topic: "cargo_watch",
        title: "Container theft in transit on a Bangladesh highway",
        severity: "moderate",
        occurredAt: "2026-07-23",
        country: "Bangladesh",
      },
    ];
    const read = buildCargoSecurityRead(rows);
    expect(read).toMatch(/among these route-side records/i);
    expect(read).toMatch(/overall-window lead/i);
  });

  it("omits unused choropleth bands above the observed maximum", () => {
    const bands = visibleCountBands(26);
    expect(bands.map((b) => b.label)).toEqual(["1–5", "6–20", "21–50"]);
    expect(bands.some((b) => b.min >= 51)).toBe(false);
  });

  it("does not compare partial final week raw counts as activity eased", () => {
    const rows = [
      inc({
        id: 1,
        title: "Warehouse theft at depot in India",
        occurredAt: "2026-07-28",
      }),
      inc({
        id: 2,
        title: "Truck hijacking on highway in India",
        occurredAt: "2026-08-09",
      }),
      inc({
        id: 3,
        title: "Cargo theft in transit on NH-48 in India",
        occurredAt: "2026-08-10",
      }),
    ];
    const m = buildCargoPatternModel(rows, { issueDate: "2026-08-10" });
    expect(m.trendCaption).not.toMatch(/activity eased/i);
    if (m.extras.trend.some((t) => t.partial)) {
      expect(m.trendCaption).toMatch(/per day|partial/i);
    }
  });

  it("explains inland transport stage total vs cargo theft in transit category", () => {
    const rows = [
      inc({
        id: 1,
        title: "Cargo theft in transit on NH-48 near Delhi, India",
        occurredAt: "2026-07-12",
      }),
      inc({
        id: 2,
        title: "Second cargo theft in transit on NH-19 near Jaipur, India",
        occurredAt: "2026-07-20",
      }),
      inc({
        id: 3,
        title: "Truck hijacking of electronics cargo on highway in India",
        severity: "high",
        occurredAt: "2026-07-28",
      }),
    ];
    const m = buildCargoPatternModel(rows, { issueDate: "2026-08-10" });
    expect(m.stageCategoryNote).toMatch(/movement-stage total/i);
    expect(m.stageCategoryNote).toMatch(/Truck hijacking/i);
  });

  it("excludes Munshiganj contracting-firm robbery from scope", () => {
    expect(
      cargoScope({
        title: "Armed robbers loot contracting firm office in Munshiganj",
        country: "Bangladesh",
      }),
    ).toBe("excluded_non_cargo");
  });

  it("classifies Mojokerto facility burglary as warehouse theft not in-transit", () => {
    const title = "Burglars break into logistics facility in Mojokerto, Indonesia";
    expect(classifyCargoCategory({ title })).toBe("Warehouse theft");
    expect(classifyCargoCategory({ title: "Facility burglary in Mojokerto" })).not.toBe(
      "Cargo theft in transit",
    );
  });

  it("includes the latest operational incident in Key Incidents", () => {
    const rows = [
      inc({
        id: 1,
        title: "Warehouse theft at depot in India",
        occurredAt: "2026-07-12",
        source: "Reuters",
        sourceUrl: "https://example.com/1",
      }),
      inc({
        id: 2,
        title: "Cargo theft in transit on NH-44 in India",
        occurredAt: "2026-08-11",
        source: "Local",
        sourceUrl: "https://example.com/2",
      }),
    ];
    const m = buildCargoPatternModel(rows, { issueDate: "2026-08-12" });
    expect(m.selected.some((r) => r.date.startsWith("2026-08-11"))).toBe(true);
  });

  it("rates arrest-only enforcement headlines as Low severity in the panel", () => {
    const rows = [
      inc({
        id: 1,
        title: "Police arrest cargo theft syndicate members in India",
        occurredAt: "2026-08-05",
        severity: "moderate",
      }),
    ];
    const m = buildCargoPatternModel(rows, { issueDate: "2026-08-10" });
    expect(m.enforcement.total).toBe(1);
    expect(m.enforcement.rows[0].severityKey).toBe("low");
  });

  it("separates India warehouse concern from Bangladesh transit concern in assessment", () => {
    const rows = [
      inc({
        id: 1,
        title: "Warehouse theft at depot in India",
        occurredAt: "2026-07-20",
        country: "India",
      }),
      inc({
        id: 2,
        title: "Warehouse theft at second depot in India",
        occurredAt: "2026-07-21",
        country: "India",
      }),
      inc({
        id: 3,
        title: "Truck hijacking and cargo theft in transit near Dhaka, Bangladesh",
        occurredAt: "2026-07-22",
        country: "Bangladesh",
      }),
      inc({
        id: 4,
        title: "Container theft in transit on Bangladesh highway",
        occurredAt: "2026-07-23",
        country: "Bangladesh",
      }),
    ];
    const m = buildCargoPatternModel(rows, { issueDate: "2026-08-10" });
    expect(m.assessment.situation).toMatch(/India.*warehouse/i);
    expect(m.assessment.situation).toMatch(/Bangladesh.*transit/i);
    expect(m.assessment.polestarView).toMatch(/India.*warehouse/i);
    expect(m.assessment.polestarView).toMatch(/Bangladesh.*transit/i);
  });
});
