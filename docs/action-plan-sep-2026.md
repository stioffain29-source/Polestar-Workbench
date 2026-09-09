# Action Plan — Commodity Reports Priority (Sep 2026)

**Date:** 9 September 2026 (revised)  
**Context:** Steve Ward (7–8 Sep) — commodity-style reports are the priority (Flashpoint, Fuel Watch, Cargo, and similar topic reports). Country briefs are still wrong (Indonesia worst) but **secondary**. 24-hour view is tighter (good). GDELT re-subscription and Carto API are on Steve's side.  

**7 Sep evening — Steve PDF review** (`polestar-report-flashpoint-202609072120.pdf`): Sprint 1a (selector + parity + relevance) shipped and republished, but the live Flashpoint PDF still has **data-hygiene and selector gaps**. Steve's directive: **fix relevance/classification before any PDF design work**.

**8 Sep — Steve PDF review** (`polestar-report-flashpoint-202609082050.pdf`): Hygiene gaps **persist** (fusion project as protest, diaspora geography, gang/security rows, raw-feed titles). Steve adds a **second block**: prose is generic, repetitive and templated — sections restate the same conclusions; copy narrates the dataset and explains software mechanics instead of delivering analyst judgement. **Editorial voice is now an explicit gate**, but still **after** the incident set is clean. Keep forecast logic and current report layout; no PDF design work.

**Related docs:**

- [Ingestion & Report Quality Plan](./ingestion-report-quality-plan.md)
- [Phase 2 prioritised fix backlog](./phase-2-fix-plan/phase-2-prioritised-fix-backlog.md)
- [Phase 3 day-by-day plan](./phase-3-implementation-plan/phase-3-day-by-day-plan.md)
- [Phase 1 ingestion audit](./phase-1-baseline-audit/ingestion-audit-kept-vs-dropped.md)

---

## Steve's latest feedback

### 7 Sep (priority alignment)

| Item | Status | Our action |
| --- | --- | --- |
| 24-hour view tighter | Positive — no change needed | Note in proof pack; don't regress |
| GDELT re-subscription | Steve's side | Monitor Source Health only |
| Carto maps API | Steve rectified | No dev work |
| **Commodity-style reports** | **Main concern** | Sprint 1 focus (see below) |
| Country briefs (Indonesia worst) | Known issue, lower priority | Sprint 4 after commodity block |

### 7 Sep evening — Flashpoint PDF review (`polestar-report-flashpoint-202609072120.pdf`)

Tagged in [1.4 stakeholder examples](./phase-1-baseline-audit/1.4-stakeholder-examples.md). **Regression fixture — must pass before next Steve PDF.**

| # | Steve requirement | Tag | Backlog | Status |
| --- | --- | --- | --- | --- |
| R1 | Fix relevance/classification **before** PDF design | scope | — | **Active** |
| R2 | Explicit **“strike” homonym** excludes (military/airstrike/disaster/sports/labour confusion) | slop-in | FP-04 | Open |
| R3 | **Hard sports/entertainment exclude** — e.g. Scott Kuggeleijn cricket must not enter as High protest | slop-in | FP-05 | Open |
| R4 | **Event location, not subject-country** — BD protest in US/UK ≠ APAC incident | wrong-country | FP-06 | Open |
| R5 | Reject **commentary/reaction** stories that mention protests but describe no discrete event | slop-in | FP-07 | Open |
| R6 | Tighten **Related Incidents** selector (e.g. Thai lawmaker/Myanmar support after protest) | selector | FP-08 | Open |
| R7 | **Distinct incidents, protest/country counts, highest severity, weekly posture** only from final validated set | wrong-count | FP-09 | Open |
| R8 | **Fail report generation** if country/severity narrative contradicts underlying records | wrong-prose | FP-10 | Open |
| R9 | **Seoul contradiction** — country section cites 18 incidents + Seoul; What Matters says Seoul only upcoming | wrong-prose | FP-11 | Open |
| R10 | **NZ contradiction** — table High vs What Matters Low | wrong-prose | FP-11 | Open |
| R11 | **Keep** forecast logic (confirmed vs unconfirmed mobilisation) | keep | — | No change |
| R12 | **Keep** report structure and visual design | keep | — | No PDF/design work |

### 8 Sep — Flashpoint PDF review (`polestar-report-flashpoint-202609082050.pdf`)

