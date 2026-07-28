---
name: Task-agent DB writes don't survive merges
description: Content changes to database rows made by task agents are lost; only code merges. Prod DB is writable from workspace.
---

**Rule:** A task agent's database writes (report prose, incident flags, seeds) happen in its isolated environment and are DISCARDED at merge — only code lands. Any task whose deliverable includes DB row content must either be done by the main agent directly, or shipped as a marker-gated boot migration in code.

**Why:** A merged task claimed to apply owner-mandated report prose; the columns were empty in dev and prod, and the owner saw "no changes" despite a green merge.

**How to apply:** When reviewing a merged task that promises data changes, verify the rows exist; when planning, put DB content work in code (migrations) or keep it with the main agent.

**Also:** `PROD_DATABASE_URL` IS writable from the workspace (the old "read-only from workspace" note is wrong for direct psql/pg use). Direct prod re-cleans/backfills via a script with `explainRelevance` work fine; still prefer marker-gated boot migrations for anything repeatable.
