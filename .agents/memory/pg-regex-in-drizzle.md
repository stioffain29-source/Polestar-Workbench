---
name: Postgres POSIX word boundaries inside Drizzle sql template literals
description: Why `\b` silently becomes backspace inside `sql\`...\`` and what to use instead.
---

When writing POSIX regex inside a Drizzle `sql\`...\`` template literal, **do not use `\b` for word boundary**. JS template literals process `\b` as the U+0008 backspace control character before the string ever reaches Postgres, so `'\\bword\\b'` ends up as `<BS>word<BS>` in the SQL — which matches nothing useful and produces no error.

Postgres POSIX regex (`~`, `~*`) supports `\y` as its own word boundary. `\y` is not a recognized JS string escape, so JS leaves the backslash intact and Postgres sees `\y` literally. Use that.

**Why:** Cost me a debug cycle when the kinetic-armed-conflict cleanup migration was matching zero rows on `\bpti\b` despite the seed having "PTI protest" content. Switching to `\ypti\y` fixed it. The same gotcha does NOT apply to regex literals in `.ts` files (e.g. `import-legacy.ts`) because `/\bword\b/i` is a regex literal, not a string, and JS regex engine treats `\b` as word boundary natively.

**How to apply:**
- Inside `sql\`SELECT ... ~* '...\yfoo\y...'\``: use `\y`.
- Inside `/foo\bbar\b/i` JS regex literal: use `\b` (works correctly).
- Inside a JS string passed to `new RegExp(...)`: use `'\\b'` (the engine sees `\b`).