Tagged in [1.4 stakeholder examples](./phase-1-baseline-audit/1.4-stakeholder-examples.md). **Primary regression fixture** — supersedes 7 Sep PDF for acceptance. Editorial benchmark: **APAC Fuel Crisis Report** (2026-04-21, pre-workbench manual report).

| # | Steve requirement | Tag | Backlog | Status |
| --- | --- | --- | --- | --- |
| R13 | **Client-facing title quality gate** — raw-feed titles (e.g. "South Korea US Protest") must not render | slop-in | FP-12 | Open |
| R14 | **Scope classification** — gang/criminal/security-force stories excluded unless clear protest or civil-unrest relevance | slop-in | FP-13 | Open |
| R15 | **Infrastructure/science misclassification** — e.g. Japan fusion project must not enter as protest | slop-in | FP-13 | Open |
| R16 | Reconfirm **event location, not subject-country** — Bangladesh diaspora protest ≠ APAC incident | wrong-country | FP-06 | Open |
| R17 | Reconfirm **single validated incident set** — Fast Facts, charts, country counts, prose all from same cleaned set | wrong-count | FP-09 | Open |
| R18 | **Section distinctness** — Executive Summary, Country View, What Matters, Polestar View must not repeat the same conclusions | wrong-prose | FP-14 | Open |
| R19 | **Stop dataset narration + template filler** — no phrases like "driven by protest activity, mostly protests…"; no posture-score or "next section" meta copy | wrong-prose | FP-14 | Open |
| R20 | **Polestar voice** — concise, operational, specific, judgement-led; every paragraph answers "so what?" | wrong-prose | FP-14 | Open |

**Sequence (Steve, 8 Sep):** data hygiene **first** (R13–R17) → editorial voice **second** (R18–R20) → send revised PDF. No layout changes (R12).

---

## Confirmed scope (from Steve)

| Priority | What Steve wants | Backlog IDs |
| --- | --- | --- |
| **1** | **Flashpoint data hygiene** — relevance, classifier, selector, title gate, metrics, narrative consistency (R1–R10, R13–R17) | FP-04 → FP-13 |
| **2** | One incident set for counts, tables, Fast Facts, prose, Related Incidents, posture | FP-09, FP-03 (extend) |
| **3** | Automated generation gate — fail on count/severity/country contradictions | FP-10, FP-11 |
| **4** | **Flashpoint editorial voice** — distinct sections, banned template phrases, Polestar judgement (R18–R20) | FP-14 |
| **5** | Cargo slop removed at ingest **and** report scope | CG-01, CG-02 — **after Flashpoint block green** |
| **6** | Thin / generic prose on Energy, Fertiliser, Data Centres | TC-01, TC-02 |
| **7** | Fuel Watch — verify canonical-facts parity (deterministic; no AI drift) | Parity audit only |
| **8** | Country briefs = in-country events, not mention-of-country | CB-01 (+ CB-02) — **after commodity block** |
| **9** | Automated audit/validation — not manual PDF spotting | Phase 4 gates + proof pack |

**Hard rules:**

- **No PDF or visual design changes** until FP-04–FP-14 gates are green (Steve R1, R12).
- **Do not start Cargo / Fuel / country briefs** until Steve's Flashpoint PDF fixture passes (hygiene **and** editorial).
- **Hygiene before copy** — FP-04–FP-13 must pass before FP-14 editorial work starts (Steve R13–R17 before R18–R20).
- **Keep** forecast logic (confirmed vs unconfirmed) — do not regress (Steve R11).

### Commodity report scope

| Report | Known issue | Sprint | Backlog |
| --- | --- | --- | --- |
| **Flashpoint Watch** | Sprint 1a shipped; 8 Sep PDF still shows slop, wrong geography, raw titles, templated prose across sections | **1** (Days 1–8) | FP-02–FP-03–FP-01 ✅ then **FP-04–FP-14** |
| **Cargo Watch** | Slop through ingest; scope gate drift | **2** (paused) | CG-01, CG-02 |
| **Fuel Watch** | Deterministic — verify preview == PDF | **2** (Day 10) | Parity audit |
| **Energy / Fertiliser / Data Centres** | Thin content, "Data quality issue" Fast Facts | **3** (Days 11–12) | TC-01, TC-02 |
| Shipping Watch | Off-region syndication | Deferred (P3) | SH-01 |
| Conflict Watch | Secondary logic review | Deferred (P3) | CF-01 |
| **Country briefs** | Foreign-subject rows (Indonesia worst) | **4** (Days 13–14) | CB-01, CB-02 |

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
| 0.6 | Log Steve's PDFs when they arrive | ✅ `…072120.pdf` (7 Sep); ✅ `…082050.pdf` (8 Sep) → [1.4 stakeholder template](./phase-1-baseline-audit/1.4-stakeholder-examples.md) |

