# Phase 2 — Prioritised fix backlog

**Polestar Workbench · Ingestion & Report Quality**

| Field | Value |
| --- | --- |
| Plan date | 2026-08-26 |
| Phase 1 audit | [docs/phase-1-baseline-audit/](../phase-1-baseline-audit/README.md) |
| Production URL | https://document-asset-manager-stioffain29.replit.app/ |
| Flashpoint issue date (audit window) | 2026-05-31 |
| Principle | Pipeline-level fixes only; **no coding until this backlog is agreed** |

---

## 1. Executive summary

Phase 1 live prod audit (180-day snapshot, issue date 2026-05-31) shows slop and signal-loss at **three distinct layers**:

1. **Relevance** — homonym excludes work for motorsport/finance rally (208+ flashpoint homonym drops), but diplomatic/process “protest” rows and syndicated foreign headlines still pass.
2. **Report selector** — Flashpoint funnel is the largest pain: **528 relevance-kept → 8 report rows**; 25+ genuine protest rows tagged **FN** at `selectFlashpointUsable` (weak-operational / unknown cut).
3. **Country render gate** — Indonesia brief admits foreign-subject rows (earthquakes abroad, foreign sports riots, Bahasa Yemen/Houthi headlines) that relevance does not filter.

This backlog ranks **17 pipeline fixes** (12 P1–P2, 5 P3/deferred). Default order prioritises **stakeholder-visible credibility** (Flashpoint counts/prose, Cargo slop, country brief geography) over hygiene backfills and dead-code cleanup.

**Golden rule (all relevance/classifier items):**

> Relevance/classifier change → bump `RELEVANCE_RULE_VERSION` in `lib/relevance/src/evaluate.ts` → boot backfill re-cleans prod

Render-only country gates and feed additions do **not** require a version bump.

---

## 2. Prioritisation method

Each item scored on three axes (1 = low, 5 = high):

| Axis | Meaning |
| --- | --- |
| **Impact** | Credibility to stakeholder if unfixed |
| **Effort** | Engineering days (1 ≈ 0.5d, 3 ≈ 1–2d, 5 ≈ 3+d) |
| **Risk** | Signal loss if fix is too aggressive |

**Priority tier** = Impact-first, then lower Effort, then lower Risk. Tiers:

- **P1** — Must fix before next stakeholder report cycle
- **P2** — Same sprint tranche; may parallelise after P1 starts
- **P3** — Scheduled after core credibility fixes; lower urgency

---

## 3. Ranked backlog (summary)

| Rank | ID | Title | Tier | Owner | Effort | Impact | Risk |
| ---: | --- | --- | --- | --- | ---: | ---: | ---: |
| 1 | FP-02 | Flashpoint selector FN recovery (`selectFlashpointUsable`) | P1 | Report pipeline | 3 | 5 | 3 |
| 2 | FP-01 | Flashpoint relevance homonym + diplomatic slop | P1 | `@workspace/relevance` | 2 | 5 | 2 |
| 3 | FP-03 | Flashpoint count/prose/ Fast Facts parity proof | P1 | Report pipeline | 2 | 5 | 1 |
| 4 | CG-01 | Cargo slop ingest + display gate coupling | P1 | `@workspace/relevance` + cargo | 2 | 4 | 2 |
| 5 | CB-01 | Country brief foreign-subject gate (shared engine) | P1 | `@workspace/country-engine` | 3 | 4 | 2 |
| 6 | CG-02 | Cargo masthead → country mis-tag at ingest | P2 | Ingest classify | 2 | 3 | 2 |
| 7 | TC-01 | Thin-content topics — ReportPack + classifier coupling | P2 | Report prose | 3 | 4 | 2 |
| 8 | TC-02 | “Data quality issue” Fast Fact — classifier buckets + plural regex | P2 | Report pipeline | 2 | 3 | 2 |
| 9 | CB-02 | Country brief opinion/editorial banned phrases | P2 | `@workspace/country-engine` | 2 | 3 | 1 |
| 10 | HY-01 | Geocode masthead pollution | P2 | Ingest geocode | 3 | 3 | 2 |
| 11 | HY-02 | Unknown country on region feeds (`COUNTRY_ALIASES`) | P2 | Ingest classify | 2 | 3 | 2 |
| 12 | SOC-01 | Social promote corroboration guard | P2 | Ingest social | 2 | 3 | 3 |
| 13 | SH-01 | Shipping off-region syndication review | P3 | `@workspace/relevance` | 2 | 2 | 2 |
| 14 | CF-01 | Conflict Watch secondary logic review | P3 | Report pipeline | 2 | 2 | 2 |
| 15 | PV-01 | Preview ≠ PDF shared-builder audit | P3 | Report export | 2 | 3 | 1 |
| 16 | ST-01 | Stale prose fingerprint invalidation | P3 | Report prose | 2 | 2 | 1 |
| 17 | DC-01 | Dead code cleanup (fuel legacy, Jakarta builders) | P3 | Maintenance | 3 | 1 | 1 |

