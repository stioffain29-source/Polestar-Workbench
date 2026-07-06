import { explainRelevance, type RelevanceInput } from "@workspace/relevance";

// Locks in the `data_centres` relevance gate. Unlike the geographic local
// feeds, this topic has a REQUIRED vocabulary bound to a data-centre object:
// only (1) operational disruption at a data-centre / hyperscale / colocation
// site, or (2) planning / build-out risk against one, is relevant. Generic
// market-size / M&A / earnings / hiring commentary — the noise the feed's own
// deny-list also drops — must read as NOT relevant so the monitor and report
// never fabricate a "data-centre incident" out of a business-news headline.

function verdict(title: string, summary = "") {
  const input: RelevanceInput = { topic: "data_centres", title, summary };
  return explainRelevance("data_centres", input);
}

describe("data_centres relevance gate", () => {
  it("keeps an operational outage at a data centre", () => {
    expect(verdict("Power failure knocks major data centre offline in Singapore").relevant).toBe(true);
  });

  it("keeps a cooling-failure disruption", () => {
    expect(verdict("Cooling failure forces hyperscale data centre shutdown").relevant).toBe(true);
  });

  it("keeps a fire at a colocation site", () => {
    expect(verdict("Fire at colocation data centre disrupts cloud services").relevant).toBe(true);
  });

  it("keeps a planning refusal against a data-centre build", () => {
    expect(verdict("Council refuses planning for new data centre over water use").relevant).toBe(true);
  });

  it("keeps a moratorium on data-centre build-out", () => {
    expect(verdict("Government imposes moratorium on data centre construction amid grid strain").relevant).toBe(true);
  });

  it("keeps community opposition to a data centre", () => {
    expect(verdict("Community opposition mounts against proposed hyperscale data centre").relevant).toBe(true);
  });

  it("drops a data-centre market-size report", () => {
    expect(verdict("Global data centre market size to reach $500bn by 2030, report says").relevant).toBe(false);
  });

  it("drops a data-centre M&A / earnings headline", () => {
    expect(verdict("Cloud provider reports record data centre revenue in quarterly earnings").relevant).toBe(false);
  });

  it("drops a generic outage with no data-centre object", () => {
    expect(verdict("Power failure hits thousands of homes in the capital").relevant).toBe(false);
  });
});
