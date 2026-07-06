import {
  selectTopStoryClusters,
  type PngReportItem,
} from "@/lib/pngReportDataset";

const DAY = 86_400_000;
const base = Date.parse("2026-06-20T08:00:00.000Z");

// Compact PngReportItem factory: only id, title and incidentDate matter for the
// Top-3 story fold; the rest carry inert defaults.
function pngItem(over: Partial<PngReportItem> & { id: string; title: string }): PngReportItem {
  return {
    summary: "",
    developmentTitle: undefined,
    province: null,
    location: null,
    category: "crime_violence" as PngReportItem["category"],
    displayCategory: "Crime & violence",
    businessImpact: "",
    severity: "moderate",
    severityLabel: "Moderate",
    severityRank: 3,
    reportedDate: new Date(base),
    incidentDate: new Date(base),
    occurredEarlier: false,
    source: "Test Wire",
    url: null,
    confidence: "reported",
    ...over,
  };
}

// A syndicated re-run of a Top-3 story that lands within the 3-day window is
// FOLDED out of the location buckets so it never reappears lower down.
describe("selectTopStoryClusters — story fold window", () => {
  const title = "Tribal clash in Enga province leaves several dead";
  it("folds a near-identical re-run inside the 3-day window", () => {
    const picked = [pngItem({ id: "a", title, incidentDate: new Date(base) })];
    const duplicate = [
      pngItem({ id: "b", title, incidentDate: new Date(base + 2 * DAY) }),
    ];
    const { foldMemberIds } = selectTopStoryClusters([picked, duplicate], {
      jakarta: false,
    });
    expect(foldMemberIds.has("b")).toBe(true);
  });

  // Formulaic headlines let two GENUINELY DISTINCT clashes weeks apart hit a high
  // jaccard. Beyond the window the later event must NOT be folded — dropping it
  // would silently lose a real incident (no-fabrication: omission is a defect).
  it("does NOT fold a near-identical event beyond the 3-day window", () => {
    const picked = [pngItem({ id: "a", title, incidentDate: new Date(base) })];
    const distinctLater = [
      pngItem({ id: "b", title, incidentDate: new Date(base + 10 * DAY) }),
    ];
    const { foldMemberIds } = selectTopStoryClusters([picked, distinctLater], {
      jakarta: false,
    });
    expect(foldMemberIds.has("b")).toBe(false);
  });
});
