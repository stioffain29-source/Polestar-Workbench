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
   will wrongly rewrite genuine English headlines. ALSO avoid place-name
   collisions: "nilai" (Indonesian "value") is a Malaysian town, so it was
   omitted — the West Papua culture headline was still caught by the unambiguous
   "pergeseran" / "adat" / "budaya". Prefer several distinct words over one
   ambiguous one.

2. **The OpenAI integration must be provisioned.** The pass is a no-op (caught,
   logged, falls back to raw) unless `AI_INTEGRATIONS_OPENAI_*` env vars are set
   (provision once via `setupReplitAIIntegrations` — covers dev + deployment).
   Uses `gpt-4o-mini`, bounded per run, bills to Replit credits.
   **How to apply:** if titles still aren't translating after markers are right,
   check the integration is provisioned — the failure is silent by design.

## Sibling: KAMMI social-watch caption translation (UNGATED — translate-all)

`social_watch_items.caption` (Bahasa KAMMI post captions) is translated in
`lib/ingest/src/captionTranslate.ts` → nullable `caption_en` column; the Protests
`SocialWatchGroup` panel prefers `caption_en` and falls back to `caption`.
**CRITICAL DIVERGENCE from the title path:** the caption pass DELIBERATELY DROPPED
the marker-word / non-Latin gate. Its candidate query is now just
`caption_en IS NULL AND caption IS NOT NULL` — every not-yet-processed caption is
sent to the model, which returns already-English captions unchanged so they leave
the candidate set. Do NOT re-add `INDONESIAN_MARKER_WORDS`/`NON_LATIN_CLASS` here.
**Why:** the marker gate is structurally leaky (rule 1 above) — genuinely-Bahasa
captions that happened to contain no listed function word shipped RAW, which is
exactly the recurring "still shows bahasa in prod" complaint. The KAMMI panel is
tiny + single-source, so translating everything costs little and closes the leak
for good; the high-volume title path keeps its gate to avoid spending on English.
**Long-caption timeout:** captions run 1,000+ chars (multi-paragraph event
posts), so the caption path uses a 60s request timeout, NOT the title path's
20s. A reasoning model aborts the longest captions at 20s on every attempt and
they ship raw — the last few stubborn rows are always the longest. If new raw
captions appear, suspect the timeout before the gate.
**Frontend "Translated from Bahasa" marker:** compares a lowercase letters+digits
SKELETON (strip emoji, punctuation and whitespace; keep only letters+digits) of
`caption` vs `caption_en`, NOT raw strings — the model tidies whitespace AND drops
decorative emoji even from English round-trips, so a raw compare falsely flags
English rows as translated.
**Prod self-heal:** prod DB is a read-only replica; only the deployment runtime
writes `caption_en`. Fixes reach prod only after a REPUBLISH — the boot
`runTitleTranslationOnce` pass (and `runIngestOnce`) then drains it. Runs (commit)
inside both, each in its own try so an LLM failure can't abort ingest. Idempotent:
UPDATE re-guards `AND caption_en IS NULL`; the edit route sets `caption_en=null`
so an edited caption re-translates. CLI: `translate-social-captions` (dry-run
default; dry-run still SPENDS tokens, so don't run it alongside the server pass).
Needs OpenAI provisioned (`AI_INTEGRATIONS_OPENAI_*`) or it no-ops. The separate
OSINT `social_raw` panel is a DIFFERENT surface and is intentionally NOT translated.
