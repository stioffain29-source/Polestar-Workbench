---
name: Drizzle aggregate runtime types
description: max()/min() over a timestamp column return an ISO STRING at runtime, not a Date, despite the TS type.
---

# Drizzle aggregate columns are strings at runtime

`db.select({ latest: max(table.someTimestamp) })` is typed as `Date | null` but
at RUNTIME `latest` is an ISO **string** (the pg driver hands back the text form
for aggregate expressions). Calling `latest.toISOString()` throws
"`.toISOString` is not a function".

**How to apply:** always coerce before using Date methods —
`const d = latest ? new Date(latest) : null;`. Existing code that "works" usually
routes the value through a formatter that already accepts `string | Date`, which
hides the trap; a fresh call site that touches `Date` methods directly will crash.
