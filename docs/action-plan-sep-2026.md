# Action Plan — Commodity Reports Priority (Sep 2026)

**Date:** 7 September 2026  
**Context:** Steve Ward (7 Sep) — commodity-style reports are the priority (Flashpoint, Fuel Watch, Cargo, and similar topic reports). Country briefs are still wrong (Indonesia worst) but **secondary**. 24-hour view is tighter (good). GDELT re-subscription and Carto API are on Steve's side.  
**Related docs:**

- [Ingestion & Report Quality Plan](./ingestion-report-quality-plan.md)
- [Phase 2 prioritised fix backlog](./phase-2-fix-plan/phase-2-prioritised-fix-backlog.md)
- [Phase 3 day-by-day plan](./phase-3-implementation-plan/phase-3-day-by-day-plan.md)
- [Phase 1 ingestion audit](./phase-1-baseline-audit/ingestion-audit-kept-vs-dropped.md)

---

## Steve's latest feedback (7 Sep)

| Item | Status | Our action |
| --- | --- | --- |
| 24-hour view tighter | Positive — no change needed | Note in proof pack; don't regress |
| GDELT re-subscription | Steve's side | Monitor Source Health only |
| Carto maps API | Steve rectified | No dev work |
| **Commodity-style reports** | **Main concern** | Sprint 1–3 focus (see below) |
| Country briefs (Indonesia worst) | Known issue, lower priority | Sprint 4 after commodity block |

---

## Confirmed scope (from Steve)

| Priority | What Steve wants | Backlog IDs |
| --- | --- | --- |
| **1** | **Commodity reports first** — Flashpoint, Cargo, Fuel Watch, then thin-content topics | FP-02 → FP-03 → FP-01 → CG-01 → TC-01 |
| **2** | One incident set for counts, tables, Fast Facts, prose (Flashpoint parity) | FP-03 |
| **3** | Cargo slop removed at ingest **and** report scope | CG-01, CG-02 |
| **4** | Thin / generic prose on Energy, Fertiliser, Data Centres | TC-01, TC-02 |
| **5** | Fuel Watch — verify canonical-facts parity (deterministic; no AI drift) | Parity audit only |
| **6** | Country briefs = in-country events, not mention-of-country | CB-01 (+ CB-02) — **after commodity block** |
| **7** | Automated audit/validation — not manual PDF spotting | Phase 4 gates + proof pack |

**Hard rule:** Do **not** bump relevance/slop rules (FP-01) until FP-02 + FP-03 gates are green.

### Commodity report scope

| Report | Known issue | Sprint | Backlog |
| --- | --- | --- | --- |
| **Flashpoint Watch** | 528→8 funnel; count ≠ prose | **1** (Days 1–3) | FP-02, FP-03, FP-01 |
| **Cargo Watch** | Slop through ingest; scope gate drift | **2** (Day 4) | CG-01, CG-02 |
| **Fuel Watch** | Deterministic — verify preview == PDF | **2** (Day 5) | Parity audit |
| **Energy / Fertiliser / Data Centres** | Thin content, "Data quality issue" Fast Facts | **3** (Days 6–7) | TC-01, TC-02 |
| Shipping Watch | Off-region syndication | Deferred (P3) | SH-01 |
| Conflict Watch | Secondary logic review | Deferred (P3) | CF-01 |
| **Country briefs** | Foreign-subject rows (Indonesia worst) | **4** (Days 8–9) | CB-01, CB-02 |

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

## Sprint 2 — Cargo + Fuel Watch (Days 4–5)

Commodity block continues. Country briefs deferred to Sprint 4.

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

**Deliverable to Steve:** Cargo Watch before/after PDF on issue date 2026-05-31.

---

### Day 5 — Fuel Watch parity + CG-02 (Cargo masthead)

**Fuel Watch** (`fuelCanonicalFacts.ts`) — deterministic report; Steve flagged it alongside Flashpoint but audit shows lower risk. Verify, don't refactor unless broken.

**Work:**

