import { readFileSync } from "node:fs";
import { join } from "node:path";
import { is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "@workspace/db/schema";

/**
 * Production-schema drift guard.
 *
 * The production database schema is provisioned in TWO independent places that
 * must stay in lockstep:
 *
 *   1. The Drizzle schemas in `lib/db/src/schema/*.ts` — these drive types and
 *      the dev-only `pnpm --filter @workspace/db run push`.
 *   2. The idempotent `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN
 *      IF NOT EXISTS` statements in `artifacts/api-server/src/lib/migrations.ts`
 *      (`runDataMigrations`). This is the ONLY path that reaches the writable
 *      production primary (drizzle push only ever touches the dev database).
 *
 * If a table or column is added to a Drizzle schema but the matching boot
 * migration DDL is forgotten, dev works fine while the published app silently
 * degrades (the exact bug that left AI country-report narratives falling back to
 * the template in production). This test fails the build when that drift exists.
 *
 * BASELINE: a handful of tables/columns predate this boot-migration drift guard.
 * They were provisioned into production before `runDataMigrations` existed and
 * are therefore not (and need not be) re-created there. They are enumerated
 * below and were verified to exist in the production database. This list is a
 * FROZEN snapshot of the pre-guard schema — it must NOT grow. Any NEW table or
 * column added to a Drizzle schema from now on must ship matching boot-migration
 * DDL in `runDataMigrations`, not a new baseline entry.
 */

const MIGRATIONS_PATH = join(
  __dirname,
  "..",
  "..",
  "artifacts",
  "api-server",
  "src",
  "lib",
  "migrations.ts",
);

// Pre-existing production schema objects that predate the boot-migration guard.
// Frozen snapshot — do not add new entries here; add boot DDL instead.
const BASELINE: Record<string, readonly string[]> = {
  incidents: [
    "id",
    "topic",
    "title",
    "display_title",
    "summary",
    "country",
    "location",
    "latitude",
    "longitude",
    "occurred_at",
    "severity",
    "confidence",
    "source",
    "source_url",
    "analyst_notes",
    "created_at",
    "relevance_status",
    "relevance_score",
    "relevance_reason",
    "relevance_version",
    "relevance_evaluated_at",
  ],
  sources: [
    "id",
    "name",
    "topic",
    "source_type",
    "url",
    "status",
    "last_success_at",
    "last_failure_at",
    "error_message",
    "reliability",
    "manual_review_required",
    "notes",
    "created_at",
  ],
  reports: [
    "id",
    "title",
    "topic",
    "country_slug",
    "status",
    "issue_date",
    "situation",
    "what_happened",
    "hard_numbers",
    "what_matters",
    "implications",
    "polestar_view",
    "watch_next",
    "author",
    "created_at",
  ],
  strikes: [
    "id",
    "theatre",
    "country",
    "location",
    "latitude",
    "longitude",
    "occurred_at",
    "munition",
    "target_category",
    "infrastructure",
    "casualties",
    "source",
    "source_url",
    "confidence",
    "summary",
    "analyst_notes",
    "created_at",
  ],
  spot_reports: [
    "id",
    "title",
    "status",
    "report_date",
    "incident_date",
    "country",
    "province",
    "city",
    "latitude",
    "longitude",
    "category",
    "severity",
    "bluf",
    "incident_details",
    "current_situation",
    "operational_impact",
    "assessment",
    "outlook",
    "recommended_actions",
    "analyst_notes",
    "confidence_level",
    "internal_source_notes",
    "show_sources_in_export",
    "linked_incident_ids",
    "map_enabled",
    "affected_radius_km",
    "created_by",
    "export_history",
    "created_at",
    "last_edited_at",
    "map_points",
  ],
  market_prices: [
    "commodity_group",
    "commodity_key",
    "label",
    "value",
    "unit",
    "change",
    "as_of",
    "source",
    "benchmark",
    "trajectory",
    "updated_at",
  ],
};

/** Top-level (non-column) tokens that can appear in a CREATE TABLE body. */
const CONSTRAINT_KEYWORDS = new Set([
  "PRIMARY",
  "UNIQUE",
  "FOREIGN",
  "CONSTRAINT",
  "CHECK",
  "EXCLUDE",
]);

/** Split a CREATE TABLE body on top-level commas and return the column names. */
function parseColumnNames(body: string): string[] {
  const segments: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of body) {
    if (ch === "(") {
      depth += 1;
      current += ch;
    } else if (ch === ")") {
      depth -= 1;
      current += ch;
    } else if (ch === "," && depth === 0) {
      segments.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) segments.push(current);

  const columns: string[] = [];
  for (const segment of segments) {
    const trimmed = segment.trim();
    if (!trimmed) continue;
    const firstToken = trimmed.split(/\s+/)[0].replace(/"/g, "");
    if (CONSTRAINT_KEYWORDS.has(firstToken.toUpperCase())) continue;
    columns.push(firstToken);
  }
  return columns;
}

/** Map of table -> set of columns declared in `CREATE TABLE IF NOT EXISTS`. */
function parseCreateTableColumns(sqlText: string): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  const headerRe = /CREATE TABLE IF NOT EXISTS\s+"?(\w+)"?\s*\(/gi;
  let match: RegExpExecArray | null;
  while ((match = headerRe.exec(sqlText))) {
    const table = match[1];
    // Balance parentheses starting at the opening paren of the column list.
    const openIndex = headerRe.lastIndex - 1;
    let depth = 0;
    let i = openIndex;
    for (; i < sqlText.length; i += 1) {
      const ch = sqlText[i];
      if (ch === "(") depth += 1;
      else if (ch === ")") {
        depth -= 1;
        if (depth === 0) {
          i += 1;
          break;
        }
      }
    }
    const body = sqlText.slice(openIndex + 1, i - 1);
    if (!result.has(table)) result.set(table, new Set());
    const set = result.get(table)!;
    for (const col of parseColumnNames(body)) set.add(col);
  }
  return result;
}

/** Map of table -> set of columns added via `ALTER TABLE ... ADD COLUMN`. */
function parseAlterAddColumns(sqlText: string): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  const re =
    /ALTER TABLE\s+"?(\w+)"?\s+ADD COLUMN IF NOT EXISTS\s+"?(\w+)"?/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(sqlText))) {
    const [, table, column] = match;
    if (!result.has(table)) result.set(table, new Set());
    result.get(table)!.add(column);
  }
  return result;
}

