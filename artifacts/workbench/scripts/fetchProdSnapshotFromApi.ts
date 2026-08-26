/**
 * Fetch incidents from production API into .prod-incidents.json.
 *
 * Production requires an authenticated owner session (Replit shield + requireOwner).
 *
 * Usage:
 *   1. Log into https://document-asset-manager-stioffain29.replit.app/
 *   2. DevTools → Application → Cookies → copy connect.sid value
 *   3. Run:
 *      PROD_API_URL=https://document-asset-manager-stioffain29.replit.app \
 *      PROD_SESSION_COOKIE="connect.sid=..." \
 *      npx tsx scripts/fetchProdSnapshotFromApi.ts
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, ".prod-incidents.json");

const PROD_API =
  process.env.PROD_API_URL?.replace(/\/$/, "") ??
  "https://document-asset-manager-stioffain29.replit.app";

const COOKIE = process.env.PROD_SESSION_COOKIE ?? "";

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
  displayTitle?: string | null;
  relevanceStatus?: string | null;
}

interface SnapshotRow {
  id: number;
  topic: string;
  title: string;
  summary: string | null;
  country: string | null;
  location: string | null;
  source: string | null;
  source_url: string | null;
  occurred_at: string | null;
  severity: string | null;
  display_title: string | null;
  relevance_status: string | null;
}

const TOPICS = [
  "flashpoint",
  "protests",
  "strikes",
  "fuel",
  "shipping",
  "cargo_watch",
  "energy",
  "fertiliser",
  "conflict",
  "indonesia_local",
  "facebook_osint",
];

async function fetchTopic(topic: string): Promise<ApiIncident[]> {
  const url = `${PROD_API}/api/incidents?topic=${encodeURIComponent(topic)}&days=180&includeIrrelevant=true`;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (COOKIE) headers.Cookie = COOKIE.includes("=") ? COOKIE : `connect.sid=${COOKIE}`;

  const res = await fetch(url, { headers, redirect: "follow" });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${topic} → HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    const body = await res.text();
    throw new Error(
      `${topic} → expected JSON, got ${ct}. ` +
        (body.includes("replshield") || body.includes("<!DOCTYPE")
          ? "Replit shield blocked the request — set PROD_SESSION_COOKIE from your logged-in browser session."
          : body.slice(0, 120)),
    );
  }
  return (await res.json()) as ApiIncident[];
}

function toSnapshotRow(r: ApiIncident): SnapshotRow {
  return {
    id: r.id,
    topic: r.topic,
    title: r.title,
    summary: r.summary,
    country: r.country,
    location: r.location,
    source: r.source,
    source_url: r.sourceUrl,
    occurred_at: r.occurredAt,
    severity: r.severity,
    display_title: r.displayTitle ?? null,
    relevance_status: r.relevanceStatus ?? null,
  };
}

async function main() {
  console.log(`Fetching from ${PROD_API} …`);
  if (!COOKIE) {
    console.warn("Warning: PROD_SESSION_COOKIE not set — request may be blocked by Replit shield.");
  }

  const byTopic: Record<string, SnapshotRow[]> = {};
  let total = 0;

  for (const topic of TOPICS) {
    try {
      const rows = await fetchTopic(topic);
      byTopic[topic] = rows.map(toSnapshotRow);
      total += rows.length;
      console.log(`  ${topic.padEnd(16)} ${rows.length}`);
    } catch (err) {
      console.error(`  ${topic.padEnd(16)} FAILED:`, err instanceof Error ? err.message : err);
      if (!COOKIE || String(err).includes("shield") || String(err).includes("401")) {
        throw err;
      }
    }
  }

  if (total === 0) {
    throw new Error("No incidents fetched — check PROD_SESSION_COOKIE and PROD_API_URL.");
  }

  writeFileSync(outPath, JSON.stringify(byTopic, null, 2));
  console.log(`\nWrote ${total} incidents → ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
