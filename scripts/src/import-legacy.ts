import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { db, incidentsTable, strikesTable, pool } from "@workspace/db";
import { sql } from "drizzle-orm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(__dirname, "../../attached_assets/legacy-dashboard-data.json");

type LegacyRecord = {
  title: string;
  date: string;
  category: string;
  severity: string;
  country: string;
  location?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  summary?: string;
  source?: string;
  sourceUrl?: string;
  legacyType?: string;
  legacyId?: string;
};

const CONTROLLED_CATEGORIES = [
  "Fuel",
  "Fertiliser",
  "Civil Unrest",
  "Energy / Grid",
  "Shipping",
  "Cargo",
  "Maritime Strike",
  "Land Strike",
  "Other",
] as const;

type ControlledCategory = (typeof CONTROLLED_CATEGORIES)[number];

function normaliseCategory(raw: string): ControlledCategory | null {
  switch (raw) {
    case "Fuel":
    case "Fertiliser":
    case "Civil Unrest":
    case "Energy / Grid":
    case "Shipping":
    case "Other":
      return raw;
    case "Cargo":
    case "APAC Cargo Theft":
      return "Cargo";
    case "Land Strikes":
      return "Land Strike";
    case "Maritime Strikes":
      return "Maritime Strike";
    case "Papua":
    case "PNG":
      return "Civil Unrest";
    case "country reports":
    case "incidents":
      return "Other";
    case "timeline records":
      return null; // anniversaries, not incidents
    default:
      return "Other";
  }
}

function normaliseSeverity(raw: string): string {
  const s = (raw ?? "").trim().toLowerCase();
  switch (s) {
    case "extreme": return "extreme";
    case "high": return "high";
    case "moderate":
    case "medium":
    case "alert":
      return "moderate";
    case "low": return "low";
    case "insignificant":
    case "noise":
      return "insignificant";
    case "":
    default:
      return "low"; // per spec rule 8
  }
}

// Map controlled category → incidents.topic (lowercase enum value used by app)
function categoryToTopic(cat: ControlledCategory): string {
  switch (cat) {
    case "Fuel": return "fuel";
    case "Fertiliser": return "fertiliser";
    case "Civil Unrest": return "protests";
    case "Energy / Grid": return "energy";
    case "Shipping": return "shipping";
    case "Cargo": return "cargo_watch";
    case "Other": return "flashpoint";
    default: return "flashpoint";
  }
}

function parseDate(d: string): Date | null {
  // Accept YYYY-MM-DD or full ISO; reject MM-DD style timeline anniversaries.
  if (!d || !/^\d{4}-\d{2}-\d{2}/.test(d)) return null;
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return null;
  return t;
}

function munitionFromTitle(t: string): string {
  const s = t.toLowerCase();
  if (s.includes("ballistic")) return "ballistic_missile";
  if (s.includes("cruise")) return "cruise_missile";
  if (s.includes("drone") || s.includes("uav") || s.includes("oneway") || s.includes("one-way")) return "drone";
  return "unknown";
}

function dedupeKey(title: string, when: Date, country: string, topicOrTheatre: string): string {
  return [
    title.trim().toLowerCase().slice(0, 200),
    when.toISOString().slice(0, 10),
    country.trim().toLowerCase(),
    topicOrTheatre,
  ].join("||");
}

