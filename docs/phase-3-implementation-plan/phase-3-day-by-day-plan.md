# Phase 3 — Day-by-day implementation plan (Days 6–12)

**Polestar Workbench · Ingestion & Report Quality**

| Field | Value |
| --- | --- |
| Sprint | Days 6–12 (7 working days) |
| Backlog source | [Phase 2 prioritised fix backlog](../phase-2-fix-plan/phase-2-prioritised-fix-backlog.md) |
| Flashpoint audit issue date | 2026-05-31 |
| Prod snapshot | `pnpm --filter workbench run audit:export-snapshot` |

---

## How to use this plan

Each day follows the same rhythm:

1. **Pre-read** — institutional memory before touching code
2. **Baseline** — capture before-state (replay, funnel, PDF)
3. **Implement** — shared lib only; one fix per PR where possible
4. **Verify** — scripts + tests from backlog item
5. **Checklist** — complete [§3.1 per-fix checklist](#per-fix-checklist-template) before marking day done
6. **Gate** — end-of-day criterion; do not start next day’s primary item if gate fails

**Constraints (do not break):** Preview == PDF · signal thin > noise in · no fabrication · severity demote-only · Fuel canonical facts only · Drizzle schema + idempotent boot migration in same change.

---

## Sprint overview

```
Day 6  ── FP-02 selector FN recovery
Day 7  ── FP-01 relevance + version bump (coordinate w/ FP-02)
Day 8  ── FP-03 parity proof + Flashpoint backfill deploy
Day 9  ── CG-01 cargo slop mirror
Day 10 ── CB-01 country foreign-subject gate
Day 11 ── CG-02 + TC-02 + CB-02 (P2 batch)
Day 12 ── TC-01 + HY-02 + integration / Phase 4 prep
         └── P3 (SH-01, CF-01, PV-01, ST-01, DC-01) → follow-on sprint
```

---

## Day 6 — Flashpoint selector FN recovery (FP-02)

**Goal:** Recover genuine protests dropped by `selectFlashpointUsable` without re-admitting homonym slop.  
**Owner:** Report pipeline dev  
**Key file:** `artifacts/workbench/src/lib/flashpointReportDataset.ts`

### Pre-read (30 min)

- `.agents/memory/MEMORY.md` — Flashpoint / weak-operational sections
- `docs/dev-handover-audit.md` §12 Golden rules
- [1.3 Flashpoint logic map](../phase-1-baseline-audit/1.3-report-logic-maps.md#flashpoint-watch--high-priority)

### Baseline (morning)

```bash
ISSUE=2026-05-31 pnpm --filter workbench exec tsx scripts/diagnoseFunnel.ts
ISSUE=2026-05-31 pnpm --filter workbench exec tsx scripts/proveFlashpointSelection.ts
ISSUE=2026-05-31 pnpm --filter workbench exec tsx scripts/dumpFlashpointDataset.ts
```

Record: relevance-kept count, final usable count (expect ~8 today), FN sample titles from [ingestion audit §4](../phase-1-baseline-audit/ingestion-audit-kept-vs-dropped.md).

### Implement (core)

- [ ] Relax **weak-operational** drop when strong public-order cues present (`protest`, `crackdown`, `clash`, `Gen Z`, `sit-in`, arrest-over-unrest patterns)
- [ ] Do **not** weaken relevance-layer homonym excludes (motorsport/finance rally stays out)
- [ ] Keep `selectFlashpointUsable` as single authority for counts, tables, charts, prose
- [ ] Add/update unit tests for FN samples (Nepal Gen Z, Dhaka violence, Tokyo anti-war rally, Manila labour rally)

### Verify (afternoon)

```bash
ISSUE=2026-05-31 pnpm --filter workbench exec tsx scripts/diagnoseFunnel.ts
ISSUE=2026-05-31 pnpm --filter workbench exec tsx scripts/proveFlashpointSelection.ts
pnpm test -- flashpointReportDataset
pnpm typecheck
```

### End-of-day gate

| Criterion | Target |
| --- | --- |
| Final usable rows (issue 2026-05-31) | **15–40** (up from 8) |
| FN audit samples in final set | Nepal / Bangladesh / Philippines protest rows present |
| New motorsport/finance FP | **0** in replay |
| `RELEVANCE_RULE_VERSION` | Unchanged (selector-only) |

**If gate fails:** Stop Day 7 FP-01 work; tune weak-operational heuristics only — do not compensate by loosening relevance excludes.

---

## Day 7 — Flashpoint relevance + diplomatic slop (FP-01)

**Goal:** Drop diplomatic/process “protest” slop at relevance; keep legitimate Tokyo rallies that relevance currently drops as ambiguous token.  
**Owner:** `@workspace/relevance` dev  
**Key files:** `lib/relevance/src/topicRelevance.ts`, `lib/relevance/src/evaluate.ts`

### Pre-read (30 min)

- `.agents/memory/MEMORY.md` — relevance / FLASHPOINT_EXCLUDE order (finance rally before political KEEP)
- Phase 2 FP-02 diff — align public-order KEEP cues so relevance + selector do not double-penalise

### Baseline (morning)

```bash
pnpm --filter workbench exec tsx scripts/replayFlashpointRelevance.ts
pnpm --filter workbench exec tsx scripts/auditLiveRelevance.ts
```

Record top drop reasons and count of “ambiguous token without public-order cue” (expect ~119 on flashpoint).

### Implement (core)

- [ ] Add tightly bound **FLASHPOINT_EXCLUDE** for diplomatic/interstate protest (`file/lodge protest`, legal-process headlines)
- [ ] Expand public-order **KEEP** cues for rally/strike disambiguation (`against`, `demands`, `clash`, `crackdown`, etc.)
- [ ] **Bump `RELEVANCE_RULE_VERSION`** in `evaluate.ts`
- [ ] Add boot migration marker for backfill (idempotent)
- [ ] Unit tests for diplomatic drop + Tokyo rally keep

### Verify (afternoon)

```bash
pnpm --filter workbench exec tsx scripts/replayFlashpointRelevance.ts
pnpm --filter workbench exec tsx scripts/auditLiveRelevance.ts
pnpm test -- relevance
pnpm typecheck
```

Re-run `diagnoseFunnel.ts` with FP-02 + FP-01 together — confirm combined funnel still 15–40 usable.

### End-of-day gate

| Criterion | Target |
| --- | --- |
| Diplomatic “file/lodge protest” rows | Dropped at relevance |
| Tokyo anti-government rally rows | Kept at relevance |
| Motorsport homonym drops | No regression (~208 class preserved) |
| Version bump + migration marker | Recorded in PR / deploy notes |

---

## Day 8 — Flashpoint parity proof + backfill deploy (FP-03)

**Goal:** Prove one incident set feeds all Flashpoint surfaces; deploy relevance backfill; verify preview == PDF.  
**Owner:** Report pipeline dev

### Pre-read (15 min)

- [1.3 selector divergence summary](../phase-1-baseline-audit/1.3-report-logic-maps.md#selector-divergence-summary)

### Implement (morning)

- [ ] Extend `proveFlashpointSelection.ts` coverage or parity unit tests: KPI = Activism + Unrest tables = prose references = Fast Facts overlap
- [ ] Fix any divergent path found (e.g. Fast Facts wider window than dataset builder)
- [ ] Export **before** headless PDF if not already captured (baseline for Phase 4)

### Deploy + backfill (midday)

- [ ] Merge FP-01 + FP-02 + FP-03 PRs (or sequential deploy if separate)
- [ ] Deploy to prod; confirm boot backfill completes (`ingest_force_v*` marker or backfill logs)
- [ ] Dry-run replay on live prod rows — attach kept/dropped delta to PR notes

### Verify (afternoon)

```bash
ISSUE=2026-05-31 pnpm --filter workbench exec tsx scripts/proveFlashpointSelection.ts
ISSUE=2026-05-31 pnpm --filter workbench exec tsx scripts/dumpFlashpointDataset.ts
pnpm --filter workbench exec tsx scripts/exportReportPdfHeadless.ts   # Flashpoint
pnpm test
```

### End-of-day gate — **P1 Flashpoint block complete**

| Criterion | Target |
| --- | --- |
| Parity tests | Green — single enriched set for all sections |
| Headless PDF | Exported; no count/prose contradiction on spot-check |
| Backfill | Prod `relevance_status` refreshed for bumped version |
| Steve wrong-count example | Resolved or documented |

---

## Day 9 — Cargo slop ingest + display coupling (CG-01)

**Goal:** Mirror cargo slop rules in relevance and display scope; validation gate passes.  
**Owner:** `@workspace/relevance` + cargo dev  
**Key files:** `lib/relevance/src/cargoSlop.ts`, `artifacts/workbench/src/lib/cargoAnalysis.ts`

### Pre-read (30 min)

- `.agents/memory/MEMORY.md` — cargo slop / two-layer model
- [1.3 Cargo logic map](../phase-1-baseline-audit/1.3-report-logic-maps.md#cargo-watch--high-priority)

### Baseline

```bash
pnpm --filter workbench exec tsx scripts/cargoScopeCheck.ts
pnpm --filter workbench exec tsx scripts/auditReports.ts
```

### Implement

- [ ] Any new exclude in `CARGO_SLOP_EXCLUDE` mirrored in `isCargoInScope` / `hasGenuineCargo`
- [ ] Bump `RELEVANCE_RULE_VERSION` if relevance rules changed
- [ ] Update `cargo-report-validation-gate` tests
- [ ] Boot backfill marker if relevance changed

### Verify

```bash
pnpm --filter workbench exec tsx scripts/cargoScopeCheck.ts
pnpm test -- cargo
pnpm typecheck
```

Export Cargo headless PDF for issue date used in audit.

### End-of-day gate

| Criterion | Target |
| --- | --- |
| “$18M/day” / “Safer Transport Act” samples | Dropped at relevance **and** scope |
| Transit-hijack / Bahasa cargo theft | Still kept |
| 10-check validation gate | Green on fixed issue PDF |

---

## Day 10 — Country brief foreign-subject gate (CB-01)

**Goal:** Shared `@workspace/country-engine` hardening — no per-theatre JSX patches.  
**Owner:** `@workspace/country-engine` dev  
**Key files:** `lib/country-engine/`, country report builders

### Pre-read (30 min)

- Country-engine memory / banned phrase docs
- [1.3 Country briefs map](../phase-1-baseline-audit/1.3-report-logic-maps.md#country-briefs--high-priority)

### Baseline

```bash
pnpm --filter workbench exec tsx scripts/countryReportData.ts
# Run country-brief-sweep workflow (Replit / CI)
```

### Implement

- [ ] Extend `INDO_FOREIGN_SUBJECT_RE` + Bahasa theatre tokens (`Yaman`, `Houthi`, etc.)
- [ ] Apply same engine pattern to PNG, West Papua, Thailand, Philippines configs
- [ ] **No** `RELEVANCE_RULE_VERSION` bump (render gate only)
- [ ] Tests for FP samples: Japan vs Sweden riot, Turkey earthquake, Houthi headline → excluded

### Verify

```bash
pnpm test -- country-engine
pnpm --filter workbench exec tsx scripts/countryReportData.ts
# country-brief-sweep — all six briefs
```

Export Indonesia brief headless PDF (before/after if not done).

### End-of-day gate — **P1 block complete**

| Criterion | Target |
| --- | --- |
| FP audit samples | Excluded from Indonesia brief |
| Domestic + foreign national rows | Genuine keeps preserved |
| `country-brief-sweep` | Green for all six briefs |

---

## Day 11 — P2 batch: cargo tag, Fast Facts, banned phrases (CG-02, TC-02, CB-02)

**Goal:** Three smaller P2 fixes in one day — independent surfaces, can parallelise across devs.

### Track A — CG-02 Cargo masthead mis-tag (½ day)

**Key file:** ingest `classifyFeedItem`

- [ ] SCMP / masthead rows get location-derived country, not masthead default
- [ ] Spot-check cargo monitor for Singapore Strait piracy rows
- [ ] No version bump unless relevance rules touched

### Track B — TC-02 Fast Fact plural regex (½ day)

**Key file:** `artifacts/workbench/src/lib/incidentClassifier.ts`

- [ ] Audit classifier tokens: `outages?` not `outage\b`
- [ ] Broaden energy/fertiliser/data-centre buckets where audit showed “Other” plurality
- [ ] Fast Facts unit tests added/updated

```bash
pnpm test -- incidentClassifier topicFastFacts
```

### Track C — CB-02 Opinion/editorial banned phrases (½ day)

**Key file:** `@workspace/country-engine`

- [ ] Extend banned phrase list from slop catalog
- [ ] Re-run `country-brief-sweep`

### End-of-day gate

| ID | Gate |
| --- | --- |
| CG-02 | SCMP maritime row country corrected in spot-check |
| TC-02 | Plural regex tests green; no “Data quality issue” on energy sample date (if incidents present) |
| CB-02 | Editorial FP patterns dropped; factual reporting not false-dropped |

---

## Day 12 — Thin content, data hygiene, Phase 4 prep (TC-01, HY-02, buffer)

**Goal:** Start highest-value remaining P2; run full regression; hand off to Phase 4 validation.

### Morning — TC-01 Thin-content topics (Energy / Fertiliser / Data Centres)

**Key files:** `draftReportProse.ts`, `incidentClassifier.ts`

- [ ] Read `.agents/memory/report-thin-content-diagnosis.md`
- [ ] Fix **both** ReportPack section depth **and** classifier buckets (not one alone)
- [ ] Verify classifier runs on relevance-filtered + windowed rows only

```bash
pnpm --filter workbench exec tsx scripts/auditReports.ts
pnpm test -- draftReportProse incidentClassifier
```

**Note:** TC-01 effort = 3; if not complete by EOD, carry remainder to follow-on — do not rush at cost of classifier precision.

### Midday — HY-02 Unknown country aliases

**Key file:** ingest `COUNTRY_ALIASES`

- [ ] Expand aliases for subnational region feeds (Nepal, Bangladesh, Philippines)
- [ ] Marker-gated backfill dry-run (Unknown-only)
- [ ] Target ≥80% Unknown → resolved on sample set

### Afternoon — Integration + Phase 4 prep

```bash
pnpm test
pnpm typecheck
ISSUE=2026-05-31 pnpm --filter workbench run audit:ingestion-report   # refresh kept/dropped doc
```

- [ ] Per-fix checklist (3.1) signed off for all shipped items
- [ ] Kept/dropped delta attached for FP-01, CG-01
- [ ] Before/after PDFs in proof pack folder for Phase 4
- [ ] Park P3 explicitly: SH-01, CF-01, PV-01, ST-01, DC-01 → follow-on sprint

### End-of-day gate — **Phase 3 sprint complete**

| Criterion | Target |
| --- | --- |
| P1 items FP-02 … CB-01 | All acceptance criteria met |
| P2 shipped | CG-02, TC-02, CB-02 done; TC-01 + HY-02 started or done |
| Test suite | `pnpm test` + `pnpm typecheck` green |
| Phase 4 | QA gate run list prepared; proof pack started |

---

## Per-fix checklist template

Copy for each shipped backlog item (from plan §3.1):

| Item | FP-02 | FP-01 | FP-03 | CG-01 | CB-01 | … |
| --- | --- | --- | --- | --- | --- | --- |
| Change in shared lib (not preview/PDF duplicate) | ☐ | ☐ | ☐ | ☐ | ☐ | |
| `RELEVANCE_RULE_VERSION` bumped if needed | n/a | ☐ | n/a | ☐ | n/a | |
| Boot migration / marker-gated backfill | n/a | ☐ | ☐ | ☐ | n/a | |
| Unit / render tests updated | ☐ | ☐ | ☐ | ☐ | ☐ | |
| Dry-run replay on live prod rows | ☐ | ☐ | ☐ | ☐ | ☐ | |
| Preview == PDF verified | ☐ | ☐ | ☐ | ☐ | ☐ | |

---

## Parallel work (optional)

If two devs available:

| Dev A | Dev B |
| --- | --- |
| Day 6–8: FP-02 → FP-03 (selector + parity) | Day 6–7: FP-01 (relevance) — **sync daily** on public-order cues |
| Day 9: CG-01 | Day 10: CB-01 |
| Day 11: TC-02 + CB-02 | Day 11: CG-02 + HY-02 start |

**Critical sync point:** FP-01 and FP-02 owners must review combined funnel before Day 8 deploy.

---

## Roll-forward (post Day 12)

Items not in this sprint — schedule as Phase 3b or fold into maintenance:

| Priority | IDs | Est. |
| --- | --- | --- |
| P2 remainder | HY-01 (geocode masthead), SOC-01 (social promote) | 2–3 days |
| P3 | SH-01, CF-01, PV-01, ST-01, DC-01 | 3–5 days |

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
```

*Aligned with [Phase 2 backlog](../phase-2-fix-plan/phase-2-prioritised-fix-backlog.md) · 2026-08-26*
