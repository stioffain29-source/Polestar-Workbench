import {
  cleanDisplayTitle,
  dedupeByTitle,
} from "../flashpointReportDataset";

describe("Flashpoint title presentation and dedupe", () => {
  it("uses the cleaned display title for source-shaped generic rows", () => {
    const source = "Example Wire";
    const rows = [
      {
        title: `${source}: Protesters rally in Delhi https://example.test/a?...`,
        displayTitle: `${source}: ${source}: Protesters rally in Delhi | Link in comments #Delhi`,
        date: new Date("2026-08-03T10:00:00Z"),
        severity: "moderate",
        country: "India",
      },
      {
        title: "Protesters rally in Delhi",
        displayTitle: "Protesters rally in Delhi",
        date: new Date("2026-08-03T10:00:00Z"),
        severity: "moderate",
        country: "India",
      },
    ];

    expect(cleanDisplayTitle(rows[0].displayTitle)).toBe("Protesters rally in Delhi");
    expect(dedupeByTitle(rows)).toHaveLength(1);
    // Source attribution remains on the row; only the client title is cleaned.
    expect(rows[0].title).toContain(source);
  });
});