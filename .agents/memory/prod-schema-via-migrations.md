---
name: Prod schema changes via boot migrations
description: Adding a DB column reaches prod only through an idempotent ALTER in api-server migrations, not drizzle push.
---

Adding a column to a `@workspace/db` schema table requires TWO writes, not one:
1. The Drizzle schema (`lib/db/src/schema/*.ts`) — gives types + dev push.
2. An idempotent `ALTER TABLE … ADD COLUMN IF NOT EXISTS …` via `db.execute(sql\`…\`)`
   at the TOP of `runDataMigrations()` in `artifacts/api-server/src/lib/migrations.ts`.

**Why:** `pnpm --filter @workspace/db run push` (drizzle-kit) only reaches the DEV
database. From the workspace the prod `DATABASE_URL` is a read-only replica, so the
deployment runtime is the only place that can write prod schema. `runDataMigrations`
runs on api-server boot (before `listen`), so the ALTER is how a new column actually
appears in prod after a republish. Without it, prod queries selecting the new column
throw "column does not exist" while dev works fine.

**How to apply:** any new schema column/table — add the IF NOT EXISTS DDL to the
migration runner so it self-applies on the next deploy. Idempotent, safe to re-run.

**Enforced by a test:** `__tests__/db/schemaBootMigrationDrift.test.ts` compares
every Drizzle table/column (via `getTableConfig`) against the `CREATE TABLE` /
`ALTER ... ADD COLUMN IF NOT EXISTS` DDL parsed from `migrations.ts`, and fails
the jest run on drift. It carries a FROZEN baseline of pre-guard tables/columns
(incidents/sources/reports original cols + whole strikes/spot_reports/
market_prices, all verified present in prod). Do NOT grow that baseline for new
schema — add boot DDL instead, or the guard is pointless.