**Exit criteria:** Baseline recorded (528→8 funnel, 8 final rows, parity failures if any). Proof pack folder started.

---

## Sprint 1 — Flashpoint block (Days 1–8)

Steve's top item. **Sprint 1a** (selector recovery + parity + relevance) is shipped. **Sprint 1b** (data hygiene) and **Sprint 1c** (editorial voice) are both gates before Cargo or any PDF design work.

### Sprint 1a — Shipped (7 Sep)

| Day | Item | Status | Notes |
| --- | --- | --- | --- |
| 1 | FP-02 selector FN recovery | ✅ Shipped | `hasStrongPublicOrderCue`; weak-operational rescue |
| 2 | FP-03 parity proof | ✅ Shipped | KPI = tables = enriched set; parity tests green |
| 3 | FP-01 relevance slop | ✅ Shipped | `RELEVANCE_RULE_VERSION = 2026-09-01.3`; boot backfill |

**Steve feedback:** Report is fuller but still not acceptable — see R2–R20 above. Do **not** treat Sprint 1a as closed.

---

### Sprint 1b — Data hygiene (Days 4–6) — **current focus**

**Regression fixture:** `polestar-report-flashpoint-202609082050.pdf` (8 Sep 2026). Also replay `…072120.pdf` — both must pass.

**Files (primary):**

- `lib/relevance/src/topicRelevance.ts` — FP-04, FP-05, FP-07, FP-13
- `lib/ingest/src/titleTranslate.ts` + incident title render path — FP-12
- `artifacts/workbench/src/lib/incidentClassifier.ts` — FP-05, FP-13 (severity typing)
- `artifacts/workbench/src/lib/flashpointReportDataset.ts` — FP-06, FP-09
- `artifacts/workbench/src/lib/relatedIncidents.ts` — FP-08
- `artifacts/workbench/src/lib/draftReportProse.ts` + country read builders — FP-11 (consistency only; voice in FP-14)
- `validateFlashpointReportDataset` / export gate — FP-10, FP-12

#### Day 4 — FP-04 + FP-05 + FP-06: Ingest relevance & geography

**Work:**

- [x] **FP-04** Add explicit **strike** homonym excludes: military strike groups, airstrikes, disaster “striking” an area, sports strikes, lightning/storm strike — must not classify as labour action
- [x] **FP-05** Hard **sports/entertainment** exclude at relevance + classifier — Scott Kuggeleijn cricket story must never enter Flashpoint as High-severity protest
- [x] **FP-06** **Event location, not subject-country** for geography — a Bangladesh diaspora protest in US/UK is not a Bangladesh/APAC incident (Steve R4, R16)
- [x] **FP-12** **Client-facing title quality gate** — reject or rewrite raw-feed titles before render (e.g. "South Korea US Protest"); fail export if title fails gate
- [x] **FP-13** **Scope classification** — drop gang/criminal/security-force and infrastructure/science rows (e.g. Japan fusion project) unless clear protest or civil-unrest relevance
- [x] Bump `RELEVANCE_RULE_VERSION` + boot backfill if relevance rules change (`2026-09-09.1`)

**Verify:**

```bash
pnpm test -- flashpointTitleExcludes flashpointFp01Relevance sportsFixtureGate
pnpm --filter workbench exec tsx scripts/replayFlashpointRelevance.ts
```

**Acceptance:**

| Criterion | Target |
| --- | --- |
| Military/airstrike/disaster/sports “strike” rows | Dropped at relevance or selector |
| Cricket/sports entertainment (Kuggeleijn-class) | **0** in Flashpoint final set |
| Foreign-venue protest with APAC subject-country only | Dropped or re-tagged to correct theatre |
| Raw-feed title ("South Korea US Protest") | Blocked at title gate (FP-12) |
| Gang/criminal/security or fusion/infra without protest hook | **0** in Flashpoint final set (FP-13) |
| Motorsport rally homonym drops | No regression |

---

