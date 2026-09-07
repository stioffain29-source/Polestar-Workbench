# Action Plan — Post Steve Sign-off (Sep 2026)

**Date:** 7 September 2026  
**Context:** Steve Ward confirmed priority order (Flashpoint selector first, then slop; parity across report surfaces; country geography; automated validation over manual PDF review).  
**Related docs:**

- [Ingestion & Report Quality Plan](./ingestion-report-quality-plan.md)
- [Phase 2 prioritised fix backlog](./phase-2-fix-plan/phase-2-prioritised-fix-backlog.md)
- [Phase 3 day-by-day plan](./phase-3-implementation-plan/phase-3-day-by-day-plan.md)
- [Phase 1 ingestion audit](./phase-1-baseline-audit/ingestion-audit-kept-vs-dropped.md)

---

## Confirmed scope (from Steve)

| Priority | What Steve wants | Backlog IDs |
| --- | --- | --- |
| **1** | Fix Flashpoint funnel **before** tightening slop rules | FP-02 → FP-03 → then FP-01 |
| **2** | One incident set for counts, tables, Fast Facts, prose | FP-03 |
| **3** | Country briefs = in-country events, not mention-of-country | CB-01 (+ CB-02 later) |
| **4** | Automated audit/validation — not manual PDF spotting | Phase 4 gates + proof pack |
| **5** | Phase 2 backlog with acceptance criteria | [phase-2-prioritised-fix-backlog.md](./phase-2-fix-plan/phase-2-prioritised-fix-backlog.md) |

**Hard rule:** Do **not** bump relevance/slop rules (FP-01) until FP-02 + FP-03 gates are green.

---

## Week 0 — Prep (1 day, before coding)

**Goal:** Lock baseline so every fix is measurable.

**One command (runs all steps below):**

```bash
pnpm --filter workbench run baseline:week0
```

Outputs → [`docs/phase-4-proof-pack/week0-baseline/`](./phase-4-proof-pack/week0-baseline/README.md)

**Prerequisite:** Add to `.env.local` (copy from [`.env.local.example`](../.env.local.example)):

- `PROD_DATABASE_URL` — prod Postgres connection string (preferred), **or**
- `PROD_SESSION_COOKIE` — `connect.sid=…` from logged-in Replit browser session

| # | Task | Command / output |
| --- | --- | --- |
| 0.1 | Export live prod snapshot | `pnpm --filter workbench run audit:export-snapshot` |
| 0.2 | Capture **before** Flashpoint funnel | `docs/phase-4-proof-pack/week0-baseline/flashpoint-funnel-2026-05-31.txt` |
| 0.3 | Capture **before** parity state | `docs/phase-4-proof-pack/week0-baseline/flashpoint-parity-2026-05-31.txt` |
| 0.4 | Export **before** headless PDFs | `flashpoint-before-*.pdf`, `cargo-watch-before.pdf`, `indonesia-brief-before.pdf` |
| 0.5 | Re-send Phase 2 doc to Steve | `python scripts/generate_phase2_fix_plan_docx.py` → attach DOCX |
| 0.6 | Log Steve's PDFs when they arrive | Tag each in [1.4 stakeholder template](./phase-1-baseline-audit/1.4-stakeholder-examples.md): slop / wrong-count / wrong-prose / wrong-country |

**Exit criteria:** Baseline recorded (528→8 funnel, 8 final rows, parity failures if any). Proof pack folder started.

---

## Sprint 1 — Flashpoint block (Days 1–3)

Steve's top item. Complete this block before anything else.

### Day 1 — FP-02: Flashpoint selector recovery

**File:** `artifacts/workbench/src/lib/flashpointReportDataset.ts` → `selectFlashpointUsable`

**Work:**

- [ ] Relax `weak-operational` drops when strong public-order cues exist (protest, crackdown, clash, Gen Z, sit-in, arrest-over-unrest)
- [ ] Do **not** touch relevance homonym excludes
- [ ] Add unit tests for FN samples: Nepal Gen Z, Dhaka violence, Tokyo anti-war, Manila labour

**Verify:**

```bash
ISSUE=2026-05-31 pnpm --filter workbench exec tsx scripts/diagnoseFunnel.ts
ISSUE=2026-05-31 pnpm --filter workbench exec tsx scripts/proveFlashpointSelection.ts
pnpm test -- flashpointReportDataset
```

**Acceptance (gate — do not proceed if fail):**

| Criterion | Target |
| --- | --- |
| Final usable rows (2026-05-31) | **15–40** (from 8) |
| Audit FN protests in final set | Nepal / Bangladesh / Philippines present |
| New motorsport/finance slop | **0** in replay |
| `RELEVANCE_RULE_VERSION` | Unchanged |

