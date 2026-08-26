# Phase 2 — Prioritised fix plan

**Status:** Backlog drafted · stakeholder agreement pending  
**Plan:** [Ingestion & Report Quality — Next Actions](../ingestion-report-quality-plan.md#phase-2--prioritised-fix-plan-days-45)

Phase 2 synthesises Phase 1 audit findings into a **ranked backlog with owners, effort estimates, and acceptance criteria**. No pipeline coding should start until this list is agreed with Steve Ward.

| Deliverable | Files |
| --- | --- |
| Ranked fix backlog (MD + DOCX) | [phase-2-prioritised-fix-backlog.md](./phase-2-prioritised-fix-backlog.md) · [phase-2-prioritised-fix-backlog.docx](./phase-2-prioritised-fix-backlog.docx) |

## Phase 1 inputs

| Source | Used for |
| --- | --- |
| [1.2 slop catalog](../phase-1-baseline-audit/1.2-slop-audit-samples.md) | Slop classes and pipeline stages |
| [Ingestion audit kept vs dropped](../phase-1-baseline-audit/ingestion-audit-kept-vs-dropped.md) | Live prod drop rates, FP/FN samples, funnel counts |
| [1.3 report logic maps](../phase-1-baseline-audit/1.3-report-logic-maps.md) | Selector divergence, thin-content traps |
| [1.4 stakeholder examples](../phase-1-baseline-audit/1.4-stakeholder-examples.md) | Template (Steve examples still pending — backlog uses audit evidence) |

## Regenerate DOCX

```bash
python scripts/generate_phase2_fix_plan_docx.py
```

## Sign-off (Phase 2 complete)

- [ ] Steve reviewed ranked backlog and agreed priority order
- [ ] Each P1–P3 item has an assigned owner
- [ ] Acceptance criteria accepted per item
- [ ] Phase 3 may begin on agreed P1 items only