async function main(): Promise<void> {
  const raw = readFileSync(SOURCE, "utf8");
  const records: LegacyRecord[] = JSON.parse(raw);
  console.log(`Loaded ${records.length} legacy records from ${SOURCE}`);

  // Pre-load existing rows to build dedupe sets.
  const existingIncidents = await db
    .select({
      title: incidentsTable.title,
      occurredAt: incidentsTable.occurredAt,
      country: incidentsTable.country,
      topic: incidentsTable.topic,
    })
    .from(incidentsTable);
  const incidentKeys = new Set(
    existingIncidents.map((r) => dedupeKey(r.title, r.occurredAt, r.country, r.topic)),
  );

  const existingStrikes = await db
    .select({
      country: strikesTable.country,
      occurredAt: strikesTable.occurredAt,
      theatre: strikesTable.theatre,
      munition: strikesTable.munition,
      targetCategory: strikesTable.targetCategory,
    })
    .from(strikesTable);
  const strikeKeys = new Set(
    existingStrikes.map((r) =>
      dedupeKey(`${r.munition} ${r.targetCategory}`, r.occurredAt, r.country, r.theatre),
    ),
  );

  const incidentBatch: typeof incidentsTable.$inferInsert[] = [];
  const strikeBatch: typeof strikesTable.$inferInsert[] = [];

  const report: Record<string, number> = Object.fromEntries(
    CONTROLLED_CATEGORIES.map((c) => [c, 0]),
  );
  let skippedDuplicate = 0;
  let skippedNoCategory = 0;
  let skippedBadDate = 0;
  let missingCoords = 0;
  let errors = 0;

  for (const r of records) {
    try {
      const cat = normaliseCategory(r.category);
      if (!cat) {
        skippedNoCategory++;
        continue;
      }
      const when = parseDate(r.date);
      if (!when) {
        skippedBadDate++;
        continue;
      }
      const severity = normaliseSeverity(r.severity);
      const country = (r.country ?? "").trim() || "Unknown";
      const title = (r.title ?? "").trim().slice(0, 500) || "Untitled";
      const summary = (r.summary ?? "").trim();
      const location = (r.location ?? "").trim() || null;
      const lat = typeof r.latitude === "number" ? r.latitude : null;
      const lng = typeof r.longitude === "number" ? r.longitude : null;
      if (lat == null || lng == null) missingCoords++;

      if (cat === "Land Strike" || cat === "Maritime Strike") {
        const theatre = cat === "Land Strike" ? "land_gcc" : "maritime_hormuz";
        const munition = munitionFromTitle(title);
        const targetCategory = "unknown";
        const key = dedupeKey(`${munition} ${targetCategory}`, when, country, theatre);
        if (strikeKeys.has(key)) {
          skippedDuplicate++;
          continue;
        }
        strikeKeys.add(key);
        strikeBatch.push({
          theatre,
          country,
          location,
          latitude: lat,
          longitude: lng,
          occurredAt: when,
          munition,
          targetCategory,
          infrastructure: "unknown",
          casualties: null,
          source: r.source || null,
          sourceUrl: r.sourceUrl || null,
          confidence: "medium",
          summary: summary || null,
          analystNotes: null,
        });
        report[cat]++;
      } else {
        const topic = categoryToTopic(cat);
        const key = dedupeKey(title, when, country, topic);
        if (incidentKeys.has(key)) {
          skippedDuplicate++;
          continue;
        }
        incidentKeys.add(key);
        incidentBatch.push({
          topic,
          title,
          summary: summary || title,
          country,
          location,
          latitude: lat,
          longitude: lng,
          occurredAt: when,
          severity,
          confidence: "medium",
          source: r.source || null,
          sourceUrl: r.sourceUrl || null,
          analystNotes: r.legacyType ? `legacy:${r.legacyType}:${r.legacyId ?? ""}` : null,
        });
        report[cat]++;
      }
    } catch (err) {
      errors++;
      console.error("Record error:", err);
    }
  }

  // Bulk insert in chunks to avoid parameter limits.
  async function chunkedInsert<T extends Record<string, unknown>>(
    rows: T[],
    inserter: (chunk: T[]) => Promise<unknown>,
    chunkSize = 200,
  ): Promise<void> {
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      await inserter(chunk);
    }
  }

  await db.transaction(async (tx) => {
    await chunkedInsert(incidentBatch, (chunk) => tx.insert(incidentsTable).values(chunk));
    await chunkedInsert(strikeBatch, (chunk) => tx.insert(strikesTable).values(chunk));
  });

  // Per-category counts already tallied. Print final report.
  console.log("\nImport report");
  console.log("=============");
  console.log("Imported:");
  for (const c of CONTROLLED_CATEGORIES) {
    console.log(`  - ${c.padEnd(16)}: ${report[c]}`);
  }
  console.log(`\nSkipped duplicates       : ${skippedDuplicate}`);
  console.log(`Skipped uncategorisable  : ${skippedNoCategory} (timeline records)`);
  console.log(`Skipped bad dates        : ${skippedBadDate}`);
  console.log(`Records missing coords   : ${missingCoords}`);
  console.log(`Errors                   : ${errors}`);

  // Show resulting table sizes.
  const incRes = await db.execute(sql`SELECT COUNT(*)::int AS count FROM incidents`);
  const strRes = await db.execute(sql`SELECT COUNT(*)::int AS count FROM strikes`);
  const incCount = (incRes.rows[0] as { count: number } | undefined)?.count ?? 0;
  const strCount = (strRes.rows[0] as { count: number } | undefined)?.count ?? 0;
  console.log(`\nDatabase now contains: ${incCount} incidents, ${strCount} strikes`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