---

## 4. Detailed backlog items

### FP-02 — Flashpoint selector FN recovery (Rank 1, P1)

**Problem:** Live audit: 528 relevance-kept flashpoint+protests rows → **8 final report rows**. Selector stage drops 25+ rows tagged **FN** — genuine Nepal Gen Z protests, Dhaka violence, Tokyo anti-war rallies, Manila labour rallies — with reason `selectFlashpointUsable (weak-operational)` or `unknown`.

**Approach:**

- Tighten **weak-operational** heuristics: do not drop rows with strong public-order cues (protest, crackdown, clash, arrest over unrest, Gen Z, sit-in with campus anchor).
- Preserve precision-first homonym excludes at relevance layer (do not weaken motorsport/finance patterns).
- Single selector remains authority: `selectFlashpointUsable` for counts, tables, charts, prose.

**Verify:** `diagnoseFunnel.ts`, `proveFlashpointSelection.ts`, replay on issue date 2026-05-31; target **15–40** usable rows (not 8) without re-admitting WRC Rally Japan slop.

**Acceptance criteria:**

- [ ] FN sample set from [ingestion audit §4](../phase-1-baseline-audit/ingestion-audit-kept-vs-dropped.md) — Nepal/Bangladesh/Philippines protest rows appear in final report set
- [ ] No new FP from motorsport/finance homonym class in replay
- [ ] KPI count = Activism + Unrest table rows = prose incident references (parity tests green)
- [ ] `RELEVANCE_RULE_VERSION` unchanged (selector-only)

**Owner:** Report pipeline dev  
**Effort:** 3 (1–2 days) · **Impact:** 5 · **Risk:** 3

---

### FP-01 — Flashpoint relevance homonym + diplomatic slop (Rank 2, P1)

**Problem:** Relevance keeps diplomatic/process noise (“lodges protest with High Commission”, “lawyer urges UN to retract report”) and syndicated foreign policy rows. Top drop reason for false negatives at relevance: **119 rows** — “ambiguous token (rally/strike) without public-order cue” — includes some legitimate Tokyo rallies dropped before selector.

**Approach:**

- Add tightly bound **FLASHPOINT_EXCLUDE** patterns for diplomatic/interstate “protest” and legal-process headlines (precision-first).
- Expand **public-order KEEP cues** for “rally/strike” disambiguation (e.g. `against`, `demands`, `clash`, `crackdown`) — coordinate with FP-02 so relevance + selector do not double-penalise.
- Bump `RELEVANCE_RULE_VERSION`; boot backfill.

**Verify:** `replayFlashpointRelevance.ts`, `auditLiveRelevance.ts` over full 180-day prod snapshot.

**Acceptance criteria:**

- [ ] Diplomatic “file/lodge protest” rows dropped at relevance
- [ ] Tokyo anti-government rally rows **kept** at relevance (not dropped as ambiguous token)
- [ ] Version bump + backfill marker applied; replay delta documented
- [ ] No regression on motorsport/finance homonym excludes (208 existing drops preserved)

**Owner:** `@workspace/relevance` dev  
**Effort:** 2 · **Impact:** 5 · **Risk:** 2

---

### FP-03 — Flashpoint count / prose / Fast Facts parity proof (Rank 3, P1)

**Problem:** Historical stakeholder flags: KPI count ≠ executive prose ≠ table rows. Code-traced map shows single selector by design post-refactor — **must be proven on live data**, not assumed.

**Approach:**

- Run `proveFlashpointSelection.ts` and extend parity unit tests for KPI, charts, Fast Facts, prose sections.
- Fix any remaining divergent code paths (e.g. Fast Facts using wider window than dataset builder).

**Verify:** `proveFlashpointSelection.ts`, `dumpFlashpointDataset.ts`, headless PDF text extract for one issue date.

**Acceptance criteria:**

