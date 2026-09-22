---
name: Regional weekly map selection
description: Why the regional map plots a capped, deterministic selection of developments and how "the same operating issue" is decided.
---

The regional weekly map plots at most five developments; the report itself may
carry more (APAC six, Middle East five to eight). The map is a **selection**, not
a mirror of the Key Developments list, and it is chosen by a deterministic ranker
in the shared policy module — not by the model, which would add another way for
generation to fail.

Ranking favours the operating picture over the worst headline: business
consequence, transport and energy impact, security significance, regional
relevance and forward importance all score, severity is the smallest term, and
each additional entry from a domain or market already on the map is penalised so
breadth wins. The chosen entries are returned in **report order**, so map
numbering follows the development list.

Two entries covering the same operating issue collapse to the stronger one. That
test must key on the **specific words that made each entry score** (compared as
short stems), not on the broad signal group: a port strike and an airport weather
closure both read as "transport", but they are two different issues and both
belong on the map. Cross-country collapse is deliberately not attempted — the map
is a picture of distinct markets.

**Why:** the client correction asked for a map that explains how the region is
operating. An uncapped map mirrored the list, and a first cut of the same-issue
rule that matched on signal groups silently dropped unrelated same-country events.

**How to apply:** when tightening the ranker, add an adversarial test for the
false positive (same country, same domain, different issue) as well as the true
duplicate, and keep the cap exported from the policy module so the prompt, the
validator and the builder cannot drift apart.
