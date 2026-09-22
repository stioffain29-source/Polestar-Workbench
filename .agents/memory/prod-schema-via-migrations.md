---
name: Managed production schema changes
description: Current publishing guidance supersedes the project's historical boot-DDL convention.
---

For new schema work, consult the database skill and its publish-migrations reference. Apply additive schema changes to development and let Publish apply the development-to-production schema diff. Do not add new startup-time DDL or production mutation scripts.

**Why:** The current platform guidance checked on 2026-09-10 explicitly prohibits startup DDL to self-heal production. Earlier project notes incorrectly said new columns required boot migrations; that instruction is superseded. Existing historical boot migrations are not permission to extend the pattern.

**How to apply:** Keep schema definitions authoritative, inspect development diffs for unrelated destructive changes, and test development first. If an old drift test mandates boot DDL for every new table, revise that expectation for the managed-publish path rather than reintroducing prohibited startup mutations. Do not refactor unrelated historical migrations without a separate reason.

An additive feature is not authorisation to drop unrelated indexes. The development schema can contain operational indexes created outside the ORM declarations.

**Why:** A development diff for isolated new storage also proposed removing existing incident and maritime indexes. Accepting the entire diff would have changed unrelated workloads.

**How to apply:** Preview the SQL before applying a broad schema push. When unrelated removals appear, apply only the authorised additive development changes and preserve those indexes; do not force the whole diff through.