---
name: Title translation marker gate
description: Why non-English incident headlines silently ship untranslated, and the two prerequisites to fix it.
---

# Title translation marker gate

Non-English incident headlines are normalised to clean English advisory titles
by `runTitleTranslation` (`lib/ingest/src/titleTranslate.ts`), wired into
`runIngestOnce` and exposed via the `translate-titles` CLI. The result lands in
`incidents.display_title` (the `ln` column); UIs prefer `ln` and fall back to the
raw title.

Two things must BOTH hold or a headline ships untranslated:

1. **Detection is marker-word gated.** A row is only a translation candidate if
   its title contains a non-Latin script OR matches `INDONESIAN_MARKER_WORDS`
   (same list feeds the JS `\b(...)\b` predicate and the SQL `~*` `\y(...)\y`
   query). Bahasa is ASCII, so it relies entirely on the word list. A new
   region/topic whose headlines use different vocabulary will be MISSED until you
   add its distinctive words.
   **Why:** West Papua conflict headlines ("Konflik bersenjata di Tanah Papua…")
   carried none of the original function words (yang/dengan/untuk…), so they were
   never selected and shipped raw.
   **How to apply:** when a topic shows untranslated foreign titles, replay the
   candidate `~*` query with new markers before assuming the LLM failed. Only add
   words that are distinctly the source language — never an English word — or you
   will wrongly rewrite genuine English headlines.

2. **The OpenAI integration must be provisioned.** The pass is a no-op (caught,
   logged, falls back to raw) unless `AI_INTEGRATIONS_OPENAI_*` env vars are set
   (provision once via `setupReplitAIIntegrations` — covers dev + deployment).
   Uses `gpt-4o-mini`, bounded per run, bills to Replit credits.
   **How to apply:** if titles still aren't translating after markers are right,
   check the integration is provisioned — the failure is silent by design.
