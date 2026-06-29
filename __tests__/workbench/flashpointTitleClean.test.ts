import {
  cleanDisplayTitle,
  dedupeByTitle,
} from "../../artifacts/workbench/src/lib/flashpointReportDataset";

describe("cleanDisplayTitle", () => {
  it("strips a leading 'Watch:' video call-to-action and the publisher masthead", () => {
    expect(
      cleanDisplayTitle("Watch: Pride protest held in Manila despite downpour - The Manila Times"),
    ).toBe("Pride protest held in Manila despite downpour");
  });

  it("strips a trailing 'VIDEO BY <credit>' attribution and the publisher masthead", () => {
    expect(
      cleanDisplayTitle("Pride protest held in Manila despite downpour VIDEO BY ALLEN LIMOS - LinkedIn"),
    ).toBe("Pride protest held in Manila despite downpour");
  });

  it("strips trailing '(VIDEO)' / ' - WATCH' tags", () => {
    expect(cleanDisplayTitle("Rally turns tense in Quezon City (VIDEO)")).toBe(
      "Rally turns tense in Quezon City",
    );
    expect(cleanDisplayTitle("Workers march downtown - WATCH")).toBe("Workers march downtown");
  });

  it("does NOT touch a real headline that merely contains the word watch/video", () => {
    expect(cleanDisplayTitle("Watch out for protests this weekend")).toBe(
      "Watch out for protests this weekend",
    );
    expect(cleanDisplayTitle("Protest video goes viral after clashes")).toBe(
      "Protest video goes viral after clashes",
    );
  });

  it("does NOT strip a bare trailing 'watch'/'video' with no separator (no false positives)", () => {
    expect(cleanDisplayTitle("Residents keep a tense overnight watch")).toBe(
      "Residents keep a tense overnight watch",
    );
    expect(cleanDisplayTitle("Crowd captures the clash on video")).toBe(
      "Crowd captures the clash on video",
    );
  });

  it("does NOT strip a natural lowercase 'video by ...' prose clause", () => {
    expect(cleanDisplayTitle("Protest video by citizen journalist goes viral")).toBe(
      "Protest video by citizen journalist goes viral",
    );
    expect(cleanDisplayTitle("Video by far the biggest protest this year")).toBe(
      "Video by far the biggest protest this year",
    );
  });

  it("DOES strip a title-case 'Video by <Name>' trailing credit", () => {
    expect(cleanDisplayTitle("Pride rally floods Manila streets Video by Allen Limos")).toBe(
      "Pride rally floods Manila streets",
    );
  });
});

describe("dedupeByTitle — video/watch syndication", () => {
  it("collapses a 'Watch:' copy and a 'VIDEO BY' copy of the same event into one row", () => {
    const rows = [
      {
        title:
          "Pride protest held in Manila despite downpour Despite the heavy rain, LGBTQ+ protesters hold their Pride protest at Liwasang Bonifacio in Manila on June 26, 2026 VIDEO BY ALLEN LIMOS - LinkedIn",
        date: new Date("2026-06-27T00:00:00Z"),
        severity: "low",
      },
      {
        title: "Watch: Pride protest held in Manila despite downpour - The Manila Times",
        date: new Date("2026-06-26T00:00:00Z"),
        severity: "low",
      },
    ];
    expect(dedupeByTitle(rows)).toHaveLength(1);
  });

  it("keeps two genuinely different protests apart", () => {
    const rows = [
      {
        title: "Pride protest held in Manila despite downpour",
        date: new Date("2026-06-26T00:00:00Z"),
        severity: "low",
      },
      {
        title: "Farmers blockade highway in Quezon City over fuel prices",
        date: new Date("2026-06-26T00:00:00Z"),
        severity: "moderate",
      },
    ];
    expect(dedupeByTitle(rows)).toHaveLength(2);
  });
});
