---
name: Region-topic foreign-syndication mis-stamp audit
description: What the cross-country tagging audit found for the region-locked topics (shipping/conflict/cargo_watch) and why only conflict got a relocate migration.
---

# Region-topic cross-country (foreign-syndication) audit

The energy (world-scope) and fuel/fertiliser audits relocated stories mis-stamped
onto a feed's default country. The same audit was run for the REGION-LOCKED topics
shipping / conflict / cargo_watch. Findings that should stop a future agent from
re-doing the wrong fix:

- **Region-locked topics get NO gazetteer/geocode/choropleth additions.** They never
  pass `scope` so they render the region choropleth only. Adding an out-of-region
  newsmaker country (Lebanon, Syria, Nigeria, Somalia…) would make it shade the
  region map — explicitly forbidden. Every genuine relocate target here
  (Thailand/Philippines/Myanmar/Pakistan) is already an in-region tracked country
  with a centroid and polygon, so no additions were needed.

- **shipping cross-country flags are NOT mis-stamps.** They are almost entirely
  maritime-CHOKEPOINT context (a title naming Suez/Hormuz/Bab el-Mandeb/Red Sea but
  the incident sits at the chokepoint, stored Yemen/Iran/Unknown by the curated
  model) or commerce port-congestion noise (Colombo/Chittagong/Ningbo/"British/
  American port congestion") the relevance gate already drops. Do NOT relocate them.
  Bare littoral tokens ("oman", "iraq") are unsafe because "Gulf of Oman" etc. would
  re-attribute curated Hormuz-cluster rows.

- **cargo_watch cross-country flags are NOT mis-stamps** either: masthead-only
  ("Philippine News Agency", "Free Malaysia Today", "Australian Broadcasting Corp"
  on Unknown-stored rows — masthead pollution, unsafe) or a foreign SUBJECT of a
  genuine in-region event (a Thai armored-truck robbery of a "Chinese man"; a Thai
  scam using a fake "Reserve Bank of India" official — correctly Thailand). Unknown→X
  is a different defect owned by globalReattribute, not this audit.

- **conflict had the only genuine defect: in-region → in-region mis-stamps.** Real
  APAC incidents dropped on the WRONG country centroid (map != table): Thai school
  shooting stored India; Cebu City shootouts stored Pakistan (sitting at the Pakistan
  centroid 30.38,69.35); Negros army/Maoist clash stored India; Baloch-insurgency
  piece stored Sri Lanka; Myanmar politics stored Bangladesh. Fixed by
  `conflict_foreign_syndication_relocate_v1` (marker-gated, in migrations.ts) mirroring
  the fuel precedent: distinctly-national TITLE token + full others-guard (no second
  tracked country named) + RELOCATE to country/centroid, never delete.

- **Do NOT add a broad Pakistan target.** The India↔Pakistan cross-border attribution
  is owned by `conflict_india_to_pakistan_relocate_v1`. The relocate here scopes
  Pakistan to `balochistan|baloch` ONLY, and deliberately leaves "Pakistan rejects…"-
  style India-stored rows alone.

- **Do NOT make West Papua/Papua or China a relocate target.** West Papua conflict
  stories name Indonesia/NZ/Australia as ACTORS (correct as-is); China-Myanmar rows
  (Kyaukphyu deep-sea port, junta Beijing visit) are correctly Myanmar. A token
  target on those would corrupt correct rows.

The out-of-region foreign conflict rows (Lebanon/Syria/Iran-insurgency/Russia/Ukraine/
US/Egypt/Nigeria stamped on India/Myanmar/Bangladesh/etc.) are left to the existing
FP_OFFSHORE_THEATRE relevance gate, which marks them irrelevant/hidden; they belong to
no in-region country so relocating them onto the region map would be wrong.
