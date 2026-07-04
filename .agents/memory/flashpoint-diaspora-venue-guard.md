---
name: Flashpoint diaspora foreign-venue guard
description: Why a protest abroad about an APAC country still leaks, and the two guards that must be patched in lockstep to drop it.
---

A diaspora protest physically at a Western venue that names an APAC country as
its SUBJECT (e.g. "Filipino youth hold protest in Ottawa to denounce the visit
of the president of the Philippines") is NOT an in-region civil-unrest event.
It must be dropped, but the out-of-region theatre gate (`FP_OFFSHORE_THEATRE_RE`)
canNOT catch it: that gate is rescued whenever an APAC anchor appears, and here
the APAC country IS present (as the subject).

The correct guard is the VENUE-gated pair, which keys on "in/at/outside/near/
across <foreign city>" and is therefore APAC-anchor-immune (a venue preposition
proves the physical location is foreign regardless of subject mentions):
- relevance: `FP_OVERSEAS_VENUE_RE` (+ `FP_OVERSEAS_PROTEST_RE`), runs BEFORE the
  title-rescue / protest-verdict keep paths.
- ingest: `FOREIGN_LOCATION_WEST`.

**Rule:** adding a Western country/city to the diaspora guard means editing BOTH
in lockstep AND bumping `RELEVANCE_RULE_VERSION` (so the boot backfill re-scores
already-stored rows — they don't self-heal).

**Why preposition-gated, never bare:** the paired protest cue includes the sports
homonyms "rally"/"clash", so a bare "Toronto rally to beat" would false-positive;
and a bare country ("Canada condemns …") is an actor reference, not the venue.
The decisive match for the Ottawa row is "protest in Ottawa".