- [ ] Automated proof: one enriched set feeds all Flashpoint surfaces
- [ ] No section references incidents outside `selectFlashpointUsable().enriched`
- [ ] Steve’s “wrong-count” template example (if provided) resolved or explained

**Owner:** Report pipeline dev  
**Effort:** 2 · **Impact:** 5 · **Risk:** 1

---

### CG-01 — Cargo slop ingest + display gate coupling (Rank 4, P1)

**Problem:** Cargo slop split across `cargoSlop.ts` (relevance) and `cargoAnalysis.ts` (display scope). Fixing one without the other causes publish failures or visible US trade-press / aggregate-loss commentary. Live audit: 43% drop rate at relevance; scope gate drops generic warehouse theft correctly but Unknown-country rows persist.

**Approach:**

- Mirror any new exclude in **both** `CARGO_SLOP_EXCLUDE` and `isCargoInScope` / `hasGenuineCargo`.
- Bump `RELEVANCE_RULE_VERSION` for relevance-side changes.
- Extend excludes for FreightWaves-style commentary already in catalog.

**Verify:** `cargoScopeCheck.ts`, `cargo-report-validation-gate` tests, `auditReports.ts`.

**Acceptance criteria:**

- [ ] “Cargo theft costs $18M/day” and “Safer Transport Act advances” dropped at relevance **and** scope
- [ ] Genuine transit-hijack / Bahasa cargo theft rows still kept
- [ ] 10-check validation gate passes on fixed issue date PDF
- [ ] Kept/dropped replay delta attached to Phase 4 proof pack

**Owner:** `@workspace/relevance` + cargo dev  
**Effort:** 2 · **Impact:** 4 · **Risk:** 2

---

### CB-01 — Country brief foreign-subject gate (Rank 5, P1)

**Problem:** Indonesia brief render path admits foreign earthquakes, foreign sports riots, Bahasa Yemen/Houthi headlines — geography guard is render-time (`isForeignSubjectForIndonesia`), not relevance. High stakeholder expectation of pipeline fix, not per-theatre patches.

**Approach:**

- Extend `INDO_FOREIGN_SUBJECT_RE` and shared `@workspace/country-engine` foreign-subject patterns for Bahasa theatre tokens (`Yaman`, `Houthi`, etc.).
- Apply same engine pattern to PNG, West Papua, Thailand, Philippines configs — **no duplicate one-off filters**.
- Render gate only — no `RELEVANCE_RULE_VERSION` bump.

**Verify:** `countryReportData.ts`, QA workflow `country-brief-sweep`, replay `isCountryRelevant` over live rows.

**Acceptance criteria:**

- [ ] FP samples from audit (Japan vs Sweden riot, Turkey earthquake, Houthi attack) excluded from Indonesia brief
- [ ] Genuine domestic rows with foreign nationals kept (dominance test)
- [ ] `country-brief-sweep` green for all six briefs
- [ ] Same guard logic referenced in logic map — not duplicated in JSX

**Owner:** `@workspace/country-engine` dev  
**Effort:** 3 · **Impact:** 4 · **Risk:** 2

---

### CG-02 — Cargo masthead → country mis-tag (Rank 6, P2)

**Problem:** SCMP and similar mastheads mis-tag `country=China` for Singapore Strait piracy — slop enters monitor before scope gate.

**Approach:** Strip or override masthead-derived country in ingest `classifyFeedItem` when body location contradicts masthead; expand gazetteer hints.

**Verify:** Spot-check cargo monitor rows; ingest unit tests if present.

**Acceptance criteria:**

- [ ] SCMP maritime incident rows get APAC location country, not masthead default
- [ ] No version bump unless relevance rules change

**Owner:** Ingest classify dev · **Effort:** 2 · **Impact:** 3 · **Risk:** 2

---

### TC-01 — Thin-content topics — ReportPack + classifier (Rank 7, P2)

**Problem:** Energy / Fertiliser / Data Centres reports produce shallow prose and “Multiple … incident types” Fast Facts when classifier dumps plurality into `"Other"` and ReportPack returns single sentences.

**Approach:** Fix **both** `draftReportProse.ts` packs **and** `incidentClassifier.ts` buckets together (see `.agents/memory/report-thin-content-diagnosis.md`).

**Verify:** Classifier run on relevance-filtered + windowed rows only; compare section depth to Shipping/Fuel templates.

**Acceptance criteria:**

