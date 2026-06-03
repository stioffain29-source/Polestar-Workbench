---
name: DB pool connection-drop resilience
description: Why a dropped Postgres connection during long ingest can crash the process, and the rule that prevents it
---

A `pg` connection dropped by the server (idle timeout, failover, or
"terminating connection due to administrator command") is re-emitted as an
`error` EVENT. If nothing is listening, Node treats it as an uncaught exception
and crashes the WHOLE process — this took the deployment down once during the
multi-minute boot ingest catch-up.

**Durable rule: every `pg` connection surface needs its own `error` listener —
`pool.on("error")` alone is not enough.**

- Idle pooled clients are covered by `pool.on("error")` at pool construction.
  Put it in the shared db lib so every consumer (server + CLI scrapers) is
  protected; it can't depend on any one app's logger.
- A CHECKED-OUT client (`pool.connect()`) held for a long job — e.g. the one
  holding the ingest advisory lock — is NOT covered by `pool.on("error")` and is
  the likeliest victim. It needs its own `client.on("error")`.

**Why:** the lock-holder sits mostly-idle for minutes, the exact window where a
backend drop happens, and a checked-out client's error bypasses the pool listener.

**How to apply when a long-lived client's connection breaks:** flag it broken;
SKIP `pg_advisory_unlock` (Postgres already released session locks on drop, and
querying a dead client throws); `client.release(true)` to DESTROY rather than
recycle the poisoned connection. Let the in-flight query rejection propagate to
the caller's try/catch so it logs a FAILED run, not a crash — never swallow it.
Listener code only reaches prod after a republish.
