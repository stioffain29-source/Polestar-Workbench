---
name: code_execution sandbox env access
description: The code_execution JS sandbox has no process.env; read/verify secrets via bash node or viewEnvVars instead.
---

# code_execution sandbox cannot read process.env

Inside the `code_execution` tool, `process.env` is **undefined** — `process.env.FOO` throws `TypeError: Cannot read properties of undefined`.

**Why:** the JS sandbox is for tool-callback orchestration, not project-process env. Secret/env values are not injected into it.

**How to apply:**
- To check whether a secret EXISTS (not its value), use the `viewEnvVars` callback in the sandbox.
- To actually USE a secret value (e.g. hit a keyed API to verify it), run a one-off `bash` `node`/`tsx` script — bash inherits the workspace env, so `process.env.VESSEL_REGISTRY_API_KEY` etc. is visible there. Exercise the real lib code path (e.g. import `@workspace/ingest` `resolveVesselClasses`) from a temp script, then delete it. Never print the key.