- [ ] No “Data quality issue” apology on issue dates with ≥3 distinct windowed incidents
- [ ] Executive summary ≥2 paragraphs when incident count ≥5
- [ ] Classifier verified on post-relevance window, not raw topic table

**Owner:** Report prose dev · **Effort:** 3 · **Impact:** 4 · **Risk:** 2

---

### TC-02 — “Data quality issue” Fast Fact — plural regex (Rank 8, P2)

**Problem:** Classifier uses `outage\b` missing plural `outages` → false “Other” plurality → Fast Fact apology.

**Approach:** Audit classifier token regexes; use plural-aware patterns (`outages?`); broaden buckets for energy/fertiliser/data-centre incident types.

**Verify:** Fast Facts unit tests; spot-check Energy issue dates.

**Acceptance criteria:**

- [ ] Plural forms match singular for all outage/disruption tokens
- [ ] Fast Facts unit tests cover regression cases
- [ ] Bump classifier version if stored classifications affected

**Owner:** Report pipeline dev · **Effort:** 2 · **Impact:** 3 · **Risk:** 2

---

### CB-02 — Country brief opinion / editorial leak (Rank 9, P2)

**Problem:** Opinion and editorial content leaks into operational briefs — banned phrase guard incomplete.

**Approach:** Extend `country-engine` banned phrases; ensure operating-risk prose path respects same list.

**Verify:** `country-brief-sweep` workflow.

**Acceptance criteria:**

- [ ] Known editorial patterns from slop catalog dropped
- [ ] No false drops of factual reporting with “analysis” in source name only

**Owner:** `@workspace/country-engine` dev · **Effort:** 2 · **Impact:** 3 · **Risk:** 1

---

### HY-01 — Geocode masthead pollution (Rank 10, P2)

**Problem:** Source masthead leaks as `location` in ingest geocode lookup — poisons map and country attribution.

**Approach:** Expand gazetteer deny-list or theatre bounding-box clamp; marker-gated `backfill:geocode` dry-run.

**Verify:** `backfill:geocode` dry-run; sample Unknown/ wrong-city rows from audit.

**Acceptance criteria:**

- [ ] Masthead-as-location FP rows corrected in backfill dry-run
- [ ] No manual per-row patches in report builders

**Owner:** Ingest geocode dev · **Effort:** 3 · **Impact:** 3 · **Risk:** 2

---

### HY-02 — Unknown country on region feeds (Rank 11, P2)

**Problem:** Subnational Google News items stored with `country='Unknown'` — weakens filters and brief matching.

**Approach:** Expand `COUNTRY_ALIASES`; marker-gated backfill (Unknown-only).

**Verify:** Spot-check Nepal/Bangladesh/Philippines region feeds post-backfill.

**Acceptance criteria:**

- [ ] ≥80% of previously Unknown subnational feed rows resolve to expected country
- [ ] Backfill idempotent; boot migration marker recorded

**Owner:** Ingest classify dev · **Effort:** 2 · **Impact:** 3 · **Risk:** 2

---

### SOC-01 — Social promote corroboration guard (Rank 12, P2)

**Problem:** Facebook/Instagram/KAMMI promote pass mints incidents without corroboration.

**Approach:** Demote-only guard — require second source or ReliefWeb corroboration before promote to incident.

**Verify:** Social topic row counts before/after; no inflate of flashpoint/cargo counts.

**Acceptance criteria:**

- [ ] Uncorroborated social rows remain demoted or needs-review
- [ ] Document intentional residual noise if any promote path kept

**Owner:** Ingest social dev · **Effort:** 2 · **Impact:** 3 · **Risk:** 3

---

### SH-01 — Shipping off-region syndication (Rank 13, P3)

**Problem:** Off-region syndicated maritime news passes relevance (46% drop rate — many “no required topic phrase”).

**Approach:** Review shipping excludes in `topicRelevance.ts`; precision-first APAC anchor requirement.

**Verify:** `auditLiveRelevance.ts` shipping section; confirm monitor dedup ≠ report dedup unchanged.

**Owner:** `@workspace/relevance` dev · **Effort:** 2 · **Impact:** 2 · **Risk:** 2

---

### CF-01 — Conflict Watch secondary logic review (Rank 14, P3)

**Problem:** Medium priority — LLM clustering and event-led prose less flagged in audit but worth parity check.

**Approach:** Trace `buildConflictReportDataset`; confirm counts/prose alignment; no code change unless audit finds divergence.

**Verify:** `topicReportData.ts`, `auditReports.ts`.

