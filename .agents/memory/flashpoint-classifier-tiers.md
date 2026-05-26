---
name: Flashpoint classifier — two-tier relevance with hard exclusions
description: Why isTopicRelevant for flashpoint/protests is a 4-step gate (hard exclusions → student non-mobilisation → unambiguous tier → ambiguous tier + public-order companion), not a flat REQUIRED list.
---

The Flashpoint and Protests topics use a different relevance shape from other topics. Other topics (fuel, shipping, cargo, fertiliser, energy) are one REQUIRED whitelist plus one EXCLUDE list. Flashpoint is four ordered steps because the words "rally", "strike" and "student(s)" are aggressively overloaded by the upstream country-name Google News queries — they pull in sports rallies, motorsport rallies, market/FX/bond/commodity rallies, weather strikes (lightning, thunder, storm, cyclone), military strikes (drone, missile, air, "Ukrainian/Israeli/junta strike on …"), counter-terror operations ("35 terrorists killed", IBO), and entertainment rallies (concert rallies, fan rallies) — all under topic='flashpoint' or topic='protests' in the DB.

**The four steps inside `isTopicRelevant(topic, i)` when topic ∈ {flashpoint, protests}:**

1. **FLASHPOINT_EXCLUDE hard exclusions** — drop sports / finance / weather / military / entertainment homonyms before doing anything else. Patterns target: sports verbs ("rally past", "rally to win", "ninth-inning rally", MLB team names), motorsport ("Rally Japan", "WRC", "Round N - Rally X"), market/FX/index names + "rally" within 60 chars (PSEi, Wall Street, Nikkei, Sensex, Ringgit, …), weather + "strike" ("lightning/thunder/storm/rain strike"), military + "strike" ("drone/missile/air/Ukrainian/junta strike", "IBO", "intelligence-based operation", "N terrorists killed"), entertainment ("concert/fan/promo rally", named celebrity rallies).
2. **STUDENT_NON_MOBILISATION_RE** — drop student-as-victim and education-policy stories ("student abducted", "missile strike on college", "exam scandal", "admission policy") even if they incidentally match a public-order word.
3. **Unambiguous-tier REQUIRED match** — any phrase in `REQUIRED.flashpoint` (protest, demonstration, march, sit-in, picket, walkout, riot, looting, roadblock, crackdown, curfew, martial law, hartal, bandh, gherao, Section 144) qualifies on its own.
4. **Ambiguous-tier match** — if the only flashpoint signal is FLASHPOINT_AMBIGUOUS_RE (`rally|strike|students?`), the record must ALSO match FLASHPOINT_PUBLIC_ORDER_CUE_RE (protest, union, labour, workers, police, arrest, curfew, Section 144, tear gas, baton, riot police, PTI, opposition rally, named-sector strike, etc). A bare "student(s)" further needs STUDENT_MOBILISATION_RE unless another non-student ambiguous trigger is also present.

**Why this matters:** the kinetic guard in `flashpointReportDataset.ts` (`isKineticOnly` with `HARD_KINETIC_RE` / `PROTEST_LINKED_KINETIC_RE`) is a second line of defence, but the relevance gate is where the noise should die. Letting "Stocks extend rally" reach the kinetic guard is wasted work — and worse, "Hundreds rally in Taipei for defence spending" needs to be admitted (public-order rally) while "PSEi rebounds on Wall Street rally" must be dropped (markets) — only a properly tiered relevance gate can distinguish them.

**How to apply / extend:**
- New homonym category surfaces in the report → add a regex to `FLASHPOINT_EXCLUDE` AND add a test case to `artifacts/workbench/scripts/testFlashpointClassifier.ts`. The test script is the contract; run `npx tsx scripts/testFlashpointClassifier.ts` from `artifacts/workbench`.
- Never weaken `FLASHPOINT_PUBLIC_ORDER_CUE_RE` by adding generic verbs (e.g. "gather", "rise", "react") — they re-admit the homonyms the exclude list just killed.
- The same gate must apply to BOTH `flashpoint` and `protests` topics because the report row is bound to one and the scraper writes the other (see `flashpoint-topic-alias.md`).

**Counter-rule:** do not generalise this two-tier pattern to other topics. Fuel/shipping/cargo do not have the same homonym density and the flat REQUIRED + EXCLUDE pattern works for them.
