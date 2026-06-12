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

**How genuine mis-stores are fixed:** hand-reviewed, text-keyed, marker-gated single-row UPDATEs in `artifacts/api-server/src/lib/migrations.ts` — gated on the distinctive summary text AND the specific wrong stored value so they are idempotent and can never touch a correct row. NOT a rulebook change, NOT the backfill.
- Block 3f, marker `strikes_mis_stored_target_correct_v1`: "UAE energy infrastructure ... gas field set ablaze" (vessel→energy) and "HMS Lancaster ... tanker" responder (military_site→vessel).
- Block 3g, marker `strikes_mis_stored_target_correct_v2`: four attacker-as-target rows where a US force / CENTCOM was scored a military target but the struck thing is the ship/tanker — M/V Lian Star; "boarded, redirected Iranian-flagged oil tanker"; "fires missile to disable ship in Gulf of Oman, CENTCOM"; "Hellfire missile to disable ship trying to break its blockade" (all military_site→vessel).

**Deliberately LEFT ALONE (rulebook is the one that's wrong):** "Radar bases housing key US missile interceptor" reads civilian_area off "housing" but is a military radar base; "US warplane struck oil tanker sailing to ... Kharg Island" reads energy_infrastructure off the *destination* Kharg but the struck target is the tanker (vessel). These stay as stored.

**Marker lag:** as of the v2 correction, prod's `app_migration_markers` had NEITHER `_v1` NOR `_v2` — block 3f had never deployed there yet. So a new correction must use a fresh marker key (don't fold into an existing block) and both blocks fire together on the next publish; the text+value gates make the overlap harmless.

**Note:** prod is read-only from the workspace, so prod-only mis-stored rows can only be corrected via this on-boot migration (runs against the writable prod DB after deploy). dev and prod have DIFFERENT strike sets (feed non-determinism), so verify predicates against prod read-only (`executeSql environment:"production"`) before adding a correction.
