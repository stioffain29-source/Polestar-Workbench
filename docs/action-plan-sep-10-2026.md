# Action Plan — Report Quality Reset (10 Sep 2026)

**Date:** 10 September 2026 (revised evening — Fuel Watch code landed on `develop-0909`)  
**Context:** Steve Ward morning audit + Flashpoint PDF review + Fuel Watch architecture list. Afternoon 12:16: classes not named stories. Evening: teammates shipped Fuel Watch pipeline work (`0d5ba0fb`, `9f91ea08`). Bench runtime was healthy in the morning audit. **Production remains “not fully resolved”** until five transient semantic-provider holds clear and prod is checked directly. West Papua security rows stay on convergence retry — no manual force-through.

**Steve 12:16 (binding):** Named stories on a single report are not the work. This is an **overall reporting failure**. If we patch Dhaka/Kathmandu this week, next cycle it is Jakarta (or Nepal, or a Fuel corridor). The same classes must fail closed everywhere, or we chase the tail.

**Supersedes for prioritisation:** [Action Plan — Sep 2026 (prior)](./action-plan-sep-2026.md). Sprint 1b/1c shipped in code; the 10 Sep Flashpoint PDF still shows the same **failure classes**. Fuel Watch now has a first implementation of the shared architecture **in code** — Steve PDF proof is still the acceptance signal.

**Related docs:**

- [Action Plan — Sep 2026 (prior)](./action-plan-sep-2026.md)
- [Ingestion & Report Quality Plan](./ingestion-report-quality-plan.md)
- [Phase 4 proof pack](./phase-4-proof-pack/week0-baseline/README.md)
- Agent memory: [report-period-evidence-audit](../.agents/memory/report-period-evidence-audit.md), [fuel-operational-relevance](../.agents/memory/fuel-operational-relevance.md), [fuel-evidence-family-weighting](../.agents/memory/fuel-evidence-family-weighting.md)

---

## Code landed 10 Sep (Fuel Watch) — do not re-implement

Branch `develop-0909`. Commits:

| SHA | What it did |
| --- | --- |
| `0d5ba0fb` | Fuel operational-consequence relevance; period/lag market indicators; shared `finalReportEvidenceAudit`; Fuel preview/PDF fail-closed; `RELEVANCE_RULE_VERSION` → `2026-09-10.1` |
| `9f91ea08` | Evidence-family weighting; `finalizeFuelPublication` as the one preview/PDF publication boundary; Watch Next from ledger (no evergreen top-up); byte-identical preview/PDF finalization tests |

**What exists in code (shared module, Fuel adapter only):**

| Plan ID | Implementation | Surfaces |
| --- | --- | --- |
| RA-12 / C6 | `artifacts/workbench/src/lib/finalReportEvidenceAudit.ts` — topic-agnostic codes: `PERIOD_ALIGNMENT`, `UNSUPPORTED_CAUSAL_CLAIM`, `UNSUPPORTED_BOILERPLATE`, `VAGUE_CHANGE`, `WATCH_NEXT_UNGROUNDED`, `BACKEND_CONFIDENCE_LEAK`, `RAW_EVIDENCE_TITLE`, `PRIORITY_GEOGRAPHY_CONTRADICTION` | Fuel adapter in `fuelReportConsistency.ts` (`validateFuelFinalEvidenceAudit`) |
| RA-01 / RA-02 / C8 | `fuelMarketIndicators.ts` + canonical facts: current vs lagged vs undated; Market Read must not call lagged series a weekly move | Fuel facts + audit |
| RA-03 / FW-01 / FW-02 / C9 | `FUEL_OPERATIONAL_CONSEQUENCE` in `lib/relevance/src/topicRelevance.ts`; bare oil/tanker/Hormuz/refinery **mention** drops; masthead/publisher/assigned country are **not** evidence | Ingest relevance + `fuelExcludes.test.ts` |
| RA-04 / C3 (partial) | Relevance ignores publisher, URL, assigned country, stored location when deciding consequence | Does **not** yet re-assign report geography from physical event |
| RA-05 / RA-06 / RA-08 / RA-09 / RA-10 / RA-11 | Causal, boilerplate, vague “confirmed change”, Watch Next grounding, backend-confidence leak, cross-section priority geo | Shared audit; Fuel `finalizeFuelPublication` |
| C4 (Fuel) | `buildFuelEvidenceLedger` — syndicated / follow-on / commentary → one family with bounded weight; facts, rankings, narratives, audit share the ledger | Fuel only |
| Preview == PDF | `finalizeFuelPublication` called from `ReportPreview.tsx` and `exportTopicReportPdf.ts`; audit issues block preview and throw `FUEL_PUBLICATION_AUDIT_FAILED` on PDF | Fuel only |

