# Ingestion & Report Quality — Next Actions Plan

**Date:** 26 August 2026  
**Context:** Stakeholder feedback (Steve Ward) — ingestion still admits slop; report logic is still wrong in places. Patches are not enough; the pipeline needs a structured review and pipeline-level fixes.

**Principle:** Fix at the **shared pipeline layer** (relevance engine, dataset builders, validation gates), not per-PDF or per-report one-offs. Every rule change is versioned and backfilled.

---

## Goals

| Goal | What success looks like |
|---|---|
| **Reduce ingestion slop** | Kept/dropped audit shows clear false positives removed; no regression of real signal |
| **Correct report logic** | Counts, prose, charts, and Fast Facts agree on the same incident set; no self-contradiction |
| **Pipeline-level fixes** | Changes land in shared libs (`@workspace/relevance`, dataset builders, country-engine), not duplicated per surface |
| **Verifiable sign-off** | Before/after samples + QA gates green on live prod data |

---

## Phase 1 — Baseline audit (Days 1–3)

Establish what is wrong today before changing anything.

**Deliverables:** [`docs/phase-1-baseline-audit/`](./phase-1-baseline-audit/README.md) — health checklist, slop catalog, report logic maps, stakeholder template. Live prod samples: `pnpm --filter workbench exec tsx scripts/runPhase1SlopAudit.ts` (requires `PROD_DATABASE_URL`).

### 1.1 Ingestion health check

- [ ] Confirm prod scheduler is running (`INGEST_SCHEDULE_ENABLED`, 12h interval) and last run completed cleanly
- [ ] Review **Source Health** page — flag feeds that are empty, stale, or erroring (401/403/timeout)
- [ ] Check ingest watchdog logs for hung runs (>90 min)
- [ ] Verify integration secrets are provisioned (GDELT, ReliefWeb, OpenAI translation/prose, AIS)
- [x] **Audit pack prepared** — [1.1 checklist + SQL](./phase-1-baseline-audit/1.1-ingestion-health-check.md)

**Key files:** `artifacts/api-server/src/lib/ingestRunner.ts`, `ingestScheduler.ts`

### 1.2 Ingestion slop audit — kept vs dropped

Run existing diagnostic scripts against **live prod DB** and export sample sets for stakeholder review.

| Topic | Script / approach | Output |
|---|---|---|
| Flashpoint | `pnpm --filter workbench audit:flashpoint` | Kept vs rejected rows with stage reason |
| Flashpoint funnel | `tsx artifacts/workbench/scripts/diagnoseFunnel.ts` | Per-filter-stage drop counts |
| Flashpoint relevance replay | `tsx artifacts/workbench/scripts/replayFlashpointRelevance.ts` | Rule impact before commit |
| Cargo scope | `tsx artifacts/workbench/scripts/cargoScopeCheck.ts` | Slop filter hits |
| Live relevance (all topics) | `tsx artifacts/workbench/scripts/auditLiveRelevance.ts` | Cross-topic kept/dropped |
| GDELT eval | `pnpm --filter @workspace/scripts eval:gdelt` | Promote/enrich precision |

**Deliverable:** Spreadsheet or markdown appendix with ~20–30 examples per topic:
- **False positives** — slop that got through (title, source, topic, why it should drop)
- **False negatives** — real signal that was dropped (same fields + why it should keep)

- [x] **Slop catalog from memory** — [1.2 slop audit](./phase-1-baseline-audit/1.2-slop-audit-samples.md)
- [ ] **Live prod samples** — run `exportProdIncidentsSnapshot.ts` then `runPhase1SlopAudit.ts` → `docs/phase-1-baseline-audit/output/`

**Key slop surfaces to review:**