describe("production schema boot-migration drift", () => {
  const migrationsSource = readFileSync(MIGRATIONS_PATH, "utf8");
  const createdColumns = parseCreateTableColumns(migrationsSource);
  const alteredColumns = parseAlterAddColumns(migrationsSource);

  const drizzleTables = Object.values(schema)
    .filter((value): value is PgTable => is(value, PgTable))
    .map((table) => getTableConfig(table));

  it("declares at least one Drizzle table (sanity)", () => {
    expect(drizzleTables.length).toBeGreaterThan(0);
  });

  it("provisions every Drizzle table in runDataMigrations or the frozen baseline", () => {
    const undeclared = drizzleTables
      .map((t) => t.name)
      .filter(
        (name) => !createdColumns.has(name) && BASELINE[name] === undefined,
      );

    expect(undeclared).toEqual([]);
  });

  it("provisions every Drizzle column via CREATE TABLE, ALTER ADD COLUMN, or the frozen baseline", () => {
    const missing: string[] = [];

    for (const table of drizzleTables) {
      const created = createdColumns.get(table.name) ?? new Set<string>();
      const altered = alteredColumns.get(table.name) ?? new Set<string>();
      const baseline = new Set(BASELINE[table.name] ?? []);

      for (const column of table.columns) {
        const name = column.name;
        const covered =
          created.has(name) || altered.has(name) || baseline.has(name);
        if (!covered) missing.push(`${table.name}.${name}`);
      }
    }

    // Each entry below is a Drizzle column with no idempotent boot-migration
    // DDL in runDataMigrations — it will exist in dev but be MISSING from the
    // production database. Add a `CREATE TABLE`/`ALTER TABLE ... ADD COLUMN IF
    // NOT EXISTS` for it in artifacts/api-server/src/lib/migrations.ts.
    expect(missing).toEqual([]);
  });
});