**What did *not* land:**

- Flashpoint (and Cargo / Energy) **do not** call `auditFinalReportEvidence` or `finalizeFuelPublication`-style publication.
- Named files in the morning plan (`reportEvidenceAudit.ts`, `reportCrossSectionConsistency.ts`) were **not** created — use `finalReportEvidenceAudit.ts` instead.
- No Steve-visible Fuel or Flashpoint PDF after these commits.
- No live 30-day Fuel relevance replay recorded in this repo (agent memory requires it before treating the version bump as accepted).
- Flashpoint R21–R26 / R30 class gaps are unchanged.

**Implication for this plan:** Sprint C is **code-complete on Fuel**, not Steve-complete. Remaining product work is (1) prove Fuel on a headless PDF + live relevance replay, (2) **consume the same audit on Flashpoint** rather than building a second stack, (3) close Flashpoint C4–C7/C9 on the 10 Sep fixture.

---

## North star — failure classes, not named stories

Do **not** patch individual incidents, countries, headlines, or keywords. Do **not** expand a blacklist every time Steve names a row. The objective is to stop the **class** recurring under a different headline, country, or commodity.

| Class | What must be true | 10 Sep Flashpoint example (fixture only) | Recurs as… | Code (10 Sep evening) |
| --- | --- | --- | --- | --- |
| **C1 Event validity** | Record describes a real qualifying event. Mention / commentary / process is not an event. | HR commission investigation (R26) | Inquiry, court, bill, “protest mentioned” | Fuel: consequence required. Flashpoint: **open** |
| **C2 Event type ≠ keywords** | Classify what happened, not headline language. | Process tagged as unrest | Fusion-as-protest, crime-as-unrest | Fuel: exclude + consequence. Flashpoint: **open** |
| **C3 Geography from the event** | Country = where the event physically occurred. | BD protest in US/UK as APAC (prior PDFs) | Jakarta/Nepal mis-geo | Fuel: metadata not used as evidence. Assignment still **open** |
| **C4 One canonical set** | Counts, tables, Fast Facts, charts, prose use one set. | SK and BD both 6; prose crowns SK (R22) | Any tie / parallel selector | Fuel: evidence families. Flashpoint ties: **open** |
| **C5 Contradiction / parity** | Narrative severity / “most affected” cannot disagree with tables; sections share priority geo. | Dhaka vs Kathmandu High (R21) | Nepal vs Jakarta | Fuel: `PRIORITY_GEOGRAPHY_CONTRADICTION`. Flashpoint: **open** |
| **C6 Evidence-to-prose** | Material claims trace to validated evidence. No template. | Activism Read / Polestar View boilerplate | Fuel market boilerplate | Fuel: audit + ledger-built sections. Flashpoint: **open** |
| **C7 Client language** | No backend/file/table talk; no raw-feed titles. | “on file”, “the table above” (R23) | Any topic | Fuel: `BACKEND_CONFIDENCE_LEAK` / `RAW_EVIDENCE_TITLE`. Flashpoint: **open** |
| **C8 Window + lag** | Out-of-window ≠ “this week”. Watch Next = indicators, not invented dates. | Forecast machinery; “confirmed dates in Watch Next” | Fuel weekly move on lagged series | Fuel: **in code**. Flashpoint: **open** |
| **C9 Scope / operational consequence** | Topic admits only in-scope operational events. | Process story in unrest tables | Oil/Hormuz mention, no fuel consequence | Fuel: **in code**. Flashpoint process-vs-event: **open** |
| **C10 Layered hold** | Low-confidence held/dropped. Rejection reasons internal. | Semantic holds + over-admission | Forcing uncertain rows | Ops holds **open**; Fuel audit fail-closed **in code** |

**Regression fixtures** (prove the class, do not encode the headline as the fix):

