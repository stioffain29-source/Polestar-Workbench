---
name: Background job reclaim independence
description: Why a durable job's recovery pass must not be sequenced behind migrations, and why the status endpoint must reclaim on read.
---

A background job's reclaim/recovery pass must install its periodic timer **before**
running its first pass, and must never be sequenced behind data migrations or any
other boot step that can fail or return early. The job's status endpoint must also
reclaim an abandoned run **on read**, using the worker's own hard deadline.

**Why:** A regional report worker orphaned by a deploy left its row `running`
forever. Boot recovery was gated behind `runDataMigrations()` (which `return`s
early on failure), and the periodic timer was only installed at the *end* of a
successful pass. One failing pass therefore disabled reclaim entirely, so the row
survived every later restart — observed stuck for 24+ minutes against a 5-minute
worker deadline — while the creation page showed "Reconnecting to your report"
indefinitely. A client that treats transport failures and a never-advancing stage
as equally transient has no way out of that state on its own.

**How to apply:**
- Install the interval first, then run the first pass in its own `catch`. A pass
  that throws (for example a table not migrated yet) must leave the timer armed.
- Keep boot recovery out of the migration-gated block entirely.
- Reclaim on read in the status route: if the row is `running` and older than the
  worker's own timeout + grace, re-queue and relaunch it, then return the
  reclaimed row. This lets the waiting page heal without a background pass.
- Never fence a job this process still owns — check the in-memory active-child map
  before reclaiming, so a live worker is not killed mid-build.
- Use the same staleness predicate (`started_at` vs the worker deadline) for both
  the periodic pass and the read-time reclaim, so the two can never disagree.

Related: an indefinite client retry loop is only safe when the server guarantees
the underlying state keeps moving. If the server can strand a row, the client
spinner becomes permanent.