**Deliverable to Steve:** Short funnel summary (before/after counts + sample titles recovered).

---

### Day 2 — FP-03: Parity proof (same incident set everywhere)

**Work:**

- [ ] Extend `proveFlashpointSelection.ts` / `flashpointSelectionParity.test.ts`
- [ ] Confirm KPI = Activism + Unrest tables = charts = Fast Facts = prose
- [ ] Fix any divergent path (e.g. Fast Facts using a wider window)

**Acceptance:**

| Criterion | Target |
| --- | --- |
| Parity tests | Green |
| No section references incidents outside `selectFlashpointUsable().enriched` | Proven by script |
| Headless PDF spot-check | No count vs prose contradiction |

**Deliverable to Steve:** Flashpoint before/after PDF on issue date 2026-05-31 + parity test output.

---

### Day 3 — FP-01: Relevance slop (only after FP-02/03 green)

**Files:** `lib/relevance/src/topicRelevance.ts`, `evaluate.ts`

**Work:**

- [ ] Add diplomatic/process excludes ("file/lodge protest", legal-process headlines)
- [ ] Expand public-order KEEP cues for rally/strike disambiguation — **coordinate with FP-02** so no double-penalise
- [ ] Bump `RELEVANCE_RULE_VERSION` + boot backfill marker

**Acceptance:**

| Criterion | Target |
| --- | --- |
| Diplomatic protest rows | Dropped at relevance |
| Tokyo anti-government rallies | Kept at relevance |
| Motorsport homonym drops | No regression (~208 preserved) |
| Combined funnel (FP-01 + FP-02) | Still 15–40 usable |

**Deliverable to Steve:** Kept/dropped replay delta + deploy confirmation.

**Milestone message to Steve:** *"Flashpoint P1 block complete — selector recovered, parity proven, relevance slop tightened. Ready for your review on issue date 2026-05-31."*

---

## Sprint 2 — Cargo + Country (Days 4–5)

### Day 4 — CG-01: Cargo slop coupling

**Files:** `lib/relevance/src/cargoSlop.ts` + `artifacts/workbench/src/lib/cargoAnalysis.ts` (mirror both layers)

**Work:**

- [ ] Any new exclude in `CARGO_SLOP_EXCLUDE` mirrored in `isCargoInScope` / `hasGenuineCargo`
- [ ] Bump `RELEVANCE_RULE_VERSION` if relevance rules changed
- [ ] Update `cargo-report-validation-gate` tests

**Acceptance:**

- [ ] "$18M/day" commentary + "Safer Transport Act" dropped at relevance **and** scope
- [ ] Genuine transit-hijack / Bahasa cargo theft still kept
- [ ] 10-check `cargo-report-validation-gate` green

---

### Day 5 — CB-01: Country geography gate

**Files:** `lib/country-engine/` (shared engine, not per-theatre JSX patches)

**Work:**

- [ ] Extend `INDO_FOREIGN_SUBJECT_RE` + Bahasa theatre tokens (`Yaman`, `Houthi`, etc.)
- [ ] Apply same engine pattern to PNG, West Papua, Thailand, Philippines configs
- [ ] **No** `RELEVANCE_RULE_VERSION` bump (render gate only)

**Acceptance:**

- [ ] Foreign earthquake, foreign sports riot, Bahasa Yemen/Houthi → excluded from Indonesia brief
- [ ] Genuine domestic rows with foreign nationals still kept
- [ ] `country-brief-sweep` green for all six briefs

**Deliverable to Steve:** Indonesia brief before/after PDF + sweep results.

---

## Sprint 3 — P2 batch + validation prep (Days 6–7)

| Day | Items | Notes |
| --- | --- | --- |
| **6** | CG-02, TC-02, CB-02 | Masthead mis-tag, Fast Fact plural regex, editorial banned phrases |
| **7** | TC-01, HY-02 (start) | Thin-content ReportPack + classifier; Unknown country aliases |

**Defer to follow-on:** HY-01 (geocode), SOC-01 (social promote), all P3 items unless buffer allows.

---

## Phase 4 — Automated validation (Days 8–9)

Addresses Steve's requirement: *"audit and validation should catch this without me spotting it manually."*

### 4.1 Run automated QA gates (live prod)

```powershell
# With PROD_DATABASE_URL set
.\artifacts\workbench\scripts\runPhase41.ps1
```

Gates include:

