---
name: Facebook OSINT slop guard + caption translation
description: Precision-first demote-only security-event guard over the theatre classifier, and the caption_en translation column, for facebook_osint social_raw rows.
---

# Facebook OSINT slop guard + caption translation

The theatre classifier assigns a security category from a broad vocabulary, so
community chatter (lost-property notices, eviction gripes, governance press
releases) sometimes lands in a real security category and can even get
auto-promoted into an incident. A precision-first SECOND gate fixes this.

## Security-event guard (pure, multilingual)
`hasSecurityEventSignal` / `isLikelyEnglish` / `applySecurityEventGuard` live in
`facebookOsintEligibility.ts` and are the ONE authority, wired at BOTH:
- ingest `classifyInScope` (facebookOsint.ts), and
- the reclassify maintenance pass (`facebookOsintReclassify.ts`).

**Rule:** demote a real category to "Other security" only when NEITHER the
caption NOR its translation carries a security-EVENT cue AND the text is
confidently readable (`captionEn` present OR `isLikelyEnglish(caption)`).

**Why:** STRICT no-fabrication — the guard may only DOWNGRADE, never up-rate; an
untranslated non-English caption we cannot read is left untouched, never demoted
on a guess. Cues are NFKC-folded so styled-glyph captions still match.

**How to apply:** adding a NEW theatre security category means you MUST add its
vocabulary to `SECURITY_EVENT_CUES` (English + Bahasa Indonesia + Tok Pisin) in
lockstep, or legitimate events in that category get silently demoted.

## caption_en translation column
`social_raw.caption_en` is a NULLABLE English translation of the original
caption (Bahasa/Tok Pisin). Display prefers `captionEn ?? caption`. Needs a
schema column AND an idempotent boot ALTER (prod DATABASE_URL is read-only from
the workspace).

## Reclassify maintenance pass
`runFacebookOsintReclassify({commit,maxTranslations=300})`, run via the
token-gated `POST /api/admin/social-reclassify` (dry-run default; `?mode=dry-run`,
`?maxTranslations=<n>`). Operator-triggered + advisory-locked like
tapa-promote / x-search — NOT in the scheduler. Scopes strictly to
`source_name='facebook_osint'` (never instagram_kammi).
- recompute mirrors the STORED `corroborated` flag into `deriveEligibility`;
  NEVER re-run `pickCorroboration` (self-match hazard against the row's own
  already-minted incident).
- un-promote is transactional: delete the incident ONLY when its
  `social_raw:<id>` marker matches this row; clear the back-link → pending_review.

**Gotcha:** dry-run performs REAL LLM translations (bounded by maxTranslations)
and discards them, so a dry-run→commit sequence pays translation cost twice.
Drain a large backlog with repeated `--commit` runs under the per-run cap.

**Narrow race (owner-only, seconds-wide, accepted):** the manual promote route
is NOT under the reclassify advisory lock, so a row promoted between the pass's
select and its demote write keeps its incident; a re-run won't clean it because
the category is by then already "Other security" (demoted=false).
