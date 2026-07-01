import {
  buildWestPapuaReportDataset,
  type PngSourceIncident,
} from "../../artifacts/workbench/src/lib/pngReportDataset";
import { isIndonesianPapuaTheatreContext } from "../../artifacts/workbench/src/lib/countryMatch";

// The `apac_local` direct-outlet RSS topic (Jubi, PNG Post-Courier, RNZ Pacific,
// BenarNews, …) is a broad local-coverage feed. Country briefs read incidents by
// COUNTRY across ALL topics (no topic filter) — CountryReport fetches
// includeIrrelevant rows and filters by country — so an `apac_local` row tagged
// country="West Papua" flows into the West Papua brief automatically, exactly as
// an `indonesia_local` row flows into the Indonesia/Jakarta briefs. These tests
// PIN that behaviour end-to-end through the structured builder so a future
// refactor cannot silently drop the new local coverage or start double-counting
// its syndication. Owner-gated UI cannot be screenshot-verified (Replit Auth),
// so this render-level assertion is the regression proof.

const DAY = 86_400_000;
function isoDaysAgo(n: number): string {
  return new Date(Date.now() - n * DAY).toISOString();
}

// A West-Papua-tagged security incident from the direct-outlet Jubi feed
// (apac_local). Bare headline — a direct RSS item carries no "- Publisher" tail.
const jubiDirect: PngSourceIncident = {
  id: "apac-1",
  title: "Two police officers killed in TPNPB attack near Intan Jaya post",
  summary: "Armed group ambushed a police post in the Papuan highlands.",
  severity: "high",
  occurredAt: isoDaysAgo(3),
  country: "West Papua",
  location: "Intan Jaya",
  source: "Jubi",
};

// The SAME story re-run through Google News (a flashpoint-topic row): identical
// headline with a trailing "- Jubi" masthead the syndicator appended.
const jubiSyndicated: PngSourceIncident = {
  id: "flash-1",
  title: "Two police officers killed in TPNPB attack near Intan Jaya post - Jubi",
  summary: "Armed group ambushed a police post in the Papuan highlands.",
  severity: "high",
  occurredAt: isoDaysAgo(3),
  country: "West Papua",
  location: "Intan Jaya",
  source: "Google News",
};

// An unrelated existing-source (flashpoint) West Papua incident.
const flashpointOther: PngSourceIncident = {
  id: "flash-2",
  title: "Protesters block road in Jayapura over land dispute",
  summary: "Demonstrators gathered outside the provincial office.",
  severity: "moderate",
  occurredAt: isoDaysAgo(5),
  country: "West Papua",
  location: "Jayapura",
  source: "Antara News",
};

function build(windowIncidents: PngSourceIncident[]) {
  return buildWestPapuaReportDataset({
    windowIncidents,
    previousWindowIncidents: [],
    thirtyDay: windowIncidents,
    ninetyDay: windowIncidents,
    baselineWatchlist: [],
    periodLabel: "test window",
  });
}

describe("apac_local feeds the West Papua brief alongside existing sources", () => {
  it("surfaces a direct-outlet (Jubi) apac_local incident in the brief", () => {
    const ds = build([flashpointOther, jubiDirect]);
    const titles = ds.windowItems.map((it) => it.title);
    // Both the existing flashpoint item and the new apac_local item appear.
    expect(titles.some((t) => /TPNPB attack near Intan Jaya/i.test(t))).toBe(true);
    expect(titles.some((t) => /Protesters block road in Jayapura/i.test(t))).toBe(true);
    // The Jubi direct outlet is counted as a distinct reporting source, so the
    // added local coverage is reflected (Reporting Confidence reads sources off
    // the deduped window items).
    const sources = new Set(ds.windowItems.map((it) => it.source));
    expect(sources.has("Jubi")).toBe(true);
    expect(sources.has("Antara News")).toBe(true);
  });

  it("does not double-count a direct-outlet item and its syndicated re-run", () => {
    const ds = build([jubiDirect, jubiSyndicated, flashpointOther]);
    const intanJaya = ds.windowItems.filter((it) =>
      /TPNPB attack near Intan Jaya/i.test(it.title),
    );
    // The Jubi direct row and its "- Jubi" Google-News syndication collapse to
    // one deduped item, so the brief never counts the same event twice.
    expect(intanJaya).toHaveLength(1);
    // The unrelated incident is untouched by the dedup.
    expect(ds.windowItems.some((it) => /Jayapura/i.test(it.title))).toBe(true);
  });
});

describe("West Papua apac_local items never leak into the Indonesia brief", () => {
  it("flags a Papua-theatre headline so the Indonesia national brief drops it", () => {
    expect(isIndonesianPapuaTheatreContext(jubiDirect.title)).toBe(true);
    expect(
      isIndonesianPapuaTheatreContext("Papuan separatists clash with TNI in the highlands"),
    ).toBe(true);
  });

  it("exempts a genuine Papua New Guinea headline (stays in the PNG brief)", () => {
    expect(
      isIndonesianPapuaTheatreContext("Tribal clash in Enga Province, Papua New Guinea"),
    ).toBe(false);
  });

  it("never fires on an ordinary national-Indonesia story", () => {
    expect(
      isIndonesianPapuaTheatreContext("Jakarta police disperse protest over fuel prices"),
    ).toBe(false);
  });
});