#### Day 5 — FP-07 + FP-08: Commentary filter + Related Incidents

**Work:**

- [x] **FP-07** Reject **reaction/commentary** stories that mention protests but do not describe a discrete public-order event
- [x] **FP-08** Tighten **Related Incidents** selector — drop sympathy/support/commentary rows (e.g. Thai lawmaker messages of support from Myanmar citizens after protest)

**Verify:**

```bash
ISSUE=<steve-pdf-issue-date> pnpm --filter workbench exec tsx scripts/proveFlashpointSelection.ts
pnpm test -- relatedIncidentsCap flashpointReportConsistency
```

**Acceptance:**

| Criterion | Target |
| --- | --- |
| Commentary-only protest mentions | Dropped |
| Related Incidents ⊆ `selectFlashpointUsable().enriched` | Proven by script |
| Steve fixture rows (Kuggeleijn, lawmaker/support, fusion, gang/security) | Absent from tables + Related |

---

#### Day 6 — FP-09 + FP-10 + FP-11: Metrics, validation, narrative consistency (hygiene)

**Work:**

- [x] **FP-09** Recalculate **distinct incidents, protest count, country count, highest severity, weekly posture** only from the final validated incident set (no wider window, no forecast rows in confirmed counts)
- [x] **FP-10** Add **generation validation** — report build **fails** if country or severity narrative contradicts underlying records
- [x] **FP-11** Fix **Seoul** contradiction (country section vs What Matters upcoming-only) and **NZ** contradiction (table High vs What Matters Low)
- [ ] **Do not change** forecast logic (confirmed vs unconfirmed mobilisation) — Steve confirmed this works

**Verify:**

```bash
pnpm test -- flashpointSelectionParity flashpointReportConsistency
ISSUE=<steve-pdf-issue-date> pnpm --filter workbench exec tsx scripts/proveFlashpointSelection.ts
# Headless PDF — must pass FP-10 gate before export
TOPIC=flashpoint ISSUE_DATE=<date> pnpm --filter workbench exec tsx --import ./scripts/registerLoader.mjs scripts/exportReportPdfHeadless.ts
```

**Acceptance:**

| Criterion | Target |
| --- | --- |
| All KPIs derived from `selectFlashpointUsable().enriched` only | Proven by parity tests |
| Seoul: confirmed vs upcoming language | Consistent across country section + What Matters |
| NZ: table severity vs What Matters | Consistent |
| `validateFlashpointReportDataset` | Hard-fail on contradiction (FP-10) |
| Steve PDF fixture replay (both PDFs) | **0** tagged slop classes; contradictions resolved |
| Title gate | No raw-feed rubbish in client-facing titles |

**Sprint 1b exit:** Hygiene gates green on `…082050.pdf` issue date. **Do not send to Steve yet** — editorial pass (Sprint 1c) required.

**Milestone (internal):** *"Flashpoint hygiene pass complete — scope/title/geography/selector/metrics validated. Starting editorial voice pass."*

---

### Sprint 1c — Editorial voice (Days 7–8) — **after Sprint 1b green**

**Benchmark:** APAC Fuel Crisis Report (2026-04-21) — pre-workbench manual report; target tone for Flashpoint prose.

**Files (primary):**

- `artifacts/workbench/src/lib/draftReportProse.ts` — section templates, banned phrases
- Flashpoint country read / What Matters / Polestar View builders — section role separation
- `lib/country-engine/src/narrative.ts` — shared phrase guards (reuse CB-02 patterns where applicable)
- `validateFlashpointReportDataset` / export gate — extend FP-10 for editorial checks

#### Day 7 — FP-14a: Section distinctness + banned template phrases

**Work:**

- [x] **FP-14** Define **one job per section** — Executive Summary (headline judgement), Country View (theatre-specific operational read), What Matters (priority risks + upcoming), Polestar View (client-facing recommendation); no cross-section repetition of the same conclusion
- [x] Add **banned phrase list** for dataset narration ("driven by protest activity", "mostly protests and organised action", posture-score explanations, "the following section…")
- [x] Prose generated **only from** `selectFlashpointUsable().enriched` — no orphan references to dropped rows

**Acceptance:**

| Criterion | Target |
| --- | --- |
| Exec Summary vs Country View vs What Matters vs Polestar View | Distinct claims; automated or review checklist shows no repeated conclusion triplets |
| Banned template phrases | **0** in `pdftotext` output on fixture issue date |
| Every paragraph | Answers "so what?" — operational implication, not dataset description |

