---
name: Country-report AI prose engine
description: How country-brief narrative prose is AI-generated, grounded, cached by fingerprint, edited, and kept preview==PDF; plus the fingerprint/prompt lockstep rule.
---

# Country-report AI prose

The narrative sections of a country brief (executiveSummary, situation, whatHappened, whatMatters, implications[], watchNext[], polestarView) are AI-generated from the live window incidents, NOT the old template. The template is a graceful fallback when the LLM is unavailable. Server lib: `artifacts/api-server/src/lib/countryProse.ts`; routes `POST /countries/:slug/prose` (generate, fingerprint-cached, `force` bypass) + `PUT /countries/:slug/prose/edit` (analyst override, bound to fingerprint → 409 if stale); cache table `country_report_prose` (one row per slug). Client wiring in `artifacts/workbench/src/pages/CountryReport.tsx` auto-generates on view, renders serverProse ?? template fallback, Redraft button = force.

## Fingerprint ⇄ prompt lockstep (the rule that bit us)

**Rule:** the cache fingerprint MUST hash exactly the same canonical, capped incident set the model actually receives — same cap (`MAX_PROSE_INCIDENTS`), same fields, same canonicalisation. Both `computeProseFingerprint` and `incidentBlock` derive from one shared `canonicalIncidents()` helper.

**Why:** originally the fingerprint hashed the FULL incident list while the prompt only sent `slice(0,60)`, so a caller could append filler past index 60 to flip the key and force repeat LLM spend for identical output (denial-of-wallet on a PUBLIC workbench). Separately the identity hashed only title/date/severity/location — omitting summary/source/country/topic, all of which the prompt renders — so a summary correction left cached prose describing text the incident no longer held ("never stale" was a lie). Fix: identity now folds in summary/source/country/topic; both paths cap+canonicalise identically; `MAX_PROSE_INCIDENTS_ACCEPTED` (1000) rejects oversized bodies with 400 before any work.

**How to apply:** any new field added to the prompt body MUST also enter `incidentIdentity`, or stale cache hits return. Bump `PROSE_PROMPT_VERSION` whenever the prompt/section contract changes so existing rows regenerate. Reordering incidents must NOT change the fingerprint (canonical sort guarantees this — verified).

## PNG variant leaves 4 sections empty BY DESIGN — "Not populated" = stale-bundle skew, not a bug

The PNG country brief uses prose variant `"png"` (vs `"country"`). The `png` variant DELIBERATELY returns only `executiveSummary` + `outlook`; `situation`/`whatHappened`/`whatMatters`/`implications` are length-0. Those four come from the deterministic `PngCountryReportBody` dataset (Top 3 / per-location / national activity), NOT the AI prose. The generic country layout renders those four FROM prose; the PNG layout renders them from the dataset. `isPng` (`acceptedCountryTokens(country.name).includes("papua new guinea")` in `CountryReport.tsx`) routes BOTH the layout choice AND the variant sent to the prose route (client-decided `proseVariant`).

**Symptom seen once:** the PUBLISHED PNG report showed "Not populated" for those four sections while Exec Summary + Fast Facts were correct. Root cause was NOT code — it was a stale cached BROWSER bundle predating `PngCountryReportBody`: the old bundle rendered the generic layout (`isPng` effectively false there) against the NEW server's `png`-variant prose → empty sections. Deployed code was correct (served prod bundle contained the PNG-body literals; prod had `png`-variant prose, which only an `isPng=true` client can produce; dev rendered the PNG body from identical data). **Why it can only be skew:** `isPng` couples the layout and the variant, so in any SINGLE consistent bundle the generic layout never meets `png` prose. Resolution = hard refresh / fresh bundle; no repo change fixes an already-cached client.

**How to apply:** if someone reports the published PNG country report showing "Not populated", first verify the served prod bundle (`getDeploymentInfo().primaryUrl`, curl `--compressed` the hashed `/assets/*.js`, grep `TOP 3 INCIDENTS THIS WEEK`) and whether prod prose is `png`-variant before touching code — the likely fix is the user reloading, not an edit.

## Constraints the prompt enforces (brand rules)

No fabrication (window facts only from supplied incidents; quiet window = limited reporting, never "calm"); NO numeric incident/record counts in prose; five-tier vocab only (Insignificant/Low/Moderate/High/Extreme); no mention of internal tooling/pipelines/geocoding/dedup; each section a distinct job (no cross-section repetition); British English. Preview==PDF is free here because the country PDF rasterises the on-screen DOM (`exportElementToPdf`), so wiring prose into the React preview covers both.
