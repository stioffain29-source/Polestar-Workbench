---
name: Daily recheck input parity
description: Why a scheduled re-evaluation of stored incidents must feed the relevance gate the raw source title, and must not re-judge translated text with the noise gates.
---

# Re-judging stored rows: feed the gate the text it was trained on

A periodic quality pass that re-evaluates ALREADY-STORED incidents must call the
relevance authority with **exactly the input the persisted gate saw** — the raw
source `title`, not the translated `display_title`.

**Why:** local-language rows are stored with the original title plus an English
`display_title`. The ingest gate judged the original. Re-judging the translation
against rules tuned for the source language drops genuine records wholesale: a
sweep over live data mass-excluded Bahasa flood, fire, union-lawsuit and street-
crime reports purely because their English rendering no longer matched the
required-phrase vocabulary. Those rows had been correctly admitted; nothing about
them changed except which string was scored.

The same trap runs the other way for the **sports/entertainment noise gates**.
Those regexes match a bare sport name, so translation manufactures false hits:
"korupsi lapangan sepak bola" becomes "football field corruption" (a prosecution),
and a wildfire beside a pitch becomes "soccer field" (a fire incident). Both then
read as fixture coverage.

**How to apply:**
- Definite exclusions run at strict parity with the ingest gate: raw title +
  summary only. A daily pass should never be *stricter* than the product's own
  rules; if it is, it is inventing a second classifier.
- When the rendered English alone trips a noise gate, that is genuinely
  uncertain — record it as an evidence-linked **review** finding, never an
  automatic exclusion.
- Verify any change of this kind with a read-only replay over live rows before
  letting it write. Counting the exclusions is not enough: read the actual
  titles it would drop. The failure here looked like a clean "47 excluded"
  until the rows were inspected.
- A non-destructive design pays for itself: recording before/after status per
  finding made restoring an entire bad run a single CAS update.

## Country attribution is not uniformly required

Region-feed topics (shipping, energy, fuel, fertiliser, data centres) legitimately
carry `country = 'Unknown'` and render as "—". Flagging those as geography gaps
buries the real findings under hundreds of known-accepted rows. Country/regional
surfaces (flashpoint, conflict, cargo, the country-local feeds) do require it.
State the expectation per tracker explicitly and default an unmapped tracker to
"required", so a new tracker must decide rather than inherit a silent pass.
