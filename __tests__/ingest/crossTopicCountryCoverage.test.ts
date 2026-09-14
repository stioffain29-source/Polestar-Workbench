import {
  CONFLICT_CONFIG,
  ENERGY_CONFIG,
  FERTILISER_CONFIG,
  FUEL_CONFIG,
} from "../../lib/ingest/src/topicConfigs";

const TARGETS = ["Australia", "China", "Vietnam", "Cambodia", "Hong Kong"];

describe("cross-topic country feed coverage", () => {
  it.each([
    ["energy", ENERGY_CONFIG],
    ["fertiliser", FERTILISER_CONFIG],
    ["fuel", FUEL_CONFIG],
    ["conflict", CONFLICT_CONFIG],
  ] as const)("%s keeps a dedicated feed for every observed coverage gap", (_topic, config) => {
    const defaults = new Set(config.feeds.map((feed) => feed.defaultCountry));
    for (const country of TARGETS) expect(defaults).toContain(country);
  });

  it.each([
    ["energy", ENERGY_CONFIG],
    ["fertiliser", FERTILISER_CONFIG],
    ["fuel", FUEL_CONFIG],
    ["conflict", CONFLICT_CONFIG],
  ] as const)("%s can attribute every target market", (_topic, config) => {
    const canonicals = new Set(config.countryAliases.map((entry) => entry.canonical));
    for (const country of TARGETS) expect(canonicals).toContain(country);
  });
});