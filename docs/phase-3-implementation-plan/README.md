# Phase 3 — Implementation plan

**Status:** Ready to start after Phase 2 sign-off  
**Plan:** [Ingestion & Report Quality — Next Actions](../ingestion-report-quality-plan.md#phase-3--implement--backfill-days-612)

Work **top-down** through the [Phase 2 backlog](../phase-2-fix-plan/phase-2-prioritised-fix-backlog.md). Days 6–12 cover all **P1** items and the highest-value **P2** items; P3 items roll to a follow-on sprint unless time remains on Day 12.

| Deliverable | File |
| --- | --- |
| Day-by-day schedule | [phase-3-day-by-day-plan.md](./phase-3-day-by-day-plan.md) |

## Prerequisites (before Day 6)

- [ ] Phase 2 backlog agreed with Steve ([§8 sign-off](../phase-2-fix-plan/phase-2-prioritised-fix-backlog.md#8-stakeholder-sign-off))
- [ ] P1 owners assigned: FP-02, FP-01, FP-03, CG-01, CB-01
- [ ] Prod snapshot exported: `pnpm --filter workbench run audit:export-snapshot`
- [ ] Baseline headless PDFs captured for Flashpoint + Cargo + Indonesia brief (Phase 4 before pack)

## Sprint at a glance

| Day | Focus | Backlog IDs | Gate |
| --- | --- | --- | --- |
| **6** | Flashpoint selector FN recovery | FP-02 | Funnel 15–40 usable rows |
| **7** | Flashpoint relevance + version bump | FP-01 | Replay delta documented |
| **8** | Flashpoint parity + backfill deploy | FP-03 | P1 Flashpoint block done |
| **9** | Cargo slop coupling | CG-01 | Validation gate green |
| **10** | Country brief foreign-subject gate | CB-01 | `country-brief-sweep` green |
| **11** | P2 quick wins (cargo tag, Fast Facts, banned phrases) | CG-02, TC-02, CB-02 | P2 batch 1 done |
| **12** | Thin content + data hygiene + Phase 4 prep | TC-01, HY-02, buffer | `pnpm test` green; proof pack started |

## Sign-off (Phase 3 complete)

- [ ] All P1 acceptance criteria met ([backlog §4](../phase-2-fix-plan/phase-2-prioritised-fix-backlog.md#4-detailed-backlog-items))
- [ ] Per-fix checklist (3.1) signed off for each shipped item
- [ ] Relevance version bump + backfill markers recorded in deploy notes
- [ ] Phase 4 validation can begin ([Phase 4 plan](../ingestion-report-quality-plan.md#phase-4--validation--sign-off-days-1314))
