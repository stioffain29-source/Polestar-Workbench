---
name: Top-3 story-diversity fold must be windowed
description: Why the PNG/country Top-3 dedup has TWO paths (pick-skip vs fold-remove) with different aggressiveness, and why the fold requires within3d.
---

The country/PNG Top-3 story-diversity guard (`selectTopStoryClusters` in `pngReportDataset.ts`, using `storySimilarity` from `countrySameStory.ts`) has TWO distinct comparison paths, and they must NOT share a threshold:

- **PICK-skip** (`isSameTopStory`, weak: `sharedStrong || jaccard>=0.4 || sharedPlaceClass`): a skipped candidate stays in its location bucket, so it is still shown ONCE. Being aggressive here only prevents a Top-3 repeat — it never loses data. Safe unwindowed.
- **FOLD-remove** (`isStrongSameTopStory`, strong: `(sharedStrong || jaccard>=0.5) && within3d`): folding adds a cluster's members to the removed-id set so the event NEVER reappears in any bucket. This DELETES data from the report.

**Why:** PNG tribal-violence headlines are formulaic ("Tribal clash in Enga leaves several dead"), so two GENUINELY DISTINCT clashes weeks apart can hit jaccard>=0.5 or share a strong entity. Without a window the fold silently drops the later real incident — a no-fabrication defect (omission counts). `within3d` is exposed on `StorySimilarity` for exactly this: gate every REMOVAL path on it.

**How to apply:** Any dedup/fold that removes incidents must require at least the same evidence the ingest clusterer needs to merge (shared strong signal / high jaccard AND the 3-day window). Do not "simplify" `isStrongSameTopStory` back to `sharedStrong || jaccard>=0.5` without `within3d`. Tests lock it: `countrySameStory.test.ts` (within3d boundary) and `pngTopStoryFoldWindow.test.ts` (selector folds inside window, keeps beyond it).
