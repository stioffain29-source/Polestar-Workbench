---
name: Agent secret-store delete quirk
description: Why deleteEnvVars can't remove a secret the user supplied via the requestEnvVar secret prompt, and how to park instead.
---

# Agent secret-store delete quirk

A secret provided by the user through the `requestEnvVar({requestType:"secret"})`
prompt lands in the repl **Secrets** store. The agent `deleteEnvVars` /
`setEnvVars` / `viewEnvVars` callbacks operate on the **env-var config layer**
(`shared`/`development`/`production`) — a *different* layer.

Observed: `deleteEnvVars({keys:["X"]})` returned `{deleted}` success for every
environment, but the value still injected into a freshly spawned process
(`node -e process.env.X`) and `viewEnvVars` kept reporting it present. So the
"success" was misleading — the user-supplied secret was NOT removed.

**Why it matters:** Do not trust a `deleteEnvVars` success as proof a
user-provided secret is gone. To verify a secret's real value, read it from a
**fresh process** (e.g. `node -e`), not `viewEnvVars`.

**How to apply:**
- To truly rotate/remove a user-supplied secret, the USER must delete it in the
  Secrets pane (Tools → Secrets), or overwrite it through the same secret prompt.
- When you can't remove a bad/placeholder secret and need a clean, non-alarming
  state, **park via a config flag** you *can* set with `setEnvVars`. Example:
  the social-watch Instagram path reads `INSTAGRAM_ENABLED` (`envFlag` in
  `lib/ingest/src/socialWatch.ts`); `setEnvVars({values:{INSTAGRAM_ENABLED:"false"}})`
  flips Source Health to `disabled` ("Switched off") instead of leaving a 401
  `failing_upstream`/`no_data` source on the PUBLIC board. Restart the
  api-server workflow for the flag to take effect.