| Area | Location | Known noise classes |
|---|---|---|
| Shared relevance engine | `lib/relevance/src/topicRelevance.ts`, `evaluate.ts` | Homonyms, off-region syndication, commerce vs maritime |
| Cargo slop filter | `lib/relevance/src/cargoSlop.ts` | Trade press, legislation, US mastheads, livestock theft |
| Flashpoint weak-ops | `flashpointReportDataset.ts` → `selectFlashpointUsable` | Sports "strike", market "rally", photo wires, court-only |
| Geocode pollution | `lib/ingest/…` geocode lookup | Source masthead leaking as location |
| Region feeds | News region feeds | `country='Unknown'` on subnational items |
| Social promote | Facebook/Instagram/KAMMI promote pass | Minted incidents without corroboration |

### 1.3 Report logic audit — end-to-end trace

For each report type, trace: **DB rows → relevance filter → report window → dataset builder → classifier → prose → preview → PDF**.

| Report | Dataset builder | Validation / gates | Priority |
|---|---|---|---|
| Flashpoint Watch | `flashpointReportDataset.ts` | Single selector `selectFlashpointUsable` | **High** — largest builder, historical count/prose contradictions |
| Cargo Watch | cargo report builder + `cargoSlop.ts` | 10-check hard gate (`cargo-report-validation-gate`) | **High** — slop + validation coupling |
| Shipping Watch | shipping dataset builder | Monitor dedup ≠ report dedup (by design) | Medium |
| Conflict Watch | conflict dataset + LLM clustering | Event-led prose, impact-ranked | Medium |
| Fuel Watch | `fuelCanonicalFacts.ts` | Fail-closed consistency gate | Low (deterministic; verify parity only) |
| Energy / Fertiliser / Data Centres | generic `draftReportProse` path | Thin-content risk (ReportPack + classifier) | Medium |
| Country briefs (PNG, West Papua, Indonesia, Jakarta, Thailand, Philippines) | `pngReportDataset.ts`, `@workspace/country-engine` | Banned phrases, foreign-subject guards | **High** — stakeholder expectation of pipeline fix |

**Scripts:**

```bash
# Topic report data dump
tsx artifacts/workbench/scripts/topicReportData.ts

# Country brief data
tsx artifacts/workbench/scripts/countryReportData.ts

# Full report audit
tsx artifacts/workbench/scripts/auditReports.ts

# Flashpoint dataset dump
tsx artifacts/workbench/scripts/dumpFlashpointDataset.ts
```

**Deliverable:** Per-report "logic map" documenting:
1. Which incident set feeds counts vs prose vs charts
2. Where selectors diverge (if anywhere)
3. Known thin-content triggers ("Data quality issue" Fast Fact = classifier dumping into "Other")
4. Specific examples Steve has flagged (collect from stakeholder)

- [x] **Logic maps (code-traced)** — [1.3 report logic maps](./phase-1-baseline-audit/1.3-report-logic-maps.md)

**Reference:** `.agents/memory/report-thin-content-diagnosis.md` — thin reports usually have **two** coupled causes (thin ReportPack + coarse classifier).

### 1.4 Collect stakeholder examples

- [ ] Ask Steve for 3–5 specific report PDFs or monitor screenshots that are still wrong
- [ ] Tag each example: slop-in / wrong-count / wrong-prose / thin-content / wrong-country / other
- [ ] Map each example to a pipeline stage (ingest, relevance, selector, classifier, prose)
- [x] **Template ready** — [1.4 stakeholder log](./phase-1-baseline-audit/1.4-stakeholder-examples.md) (send request to Steve)

---

## Phase 2 — Prioritised fix plan (Days 4–5)

Synthesise audit findings into a ranked backlog. **No coding until this list is agreed.**

**Deliverables:** [`docs/phase-2-fix-plan/`](./phase-2-fix-plan/README.md) — [ranked backlog MD + DOCX](./phase-2-fix-plan/phase-2-prioritised-fix-backlog.md) (17 items, P1–P3 tiers, owners, acceptance criteria).

- [x] **Backlog drafted** from Phase 1 live audit + logic maps
- [ ] **Stakeholder agreement** — Steve sign-off on priority order (§8 of backlog doc)
- [ ] **Owners assigned** for P1 items (FP-02, FP-01, FP-03, CG-01, CB-01)