#### Day 8 — FP-14b: Polestar voice + Steve deliverable

**Work:**

- [x] Rewrite section prompts/templates toward **concise, operational, judgement-led** copy — match APAC Fuel Crisis tone, not generic LLM filler
- [x] Extend **FP-10 validation** — fail generation on banned phrases or section repetition heuristics
- [ ] Headless PDF export on Steve's issue date; replay both regression PDFs

**Verify:**

```bash
pnpm test -- flashpointReportConsistency flashpointProseVoice
ISSUE=<steve-pdf-issue-date> pnpm --filter workbench exec tsx scripts/proveFlashpointSelection.ts
TOPIC=flashpoint ISSUE_DATE=<date> pnpm --filter workbench exec tsx --import ./scripts/registerLoader.mjs scripts/exportReportPdfHeadless.ts
```

**Acceptance:**

| Criterion | Target |
| --- | --- |
| Voice vs APAC Fuel benchmark | Steve-readable: specific, not templated |
| Software/meta filler | **0** posture-score or section-preview explanations |
| Hygiene regression | Sprint 1b acceptance still green |
| Both Steve PDF fixtures | Replay passes |

**Deliverable to Steve:** Updated Flashpoint PDF on the **same issue date as `…082050.pdf`** + short delta (rows dropped, sections reworked). **No layout changes.**

**Milestone message to Steve:** *"Flashpoint pass complete — incident set cleaned (scope, geography, titles, single metrics source) and prose reworked for distinct sections and Polestar voice. Structure and forecast logic unchanged. Please re-read against the 8 Sep PDF."*

---

### Sprint 1a archive (shipped — reference only)

<details>
<summary>Days 1–3: FP-02, FP-03, FP-01 (completed 7 Sep)</summary>

#### Day 1 — FP-02: Flashpoint selector recovery

**File:** `artifacts/workbench/src/lib/flashpointReportDataset.ts` → `selectFlashpointUsable`

- [x] Relax `weak-operational` drops when strong public-order cues exist
- [x] Do **not** touch relevance homonym excludes
- [x] Unit tests: Nepal Gen Z, Dhaka violence, Tokyo anti-war, Manila labour

#### Day 2 — FP-03: Parity proof

- [x] Extend `proveFlashpointSelection.ts` / `flashpointSelectionParity.test.ts`
- [x] KPI = Activism + Unrest tables = charts = Fast Facts = prose
- [x] Parity tests green

#### Day 3 — FP-01: Relevance slop

- [x] Diplomatic/process excludes ("file/lodge protest", legal-process headlines)
- [x] Public-order KEEP cues for rally/strike disambiguation
- [x] `RELEVANCE_RULE_VERSION` bumped + boot backfill

**Outcome:** Funnel recovered (~8 → ~14 rows on audit issue date); Steve PDF review shows further hygiene work required (Sprint 1b).

</details>

---

## Sprint 2 — Cargo + Fuel Watch (Days 9–10) — **paused**

**Gate:** Do not start until Sprint 1b + 1c (FP-04–FP-14) pass Steve's PDF fixture.

Commodity block continues after Flashpoint hygiene. Country briefs deferred to Sprint 4.

### Day 9 — CG-01: Cargo slop coupling

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

### Day 10 — Fuel Watch parity + CG-02 (Cargo masthead)

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

## Sprint 3 — Thin-content commodity topics (Days 11–12)

Energy, Fertiliser, Data Centres — generic `draftReportProse` path with thin ReportPack + coarse classifier.

| Day | Items | Notes |
| --- | --- | --- |
| **11** | TC-01, TC-02 | ReportPack + classifier coupling; Fast Fact plural regex |
| **12** | CG-02 (finish), HY-02 (start) | Cargo masthead mis-tag; Unknown country aliases on region feeds |

**Acceptance (TC-01/02):**

- [ ] No "Data quality issue" Fast Fact on sample Energy/Fertiliser issue dates
- [ ] Section depth comparable to Shipping/Fuel templates
- [ ] Classifier run on relevance-filtered + windowed rows only

**Defer to follow-on:** HY-01 (geocode), SOC-01 (social promote), SH-01, CF-01 (P3).

---

## Sprint 4 — Country briefs (Days 13–14)

