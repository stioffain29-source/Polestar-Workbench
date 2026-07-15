// Locks the shared classification rulebook's accident / natural-hazard reroute:
// a flood, snakebite or vehicle accident that only states a death count must be
// classified as a Natural hazard, NOT as violent crime — while a deliberate
// killing (shooting, stabbing, bombing) keeps its violent classification.

import {
  extractStructuredItem,
  compileGazetteer,
} from "../../lib/ingest/src/structuredExtract";

const GAZ = compileGazetteer({});

function categoryOf(title: string, summary = ""): string {
  return extractStructuredItem(title, summary, null, GAZ).category;
}

describe("structuredExtract accident/hazard reroute", () => {
  it("reroutes a snakebite death to Natural hazard, not violent crime", () => {
    expect(categoryOf("Snakebite kills three farmers in the highlands")).toBe(
      "Natural hazard",
    );
  });

  it("reroutes a fatal flood to Natural hazard", () => {
    expect(categoryOf("Flash flood killed at least 30 in coastal villages")).toBe(
      "Natural hazard",
    );
    expect(categoryOf("Banjir bandang menewaskan puluhan warga")).toBe(
      "Natural hazard",
    );
  });

  it("reroutes a fatal road/vehicle accident to Natural hazard", () => {
    expect(categoryOf("Five killed in bus crash on the coastal road")).toBe(
      "Natural hazard",
    );
    expect(categoryOf("Truck crash leaves two dead in head-on collision")).toBe(
      "Natural hazard",
    );
    expect(categoryOf("Kecelakaan bus maut, sejumlah penumpang tewas")).toBe(
      "Natural hazard",
    );
  });

  it("reroutes drowning and lightning fatalities to Natural hazard", () => {
    expect(categoryOf("Two children drowned after being swept away by floodwaters")).toBe(
      "Natural hazard",
    );
    expect(categoryOf("Farmer struck by lightning and killed in his field")).toBe(
      "Natural hazard",
    );
  });

  it("does NOT reroute a deliberate killing that mentions a road", () => {
    expect(categoryOf("Gunman shot dead a driver on the highway")).toBe(
      "Homicide / violent crime",
    );
    expect(categoryOf("Man stabbed to death after a crash-related dispute")).toBe(
      "Homicide / violent crime",
    );
  });

  it("leaves an earthquake with no casualty word as Natural hazard", () => {
    expect(categoryOf("Strong earthquake damages buildings offshore")).toBe(
      "Natural hazard",
    );
  });

  it("keeps a plain shooting as violent crime", () => {
    expect(categoryOf("Two men gunned down in a targeted shooting")).toBe(
      "Homicide / violent crime",
    );
  });
});
