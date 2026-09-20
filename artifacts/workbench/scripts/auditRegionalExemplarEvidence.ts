import pg from "../../../lib/db/node_modules/pg/esm/index.mjs";

const connectionString = process.env.PROD_DATABASE_URL?.trim();
if (!connectionString) throw new Error("PROD_DATABASE_URL is required");

const pool = new pg.Pool({
  connectionString,
  max: 1,
  application_name: "regional-weekly-exemplar-audit-readonly",
});

const cases = [
  ["apac-kohat", ["kohat"]],
  ["apac-narathiwat", ["narathiwat", "sukhirin"]],
  ["apac-cotabato", ["cotabato", "barmm"]],
  ["apac-australia-migration", ["visa hopping", "working holiday", "migration overhaul"]],
  ["apac-india-hoaxes", ["gmail accounts", "bomb hoax"]],
  ["apac-typhoon-dujuan", ["dujuan"]],
  ["apac-halmahera", ["halmahera", "pulau doi"]],
  ["me-riyadh", ["riyadh"]],
  ["me-pipeline-yanbu", ["east-west pipeline", "yanbu"]],
  ["me-hormuz", ["hormuz"]],
  ["me-bab-el-mandeb", ["bab el mandeb", "red sea coast"]],
  ["me-syria-diesel", ["diesel prices", "diesel price"]],
  ["me-aws", ["aws", "amazon web services"]],
  ["me-spyware", ["spyware"]],
  ["me-asir-jazan-weather", ["asir", "jazan"]],
  ["me-uae-visa", ["bangladeshi nationals", "bangladesh visa", "visa cancellations"]],
  ["me-syria-incursion", ["southern syria", "daraa", "incursion"]],
  ["me-yemen-strikes", ["exchange strikes", "yemenis flee", "saudi houthi"]],
] as const;

try {
  await pool.query("begin read only");
  for (const [key, terms] of cases) {
    const result = await pool.query(
      `select id, topic, title, display_title, summary, country, location,
              occurred_at, incident_date, severity, category, confidence,
              source, source_url, resolved_url, event_cluster_key
         from incidents
        where occurred_at >= timestamptz '2026-09-12'
          and occurred_at < timestamptz '2026-09-22'
          and (
            lower(coalesce(title, '') || ' ' || coalesce(display_title, '') || ' ' ||
                  coalesce(summary, '') || ' ' || coalesce(country, '') || ' ' ||
                  coalesce(location, ''))
            like any($1::text[])
          )
        order by occurred_at, id
        limit 30`,
      [terms.map((term) => `%${term}%`)],
    );
    console.log(JSON.stringify({ key, count: result.rowCount, rows: result.rows }));
  }

  const forward = await pool.query(
    `select id, source_name, source_url, source_title, source_published_at,
            event_date, country, city, venue, event_type, issue, organiser,
            description, disruption_potential, confidence, status
       from protest_events
      where event_date >= timestamptz '2026-09-20'
        and event_date < timestamptz '2026-09-28'
      order by event_date, country, id`,
  );
  console.log(JSON.stringify({ key: "forward", count: forward.rowCount, rows: forward.rows }));
  await pool.query("rollback");
} finally {
  await pool.end();
}