Regenerate DOCX: `python scripts/generate_phase2_fix_plan_docx.py`

### 2.1 Ingestion fixes (pipeline-level)

Each fix must follow the golden rule:

> Relevance/classifier change → bump `RELEVANCE_RULE_VERSION` in `lib/relevance/src/evaluate.ts` → boot backfill re-cleans prod

| Fix type | Approach | Verify |
|---|---|---|
| New exclude / keep rule | Tightly bound regex in `@workspace/relevance`; precision-first (remove over-broad REQUIRED, don't add broad excludes) | Replay full live row set before commit |
| Cargo slop | Mirror gate in ingest + display; bump version | `cargoScopeCheck.ts` + cargo report gate |
| Geocode masthead | Expand gazetteer or add theatre bounding-box clamp | `backfill:geocode` dry-run |
| Unknown country on region feeds | Expand `COUNTRY_ALIASES`; marker-gated backfill (Unknown-only) | Spot-check subnational feeds |
| Feed coverage gap | Place-anchored Google News edition feed (no version bump) | Source Health + dry-run insert count |

### 2.2 Report logic fixes (pipeline-level)

| Fix type | Approach | Verify |
|---|---|---|
| Count ≠ prose contradiction | One shared selector per report (Flashpoint: `selectFlashpointUsable` for ALL sections) | `proveFlashpointSelection.ts`, parity tests |
| Thin content | Fix **both** ReportPack in `draftReportProse.ts` AND classifier buckets in `incidentClassifier.ts` | Classifier verified on relevance-filtered + windowed rows only |
| "Data quality issue" Fast Fact | Broaden classifier buckets; check plural-matching trap (`outages?` not `outage\b`) | Fast Facts unit tests |
| Country brief noise | Named RE in country-engine gate + replay `isCountryRelevant` over live rows | `country-brief-sweep` workflow |
| Preview ≠ PDF | Fix shared builder once; never patch preview or PDF alone | Headless PDF harness |
| Stale prose | Fingerprint cache invalidation; issue-date window clamp | Stale-prose guard tests |

### 2.3 Prioritisation matrix

Score each item: **Impact** (credibility to stakeholder) × **Effort** × **Risk** (signal loss).

Suggested default order (adjust after audit):

1. Flashpoint — slop through ingest + selector/prose alignment
2. Cargo Watch — slop filter + validation gate consistency
3. Country briefs — shared engine hardening (not per-theatre patches)
4. Thin-content topics — ReportPack + classifier coupling
5. Geocode / Unknown country — data hygiene backfills
6. Shipping / Conflict — secondary logic review
7. Dead code cleanup — fuel legacy paths, unused Jakarta builders (lower urgency)

**Deliverable:** [Ranked backlog with owner, estimated effort, and acceptance criteria per item](./phase-2-fix-plan/phase-2-prioritised-fix-backlog.md).

---

## Phase 3 — Implement & backfill (Days 6–12)

Work top-down through the agreed backlog.

### 3.1 Implementation checklist (per fix)

- [ ] Change lands in shared lib (not duplicated in preview + PDF + monitor)
- [ ] `RELEVANCE_RULE_VERSION` bumped if relevance rules changed
- [ ] Boot migration or marker-gated backfill if stored data needs re-cleaning
- [ ] Unit / render tests updated or added for the specific regression
- [ ] Dry-run replay on live prod rows shows expected kept/dropped delta
- [ ] Preview == PDF verified for affected report surface

### 3.2 Key constraints (do not break)

1. **Preview == PDF** for every report surface
2. **Signal thin > noise in** — conservative false-drops acceptable; document any intentional drops
3. **No fabrication** — empty windows labelled honestly
4. **Severity demote-only** at display time — never up-rate
5. **Fuel Watch** — canonical facts only; no AI override of analytical sections
6. **Prod schema** — Drizzle schema + idempotent boot migration in same change

### 3.3 Institutional knowledge

Before changing relevance, prose, severity, dedup, or PDF paths:

- Read `.agents/memory/MEMORY.md` and the topic-specific memory file for the area being changed
- Read `docs/dev-handover-audit.md` §12 Golden rules

---

## Phase 4 — Validation & sign-off (Days 13–14)

### 4.1 Automated QA gates (live prod data)

Run all three validation workflows (currently registered in `.replit`):

| Workflow | What it checks |
|---|---|
| `pdf-fonts` | Country brief PDFs use Roboto only |
| `topic-font-audit` | Topic report PDF font audit (live-data dependent) |
| `country-brief-sweep` | Six country/city briefs — country gate + banned phrases |

Plus full test suite:

```bash
pnpm test          # 230 suites / 3,634 tests
pnpm typecheck
```

### 4.2 Before/after proof pack

For each fixed item in the backlog:

- [ ] Export headless PDF before fix (baseline — if not already captured)
- [ ] Export headless PDF after fix
- [ ] Kept/dropped sample diff for ingestion changes
- [ ] Screenshot or `pdftotext` excerpt showing the specific issue is resolved

**Scripts:** `artifacts/workbench/scripts/exportReportPdfHeadless.ts`, `scripts/exportReportPdfHeadless.ts`, `artifacts/workbench/scripts/generateSystemicFixPdfs.ts`

### 4.3 Stakeholder review

- [ ] Share proof pack with Steve
- [ ] Walk through 3–5 flagged examples live
- [ ] Agree closure criteria for each backlog item
- [ ] Document any accepted residual noise (with rationale)

---

## Ongoing — not one-time

Data quality is **heuristic and iterative**. After sign-off:

| Cadence | Action |
|---|---|
| After every relevance change | Version bump + replay + backfill |
| Weekly | Spot-check Source Health + latest Flashpoint/Cargo kept set |
| Per report issue date | Run QA gates before treating report as publish-ready (`issueDate` = de-facto publish date) |
| Quarterly | Re-run full slop audit scripts; refresh stakeholder sample set |

---

## Open items from handover (fold into backlog)

From `docs/dev-handover-audit.md` §11 — lower priority but worth scheduling after core fixes:

- [ ] Strip unused Jakarta prose builders
- [ ] Harden section-hiding for remaining report sections
- [ ] Banned-wording guard for analyst-edited sections
- [ ] Remove dead fuel prose legacy paths (`fuelReportFacts.ts`, `fuelReportConsistency.ts`)
- [ ] Frontend bundle code-splitting (optimisation)

---

## Quick reference — key paths

```
Ingestion orchestration     artifacts/api-server/src/lib/ingestRunner.ts
Relevance engine            lib/relevance/src/
Cargo slop                  lib/relevance/src/cargoSlop.ts
Flashpoint selector         artifacts/workbench/src/lib/flashpointReportDataset.ts
Report prose resolution     artifacts/workbench/src/lib/topicProseResolution.ts
Draft prose packs           artifacts/workbench/src/lib/draftReportProse.ts
Incident classifier         artifacts/workbench/src/lib/incidentClassifier.ts
Country engine              lib/country-engine/
Fuel canonical facts        artifacts/workbench/src/lib/fuelCanonicalFacts.ts
Rulebook / memory           .agents/memory/MEMORY.md
Handover audit              docs/dev-handover-audit.md
```

---

## Summary timeline

| Phase | Duration | Outcome |
|---|---|---|
| **1 — Baseline audit** | Days 1–3 | Kept/dropped samples, report logic maps, stakeholder examples tagged |
| **2 — Fix plan** | Days 4–5 | Ranked backlog drafted · [phase-2-fix-plan/](./phase-2-fix-plan/README.md) · stakeholder agreement pending |
| **3 — Implement** | Days 6–12 | Pipeline fixes, version bumps, backfills, tests |
| **4 — Validation** | Days 13–14 | QA gates green, proof pack, stakeholder sign-off |

**Next immediate action:** Review [Phase 2 backlog](./phase-2-fix-plan/phase-2-prioritised-fix-backlog.md) with Steve; assign P1 owners; then begin Phase 3 on FP-02 + FP-01.
