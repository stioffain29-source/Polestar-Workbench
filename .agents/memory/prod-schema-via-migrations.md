---
name: Managed production schema changes
description: Current publishing guidance supersedes the project's historical boot-DDL convention.
---

For new schema work, consult the database skill and its publish-migrations reference. Apply additive schema changes to development and let Publish apply the development-to-production schema diff. Do not add new startup-time DDL or production mutation scripts.

**Why:** The current platform guidance checked on 2026-09-10 explicitly prohibits startup DDL to self-heal production. Earlier project notes incorrectly said new columns required boot migrations; that instruction is superseded. Existing historical boot migrations are not permission to extend the pattern.

**How to apply:** Keep schema definitions authoritative, inspect development diffs for unrelated destructive changes, and test development first. If an old drift test mandates boot DDL for every new table, revise that expectation for the managed-publish path rather than reintroducing prohibited startup mutations. Do not refactor unrelated historical migrations without a separate reason.