- Flashpoint: `polestar-report-flashpoint-202609101057.pdf` (primary). Also replay `…082050.pdf`, `…072120.pdf`.
- Fuel: any current issue-date headless PDF after `finalizeFuelPublication`; plus live relevance replay vs persisted `2026-09-10.1` verdicts.
- Adversarial set: keyword false positives, foreign-subject vs physical location, commentary/non-event, process/investigation, crime-as-unrest, historical-as-current, duplicate syndication, ambiguous geo/type, **tied country counts**, **narrative vs table severity**.
- Tests must verify **logic**. Hardcoding “Dhaka”, “Kathmandu”, “South Korea”, or “Jakarta” as the defence is the tail-chase.

**Protect (keep winning):** What Matters location-specific operational risks; Implications for Business as location-specific actions; Watch Next as indicators and triggers (not dates). Forecast logic stays confirmed vs unconfirmed mobilisation. **No PDF layout or visual design changes.**

---

## Steve's 10 Sep audit (bench health)

| Check | Result |
| --- | --- |
| Build / typecheck | Pass |
| Focused tests | 39/39 pass |
| API + Workbench runtime | Healthy |
| Browser console | Clean |
| PDF font audits | Pass |
| Country brief sweep | Pass |

**Flashpoint data (30-day window):**

| Metric | Value |
| --- | --- |
| Rows | 1,482 |
| Semantic version coverage | 1,373 (92.6%) |
| Valid | 174 |
| Needs review | 282 |
| Invalid | 917 |
| **Transient provider holds** | **5** |

**Last 24 hours:** 25 candidates — 8 valid, 3 needs review, 14 invalid; all geocoded.

**Active reliability risk:** Five rows still have semantic-validator failures (including credible West Papua security events). Five-minute retry is active; provider is intermittently failing. Convergence process should clear these — **do not** treat as resolved until holds = 0 and prod is spot-checked.

**Developer verdict (Steve):** Code and runtime healthy. Do not call production fully resolved until transient holds clear and production data is checked directly.

**Note:** Evening Fuel commits added tests (`fuelSharedArchitecture`, `finalReportEvidenceAudit`, consequence fixtures). Re-run the full suite before claiming the morning “39/39” figure; do not treat that count as current.

---

## 10 Sep PDF — mapped to classes (not a punch list)

Primary Flashpoint fixture: `polestar-report-flashpoint-202609101057.pdf`. Rows below are **how the class showed up today**. Closing the named row without the class gate is not done. **Fuel commits do not close these.**

| # | What Steve saw | Class | Shared control | Status |
| --- | --- | --- | --- | --- |
| R21 | Narrative “most serious” ≠ table max severity | **C5** | Wire Flashpoint into `auditFinalReportEvidence` + dataset parity | Open |
| R22 | Tied country counts; prose picks a winner | **C4, C5** | Single set + ranking/tie rule | Open |
| R23 | Backend / file / table meta-language | **C7** | Extend audit `BACKEND_CONFIDENCE_LEAK` seed (“table above”, “Named locations”) + Flashpoint adapter | Open |
| R24 | Activism Read generic boilerplate | **C6** | Evidence-built section contract on canonical Flashpoint set | Open |
| R25 | Forecast explains the table / period machinery | **C6, C8** | Indicator + operational meaning only | Open |
| R26 | Investigation/process admitted as unrest | **C1, C2, C9** | Event-validity + scope | Open |
| R27 | What Matters location-specific (keep) | — | Regression guard | Keep |
| R28 | Implications location-specific (keep) | — | Regression guard | Keep |
| R29 | Watch Next indicators/triggers (keep) | **C8** | Grounded signals only | Keep |
| R30 | Polestar View generic; “confirmed dates in Watch Next” | **C6, C8** | Judgement from same evidence set | Open |

**What improved (Flashpoint PDF):** What Matters, Implications for Business, Watch Next structure.  
**What never closed (Flashpoint):** C4–C7 and C9 still render in client output.

---

## Fuel Watch — F-list vs code

Steve: *“Fuel watch is worse than its ever been.”* His list is **shared report architecture**. Fuel-specific relevance is the topic flavour of **C9**.