**Owner:** Report pipeline dev · **Effort:** 2 · **Impact:** 2 · **Risk:** 2

---

### PV-01 — Preview ≠ PDF shared-builder audit (Rank 15, P3)

**Problem:** Invariant says preview == PDF — verify no drift on country briefs and topic reports after other fixes.

**Approach:** Headless PDF harness; fix shared builder once if drift found — never patch preview or PDF alone.

**Verify:** `exportReportPdfHeadless.ts`, `pdf-fonts` / `topic-font-audit` workflows.

**Owner:** Report export dev · **Effort:** 2 · **Impact:** 3 · **Risk:** 1

---

### ST-01 — Stale prose fingerprint invalidation (Rank 16, P3)

**Problem:** Cached prose can reference prior issue window after data refresh.

**Approach:** Fingerprint cache invalidation; issue-date window clamp in prose resolution path.

**Verify:** Stale-prose guard tests if present; manual re-export same issue date after ingest.

**Owner:** Report prose dev · **Effort:** 2 · **Impact:** 2 · **Risk:** 1

---

### DC-01 — Dead code cleanup (Rank 17, P3)

**Problem:** Legacy fuel prose paths, unused Jakarta builders add maintenance burden — lower urgency per handover §11.

**Approach:** Remove `fuelReportFacts.ts` / `fuelReportConsistency.ts` dead paths; strip unused Jakarta prose builders after country engine hardening.

**Verify:** `pnpm test`, `pnpm typecheck` green.

**Owner:** Maintenance · **Effort:** 3 · **Impact:** 1 · **Risk:** 1

---

## 5. Fix-type cross-reference

### 5.1 Ingestion fixes (pipeline-level)

| Fix type | Backlog IDs | Version bump? |
| --- | --- | --- |
| New exclude / keep rule | FP-01, CG-01, SH-01 | Yes |
| Cargo slop mirror | CG-01 | Yes |
| Geocode masthead | HY-01 | No (backfill) |
| Unknown country | HY-02 | No (alias + backfill) |
| Feed coverage gap | _(deferred — no audit blocker)_ | No |
| Masthead country mis-tag | CG-02 | No |
| Social promote guard | SOC-01 | No |

### 5.2 Report logic fixes (pipeline-level)

| Fix type | Backlog IDs |
| --- | --- |
| Count ≠ prose contradiction | FP-02, FP-03 |
| Thin content | TC-01 |
| “Data quality issue” Fast Fact | TC-02 |
| Country brief noise | CB-01, CB-02 |
| Preview ≠ PDF | PV-01 |
| Stale prose | ST-01 |

---

## 6. Phase 3 implementation order (default sprint)

Work **top-down**; do not start lower ranks until P1 acceptance criteria are met or explicitly deferred with Steve.

```
Week 1 (P1):  FP-02 → FP-01 → FP-03 → CG-01 → CB-01
Week 2 (P2):  CG-02 → TC-01 → TC-02 → CB-02 → HY-01 → HY-02 → SOC-01
Later (P3):   SH-01 → CF-01 → PV-01 → ST-01 → DC-01
```

**Parallelisation:** FP-01 (relevance) and FP-02 (selector) may run in parallel if coordination note shared — public-order cue changes must be reviewed together to avoid double-drop.

---

## 7. Deferred / out of scope for Phase 3

| Item | Rationale |
| --- | --- |
| Feed coverage gap (Sri Lanka cargo, new Google News editions) | Coverage expansion — track in Source Health; not a classifier fix |
| US MAGA / Trump rally rows | Accepted tradeoff — geo filter in ingest classify, not relevance lib |
| Frontend bundle code-splitting | Optimisation — handover §11 |
| Steve PDF examples (1.4) | Backlog evidence-based; re-rank when examples arrive |

---

## 8. Stakeholder sign-off

| Reviewer | Role | Date | Agreed priority? |
| --- | --- | --- | --- |
| Steve Ward | Stakeholder | | ☐ |
| Pipeline dev lead | Implementation | | ☐ |

**Questions for Steve:**

1. Is **Flashpoint selector recovery** (528→8 funnel) the top pain vs relevance slop?
2. Accept **P3 deferral** of shipping/conflict/dead-code until P1 green?
3. Provide 3–5 PDF examples to validate FP-03 / TC-01 acceptance criteria?

---

## 9. Regenerating this document

```bash
python scripts/generate_phase2_fix_plan_docx.py
```

*Synthesised from Phase 1 audit outputs · 2026-08-26*
