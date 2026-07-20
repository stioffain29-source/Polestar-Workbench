import {
  runCountryReportQc,
  type CountryReportQcMapIncident,
} from "@/lib/countryReportQc";
import type { PngReportItem } from "@/lib/pngReportDataset";

type Ds = Parameters<typeof runCountryReportQc>[0];

function item(
  over: Partial<PngReportItem> & { id: string; title: string },
): PngReportItem {
  return {
    id: over.id,
    title: over.title,
    summary: "",
    province: over.province ?? null,
    location: over.location ?? null,
    category: "Other security",
    displayCategory: "Other security",
    businessImpact: "",
    severity: "low",
    severityLabel: "Low",
    severityRank: 2,
    reportedDate: new Date("2026-07-15T08:00:00.000Z"),
    incidentDate: over.incidentDate ?? null,
    occurredEarlier: over.occurredEarlier ?? false,
    occurredOutOfWindow: over.occurredOutOfWindow ?? false,
    source: "Test",
    url: null,
    confidence: "unrated",
    ...over,
  } as PngReportItem;
}

function dataset(over: Partial<Ds> = {}): Ds {
  return {
    topThree: [],
    incidentDetailsItems: [],
    windowItems: [],
    bluf: "",
    executiveSummary: "",
    outlook: "",
    polestarView: "",
    whatChanged: "",
    businessImpact: [],
    whatMattersBullets: [],
    escalationIndicators: [],
    keyDevelopments: [],
    assessedThemes: [],
    recommendedActions: [],
    ...over,
  } as Ds;
}

const map = (
  ...locs: string[]
): CountryReportQcMapIncident[] => locs.map((location) => ({ location }));

describe("runCountryReportQc — non-blocking §13 quality checks", () => {
  it("is silent (no warnings) for a consistent brief", () => {
    const dev = item({
      id: "1",
      title: "Ambush near Ilaga",
      location: "Ilaga, Puncak",
    });
    const ds = dataset({
      topThree: [dev],
      windowItems: [dev],
      bluf: "An ambush near Ilaga (Puncak) was reported this week.",
    });
    expect(runCountryReportQc(ds, map("Ilaga, Puncak"))).toEqual([]);
  });

  // ---- Check A (invariant): older row must carry an incident date -----------
  it("flags an out-of-window top development that has no explicit incident date", () => {
    const older = item({
      id: "2",
      title: "Shooting in Dekai",
      location: "Dekai, Yahukimo",
      occurredOutOfWindow: true,
      incidentDate: null,
    });
    const ds = dataset({
      topThree: [older],
      windowItems: [older],
      bluf: "An earlier shooting in Dekai, Yahukimo resurfaced this week.",
    });
    const w = runCountryReportQc(ds, map("Dekai, Yahukimo"));
    expect(
      w.some((s) => /has no explicit incident date/.test(s)),
    ).toBe(true);
  });

  // ---- Check A (reachable §13): older LEAD states BOTH dates in the prose ---
  it("does NOT flag an out-of-window lead whose narrative states both dates", () => {
    const older = item({
      id: "3",
      title: "Shooting in Dekai",
      location: "Dekai, Yahukimo",
      occurredOutOfWindow: true,
      incidentDate: new Date("2026-07-01T08:00:00.000Z"),
      reportedDate: new Date("2026-07-15T08:00:00.000Z"),
    });
    const ds = dataset({
      topThree: [older],
      windowItems: [older],
      bluf: "This period's lead item was fresh reporting on an earlier development in Dekai, Yahukimo: shooting in Dekai (occurred 1 Jul 2026, reported 15 Jul 2026).",
    });
    expect(runCountryReportQc(ds, map("Dekai, Yahukimo"))).toEqual([]);
  });

  it("flags an out-of-window lead when the narrative omits its dates", () => {
    const older = item({
      id: "3b",
      title: "Shooting in Dekai",
      location: "Dekai, Yahukimo",
      occurredOutOfWindow: true,
      incidentDate: new Date("2026-07-01T08:00:00.000Z"),
      reportedDate: new Date("2026-07-15T08:00:00.000Z"),
    });
    const ds = dataset({
      topThree: [older],
      windowItems: [older],
      bluf: "An earlier shooting in Dekai, Yahukimo resurfaced this week.",
    });
    const w = runCountryReportQc(ds, map("Dekai, Yahukimo"));
    expect(
      w.some((s) => /does not state both its occurrence date/.test(s)),
    ).toBe(true);
  });

  // ---- Check B: top-dev location must be present in the map input -----------
  it("flags a top development whose location is absent from the map's incident set", () => {
    const dev = item({ id: "4", title: "Clash in Wamena", location: "Wamena" });
    const ds = dataset({
      topThree: [dev],
      windowItems: [dev],
      bluf: "A clash in Wamena was reported.",
    });
    const w = runCountryReportQc(ds, map("Jayapura"));
    expect(w.some((s) => /not represented in the map/.test(s))).toBe(true);
  });

  // ---- Check C: top-dev must be referenced in the narrative -----------------
  it("flags a top development that is not referenced anywhere in the narrative", () => {
    const dev = item({ id: "5", title: "Robbery in Nabire", location: "Nabire" });
    const ds = dataset({
      topThree: [dev],
      windowItems: [dev],
      bluf: "Security across the province remained broadly stable.",
    });
    const w = runCountryReportQc(ds, map("Nabire"));
    expect(
      w.some((s) => /not referenced anywhere in the narrative/.test(s)),
    ).toBe(true);
  });

  it("counts a place named only inside a themed key-development paragraph as referenced", () => {
    const dev = item({ id: "6", title: "Robbery in Nabire", location: "Nabire" });
    const ds = dataset({
      topThree: [dev],
      windowItems: [dev],
      bluf: "Security across the province remained broadly stable.",
      keyDevelopments: [
        {
          heading: "Violent crime",
          items: [],
          businessImpact: "An armed robbery in Nabire disrupted local trade.",
        },
      ] as unknown as Ds["keyDevelopments"],
    });
    const w = runCountryReportQc(ds, map("Nabire"));
    expect(
      w.some((s) => /not referenced anywhere in the narrative/.test(s)),
    ).toBe(false);
  });

  it("skips checks for a top development with no distinctive location", () => {
    const dev = item({
      id: "7",
      title: "Province-wide security alert",
      province: null,
      location: null,
    });
    const ds = dataset({ topThree: [dev], windowItems: [dev] });
    expect(runCountryReportQc(ds, [])).toEqual([]);
  });

  it("ignores generic geographic filler words when anchoring (no false map/narrative flags)", () => {
    // Only 'papua'/'highlands'/'district' tokens — all stopwords — so there is
    // no distinctive anchor to verify, and the row must not be flagged.
    const dev = item({
      id: "8",
      title: "Unrest reported",
      location: "Highlands district, Papua",
    });
    const ds = dataset({ topThree: [dev], windowItems: [dev], bluf: "" });
    expect(runCountryReportQc(ds, [])).toEqual([]);
  });
});
