import {
  buildCargoGroupedDataset,
  cargoClusterKey,
  type CargoClusterInput,
} from "../../artifacts/workbench/src/lib/cargoGroupedDataset";

function inc(p: Partial<CargoClusterInput>): CargoClusterInput {
  return { title: "", summary: "", occurredAt: "2026-06-20", ...p };
}

describe("cargo grouped dataset — conservative clustering", () => {
  it("merges syndicated reports of the same event (same category/country/port, overlapping tokens, close dates)", () => {
    const a = inc({
      id: 1,
      title: "Armed robbers board ship at Port Klang anchorage",
      occurredAt: "2026-06-20",
      source: "Reuters",
      sourceUrl: "https://r.example/1",
    });
    const b = inc({
      id: 2,
      title: "Robbers board vessel at Port Klang anchorage overnight",
      occurredAt: "2026-06-21",
      source: "Local Daily",
      sourceUrl: "https://l.example/2",
    });
    const { clusters } = buildCargoGroupedDataset([a, b], { referenceDate: "2026-06-24" });
    expect(clusters).toHaveLength(1);
    expect(clusters[0].clusterSize).toBe(2);
    expect(clusters[0].sourceLinks).toHaveLength(2);
  });

  it("does NOT merge different ports", () => {
    const a = inc({ id: 1, title: "Robbers board ship at Port Klang anchorage", occurredAt: "2026-06-20" });
    const b = inc({ id: 2, title: "Robbers board ship at Colombo anchorage", occurredAt: "2026-06-20" });
    const { clusters } = buildCargoGroupedDataset([a, b]);
    expect(clusters).toHaveLength(2);
  });

  it("does NOT merge across a wide date gap (same place, same wording)", () => {
    const a = inc({ id: 1, title: "Theft from container at Port Klang terminal", occurredAt: "2026-06-01" });
    const b = inc({ id: 2, title: "Theft from container at Port Klang terminal", occurredAt: "2026-06-20" });
    const { clusters } = buildCargoGroupedDataset([a, b]);
    expect(clusters).toHaveLength(2);
  });

  it("does NOT merge different categories even at the same port", () => {
    const a = inc({ id: 1, title: "Police seize narcotics in container at Port Klang", occurredAt: "2026-06-20" });
    const b = inc({ id: 2, title: "Armed robbers board ship at Port Klang anchorage", occurredAt: "2026-06-20" });
    const { clusters } = buildCargoGroupedDataset([a, b]);
    expect(clusters).toHaveLength(2);
  });

  it("cluster size raises the primary's confidence", () => {
    const mk = (id: number) =>
      inc({ id, title: "Robbers board ship at Port Klang anchorage", occurredAt: "2026-06-20", source: "Blog" });
    const single = buildCargoGroupedDataset([mk(1)]).clusters[0];
    const triple = buildCargoGroupedDataset([mk(1), mk(2), mk(3)]).clusters[0];
    expect(single.confidence ?? single.enrichment.confidence).toBe("Low");
    expect(triple.enrichment.confidence).toBe("High");
  });
});

describe("cargo grouped dataset — sectioning + order", () => {
  it("emits the five sections in a stable order", () => {
    const { sections } = buildCargoGroupedDataset([
      inc({ id: 1, title: "Theft from container at Port Klang terminal", severity: "moderate" }),
    ]);
    expect(sections.map((s) => s.key)).toEqual([
      "severe_high",
      "cargo_security_land",
      "port_related",
      "watch_items",
      "new_updated",
    ]);
  });

  it("routes a fatal/high cluster to severe_high, a land theft to cargo_security_land, a port theft to port_related", () => {
    const severe = inc({ id: 1, title: "Several killed as gang ambushes cargo convoy", severity: "extreme", occurredAt: "2026-06-20" });
    const land = inc({ id: 2, title: "Warehouse theft ring hits Jakarta depot", severity: "moderate", occurredAt: "2026-06-20" });
    const port = inc({ id: 3, title: "Theft from container at Port Klang terminal", severity: "low", occurredAt: "2026-06-20" });
    const { sections } = buildCargoGroupedDataset([severe, land, port]);
    const byKey = Object.fromEntries(sections.map((s) => [s.key, s.clusters]));
    expect(byKey.severe_high.some((c) => c.title.includes("convoy"))).toBe(true);
    expect(byKey.cargo_security_land.some((c) => c.title.includes("Warehouse"))).toBe(true);
    expect(byKey.port_related.some((c) => c.title.includes("container"))).toBe(true);
  });

  it("partitions are mutually exclusive (a high port cluster is in severe_high, not port_related)", () => {
    const hiPort = inc({ id: 1, title: "Several killed in armed raid on Port Klang terminal", severity: "extreme", occurredAt: "2026-06-20" });
    const { sections } = buildCargoGroupedDataset([hiPort]);
    const byKey = Object.fromEntries(sections.map((s) => [s.key, s.clusters]));
    expect(byKey.severe_high).toHaveLength(1);
    expect(byKey.port_related).toHaveLength(0);
  });

  it("new_updated re-lists recent clusters (cross-cutting view)", () => {
    const fresh = inc({ id: 1, title: "Theft from container at Port Klang terminal", severity: "low", occurredAt: "2026-06-23" });
    const { sections } = buildCargoGroupedDataset([fresh], { referenceDate: "2026-06-24" });
    const newUpdated = sections.find((s) => s.key === "new_updated")!;
    expect(newUpdated.clusters).toHaveLength(1);
  });

  it("exposes de-duplicated watch items in severity order", () => {
    const a = inc({ id: 1, title: "Several killed in armed raid on Port Klang terminal", severity: "extreme", occurredAt: "2026-06-20" });
    const b = inc({ id: 2, title: "Warehouse theft ring hits Jakarta depot", severity: "low", occurredAt: "2026-06-20" });
    const { watchItems } = buildCargoGroupedDataset([a, b]);
    expect(watchItems.length).toBeGreaterThanOrEqual(1);
    expect(new Set(watchItems).size).toBe(watchItems.length);
  });
});

describe("cargo grouped dataset — cluster key", () => {
  it("is identical for same group/category/country/port and differs across ports", () => {
    const k1 = cargoClusterKey(inc({ title: "Theft from container at Port Klang terminal" }));
    const k2 = cargoClusterKey(inc({ title: "Theft from container at Port Klang terminal" }));
    const k3 = cargoClusterKey(inc({ title: "Theft from container at Colombo terminal" }));
    expect(k1).toBe(k2);
    expect(k1).not.toBe(k3);
  });
});