| # | Requirement | Class | Backlog | Code (10 Sep evening) | Steve PDF |
| --- | --- | --- | --- | --- | --- |
| F1 | Period alignment | C8 | RA-01 | Shipped — market comparison scope + `PERIOD_ALIGNMENT` | Open |
| F2 | Lagged labelled, not “this week” | C8 | RA-02 | Shipped — `temporalStatus` / Market Read context copy | Open |
| F3 | Operational fuel consequence | C9 | RA-03, FW-01 | Shipped — `FUEL_OPERATIONAL_CONSEQUENCE` | Open |
| F4 | Mention of oil/tanker/Hormuz ≠ admit | C1, C9 | RA-03, FW-02 | Shipped — drop without consequence | Open |
| F5 | Physical geography of the fuel event | C3 | RA-04 | Partial — metadata not evidence; country assignment still open | Open |
| F6 | Causal language needs evidence | C6 | RA-05 | Shipped — `UNSUPPORTED_CAUSAL_CLAIM` | Open |
| F7 | No generic market boilerplate | C6 | RA-06 | Shipped — `UNSUPPORTED_BOILERPLATE` + ledger-built narratives | Open |
| F8 | Prose from validated developments | C6 | RA-06 | Shipped in builders; thin weeks allowed to say less | Open |
| F9 | No raw-feed language | C7 | RA-07 | Shipped — `RAW_EVIDENCE_TITLE` | Open |
| F10 | Cross-section priority consistency | C5 | RA-08 | Shipped — `PRIORITY_GEOGRAPHY_CONTRADICTION` | Open |
| F11 | Ban unnamed “confirmed change” | C7 | RA-09 | Shipped — `VAGUE_CHANGE` | Open |
| F12 | Watch Next grounded | C8 | RA-10 | Shipped — ledger / typed refs; no evergreen defaults | Open |
| F13 | Backend confidence internal | C7, C10 | RA-11 | Shipped — `BACKEND_CONFIDENCE_LEAK` | Open |
| F14 | Pre-render evidence-to-prose audit | C6 | RA-12 | Shipped — preview block + PDF throw | Open |

**Hard rule unchanged:** do not fork a second audit for Flashpoint. Add a Flashpoint adapter that translates the canonical unrest set into `FinalReportEvidenceAuditInput`.

---

## Honest assessment

| Claim | Reality (10 Sep evening) |
| --- | --- |
| FP-10/FP-11 contradiction gates shipped | C5 still renders on the Flashpoint PDF. Gate was instance-shaped. |
| FP-14 editorial voice shipped | C6 still templated in Activism Read and Polestar View. |
| FP-09 single metrics source | C4 still broken on Flashpoint ties. |
| Fuel = parity audit only | **Superseded.** Fuel now has consequence relevance + shared evidence audit + family weighting. |
| Morning plan: Sprint A then B then C | Teammates **did Fuel (C) first**, and extracted a shared audit module. Correct next step is Flashpoint **consumption**, not a Fuel rewrite. |
| Shared architecture on all topic export paths | **Not true yet.** Only Fuel preview/PDF call the audit. |

**Root cause (Flashpoint):** dataset/validation tests against known bad rows; class gates still not on unrest export.

**Fuel remaining risk:** consequence gate is still **pattern-based** (precision-first regex). Steve asked for event-based validity so unseen story shapes still fail. Treat regex as the current defence, not the end state. Live replay before claiming F3/F4 done.

**Commitment:** No client PDF until (a) Fuel headless PDF + live relevance replay are internally green, and (b) Flashpoint C4/C5/C7 fail closed on the 10 Sep fixture **and** held-out cases that are not Nepal/Dhaka/Jakarta.

---

## Confirmed scope (evening reset)

| Priority | What we build | Classes | Status |
| --- | --- | --- | --- |
| **0** | **Shared `finalReportEvidenceAudit` on every commodity export** | C5–C8, C6, C7 | Module exists; **Fuel wired; Flashpoint not wired** |
| **1** | **Prove on Flashpoint** — adapter + C1/C4/C5/C9 unrest validity + 10 Sep fixture | C1–C10 on protests/unrest | Open |
| **2** | **Fuel Watch proof** — live relevance replay + headless PDF; close F5 geography assignment | C3 remainder; Steve read | Code in; proof **open** |
| **3** | **Production reliability** — 5 semantic holds; prod spot-check | C10 | Open |
| **4** | Cargo, country briefs, thin Energy/Fertiliser/Data Centres | Same audit, later | After P0–P2 Steve PDF |

**Hard rules:**

