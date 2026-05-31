# Polestar Advisory Workbench — Report Suite Proof Pack

**Generated:** 31 May 2026 · **Data source:** live `/api/incidents` feed (dev) · **Issue window:** report cycle 24–30 May 2026

This pack proves each report now reads ONE filtered dataset, that keyword-but-not-operational
records are rejected with a stated reason, and that the on-screen preview equals the exported PDF.

---

## How to read this

- **Records included** = the count that survives the two-stage relevance gate and feeds *every*
  surface (Fast Facts cards, exec summary, country chart, What Matters, Polestar View, Watch Next,
  Related Incidents). There is no second, looser dataset behind the cards.
- **Rejected (with reason)** = representative records the gate dropped and *why*.
- **Stage 1 — relevance gate** (`topicRelevance.ts`, `isTopicRelevant`): EXCLUDE patterns are
  checked before REQUIRED, so an exclude always wins. Shared by all topics.
- **Stage 2 — operational filter** (`flashpointReportDataset.ts`, `isWeakOperational`):
  Flashpoint-only; strips retrospective-accountability / aftermath noise that still carries protest
  vocabulary. Gated on a live-public-order cue so a genuine live event is never dropped.

---

## Flashpoint (Protests & Civil Unrest) — report #13

- **Records included:** 9 (all genuine live protest / strike / unrest)
- **Data status:** MANUAL (scraper-fed; flashpoint feed)
- **Latest record:** 2026-05-30 · **Last updated:** 2026-05-30
- **Top country:** Philippines (4) — matches the exec-summary prose ("Philippines carries the
  heaviest concentration, with Bangladesh and Sri Lanka as supporting watch areas"). Cards == prose.

**Included (9):** Bangladesh editors/press protest; Dhaka University quota-reform clash; Indonesian
filmmaker decries military crackdown; Nepal Student Union NC-HQ protest; Philippines fisherfolk
protest; Philippines tree-cutting protest (×2 outlets); Benguet students protest; Sri Lanka BASL
court boycott over Colombo shooting.

**Rejected (22) — representative reasons:**

| Rejected record | Reason |
|---|---|
| Nepal Rights Body Urges Charges Against Ex-PM Over Gen Z Protest Deaths (OCCRP) | Retrospective accountability — rights body recommending charges over a *past* event, no live cue |
| Nepal NHRC recommends action/probe vs Oli, Lekhak, Gurung (×4 outlets) | Retrospective accountability — commission of inquiry / probe |
| Former Nepal PM Oli arrested over Gen Z protest crackdown | Retrospective — arrested "over" a past crackdown |
| Former Sri Lankan IGP arrested in connection with May 2022 protest-site attack | Retrospective — "arrested in connection with" a past event |
| Hasina's lawyer urges UN to retract death-toll report; "Highly Inaccurate" UN-report dispute | UN-report commentary / death-toll dispute, not a live incident |
| BAYAN, labor leaders face raps over May 1 rally | Retrospective — "face raps over" a past rally |
| Peaceful Polling underway in Nepal after Gen Z protest | Aftermath / normalisation — calm polling is the absence of an incident |
| Eimskip strike of bosuns cancelled / strike begun on Eimskip vessels | Foreign-maritime mislabel + suspended-strike (not APAC civil unrest) |
| Kite of Dreams reaches Everest to amplify Gaza voices | Awareness stunt — novelty, not public-order |
| Licensable picture: Indonesian students protest (Reuters Connect) | Stock-photo wire, not an incident |
| Thousands rally in Spain / Georgia independence day | Out-of-region syndication |
| India offers BrahMos missile to Philippines | Military procurement, no public-order angle |
| Anika's 11-second strike matches football goal | SEO keyword collision ("strike") |

---

## Cargo Watch — report #11

- **Records included:** 25 · **Data status:** MANUAL (cargo_watch scraper)
- **Latest record:** ~2026-05-23 · **Last updated:** within cycle
- All 25 are land-based cargo theft / truck hijack / depot-warehouse incidents across APAC.

**Rejected — representative reasons:**

| Rejected record | Reason |
|---|---|
| Op-ed / advisory / conference "to tackle cargo theft" | Advocacy/agenda, not an operational incident |
| FBI cargo-theft advisory (US jurisdiction) | Out-of-region agency advisory (now gated on advisory framing, not a bare token) |
| Ogun (Nigeria) truck-hijack foil | Out-of-region — APAC report (now gated on Nigeria/police context) |

> Known residual (honest): two foreign-language US-jurisdiction syndications (Japanese DOJ request,
> Korean LA seizure) still pass — reliable foreign-language jurisdiction detection is high-risk and
> was deliberately left rather than risk dropping legitimate APAC records.

---

## Fuel Watch — report #9

- **Records included:** 28 · **Data status:** STATIC (import only — no live scraper)
- **Latest record:** ~2026-05-21..23
- **Rejected:** EV-sales demand-shift stories, PR "applauds leadership" puff pieces (FUEL_EXCLUDE).

> Known residual (out of scope for this relevance task): some severity *labels* on pricing /
> legislative / infrastructure records read "extreme". Severity is set by the import data /
> classifier, not the relevance gate — flagged here, not changed.

## Fertiliser — report #10

- **Records included:** 11 · **Data status:** STATIC (import only)
- All 11 are supply / shortage / price / plant-incident records.

## Energy — report #8

- **Records included:** 5 · **Data status:** STATIC (import only)
- Signal is genuinely thin (5 records) — Related Incidents shows the "signal thin" note rather than
  padding with off-topic items.

## Shipping — report #12

- **Records included:** 9 · **Data status:** STATIC (import only)
- All 9 are Hormuz/Strait disruption, vessel-attack probe, or container-rate movement.
- **Rejected:** vessel sale-and-purchase / newbuild orderbook / ship-finance deals
  ("heads back to suezmax newbuilds", "cashes in on ageing suezmax pair", "$29m gain from disposal").
  Newbuild is now gated on commercial/orderbook framing, so an attack on a newly built tanker
  would NOT be dropped.

## Country reports (Papua / Papua New Guinea)

- Per-country source overrides fire (Jubi, RNZ Pacific, ABC News Australia, Benar News) so the
  narrative stays country-specific rather than generic regional wire copy.
- Data status (live / manual / static) and the "Data as of" provenance line render on screen and in
  the headless PDF via the shared data-status model.

---

## Preview == PDF

The in-app **Download PDF** rasterises the on-screen `.print-report` DOM, so screen and in-app PDF
are identical by construction. The attached PDFs were produced the same way (headless Chromium
rasterising the same DOM), so they are a faithful proof of the on-screen report:

- `Flashpoint_Protests_2026-05-30.pdf` (7pp)
- `Shipping_Hormuz_2026-05-30.pdf` (5pp)
- `CargoWatch_2026-05-30.pdf` (3pp)
- `FuelWatch_2026-05-30.pdf` (6pp)
- `FertiliserWatch_2026-05-30.pdf` (3pp)
- `EnergyWatch_2026-05-30.pdf` (3pp)

## Proof reproducibility

- Flashpoint audit: `cd artifacts/workbench && ISSUE=2026-05-30 npx tsx scripts/auditFlashpoint.ts`
- Multi-report audit: `cd artifacts/workbench && npx tsx scripts/auditReports.ts`
- PDFs: `CHROMIUM_BIN=<chromium> node scripts/exportReportPdfBrowser.mjs`

## Production caveat (honest)

The production database is READ-ONLY from this workspace and the deployment runs the *previous* code
until republished. So a true live-production screenshot requires publishing first. The strongest
pre-publish evidence is exactly this pack: the KEPT/DROPPED audit against the live `/api/incidents`
feed plus PDFs regenerated from that same data. **Publish to verify in production.**
