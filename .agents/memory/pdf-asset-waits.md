---
name: PDF asset waits
description: Recovery rules for browser PDF exports when font or cover-image assets stop responding.
---

PDF font fetches and cover-image fetch/decode waits must always be time-bounded. Flashpoint export should continue with jsPDF’s built-in font when Roboto cannot load, and should use the existing gradient cover fallback when the cover asset cannot load.

**Why:** Browser-side PDF generation can otherwise leave the editor permanently showing “Generating PDF…” when an asset request remains pending. A failed shared font-loading promise can also poison every retry.

**How to apply:** Any new asynchronous asset dependency in a browser PDF path needs a bounded wait and an explicit recovery or visible failure. Failed shared loaders must clear their in-flight cache so a later click can retry.