# Research Notes: DB Ports Technical Feasibility

**Status:** complete
**Depth:** Standard

## Plan

- **Question:** Can one analyst reliably produce a fortnightly APAC and Oceania ports, terminals and logistics intelligence bulletin using the existing Workbench?
- **Scope:** Southeast Asia, Greater China, Japan, South Korea, Australia, New Zealand and materially relevant Pacific Island states; excludes the Indian Subcontinent, Middle East conflict and Red Sea/Houthi reporting.
- **Audience:** Client-facing feasibility decision for “DB Ports”.
- **Deliverable:** Technical feasibility report plus a limited, unpublished 14-day trial sample; no product build.

## Focus Areas

| # | Area | Status | Sources |
|---|---|---|---|
| 1 | Existing system capabilities and source inventory | complete | codebase audit |
| 2 | Country/theme coverage and source gaps | complete | 16 official/specialist sources |
| 3 | Fourteen-day candidate test and materiality filtering | complete | 1,406 rows screened |
| 4 | Lawful automation sources and continuity risks | complete | 22-source registry |
| 5 | Human workload, MVP workflow and viability | complete | operating-model audit |

## Coverage Checklist

- [x] Inventory relevant feeds, APIs, scrapers and stored sources.
- [x] Assess country and theme coverage, including Pacific states.
- [x] Test exclusions, materiality, deduplication and location extraction.
- [x] Identify lawful automated sources and manual-review sources.
- [x] Assess fact/claim/judgement separation and draft-item generation.
- [x] Assess editable Word export and client-specific watchlists.
- [x] Estimate setup work and recurring human production time.
- [x] Provide a go, conditional-go or no-go recommendation.

## Findings Log

- Existing ingest, provenance, editing and PDF systems are reusable.
- Native DOCX generation exists for Spot Reports but not DB Ports.
- Current source coverage is discovery-grade, not publication-grade.
- The 14-day trial found seven plausible developments from 1,406 rows; 364 of 469 screened rows lacked summaries.
- Reliable solo production currently requires roughly 32–51 hours per fortnight.
- Recommendation: conditional go for a constrained pilot only.

## Conflicts & Open Questions

- Workload estimates varied because lower figures assumed mature automation. The report uses the current-state, quality-controlled base estimate and states the mature-pilot target separately.

## Gaps

- Public automation terms remain unconfirmed for several official HTML/PDF portals.
- The trial used one structured discovery dataset and does not prove complete regional coverage.