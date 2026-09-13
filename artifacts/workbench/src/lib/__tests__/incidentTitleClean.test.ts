import {
  cleanClientFacingProse,
  cleanIncidentTitle,
  displayIncidentTitle,
} from "../incidentTitle";

describe("shared client-facing incident title cleanup", () => {
  it("removes URLs, tracking fragments and link-in-comments CTAs without changing facts", () => {
    expect(
      displayIncidentTitle(
        "Workers march in Delhi https://example.test/story?...",
        null,
      ),
    ).toBe("Workers march in Delhi");
    expect(
      cleanIncidentTitle(
        "Workers march in Delhi | Read more in the comments 👇 #Delhi",
      ),
    ).toBe("Workers march in Delhi");
  });

  it("removes social labels, hashtags and publisher navigation residue", () => {
    expect(
      cleanIncidentTitle(
        "BREAKING: Students rally over fees #Campus | Latest News | Example News",
      ),
    ).toBe("Students rally over fees");
    expect(
      cleanIncidentTitle(
        "Home > News > Workers block roads over wages - ExampleWire.com",
      ),
    ).toBe("Workers block roads over wages");
  });

  it("drops duplicated source prefixes but preserves the headline and attribution fields", () => {
    expect(
      cleanIncidentTitle("Example Wire: Example Wire: Protesters gather in Delhi"),
    ).toBe("Protesters gather in Delhi");
  });

  it("does not rewrite factual uses of link, comment or watch", () => {
    expect(
      cleanIncidentTitle("Watch groups link arms as protesters gather"),
    ).toBe("Watch groups link arms as protesters gather");
    expect(
      cleanIncidentTitle("Officials comment on the protest in Delhi"),
    ).toBe("Officials comment on the protest in Delhi");
  });

  it("removes explicit source packaging from narrative text without stripping facts", () => {
    expect(
      cleanClientFacingProse(
        'Source headline: "Depot outage interrupts diesel deliveries" — Reuters',
      ),
    ).toBe("Depot outage interrupts diesel deliveries");
  });
});