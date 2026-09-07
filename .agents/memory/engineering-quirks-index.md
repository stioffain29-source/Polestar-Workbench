---
name: Engineering environment quirks
description: Compact pointers to durable build, codegen, test, runtime, payload, secret and merge behavior.
---

Use these focused notes when the matching failure appears:

- [Orval path/query collision](orval-params-name-collision.md)
- [pnpm override lockfile regeneration](pnpm-overrides-lockfile.md)
- [Base64 JSON body limits](json-body-base64-limits.md)
- [Cloud Run transient uptime](cloudrun-uptime-outages.md)
- [Codegen and Workbench HMR](codegen-vite-hmr-restart.md)
- [Jest route harness](jest-route-test-harness.md)
- [Frontend/server barrel imports](workbench-server-lib-barrel-import.md) and [Jest import.meta](jest-barrel-import-meta.md)
- [Secret-store deletion layers](agent-secret-store-delete.md)
- [Drizzle aggregate runtime types](drizzle-aggregate-runtime-types.md)
- [32 MB response cap](response-32mb-chunk-cap.md)
- [Task-agent database writes](task-agent-db-writes.md)

**Why:** These issues are unrelated but each is a durable environment trap; a
single index preserves discoverability without exhausting the main memory index.

**How to apply:** Open only the matching topic when the symptom appears.