Steve confirmed country briefs are wrong but **not the priority**. Indonesia is the worst case — fix shared engine first, then sweep all six briefs.

### Day 13 — CB-01: Country geography gate

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

### Day 14 — CB-02: Editorial banned phrases + proof pack

- [ ] Country brief opinion/editorial phrase guard
- [ ] Indonesia brief before/after PDF (primary proof)
- [ ] Sweep results for PNG, West Papua, Thailand, Philippines, Jakarta

**Deliverable to Steve:** Indonesia brief before/after PDF + sweep results.

---

## Phase 4 — Automated validation (Days 15–16)

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

For each shipped item (FP-04–FP-14, then CG-01, CB-01):

| Artifact | Purpose |
| --- | --- |
| Before/after headless PDF | Visual proof (same layout — data only) |
| Funnel + selection proof output | Quantified fix |
| Kept/dropped diff | Ingestion/selector changes |
| Parity + validation test log | Counts = prose = tables; FP-10 gate |
| Steve PDF mapped to stage | `…082050.pdf` (primary) + `…072120.pdf` → regression fixtures locked |

### 4.3 Stakeholder review

- [ ] Re-run gates on **Steve's PDF issue date** (8 Sep 2026 generation)
- [ ] Map any new PDFs Steve sends → pipeline stage → acceptance criterion
- [ ] Agree closure per backlog item; document accepted residual noise

**Ongoing cadence (communicate to Steve):**

| Cadence | Action |
| --- | --- |
| Before each publish issue date | Run Phase 4.1 gates |
| Weekly | Spot-check Source Health + Flashpoint kept set |
| Quarterly | Full slop audit refresh (`runPhase1SlopAudit.ts`) |

---

## Steve's bad PDFs — how to use them

**Primary fixture:** `polestar-report-flashpoint-202609082050.pdf` (8 Sep 2026)  
**Secondary fixture:** `polestar-report-flashpoint-202609072120.pdf` (7 Sep 2026)

Use as **regression fixtures**, not primary QA:

1. Tag each example (slop-in / wrong-count / wrong-prose / wrong-country) — see R2–R20 tables above
2. Map to pipeline stage (relevance → classifier → selector → Related Incidents → prose)
3. Add to proof pack as "must pass" after fix
4. If audit should have caught it but didn't → add/extend a gate (FP-10 validation, parity test, funnel script)

**Known fixture rows to lock:**

| Symptom | Example class | Stage |
| --- | --- | --- |
| slop-in | Scott Kuggeleijn cricket as High protest | relevance + classifier (FP-05) |
| slop-in | Military/airstrike/disaster "strike" | relevance (FP-04) |
| wrong-country | BD-related protest filed under APAC from US/UK venue | geography (FP-06) |
| slop-in | Commentary mentioning protest, no discrete event | relevance/selector (FP-07) |
| selector | Thai lawmaker Myanmar support after protest in Related | Related Incidents (FP-08) |
| wrong-prose | Seoul 18 incidents vs upcoming-only in What Matters | prose validation (FP-11) |
| wrong-prose | NZ High in table vs Low in What Matters | prose validation (FP-11) |
| slop-in | Japan fusion project as protest | scope classifier (FP-13) |
| slop-in | Gang/criminal/security-force without protest hook | scope classifier (FP-13) |
| slop-in | "South Korea US Protest" raw title | title gate (FP-12) |
| wrong-prose | Same conclusion in Exec Summary, Country View, What Matters, Polestar View | editorial templates (FP-14) |
| wrong-prose | "Driven by protest activity…" dataset narration | banned phrases (FP-14) |
| wrong-prose | Posture-score / "next section" meta copy | banned phrases (FP-14) |

**Editorial benchmark:** APAC Fuel Crisis Report (2026-04-21) — tone reference for FP-14 acceptance reviews.

---

## Deliverables timeline (Upwork updates)

| When | What Steve gets |
| --- | --- |
| **7 Sep** | Sprint 1a deployed — Steve reviewed PDF, returned hygiene requirements |
| **8 Sep** | Steve second PDF — hygiene gaps persist; editorial voice added as explicit requirement |
| **End Sprint 1b (Day 6)** | Hygiene gates green internally — scope, geography, titles, metrics |
| **End Sprint 1c (Day 8)** | Flashpoint PDF to Steve — hygiene + editorial voice, no design change |
| **End Sprint 2 (Day 10)** | Cargo + Fuel Watch proof — **after** Flashpoint fixture green |
| **End Sprint 3 (Day 12)** | Energy/Fertiliser/Data Centres thin-content fixes |
| **End Sprint 4 (Day 14)** | Indonesia brief before/after + country sweep |
| **End Phase 4 (Day 16)** | Full proof pack + validation summary (PASSED/FAILED email) |
| **Ongoing** | Short updates when each acceptance block clears |