- [ ] Export headless Fuel Watch PDF; confirm preview == PDF
- [ ] Run consistency gate — no AI override of analytical sections
- [ ] If Steve sends a bad Fuel PDF → tag and add regression fixture

**CG-02 (if time):** Cargo masthead → country mis-tag at ingest

**Acceptance:**

- [ ] Fuel Watch PDF passes font + content parity check
- [ ] No count/prose contradiction in canonical sections

**Milestone message to Steve:** *"Commodity P1 block complete — Flashpoint + Cargo fixed; Fuel Watch verified. Ready for your review. Country briefs (Indonesia first) next."*

---

## Sprint 3 — Thin-content commodity topics (Days 6–7)

Energy, Fertiliser, Data Centres — generic `draftReportProse` path with thin ReportPack + coarse classifier.

| Day | Items | Notes |
| --- | --- | --- |
| **6** | TC-01, TC-02 | ReportPack + classifier coupling; Fast Fact plural regex (`outages?` not `outage\b`) |
| **7** | CG-02 (finish), HY-02 (start) | Cargo masthead mis-tag; Unknown country aliases on region feeds |

**Acceptance (TC-01/02):**

- [ ] No "Data quality issue" Fast Fact on sample Energy/Fertiliser issue dates
- [ ] Section depth comparable to Shipping/Fuel templates
- [ ] Classifier run on relevance-filtered + windowed rows only

**Defer to follow-on:** HY-01 (geocode), SOC-01 (social promote), SH-01, CF-01 (P3).

---

## Sprint 4 — Country briefs (Days 8–9)

Steve confirmed country briefs are wrong but **not the priority**. Indonesia is the worst case — fix shared engine first, then sweep all six briefs.

### Day 8 — CB-01: Country geography gate

**Files:** `lib/country-engine/` (shared engine, not per-theatre JSX patches)

**Work:**

- [ ] Extend `INDO_FOREIGN_SUBJECT_RE` + Bahasa theatre tokens (`Yaman`, `Houthi`, etc.)
- [ ] Apply same engine pattern to PNG, West Papua, Thailand, Philippines configs
- [ ] **No** `RELEVANCE_RULE_VERSION` bump (render gate only)

**Acceptance:**

- [ ] Foreign earthquake, foreign sports riot, Bahasa Yemen/Houthi → excluded from Indonesia brief
- [ ] Genuine domestic rows with foreign nationals still kept
- [ ] `country-brief-sweep` green for all six briefs

---

### Day 9 — CB-02: Editorial banned phrases + proof pack

- [ ] Country brief opinion/editorial phrase guard
- [ ] Indonesia brief before/after PDF (primary proof)
- [ ] Sweep results for PNG, West Papua, Thailand, Philippines, Jakarta

**Deliverable to Steve:** Indonesia brief before/after PDF + sweep results.

---

## Phase 4 — Automated validation (Days 10–11)

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
| **Now** | Confirm commodity-first priority aligned; request bad PDFs (Flashpoint, Fuel, Cargo) |
| **End Sprint 1 (Day 3)** | Flashpoint proof: funnel 15–40, parity green, before/after PDF |
| **End Sprint 2 (Day 5)** | Cargo + Fuel Watch proof |
| **End Sprint 3 (Day 7)** | Energy/Fertiliser/Data Centres thin-content fixes |
| **End Sprint 4 (Day 9)** | Indonesia brief before/after + country sweep |
| **End Phase 4 (Day 11)** | Full proof pack + validation summary (PASSED/FAILED email) |
| **Ongoing** | Short Upwork updates when each commodity acceptance block clears |

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

1. **Reply to Steve** — confirm commodity-first priority; ask for recent bad PDFs (Flashpoint, Fuel Watch, Cargo) as regression fixtures
2. **Run baseline capture** (Week 0 checklist) — include `flashpoint-before`, `cargo-watch-before`, `fuel-watch-before` PDFs (not Indonesia yet)
3. **Start FP-02** in `flashpointReportDataset.ts` — selector recovery only, no relevance changes
4. **Do not start CB-01** until Sprint 4 — commodity block must clear first

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
