import { db, incidentsTable, pool } from "@workspace/db";
import { geocode } from "@workspace/ingest";
import { and, eq, isNull, or, sql } from "drizzle-orm";

// Backfill latitude/longitude for existing flashpoint + cargo_watch incidents
// that were inserted before the ingest pipeline gained a geocoding step.
//
// Resolves coordinates from each row's country + title/summary using the same
// @workspace/ingest geocode() lookup used at ingest time, so backfilled rows
// match freshly-ingested rows. Rows that cannot be geocoded are logged, not
// silently skipped. Dry-run by default; pass --commit to write.

async function main(): Promise<void> {
  const commit = process.argv.includes("--commit");
  console.log(`Geocode backfill — mode=${commit ? "COMMIT" : "DRY-RUN"}`);

  const rows = await db
    .select({
      id: incidentsTable.id,
      topic: incidentsTable.topic,
      country: incidentsTable.country,
      title: incidentsTable.title,
      summary: incidentsTable.summary,
      location: incidentsTable.location,
    })
    .from(incidentsTable)
    .where(
      and(
        or(eq(incidentsTable.topic, "flashpoint"), eq(incidentsTable.topic, "cargo_watch")),
        or(isNull(incidentsTable.latitude), isNull(incidentsTable.longitude)),
      ),
    );

  console.log(`Rows missing coordinates: ${rows.length}`);

  let resolved = 0;
  const misses: string[] = [];
  const updates: { id: number; lat: number; lng: number; location: string | null }[] = [];

  for (const r of rows) {
    const geo = geocode(r.country, `${r.title} ${r.summary}`);
    if (!geo) {
      misses.push(`[${r.topic}] ${r.country} — ${r.title.slice(0, 80)}`);
      continue;
    }
    resolved++;
    updates.push({
      id: r.id,
      lat: geo.latitude,
      lng: geo.longitude,
      location: r.location ?? geo.location,
    });
  }

  console.log(`Resolved: ${resolved}/${rows.length}`);
  if (misses.length > 0) {
    console.log(`WARNING: ${misses.length} row(s) could not be geocoded:`);
    for (const m of misses) console.log(`  - ${m}`);
  }

  if (!commit) {
    console.log("\nDRY-RUN — no rows written. Re-run with --commit to apply.");
    await pool.end();
    return;
  }

  for (const u of updates) {
    await db
      .update(incidentsTable)
      .set({ latitude: u.lat, longitude: u.lng, location: u.location })
      .where(eq(incidentsTable.id, u.id));
  }

  const remaining = await db.execute(sql`
    SELECT COUNT(*)::int AS count FROM incidents
    WHERE topic IN ('flashpoint','cargo_watch')
      AND (latitude IS NULL OR longitude IS NULL)
  `);
  const count = (remaining.rows[0] as { count: number } | undefined)?.count ?? 0;
  console.log(`\nUpdated ${updates.length} rows. Still missing coordinates: ${count}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