- **Class gates, not story patches.**
- **Do not re-implement Fuel Watch.** Extend `finalReportEvidenceAudit` and Flashpoint adapters.
- **Keyword blacklists are support, not the defence.**
- **One canonical set before any calculation** (Fuel: evidence ledger. Flashpoint: still to enforce on ties).
- **Steve PDF is acceptance** — unit tests alone are not.
- **No PDF layout or visual design changes.**
- **Protect** What Matters, Implications, Watch Next structure (R27–R29).
- **Keep** forecast logic (confirmed vs unconfirmed).
- **Prod:** “Not fully resolved” until semantic holds = 0 and prod spot-check done.
- **Relevance bump `2026-09-10.1` requires live Fuel replay** before calling F3/F4 accepted.

---

## Sprint A — Shared class gates (revised: mostly shipped for Fuel)

**Goal:** One validation layer every commodity report uses. Stops Nepal-this-week / Jakarta-next-week / Fuel-corridor-the-week-after.

**Canonical files (as landed, not the morning names):**

- `artifacts/workbench/src/lib/finalReportEvidenceAudit.ts` — shared fail-closed audit
- `artifacts/workbench/src/lib/__tests__/finalReportEvidenceAudit.test.ts`
- `artifacts/workbench/src/lib/fuelReportConsistency.ts` — Fuel adapter (`validateFuelFinalEvidenceAudit`)
- `artifacts/workbench/src/lib/fuelWatchReport.ts` — `finalizeFuelPublication`
- `lib/relevance/src/topicRelevance.ts` — Fuel C9
- `lib/country-engine/src/bannedPhrases.ts` — still the country-brief language gate; **not** yet the topic-report C7 source

### Remaining Sprint A (do this before another Fuel rewrite)

- [x] **RA-01 / RA-02 / RA-11** on Fuel publication path
- [x] **RA-07 / RA-09** pattern class in shared audit (Fuel seed: “on file”, “dataset shows”, “condition set”, unnamed confirmed change)
- [x] **Extend C7 patterns** Steve named on Flashpoint that the Fuel seed may miss: “the table above”, “Named locations”, “the file does not show” — as a **class** in `finalReportEvidenceAudit`, not a Flashpoint-only list
- [x] **Flashpoint adapter** — `flashpointPublication.ts` maps canonical unrest set + section map → `auditFinalReportEvidence`; preview and `exportFlashpointReportPdf` call `finalizeFlashpointPublication`
- [x] **Canonical set rule on Flashpoint** — volume ties cannot crown one country in Fast Facts or exclusive “heaviest volume” prose; unrest “most serious” uses table max severity. Shared `RANKING_TIE` / `SEVERITY_PARITY` codes.
- [x] **RA-08 / RA-10 / RA-12** on Fuel
- [x] Same auditor on Flashpoint via the adapter (no second auditor)

**Verify:**

```bash
pnpm test -- finalReportEvidenceAudit fuelSharedArchitecture fuelExcludes
# After adapter: flashpointReportConsistency + a Flashpoint publication audit test
```

**Sprint A exit:** RA codes run on Flashpoint **and** Fuel export paths. Class tests green. **No Steve PDF yet.**

---

## Sprint B — Prove classes on Flashpoint (Days 4–6) — still the main gap

**Not “close Dhaka.”** Prove C1–C9 on the unrest pipeline. Consume `finalReportEvidenceAudit`. The 10 Sep PDF is the **live fixture**.

**Files (primary):**

- `artifacts/workbench/src/lib/flashpointReportDataset.ts` — C4, C5, C9
- `artifacts/workbench/src/lib/draftReportProse.ts` — C6, C8
- `lib/relevance/src/topicRelevance.ts` — C1, C2, C9 (event vs process; do not copy Fuel consequence regex)
- New: Flashpoint publication helper mirroring `finalizeFuelPublication` (dataset + sections + `assertFinalReportEvidence`)
- `validateSteveFlashpointChecklist.py` — **class patterns**, 10 Sep as one replay

### Day 4 — C4 + C5 on Flashpoint

- [ ] Highest-severity claim = max severity in that subsection’s canonical table
- [ ] “Most affected” / heaviest volume uses canonical counts; **ties must not pick a winner**
- [ ] Hard-fail on those **shapes**, with fixtures that are not the 10 Sep countries

### Day 5 — C1, C2, C6, C9 on Flashpoint

- [ ] Investigation/process/commentary out unless an in-window public-order event is evidenced
- [ ] Activism and Protest Read from the canonical set only
- [ ] Forecast: confirmed forward indicator + operational meaning only

### Day 6 — C6 + C8 + protect wins

