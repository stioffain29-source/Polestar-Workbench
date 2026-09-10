import { cargoTestHooks } from "../../lib/ingest/src/cargoWatch";
import { shippingTestHooks } from "../../lib/ingest/src/shipping";

// Locks CARGO_WATCH and SHIPPING country attribution against silent gazetteer
// or ordering drift — the parallel of energyForeignCountry.test.ts and
// fuelFertiliserForeignCountry.test.ts, but for the two region-scoped topics.
// Both resolve country from headline text via their OWN classify/detectCountry
// path (NOT the world-scope GLOBAL_TOPIC_ALIASES one). Unlike the commodity
// monitors these are REGION-SCOPED: only in-scope (APAC + Middle East) names
// are aliases, so a foreign place named only in passing must never relocate an
// in-region story onto it, and the theatre-first alias ordering must hold. A
// silent change could mis-stamp a foreign story onto an in-region theatre or
// pull an in-region story off onto a foreign place named in passing.

const { classifyFeedItem } = cargoTestHooks;

describe("cargo foreign-country attribution", () => {
  it("keeps an in-region cargo story that names an out-of-scope place in passing", () => {
    // Chennai (India) is the incident; Nepal is only the freight's destination.
    // Nepal is not an in-scope alias, so attribution must stay India.
    const item = classifyFeedItem(
      "Truck hijacking foiled in Chennai, India as stolen freight was bound for Nepal",
      "",
    );
    expect(item.result.kept).toBe(true);
    expect(item.result.country).toBe("India");
  });

  it("does NOT relocate an in-region cargo story onto a major foreign country named in passing", () => {
    // Jakarta (Indonesia) is the incident; Russia is only the goods' origin and
    // is not an in-scope alias, so it must never win over Indonesia.
    const item = classifyFeedItem(
      "Warehouse theft ring busted in Jakarta after goods traced to Russia",
      "",
    );
    expect(item.result.kept).toBe(true);
    expect(item.result.country).toBe("Indonesia");
  });

  it("drops a diaspora cargo story framed as occurring in a foreign country (not stamped onto the in-region name)", () => {
    // Manila matches the Philippines alias, but the incident is framed as
    // occurring in California — the foreign-context guard drops it rather than
    // mis-attribute a US arrest to the Philippines.
    const item = classifyFeedItem(
      "Cargo theft suspects from Manila arrested in California",
      "",
    );
    expect(item.result.kept).toBe(false);
    expect(item.result.country).toBeNull();
  });

  it("sanity: attributes a genuine in-country cargo crime to its theatre", () => {
    const item = classifyFeedItem(
      "Container theft ring busted at Karachi port, Pakistan - Dawn",
      "",
    );
    expect(item.result.kept).toBe(true);
    expect(item.result.country).toBe("Pakistan");
  });
});

const { classify: classifyShipping, classifyFeedItem: classifyShippingFeedItem } = shippingTestHooks;

describe("shipping foreign-country attribution", () => {
  it("does not infer physical jurisdiction from a named actor before semantic validation", () => {
    const c = classifyShipping(
      "Houthi drone attack on tanker in Red Sea off Saudi Arabia coast",
      "",
    );
    expect(c.kept).toBe(true);
    expect(c.country).toBeNull();
  });

  it("does NOT relocate an in-region shipping story onto a foreign port named in passing", () => {
    // Neither a route name nor the vessel's origin establishes jurisdiction.
    const c = classifyShipping(
      "Tanker seized in Strait of Hormuz after departing Rotterdam",
      "",
    );
    expect(c.kept).toBe(true);
    expect(c.country).toBeNull();
  });

  it("keeps an in-region boarding story even when a foreign flag state is named", () => {
    // Flag state and route mentions cannot replace validated physical geography.
    const c = classifyShipping(
      "Panama-flagged bulk carrier boarded by robbers in Singapore Strait",
      "",
    );
    expect(c.kept).toBe(true);
    expect(c.country).toBeNull();
  });

  it("does not fall back to a feed theatre when physical country is unknown", () => {
    const c = classifyShipping(
      "Tanker attacked by drone at sea after leaving Rotterdam",
      "",
      "Iran",
    );
    expect(c.kept).toBe(true);
    expect(c.country).toBeNull();
  });

  it("strips the publisher without inventing a physical country", () => {
    const item = classifyShippingFeedItem(
      "Armed robbers board bulk carrier in Singapore Strait - South China Morning Post",
      "",
    );
    expect(item.cleanTitle).toBe("Armed robbers board bulk carrier in Singapore Strait");
    expect(item.sourceName).toBe("South China Morning Post");
    expect(item.result.kept).toBe(true);
    expect(item.result.country).toBeNull();
  });
});
