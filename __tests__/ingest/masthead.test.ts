import { stripSourceMasthead } from "../../lib/ingest/src/newsTopic";

describe("stripSourceMasthead", () => {
  it("removes the trailing publisher masthead so its country does not leak", () => {
    const hay =
      "afghanistan claims strikes on militant hideouts inside pakistan the times of india";
    const out = stripSourceMasthead(hay, "The Times of India");
    expect(out).not.toContain("times of india");
    expect(out).toContain("pakistan");
    // The masthead's "india" token is gone; the event country (pakistan) remains.
    expect(out).not.toMatch(/\bindia\b/);
  });

  it("is a no-op when the source name is empty", () => {
    const hay = "protest in delhi";
    expect(stripSourceMasthead(hay, "")).toBe(hay);
  });

  it("leaves a genuine in-body country mention untouched", () => {
    const hay =
      "india charges pakistan-based militant groups in kashmir killings the times of india";
    const out = stripSourceMasthead(hay, "The Times of India");
    // The masthead occurrence is stripped, but the body still names india.
    expect(out).toContain("india charges");
  });
});