- [ ] Polestar View from the same set; Watch Next is indicators, not dates
- [ ] Regression lock: What Matters, Implications, Watch Next (R27–R29)
- [ ] Headless PDF on 2026-09-10 must pass shared audit + class checklist

**Verify:**

```bash
pnpm test -- flashpointReportConsistency flashpointProseVoice
ISSUE=2026-09-10 pnpm --filter workbench exec tsx scripts/proveFlashpointSelection.ts
python artifacts/workbench/scripts/validateSteveFlashpointChecklist.py path/to/flashpoint-20260910.pdf --issue 2026-09-10
TOPIC=flashpoint ISSUE_DATE=2026-09-10 pnpm --filter workbench exec tsx --import ./scripts/registerLoader.mjs scripts/exportReportPdfHeadless.ts
```

**Sprint B exit — deliverable to Steve:**

- Headless Flashpoint PDF on **2026-09-10**, **same layout**
- One-page **class** delta (not “we fixed Kathmandu”)
- Note that Fuel already runs the same audit module
- **No layout changes**

---

## Sprint C — Fuel Watch (code landed; proof remaining)

**Do not restart Days 7–9 implementation.** Remaining is proof and the C3 remainder.

### Already done in `0d5ba0fb` / `9f91ea08`

- [x] **FW-01 / FW-02** operational consequence; entity mention insufficient
- [x] **FW-04** causal claims need evidence (`UNSUPPORTED_CAUSAL_CLAIM`)
- [x] **FW-05** ledger-built paragraphs; boilerplate audit
- [x] **FW-06** publication path + RA-12; preview == PDF finalization test
- [x] Family weighting so coverage volume ≠ significance

### Still open

- [ ] **Live relevance replay** on recent stored Fuel rows vs `2026-09-10.1` (required before accepting the bump). Inspect lost rows by **semantic class**, not by adding headline exceptions.
- [ ] **FW-03 / F5** — assign report geography from where the fuel event occurred, not only “ignore metadata when admitting”
- [ ] **Headless Fuel PDF** on a current issue date; funnel diff (rows dropped by C9)
- [ ] Steve read of that PDF — unit tests are not acceptance

**Verify:**

```bash
pnpm test -- fuelReportFacts fuelEffectiveSections fuelReportConsistency fuelSharedArchitecture fuelExcludes finalReportEvidenceAudit
TOPIC=fuel ISSUE_DATE=<date> pnpm --filter workbench exec tsx --import ./scripts/registerLoader.mjs scripts/exportReportPdfHeadless.ts
```

**Sprint C exit:** Fuel PDF + funnel diff + live-replay note + confirmation Flashpoint will use the **same** `finalReportEvidenceAudit` (no Fuel-only fork).

---

## Sprint D — Production + proof pack (Days 10–11)

### Day 10 — Transient holds + prod verification

| Task | Owner | Exit |
| --- | --- | --- |
| Monitor 5 semantic-provider holds | Convergence + Steve | Holds = 0 |
| Spot-check prod Flashpoint rows (West Papua) | Steve + dev | Valid or needs-review, not stuck invalid |
| Confirm Fuel relevance backfill ran for `2026-09-10.1` | Dev | Persisted verdicts match new rule |
| Re-run Phase 4.1 gates on prod | Dev | PASSED email |

### Day 11 — Proof pack update

| Artifact | Purpose |
| --- | --- |
| `flashpoint-20260910-before.pdf` / `after.pdf` | Fixture replay — class proof |
| Class-test log | Ties, severity parity, process-vs-event, geo, language, evidence orphans — **non-fixture cases** |
| `fuel-watch-before.pdf` / `after.pdf` | Same RA on Fuel after live replay |
| Funnel + selection proof | C9 drops on Fuel; C1/C9 drops on Flashpoint |
| RA gate test log | `finalReportEvidenceAudit` codes on **both** topics |
| Checklist output | Class-based `validateSteveFlashpointChecklist.py` on after PDF |

**Prod sign-off (Steve):** Bench green **and** holds cleared **and** prod spot-check **and** both commodity PDFs pass his read **and** we are not defending named countries.

---

## Deferred (unchanged position)

| Item | When |
| --- | --- |
| CG-01, CG-02 Cargo | After Sprint B + C Steve sign-off — inherit `finalReportEvidenceAudit`, do not fork |
| CB-01, CB-02 Country briefs | After commodity block — C3 is the same class |
| TC-01, TC-02 Energy/Fertiliser/Data Centres | After Cargo |
| PDF layout / design | Not in scope |

