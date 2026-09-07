/**
 * Load flashpoint + protests incidents for funnel / parity scripts.
 *
 * Priority:
 *   1. SNAPSHOT_PATH or scripts/.prod-incidents.json (when USE_SNAPSHOT=1 or no API_BASE override)
 *   2. API_BASE / http://localhost:80
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { FlashpointReportIncident } from "../src/lib/flashpointReportDataset";

const here = dirname(fileURLToPath(import.meta.url));
const defaultSnapshot = join(here, ".prod-incidents.json");

interface SnapshotRow {
  id: number;
  topic: string;
  title: string;
  summary: string | null;
  country: string | null;
  location: string | null;
  source: string | null;
  source_url?: string | null;
  sourceUrl?: string | null;
  occurred_at?: string | null;
  occurredAt?: string | null;
  severity: string | null;
  display_title?: string | null;
}

interface ApiIncident {
  id: number;
  topic: string;
  title: string;
  summary: string | null;
  country: string | null;
  location: string | null;
  source: string | null;
  sourceUrl: string | null;
  occurredAt: string | null;
  severity: string | null;
}

export type FlashpointLoadSource = "snapshot" | "api";

function toFlashpointInput(r: SnapshotRow | ApiIncident): FlashpointReportIncident {
  const sourceUrl =
    "sourceUrl" in r && r.sourceUrl != null
      ? r.sourceUrl
      : "source_url" in r
        ? (r.source_url ?? null)
        : null;
  const occurredAt =
    "occurredAt" in r && r.occurredAt != null
      ? r.occurredAt
      : "occurred_at" in r
        ? (r.occurred_at ?? "")
        : "";
  return {
    id: r.id,
    title: r.title,
    topic: r.topic,
    severity: r.severity ?? "Low",
    occurredAt: occurredAt ?? "",
    country: r.country,
    summary: r.summary,
    source: r.source,
    sourceUrl,
    location: r.location ?? r.country,
  };
}

function resolveSnapshotPath(): string | null {
  const explicit = process.env.SNAPSHOT_PATH?.trim();
  if (explicit && existsSync(explicit)) return explicit;
  if (existsSync(defaultSnapshot)) return defaultSnapshot;
  return null;
}

function loadFromSnapshot(path: string): FlashpointReportIncident[] {
  const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, SnapshotRow[]>;
  const flashpoint = raw.flashpoint ?? [];
  const protests = raw.protests ?? [];
  return [...flashpoint, ...protests].map(toFlashpointInput);
}

async function fetchFromApi(apiBase: string): Promise<FlashpointReportIncident[]> {
  async function fetchAll(topic: string): Promise<ApiIncident[]> {
    const res = await fetch(`${apiBase}/api/incidents?topic=${topic}&limit=5000`);
    if (!res.ok) throw new Error(`fetch ${topic} → HTTP ${res.status}`);
    return (await res.json()) as ApiIncident[];
  }
  const [flashpoint, protests] = await Promise.all([fetchAll("flashpoint"), fetchAll("protests")]);
  return [...flashpoint, ...protests].map(toFlashpointInput);
}

export async function loadFlashpointIncidents(): Promise<{
  incidents: FlashpointReportIncident[];
  source: FlashpointLoadSource;
  meta: { flashpointCount: number; protestsCount: number; path?: string; apiBase?: string };
}> {
  const preferSnapshot =
    process.env.USE_SNAPSHOT === "1" ||
    process.env.SNAPSHOT_PATH?.trim() ||
    (!process.env.API_BASE?.trim() && resolveSnapshotPath());

  const snapshotPath = resolveSnapshotPath();
  if (preferSnapshot && snapshotPath) {
    const raw = JSON.parse(readFileSync(snapshotPath, "utf8")) as Record<string, SnapshotRow[]>;
    const flashpointCount = raw.flashpoint?.length ?? 0;
    const protestsCount = raw.protests?.length ?? 0;
    return {
      incidents: loadFromSnapshot(snapshotPath),
      source: "snapshot",
      meta: { flashpointCount, protestsCount, path: snapshotPath },
    };
  }

  const apiBase = process.env.API_BASE?.trim() ?? "http://localhost:80";
  const incidents = await fetchFromApi(apiBase);
  const flashpointCount = incidents.filter((r) => r.topic === "flashpoint").length;
  const protestsCount = incidents.filter((r) => r.topic === "protests").length;
  return {
    incidents,
    source: "api",
    meta: { flashpointCount, protestsCount, apiBase },
  };
}