- `pnpm test` + `pnpm typecheck`
- Flashpoint funnel + parity scripts
- `country-brief-sweep`
- Topic/country PDF font audits
- Optional: email summary via `sendValidationSummaryEmail.ts`

### 4.2 Proof pack (per fixed backlog item)

For each shipped item (FP-02, FP-03, FP-01, CG-01, CB-01):

| Artifact | Purpose |
| --- | --- |
| Before/after headless PDF | Visual proof |
| Funnel replay output | Quantified fix (528→N) |
| Kept/dropped diff | Ingestion changes |
| Parity test log | Counts = prose = tables |
| Steve's PDF mapped to stage | Regression fixture locked |

### 4.3 Stakeholder review

- [ ] Walk through proof pack on issue date **2026-05-31**
- [ ] Map any PDFs Steve sends → pipeline stage → acceptance criterion
- [ ] Agree closure per backlog item; document accepted residual noise

**Ongoing cadence (communicate to Steve):**

| Cadence | Action |
| --- | --- |
| Before each publish issue date | Run Phase 4.1 gates |
| Weekly | Spot-check Source Health + Flashpoint kept set |
| Quarterly | Full slop audit refresh (`runPhase1SlopAudit.ts`) |

---

## Steve's bad PDFs — how to use them

Use as **regression fixtures**, not primary QA:

1. Tag each example (slop-in / wrong-count / wrong-prose / wrong-country)
2. Map to pipeline stage (relevance → selector → classifier → prose)
3. Add to proof pack as "must pass" after fix
4. If audit should have caught it but didn't → add/extend a gate (parity test, funnel script, or validation workflow)

---

## Deliverables timeline (Upwork updates)

| When | What Steve gets |
| --- | --- |
| **Now** | Phase 2 backlog DOCX (acceptance criteria per item) |
| **End Sprint 1 (Day 3)** | Flashpoint proof: funnel 15–40, parity green, before/after PDF |
| **End Sprint 2 (Day 5)** | Cargo + Indonesia brief proof |
| **End Phase 4 (Day 9)** | Full proof pack + validation summary (PASSED/FAILED email) |
| **Ongoing** | Short Upwork updates when each P1 acceptance block clears |

---

## Risk controls

| Risk | Mitigation |
| --- | --- |
| FP-01 + FP-02 double-penalise real protests | Run combined funnel before deploy; sync public-order cues |
| Loosen selector → slop returns | Target 15–40 rows, not "open the floodgates"; replay homonym class |
| Cargo fix breaks validation gate | Mirror rules in both layers; run 10-check gate before sign-off |
| Steve still finds issues manually | Each PDF → new regression test or gate; don't rely on one-off patches |

---

## Per-fix checklist (copy per shipped item)

| Item | FP-02 | FP-03 | FP-01 | CG-01 | CB-01 |
| --- | --- | --- | --- | --- | --- |
| Change in shared lib (not preview/PDF duplicate) | ☐ | ☐ | ☐ | ☐ | ☐ |
| `RELEVANCE_RULE_VERSION` bumped if needed | n/a | n/a | ☐ | ☐ | n/a |
| Boot migration / marker-gated backfill | n/a | n/a | ☐ | ☐ | n/a |
| Unit / render tests updated | ☐ | ☐ | ☐ | ☐ | ☐ |
| Dry-run replay on live prod rows | ☐ | ☐ | ☐ | ☐ | ☐ |
| Preview == PDF verified | ☐ | ☐ | ☐ | ☐ | ☐ |

---

## Immediate next actions

1. **Run baseline capture** (Week 0 checklist) and save outputs for the proof pack
2. **Start FP-02** in `flashpointReportDataset.ts` — selector recovery only, no relevance changes
3. **Attach Phase 2 DOCX** to Upwork if not already sent; update Steve when FP-02 gate clears

---

## Key commands reference

```bash
# Snapshot + audit
pnpm --filter workbench run audit:export-snapshot
ISSUE=2026-05-31 pnpm --filter workbench run audit:ingestion-report

# Flashpoint
ISSUE=2026-05-31 pnpm --filter workbench exec tsx scripts/diagnoseFunnel.ts
ISSUE=2026-05-31 pnpm --filter workbench exec tsx scripts/proveFlashpointSelection.ts
pnpm --filter workbench exec tsx scripts/replayFlashpointRelevance.ts

# Cargo / country
pnpm --filter workbench exec tsx scripts/cargoScopeCheck.ts
pnpm --filter workbench exec tsx scripts/countryReportData.ts

# QA
pnpm test && pnpm typecheck
.\artifacts\workbench\scripts\runPhase41.ps1
```
