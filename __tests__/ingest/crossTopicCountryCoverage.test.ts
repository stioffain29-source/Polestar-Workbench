import {
  COUNTRY_ALIASES,
  CONFLICT_CONFIG,
  ENERGY_CONFIG,
  FERTILISER_CONFIG,
  FUEL_CONFIG,
} from "../../lib/ingest/src/topicConfigs";
import { SEARCH_FEEDS } from "../../lib/ingest/src/protestSchedule";

const TARGETS = [
  "Australia",
  "China",
  "Vietnam",
  "Cambodia",
  "Laos",
  "New Zealand",
  "Hong Kong",
];

describe("cross-topic country feed coverage", () => {
  const configs = [
    ["energy", ENERGY_CONFIG],
    ["fertiliser", FERTILISER_CONFIG],
    ["fuel", FUEL_CONFIG],
    ["conflict", CONFLICT_CONFIG],
  ] as const;

  it.each(configs)("%s keeps a dedicated feed for every observed coverage gap", (_topic, config) => {
    const defaults = new Set(config.feeds.map((feed) => feed.defaultCountry));
    for (const country of TARGETS) expect(defaults).toContain(country);
  });

  it.each(configs)("%s can attribute every target market", (_topic, config) => {
    const canonicals = new Set(config.countryAliases.map((entry) => entry.canonical));
    for (const country of TARGETS) expect(canonicals).toContain(country);
  });

  it("recognises local country and city terminology in shared attribution", () => {
    const aliasesFor = (country: string) =>
      COUNTRY_ALIASES.find((entry) => entry.canonical === country)?.aliases ?? [];
    expect(aliasesFor("Laos")).toEqual(expect.arrayContaining(["lao", "vientiane", "luang prabang", "ລາວ"]));
    expect(aliasesFor("Vietnam")).toEqual(expect.arrayContaining(["viet nam", "saigon", "da nang", "việt nam"]));
    expect(aliasesFor("Cambodia")).toEqual(expect.arrayContaining(["kampuchea", "phnom penh", "កម្ពុជា"]));
    expect(aliasesFor("China")).toEqual(expect.arrayContaining(["prc", "guangzhou", "shenzhen", "中国"]));
    expect(aliasesFor("New Zealand")).toEqual(expect.arrayContaining(["aotearoa", "nz", "dunedin"]));
  });

  it("uses broader country anchors in shared topic searches", () => {
    for (const [, config] of configs) {
      expect(config.feeds.find((feed) => feed.defaultCountry === "Laos")?.q).toContain("Vientiane");
      expect(config.feeds.find((feed) => feed.defaultCountry === "Vietnam")?.q).toContain("Da Nang");
      expect(config.feeds.find((feed) => feed.defaultCountry === "China")?.q).toContain("Shenzhen");
    }
  });

  it("collects planned protests for Cambodia, China and Laos", () => {
    const scheduledCountries = new Set(SEARCH_FEEDS.map((feed) => feed.country));
    for (const country of ["Cambodia", "China", "Laos"]) {
      expect(scheduledCountries).toContain(country);
    }
  });
});