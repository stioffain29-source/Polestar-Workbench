---
name: Shared country-report engine (@workspace/country-engine)
description: One validated pipeline for ALL country reports — canonical events, exclusions, confidence gate, approved narrative, fail-closed quality gate.
---

# Shared country-report engine

`@workspace/country-engine` is the ONE pipeline behind every Pole Star country report (owner's 38-section brief lives in attached_assets). Pure TS, zero runtime deps, so the same code runs in browser, api-server and jest.

**Rules that must hold:**
- Articles ≠ incidents: exclusions are STORED with reasons and never rendered as Low filler. Confidence gate 85/70/50; held rows go to the owner review panel; analyst overrides re-run the engine and are authoritative (audit-logged).
- Section TEXT comes only from the engine's approved narrative structures (word caps, approved recommendations menu, trend wording only with prior-period data). The §30 banned-phrase list is enforced by the fail-closed quality gate, which blocks Download PDF. **Why:** owner rejected the old template prose wholesale.
- The generic AI prose never auto-overlays engine text; only an EXPLICIT analyst edit may override a section, and the gate is RE-RUN over the final effective narrative so what renders/exports is what was validated.
- Banned phrases hide outside the engine too (theme-synthesis / operating-risk / escalation-indicator templates) — verify with a real headless PDF, pdftotext + banned-phrase scan, not just unit tests.
- Event titles entering prose must be naturalised (no shouty wire headlines) and never say "at <Country>"; Country-only/Unknown precision rows get no location clause and are never plotted.

**How to apply:**
- Duplicate grouping is date-bucketed; do NOT revert to a plain pairwise scan — an ~18k-row country window hangs the boot reprocess for many minutes, bucketed it finishes.
- Prod reprocess arrives via a marker-gated boot migration; the marker key embeds COUNTRY_ENGINE_RULE_VERSION (lib/country-engine config), so bump that constant whenever gate/classification/dedupe rules change and EVERY environment re-runs all slugs on the next boot. The whole-run marker is written ONLY when every slug succeeds (per-slug resume markers survive SIGTERM), so partial failures retry on the next boot (engine runs are idempotent). Additionally the ingest scheduler re-runs the engine for ALL slugs after every successful scheduled ingest, so persisted review queues track fresh incidents without a boot.
- Legacy free-form prose builders are DELETED (BLUF/Exec/Outlook/Polestar/recommended-actions/keyDevelopments/whatMatters/customerRelevance); the engine block in the dataset builder is the SOLE author of those sections. The rendered NON-engine surfaces that survive (assessed-theme paragraphs → incidentThemesOverride, operating-risk priorities, watchlist lines) must themselves stay banned-phrase-clean — the §30 list applies to them too, and the headless pdftotext scan is the check that catches leaks there.
- Large held/review queues on high-volume countries are expected data reality (the gate holds low-confidence rows), not a bug; tune deliberately via overrides or thresholds.

## §33 gate: window is a REPORTING window
- `event_within_window` must not fail-close on an event whose eventDate falls outside the window while SOME publicationDate is inside it (fresh reporting of an earlier occurrence, or an advisory dated past the window end like "flooding until 31 July") — that class is a WARNING; only no-in-window-publication is critical. **Why:** the briefs deliberately keep such items (occurredOutOfWindow, both dates stated); the old strictly-occurred check fail-closed 5 of 6 theatres on live data while PNG passed only by luck.
- Repeatable proof: `bash artifacts/workbench/scripts/verifyCountryBriefs.sh` sweeps ALL supported COUNTRY_SLUGs headlessly and asserts gate passed + no §30 banned phrase in pdftotext + no §16 trend words when hasPriorData=false (the exporter's `[countryGate]` log line carries hasPriorData).

## Assessed-meaning layer (analysis, not incident list)
- All "what this means" synthesis lives in `lib/country-engine/src/narrative.ts` (CATEGORY_IMPLICATIONS, repeatSubLocations, harmPhrase, trajectorySentence). Enrich prose THERE — preview==PDF parity is free because the engine narrative is the sole author.
- Top-3 tiles show the engine's assessed sentence via the dataset remap in pngReportDataset (engine businessSentence spliced into the card's businessImpact); the card components themselves were not changed.
- Any comparative/trajectory sentence MUST be built only when priorPeriodEvents != null (§16 trend gate); non-gated sentences must avoid TREND_WORDS ("sustained"/"renewed"/"reduced concern" are safe substitutes for "continues"/"further"/"easing").
- Severity words in prose are gate-checked case-sensitively against stored severities of the claim's supporting events — use lowercase descriptors ("higher-severity", "casualty-bearing") to stay safe.
- Headless exporter now logs `[countryGate] <country>: passed=...` — the quick live-data proof that the §33 gate still passes.
