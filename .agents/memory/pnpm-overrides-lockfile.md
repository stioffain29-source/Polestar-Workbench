---
name: pnpm overrides need lockfile regen
description: Editing pnpm-workspace.yaml overrides/catalog without regenerating pnpm-lock.yaml breaks the --frozen-lockfile post-merge install on every future merge.
---

Any change to `pnpm-workspace.yaml` `overrides:` or `catalogs:` MUST be committed alongside a regenerated `pnpm-lock.yaml` (run `pnpm install`, commit the lockfile).

**Why:** the post-merge reconciliation script (`scripts/post-merge.sh`) runs `pnpm install --frozen-lockfile` then `pnpm --filter db push`. pnpm records the overrides/catalog snapshot inside the lockfile, so a drift makes the frozen install refuse to proceed ("Update your lockfile…"), which fails *every* future task merge's post-merge step and skips the `db push` that runs after it. The drift is dormant — it only surfaces when the next merge triggers post-merge, so the breaking commit and the failing merge can be far apart (here: security pins for esbuild GHSA-67mh-4wv8-2f99 and qs GHSA-q8mj-m7cp-5q26 were added in an earlier "test framework setup" commit but the lockfile was never regenerated).

**How to apply:** after editing overrides/catalog (or adding/removing any dependency), run `pnpm install` (non-frozen) and commit the updated `pnpm-lock.yaml`; verify with `pnpm install --frozen-lockfile` (should say "Lockfile is up to date"). Do NOT "fix" a frozen-install failure by weakening the script to non-frozen — the strict check is intentional; regenerate the lockfile instead.
