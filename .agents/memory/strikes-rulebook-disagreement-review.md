---
name: Strike stored-vs-rulebook category disagreements
description: Why a blanket rulebook overwrite of strike target_category is unsafe, and how the few genuine mis-stores are corrected.
---

# Strike target_category: stored vs rulebook disagreements

When a strike row's stored `target_category` disagrees with `classifyStrikeTarget()` over (summary + source), the STORED value is usually RIGHT and the rulebook is wrong. Reviewed every such row across dev + prod: the large majority are correctly stored and the rulebook would corrupt them.

**Why the rulebook loses these:** it is pure regex and cannot tell
- attacker from target — "US Central Command"/"CENTCOM"/"US disables tanker" is the striker, not a military target (MILITARY_SIG fires anyway);
- aircraft from ship — "KC-135 tankers" are refuelling AIRCRAFT, VESSEL_SIG matches "tanker";
- responder from target — "HMS Lancaster first to respond after drone attack on tanker" is not the thing hit;
- a co-mentioned secondary target — a headline naming both a tanker and an oil/energy site;
- "radar bases housing ..." — "housing" trips CIVIL_SIG though the target is a military radar base.

**Decision:** a blanket / automated rulebook reconciliation is UNSAFE — it would overwrite many correct values to fix a couple. The fill-only-when-blank backfill (`runStrikesBackfill`, migrations block 3e) is correct and must stay blank-only.

**How genuine mis-stores are fixed:** hand-reviewed, text-keyed, marker-gated single-row UPDATEs in `artifacts/api-server/src/lib/migrations.ts` (block 3f, marker `strikes_mis_stored_target_correct_v1`) — gated on the distinctive summary text AND the specific wrong stored value so they are idempotent and can never touch a correct row. NOT a rulebook change, NOT the backfill.

**Note:** prod is read-only from the workspace, so prod-only mis-stored rows can only be corrected via this on-boot migration (runs against the writable prod DB after deploy). dev and prod have DIFFERENT strike sets (feed non-determinism), so verify predicates against prod read-only (`executeSql environment:"production"`) before adding a correction.
