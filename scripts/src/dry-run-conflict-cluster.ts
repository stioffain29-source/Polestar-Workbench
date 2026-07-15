// Dry-run harness for conflict same-event clustering (de-risk before wiring).
//
// Loads a saved prod snapshot of conflict rows (/tmp/conflict_rows.json), runs
// the REAL LLM judge over the deterministic candidate pairs, and prints every
// proposed cluster for manual review. NO database writes.
//
//   AI_INTEGRATIONS_OPENAI_* must be set. Run:
//   pnpm --filter @workspace/scripts run dryrun:conflict-cluster
//   (optional: SNAPSHOT=/path/to/rows.json WINDOW_DAYS=14 GATE_HOURS=72)

import { readFileSync } from "node:fs";
import {
  clusterRows,
  candidatePairs,
  judgeSamePair,
  type ClusterRow,
} from "@workspace/ingest";

interface SnapshotRow {
  id: string | number;
  severity?: string;
  occurred_at: string;
  country: string;
  title: string;
  display_title?: string | null;
  event_cluster_key?: string | null;
}

function loadSnapshot(path: string): ClusterRow[] {
  const raw = JSON.parse(readFileSync(path, "utf8")) as
    | SnapshotRow[]
    | { rows: SnapshotRow[] };
  const arr = Array.isArray(raw) ? raw : raw.rows;
  return arr.map((r) => ({
    id: Number(r.id),
    country: r.country,
    occurredAt: r.occurred_at.replace(" ", "T").replace(/\+00$/, "+00:00"),
    title: r.title,
    displayTitle: r.display_title ?? null,
    severity: r.severity ?? null,
    eventClusterKey: r.event_cluster_key ?? null,
  }));
}

async function main(): Promise<void> {
  const path = process.env.SNAPSHOT || "/tmp/conflict_rows.json";
  const windowDays = Number(process.env.WINDOW_DAYS || "14");
  const gateHours = Number(process.env.GATE_HOURS || "72");
  const maxNeighbours = Number(process.env.MAX_NEIGHBOURS || "6");

  const all = loadSnapshot(path);
  const since = Date.now() - windowDays * 86400000;
  const rows = all.filter((r) => new Date(r.occurredAt).getTime() >= since);
  const byId = new Map(rows.map((r) => [r.id, r]));

  const pairs = candidatePairs(rows, gateHours, maxNeighbours);
  console.log(
    `Loaded ${all.length} snapshot rows; ${rows.length} within ${windowDays}d; ${pairs.length} candidate pairs (gate ${gateHours}h, K=${maxNeighbours}).`,
  );
  console.log("Adjudicating with LLM… (this issues one call per candidate pair)\n");

  const result = await clusterRows(rows, judgeSamePair, {
    gateHours,
    concurrency: 8,
    maxPairs: 5000,
    maxNeighbours,
  });

  console.log(
    `=== ${result.clusters.length} cluster(s) of size >= 2 (edges ${result.edges}) ===\n`,
  );
  const fmt = (id: number): string => {
    const r = byId.get(id)!;
    const d = new Date(r.occurredAt).toISOString().slice(0, 10);
    const head = (r.displayTitle?.trim() || r.title || "").slice(0, 120);
    return `  [${id}] ${d} ${(r.severity ?? "?").padEnd(8)} ${head}`;
  };
  result.clusters
    .sort((a, b) => b.length - a.length)
    .forEach((c, i) => {
      const key = result.assignments.get(c.find((id) => result.assignments.has(id))!) ?? "(existing)";
      console.log(`Cluster ${i + 1} (${c.length} rows) key=${key}`);
      c.forEach((id) => console.log(fmt(id)));
      console.log("");
    });

  const clustered = new Set(result.clusters.flat());
  console.log(
    `Summary: ${clustered.size} rows in clusters, ${rows.length - clustered.size} singletons.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