---

## Risk controls

| Risk | Mitigation |
| --- | --- |
| **Tail-chase (Nepal → Jakarta)** | Class tests with held-out geographies; forbid headline-hardcoded gates |
| **Rebuilding Fuel Watch** | Treat `0d5ba0fb` / `9f91ea08` as the Fuel implementation; only proof + F5 + live replay remain |
| **Fuel-only architecture (Steve’s exact complaint)** | Next commit must wire Flashpoint to `finalReportEvidenceAudit`, not add Fuel-only phrases |
| Keyword blacklist as primary defence | C1/C2 event-validity first; Fuel regex is interim |
| Unit tests green, Steve PDF still bad | Acceptance = headless PDF + class checklist |
| Fuel C9 drops real supply events | Live replay; correct **grammar**, not country/headline exceptions |
| What Matters / Watch Next regress | R27–R29 regression tests before Sprint B exit |
| Semantic holds block West Papua | Convergence retry; do not force; track hold count |
| Sending PDFs too early | No client PDF until Fuel replay + Flashpoint C4/C5/C7 fail closed on fixture **and** non-fixture cases |

---

## Deliverables timeline (Steve updates)

| When | What Steve gets |
| --- | --- |
| **10 Sep morning** | Audit PASS (bench); Flashpoint PDF review; 12:16 correction — classes not stories |
| **10 Sep evening** | Internal: Fuel shared-audit + consequence gate on `develop-0909` — **no Steve PDF** |
| **End remaining Sprint A** | Internal: Flashpoint adapter on the same audit — no Steve PDF |
| **End Sprint B** | **Flashpoint PDF** on 2026-09-10 + one-page class delta |
| **End Sprint C proof** | **Fuel Watch PDF** + funnel diff + live-replay summary |
| **End Sprint D** | Proof pack including non-fixture class tests; prod hold status |
| **Weekly until sign-off** | Hold count, class-gate status, blockers — one short message |

---

## Immediate next actions

1. **Do not restart Fuel Watch implementation.** Review `finalizeFuelPublication` + `finalReportEvidenceAudit` and plan the Flashpoint adapter against that contract.
2. **Live Fuel relevance replay** against stored rows at `2026-09-10.1`. Record kept/lost by class. Fix grammar if recall of real operational events collapsed.
3. **Extend the shared audit** for Flashpoint C7 phrases Steve named (“the table above”, “Named locations”) as a language **class**.
4. **Sprint B:** Flashpoint canonical set, ties, severity parity, process-vs-event, evidence-built Activism Read / Forecast / Polestar View; send Steve PDF only at exit.
5. **Headless Fuel PDF** only after replay is green; then Steve read.
6. **Lock** `polestar-report-flashpoint-202609101057.pdf` as the Flashpoint class fixture — examples of C4/C5/C6/C7/C9, not a city to-do list.
7. **Track** semantic hold count daily until 0; prod spot-check before “fully resolved”.
8. **Do not** change PDF layout; **do not** regress What Matters / Implications / Watch Next; **do not** send another PDF while C4/C5/C7 can still fire on a country we have not named yet.

---

## Key commands reference

```bash
# Shared audit + Fuel (landed)
pnpm test -- finalReportEvidenceAudit fuelSharedArchitecture fuelExcludes fuelReportFacts fuelEffectiveSections fuelReportConsistency

# Flashpoint — 10 Sep fixture (proof of classes, not of named cities)
ISSUE=2026-09-10 pnpm --filter workbench exec tsx scripts/proveFlashpointSelection.ts
ISSUE=2026-09-10 pnpm --filter workbench exec tsx scripts/diagnoseFunnel.ts
python artifacts/workbench/scripts/validateSteveFlashpointChecklist.py <pdf> --issue 2026-09-10
TOPIC=flashpoint ISSUE_DATE=2026-09-10 pnpm --filter workbench exec tsx --import ./scripts/registerLoader.mjs scripts/exportReportPdfHeadless.ts

# Fuel Watch proof
TOPIC=fuel ISSUE_DATE=<date> pnpm --filter workbench exec tsx --import ./scripts/registerLoader.mjs scripts/exportReportPdfHeadless.ts

# Shared / QA
pnpm test && pnpm typecheck
.\artifacts\workbench\scripts\runPhase41.ps1
```
