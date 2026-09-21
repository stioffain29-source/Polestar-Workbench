// @ts-expect-error Temporary maintenance script uses the workspace's installed pg runtime.
import pg from "../../lib/db/node_modules/pg/esm/index.mjs";

const devUrl = process.env.DATABASE_URL;
const prodUrl = process.env.PROD_DATABASE_URL;
if (!devUrl || !prodUrl) throw new Error("Development and production database URLs are required");
if (devUrl === prodUrl) throw new Error("Refusing to run against identical databases");

const dev = new pg.Pool({
  connectionString: devUrl,
  application_name: "polestar-maintenance:v2",
  max: 1,
});
const prod = new pg.Pool({
  connectionString: prodUrl,
  application_name: "polestar-maintenance:v2",
  max: 1,
});
try {
  const { rows } = await dev.query<{
    name: string;
    topic: string;
    source_type: string;
    url: string;
    status: string;
    reliability: number;
    manual_review_required: boolean;
    notes: string;
  }>(`
    SELECT name, topic, source_type, url, status, reliability,
           manual_review_required, notes
      FROM sources
     WHERE name LIKE 'Google News — % (Flashpoint %)'
     ORDER BY name
  `);
  if (rows.length !== 53) {
    throw new Error(`Expected 53 generated country sources, found ${rows.length}`);
  }
  await prod.query("BEGIN");
  for (const row of rows) {
    await prod.query(
      `INSERT INTO sources
         (name, topic, source_type, url, status, reliability, manual_review_required, notes)
       SELECT $1, $2, $3, $4, $5, $6, $7, $8
       WHERE NOT EXISTS (SELECT 1 FROM sources WHERE name = $1)`,
      [
        row.name,
        row.topic,
        row.source_type,
        row.url,
        row.status,
        row.reliability,
        row.manual_review_required,
        row.notes,
      ],
    );
    await prod.query(
      `UPDATE sources
          SET topic = $2, source_type = $3, url = $4, status = $5,
              reliability = $6, manual_review_required = $7, notes = $8,
              error_message = NULL, consecutive_failures = 0,
              last_failure_at = NULL, failure_reason = NULL
        WHERE name = $1`,
      [
        row.name,
        row.topic,
        row.source_type,
        row.url,
        row.status,
        row.reliability,
        row.manual_review_required,
        row.notes,
      ],
    );
  }
  await prod.query("COMMIT");
  console.log(JSON.stringify({ productionSourcesUpserted: rows.length }));
} catch (error) {
  await prod.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await dev.end();
  await prod.end();
}