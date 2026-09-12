import {
  currentReportDate,
  isCurrentReport,
  sortReportsByLifecycle,
  splitReportsByLifecycle,
} from "@/lib/reportLifecycle";

const topics = [
  "energy",
  "conflict",
  "shipping",
  "cargo_watch",
  "fertiliser",
  "fuel",
] as const;

describe("shared report lifecycle", () => {
  it.each(topics)("classifies a fresh %s draft as current", (topic) => {
    const report = {
      id: topics.indexOf(topic) + 1,
      topic,
      status: "draft",
      // A new report may intentionally start with a past product issue date.
      issueDate: "2026-06-17",
      createdAt: "2026-09-12T10:00:00.000Z",
    };
    expect(isCurrentReport(report, new Date("2026-09-12T12:00:00.000Z"))).toBe(true);
  });

  it("keeps stored dates and separates historical rows", () => {
    const rows = [
      { id: 2, status: "draft", issueDate: "2026-06-17", createdAt: "2026-06-17T10:00:00Z" },
      { id: 3, status: "draft", issueDate: "2026-09-12", createdAt: "2026-09-12T11:00:00Z" },
    ];
    const split = splitReportsByLifecycle(rows, new Date("2026-09-12T12:00:00Z"));
    expect(split.current.map((row) => row.id)).toEqual([3]);
    expect(split.older.map((row) => row.id)).toEqual([2]);
    expect(rows[0].issueDate).toBe("2026-06-17");
  });

  it("sorts by updatedAt activity, then issueDate, then id", () => {
    const rows = [
      { id: 1, status: "draft", issueDate: "2026-09-12", createdAt: "2026-09-12T10:00:00Z", updatedAt: "2026-09-12T10:00:00Z" },
      { id: 3, status: "draft", issueDate: "2026-09-11", createdAt: "2026-09-12T10:00:00Z", updatedAt: "2026-09-12T10:00:00Z" },
      { id: 2, status: "draft", issueDate: "2026-09-12", createdAt: "2026-09-12T10:00:00Z", updatedAt: "2026-09-12T11:00:00Z" },
      { id: 4, status: "draft", issueDate: "2026-09-10", createdAt: "2026-09-13T10:00:00Z" },
    ];
    expect(sortReportsByLifecycle(rows).map((row) => row.id)).toEqual([4, 2, 1, 3]);
  });

  it("keeps published rows in a completed group", () => {
    const split = splitReportsByLifecycle([
      { id: 1, status: "published", issueDate: "2026-06-17", createdAt: "2026-06-17T10:00:00Z" },
      { id: 2, status: "draft", issueDate: "2026-06-17", createdAt: "2026-06-17T10:00:00Z" },
    ], new Date("2026-09-12T12:00:00Z"));
    expect(split.completed.map((row) => row.id)).toEqual([1]);
    expect(split.older.map((row) => row.id)).toEqual([2]);
  });

  it("uses the local-calendar current product date rule for new drafts", () => {
    const local = new Date(2026, 8, 12, 23, 59);
    expect(currentReportDate(local)).toBe("2026-09-12");
  });
});