---

## Risk controls

| Risk | Mitigation |
| --- | --- |
| PDF design churn distracts from data/copy fixes | **Hard stop:** no layout/CSS changes until FP-04–FP-14 green (Steve R12) |
| Editorial rewrite on dirty incident set | **Sequence lock:** FP-14 starts only after FP-04–FP-13 green |
| Templated prose passes hygiene but fails voice review | FP-14 banned-phrase + section-distinctness gates; APAC Fuel benchmark review |
| Strike/sports excludes drop real labour action | Precision-first patterns; replay labour-strike positives; unit tests per class |
| Event-location rule drops genuine cross-border protests | Require APAC venue anchor OR live public-order hook; test BD-in-US/UK negatives |
| FP-09 metrics still use wider window somewhere | Audit every Fast Fact / chart / posture builder; single `enriched` source |
| Seoul/NZ-style contradictions recur | FP-10 hard-fail generation; extend parity tests with country-section fixtures |
| Steve still finds issues manually | Each PDF row → regression test or gate; don't rely on one-off patches |
| Cargo fix breaks validation gate | Mirror rules in both layers; run 10-check gate before sign-off |

---

## Per-fix checklist (copy per shipped item)

| Item | FP-04 | FP-05 | FP-06 | FP-07 | FP-08 | FP-09 | FP-10 | FP-11 | FP-12 | FP-13 | FP-14 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Change in shared lib (not preview/PDF duplicate) | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| `RELEVANCE_RULE_VERSION` bumped if needed | ☐ | ☐ | n/a | ☐ | n/a | n/a | n/a | n/a | n/a | ☐ | n/a |
| Boot migration / marker-gated backfill | ☐ | ☐ | n/a | ☐ | n/a | n/a | n/a | n/a | n/a | ☐ | n/a |
| Unit / render tests updated | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Steve PDF fixture row passes | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Preview == PDF verified (data only) | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |

---

## Immediate next actions

1. **Tag Steve's PDFs** in [1.4 stakeholder examples](./phase-1-baseline-audit/1.4-stakeholder-examples.md) — lock `…082050.pdf` as primary fixture; keep `…072120.pdf` as secondary
2. **Sprint 1b (Days 4–6):** FP-04 → FP-13 — strike/sports slop, event-location geography, title gate, gang/security/fusion scope, Related Incidents, metrics validation
3. **Sprint 1c (Days 7–8):** FP-14 — section distinctness, banned template phrases, Polestar voice (benchmark: APAC Fuel Crisis Report 2026-04-21)
4. **Do not** change PDF layout, CSS, or chart design
5. **Do not start CG-01 / Cargo** until Sprint 1b + 1c pass on Steve's issue date
6. **Do not send Steve a PDF** after hygiene only — editorial pass is part of acceptance
7. **Preserve** forecast logic (confirmed vs unconfirmed) — regression test before deploy

---

## Key commands reference

```bash
# Snapshot + audit
pnpm --filter workbench run audit:export-snapshot
ISSUE=2026-05-31 pnpm --filter workbench run audit:ingestion-report

# Flashpoint (Sprint 1b/1c — Steve PDF fixtures)
ISSUE=<steve-pdf-issue-date> pnpm --filter workbench exec tsx scripts/diagnoseFunnel.ts
ISSUE=<steve-pdf-issue-date> pnpm --filter workbench exec tsx scripts/proveFlashpointSelection.ts
pnpm test -- flashpointTitleExcludes flashpointFp01Relevance flashpointSelectionParity relatedIncidentsCap flashpointProseVoice
pnpm --filter workbench exec tsx scripts/replayFlashpointRelevance.ts

# Cargo / country
pnpm --filter workbench exec tsx scripts/cargoScopeCheck.ts
pnpm --filter workbench exec tsx scripts/countryReportData.ts

# QA
pnpm test && pnpm typecheck
.\artifacts\workbench\scripts\runPhase41.ps1
```
