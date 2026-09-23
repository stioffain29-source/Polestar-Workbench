---
name: Country-engine reprocess worker
description: Why the rule-versioned country-engine reprocess must run in a forked worker, the database write-fence app-name rule that ops runs keep tripping, and the per-slug lock that stops two runs deleting each other's events.
---

# Rule-versioned reprocess runs OFF the API process

Bumping the country-engine rule version makes the next boot re-run the engine
for every country over a 120-day window. That work is CPU-bound and pure (no
awaits inside the build phase), and the biggest slugs are tens of thousands of
rows — minutes of solid compute per slug.

**Rule:** never run it inside the API process. Fork a dedicated worker entry
(the same pattern the ingest and regional-report workers use) and let the
server keep serving.

**Why:** run inline it pins the single event loop. The symptom is not an error
— the workbench shell loads, every API call queues, the deployment logs go
completely silent for many minutes, and the app looks dead. Nothing in the logs
says "busy", so the failure reads as a crash or a hung deploy.

**How to apply:** any boot-time or post-ingest job that is CPU-bound over a full
table window belongs in a forked child. Keep per-slug resume markers so a
restart mid-run continues instead of redoing finished work, and write the
version-level marker only after every configured slug is marked.

# Database write fence: the application_name allowlist

Writes are gated by a trigger that inspects `application_name` and accepts only:

- `polestar-app:v2:%`
- exactly `polestar-maintenance:v2`
- `polestar-ingest:<runId>` where runId equals the ACTIVE ingest fence row

Anything else raises `database writer <name> does not support ingest fence
protocol v2` (SQLSTATE 55000).

**Why:** a descriptive label is the natural thing to set on a new worker or a
one-off ops script, and it silently breaks every write that job makes — the
engine work completes and then the marker insert throws. Plain `psql` is
rejected for the same reason, so operator fixes must go through a process that
uses the app's pool (which defaults to `polestar-app:v2:<pid>`).

**How to apply:** when forking a worker or writing an ops script, either leave
PGAPPNAME alone or keep the `polestar-app:v2:` prefix. Only the real ingest
worker may use the `polestar-ingest:` form, and only while it owns the fence.

# One writer per country slug

An engine run upserts the events it produced and then DELETES that slug's rows
it did not produce. Two runs of the same slug against one database therefore
race: the slower one finishes last and deletes what the newer one just wrote.

**Why:** overlap is easy to cause — a boot fork, the post-ingest
`runCountryEngineAll`, and an operator run against the same database can all be
in flight at once.

**How to apply:** take a session advisory lock keyed on the slug
(`pg_try_advisory_lock(hashtextextended('country-engine:<slug>', 0))`) and skip
the slug when it is already held; leave its marker unwritten so the holder (or
the next boot) finishes it.
