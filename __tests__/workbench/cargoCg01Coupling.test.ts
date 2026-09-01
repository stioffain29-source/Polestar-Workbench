import { explainRelevance } from "@workspace/relevance";
import { classifyScope } from "../../artifacts/workbench/src/lib/cargoAnalysis";

// CG-01: cargo slop must be dropped at BOTH ingest relevance and display scope.
// Genuine Bahasa / transit-hijack incidents must survive BOTH gates.

const cargoRelevance = (title: string) =>
  explainRelevance("cargo_watch", { topic: "cargo_watch", title });

describe("CG-01 cargo slop coupling — relevance and scope agree on drops", () => {
  const SLOP = [
    "Cargo theft costs trucking industry $18M a day",
    "Safer Transport Act advances in House committee",
    "Cargo Theft Costs Trucking $18M Daily",
    "SAFER Transport Act takes aim at cargo theft",
  ];

  it.each(SLOP)("drops slop at relevance and scope: %s", (title) => {
    expect(cargoRelevance(title).relevant).toBe(false);
    expect(classifyScope({ title, country: "United States" }, "Out of scope")).toBe(
      "excluded_non_cargo",
    );
  });
});

describe("CG-01 cargo slop coupling — relevance and scope agree on keeps", () => {
  const KEEP = [
    "Truck hijack on Dhaka-Chattogram highway near Cumilla",
    "Pencurian Gudang Sembako di Selomerto Wonosobo Terungkap",
    "Polrestabes Medan Didesak Tangkap Perampok Truk Milik Pengusaha Eksped",
    "Five suspects of container truck robbery on Pemalang Ring Road arrested, loss of Rp1.8 billion",
  ];

  it.each(KEEP)("keeps genuine cargo at relevance and scope: %s", (title) => {
    expect(cargoRelevance(title).relevant).toBe(true);
    expect(classifyScope({ title, country: "Indonesia" }, "APAC")).toBe("in_scope");
  });
});
