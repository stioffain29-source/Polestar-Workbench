/**
 * Shared fixtures for the prose-override preview==PDF parity suites (task 448).
 *
 * One fixture per topic family carries a DISTINCT sentinel in every editable
 * prose/read column that topic renders. The PDF suite (recording pdfChrome
 * stub) and the preview suite (renderToStaticMarkup, real pdfChrome) both
 * consume these SAME report objects — after routing them through the headless
 * exporter's `buildHeadlessReportData` — and assert every sentinel reaches the
 * page. Together they prove a saved override renders identically on screen and
 * in the exported PDF, and can never silently fall back to auto-prose.
 *
 * Named *TestHelpers.ts so jest's testPathIgnorePatterns skips it as a suite.
 */
export const ISSUE_DATE = "2026-06-20";

// pickProse (flashpoint core prose) only lets editor text REPLACE the
// auto-prose when it carries substance (>= 240 chars); shorter notes are
// prepended to the auto text. Either way the sentinel must appear, but use a
// long body so the test asserts the strong "replaces outright" contract too.
export function longProse(token: string): string {
  return (
    `${token} ` +
    "This is a saved analyst override paragraph used to verify that the " +
    "exported PDF renders exactly the text the on-screen preview shows. " +
    "It is deliberately long enough to clear the substance bar applied to " +
    "core narrative fields so the override replaces the auto-prose outright " +
    "rather than being appended ahead of it."
  );
}

export function baseInc(over: {
  id: string;
  topic: string;
  title: string;
  country: string;
  severity: string;
  summary?: string;
  location?: string | null;
}) {
  return {
    occurredAt: "2026-06-16T08:00:00+00:00",
    summary: over.summary ?? null,
    source: "Test Wire",
    sourceUrl: `https://example.com/${over.id}`,
    location: over.location ?? null,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Flashpoint — 4 section reads + core narrative prose.
// ---------------------------------------------------------------------------
export const FLASHPOINT_SENTINELS: Record<string, string> = {
  activismRead: "ZZ-ACTIVISM-READ-OVERRIDE-ZZ saved analyst text.",
  civilUnrestRead: "ZZ-CIVIL-UNREST-READ-OVERRIDE-ZZ saved analyst text.",
  forecastRead: "ZZ-FORECAST-READ-OVERRIDE-ZZ saved analyst text.",
  regionalCountryRead: "ZZ-REGIONAL-READ-OVERRIDE-ZZ saved analyst text.",
  executiveSummary: longProse("ZZ-EXEC-OVERRIDE-ZZ"),
  whatMatters: longProse("ZZ-WHAT-MATTERS-OVERRIDE-ZZ"),
  implications: longProse("ZZ-IMPLICATIONS-OVERRIDE-ZZ"),
  watchNext: longProse("ZZ-WATCH-NEXT-OVERRIDE-ZZ"),
  polestarView: longProse("ZZ-POLESTAR-OVERRIDE-ZZ"),
};

export const FLASHPOINT_REPORT = {
  id: 1,
  topic: "flashpoint",
  status: "published",
  issueDate: ISSUE_DATE,
  title: "Flashpoint Watch",
  situation: "",
  whatHappened: "",
  author: "Test",
  ...FLASHPOINT_SENTINELS,
};

export const FLASHPOINT_INCIDENTS = [
  baseInc({
    id: "f1",
    topic: "flashpoint",
    country: "Indonesia",
    severity: "high",
    title: "Mass protest demonstrators clash with police in the capital",
    summary: "Thousands of demonstrators rallied and clashed with police.",
  }),
  baseInc({
    id: "f2",
    topic: "flashpoint",
    country: "Philippines",
    severity: "moderate",
    title: "Protesters rally against a fuel price hike downtown",
    summary: "A street rally protested rising fuel prices.",
  }),
];

// ---------------------------------------------------------------------------
// Shipping — 5 section reads.
// ---------------------------------------------------------------------------
export const SHIPPING_SENTINELS: Record<string, string> = {
  chokepointRouteRead: "ZZ-CHOKEPOINT-READ-OVERRIDE-ZZ saved analyst text.",
  vesselPiracyRead: "ZZ-PIRACY-READ-OVERRIDE-ZZ saved analyst text.",
  maritimeSecurityRead: "ZZ-MARSEC-READ-OVERRIDE-ZZ saved analyst text.",
  commercialImpactRead: "ZZ-COMMERCIAL-READ-OVERRIDE-ZZ saved analyst text.",
  regionalCountryRead: "ZZ-SHIP-REGIONAL-READ-OVERRIDE-ZZ saved analyst text.",
};

export const SHIPPING_REPORT = {
  id: 1,
  topic: "shipping",
  status: "published",
  issueDate: ISSUE_DATE,
  title: "Shipping Watch",
  situation: "",
  whatHappened: "",
  author: "Test",
  ...SHIPPING_SENTINELS,
};

export const SHIPPING_INCIDENTS = [
  baseInc({
    id: "s1",
    topic: "shipping",
    country: "Yemen",
    severity: "high",
    location: "Red Sea",
    title: "Tanker attacked by armed skiffs in the Gulf of Aden",
    summary: "Armed men in skiffs attacked a tanker underway.",
  }),
  baseInc({
    id: "s2",
    topic: "shipping",
    country: "Singapore",
    severity: "moderate",
    title: "Cargo vessel boarded and crew robbed in the Singapore Strait",
    summary: "Robbers boarded a bulk carrier and stole stores.",
  }),
];

// ---------------------------------------------------------------------------
// Conflict — Other Watched Theatres read.
// ---------------------------------------------------------------------------
export const CONFLICT_SENTINELS: Record<string, string> = {
  conflictOtherWatchedRead: "ZZ-OTHER-WATCHED-READ-OVERRIDE-ZZ saved analyst text.",
};

export const CONFLICT_REPORT = {
  id: 1,
  topic: "conflict",
  status: "published",
  issueDate: ISSUE_DATE,
  title: "Conflict Watch",
  situation: "",
  whatHappened: "",
  author: "Test",
  ...CONFLICT_SENTINELS,
};

export const CONFLICT_INCIDENTS = [
  baseInc({
    id: "c1",
    topic: "conflict",
    country: "Philippines",
    severity: "high",
    title: "Armed clashes between troops and militants near the outpost",
    summary: "Troops exchanged fire with militants near the outpost.",
  }),
  baseInc({
    id: "c2",
    topic: "conflict",
    country: "Myanmar",
    severity: "moderate",
    title: "Militants ambush an army patrol on the highway",
    summary: "An army patrol was ambushed on the highway.",
  }),
];

// ---------------------------------------------------------------------------
// Generic energy — core narrative prose (resolveSimpleProse: editor wins
// whenever non-blank).
// ---------------------------------------------------------------------------
export const ENERGY_SENTINELS: Record<string, string> = {
  executiveSummary: "ZZ-ENERGY-EXEC-OVERRIDE-ZZ saved analyst text.",
  situation: "ZZ-ENERGY-SITUATION-OVERRIDE-ZZ saved analyst text.",
  whatHappened: "ZZ-ENERGY-WHAT-HAPPENED-OVERRIDE-ZZ saved analyst text.",
  whatMatters: "ZZ-ENERGY-WHAT-MATTERS-OVERRIDE-ZZ saved analyst text.",
  implications: "ZZ-ENERGY-IMPLICATIONS-OVERRIDE-ZZ saved analyst text.",
  watchNext: "ZZ-ENERGY-WATCH-NEXT-OVERRIDE-ZZ saved analyst text.",
  polestarView: "ZZ-ENERGY-POLESTAR-OVERRIDE-ZZ saved analyst text.",
};

export const ENERGY_REPORT = {
  id: 1,
  topic: "energy",
  status: "published",
  issueDate: ISSUE_DATE,
  title: "Energy Watch",
  author: "Test",
  ...ENERGY_SENTINELS,
};

// ---------------------------------------------------------------------------
// Cargo Watch — the pattern report's editable assessment sections. The cargo
// surfaces (CargoReportPreview + exportTopicReportPdf's cargo branch) render
// executiveSummary via resolveSimpleProse and the five assessment sections via
// the identical resolveSimpleProse stack, all under the HARD 10-check
// validation gate — so these fixtures must also PASS the gate (distinct
// per-section text, no sensational/evidence-claim vocabulary, Polestar View
// >= 120 words). The legacy cargoSecurityRead / logisticsHubRead columns are
// NOT rendered by the pattern report (they survive only in the unreachable
// generic ReportPreview cargo branch), so they carry no sentinel here.
// ---------------------------------------------------------------------------
export const CARGO_SENTINELS: Record<string, string> = {
  executiveSummary:
    "ZZ-CARGO-EXEC-OVERRIDE-ZZ Saved analyst summary of this month's cargo crime pattern used for the parity check.",
  situation:
    "ZZ-CARGO-SITUATION-OVERRIDE-ZZ Saved analyst situation text describing this month's cargo theft reporting in the covered region.",
  whatMatters:
    "ZZ-CARGO-WHAT-MATTERS-OVERRIDE-ZZ Saved analyst note on why the month's theft pattern matters for shippers.",
  implications:
    "ZZ-CARGO-IMPLICATIONS-OVERRIDE-ZZ Saved analyst implication for logistics operators planning warehouse protection.",
  watchNext:
    "ZZ-CARGO-WATCH-NEXT-OVERRIDE-ZZ Saved analyst watch item for the coming reporting period.",
  // Check 9 of the cargo validation gate requires >= 120 words when present.
  polestarView:
    "ZZ-CARGO-POLESTAR-OVERRIDE-ZZ This saved analyst assessment is written to satisfy the hard validation gate " +
    "while carrying a unique sentinel token that both parity suites assert on. The month's reporting shows a " +
    "steady level of theft activity against goods in transit and in storage across the covered countries, with " +
    "no single location dominating the picture and no confirmed change in the methods described by the " +
    "underlying records. We assess that the overall level of risk to commercial cargo remains broadly in line " +
    "with previous reporting periods, and that operators should continue to apply their existing security " +
    "measures at loading points, storage sites and transfer points. We will keep reviewing each new record as " +
    "it arrives and will flag any sustained change in volume, geography or method in the next issue of this " +
    "report, together with any practical steps that the evidence at that point supports for affected operators.",
};

export const CARGO_REPORT = {
  id: 1,
  topic: "cargo_watch",
  status: "published",
  issueDate: ISSUE_DATE,
  title: "Cargo Watch",
  whatHappened: "",
  author: "Test",
  ...CARGO_SENTINELS,
};

// In-scope (APAC) cargo theft records: pass isCargoInScope, classify as
// OPERATIONAL (no arrest/seizure vocabulary, so nothing lands in the
// enforcement partition), all dated inside the monthly window.
export const CARGO_INCIDENTS = [
  baseInc({
    id: "cg1",
    topic: "cargo_watch",
    country: "Indonesia",
    severity: "high",
    title: "Armed men hijack a cargo truck carrying electronics near Jakarta",
    summary: "Armed men hijacked a truck carrying electronics on the highway.",
  }),
  baseInc({
    id: "cg2",
    topic: "cargo_watch",
    country: "Philippines",
    severity: "moderate",
    title: "Thieves break into a warehouse and steal freight consignments in Manila",
    summary: "Thieves broke into a warehouse and stole freight consignments.",
  }),
  baseInc({
    id: "cg3",
    topic: "cargo_watch",
    country: "Malaysia",
    severity: "moderate",
    title: "Container theft reported at a port terminal in Port Klang",
    summary: "A container was stolen from a port terminal storage yard.",
  }),
];

// ---------------------------------------------------------------------------
// Fuel Watch — the three fuel-specific editable reads (pickRead: editor text
// replaces the generated read outright). hardNumbers carries Brent + WTI +
// jet fuel so the exporter's fail-closed market-data gate passes without
// allowMissingMarketData.
// ---------------------------------------------------------------------------
export const FUEL_SENTINELS: Record<string, string> = {
  fuelMarketRead: "ZZ-FUEL-MARKET-READ-OVERRIDE-ZZ saved analyst text.",
  fuelOperationalRead: "ZZ-FUEL-OPERATIONAL-READ-OVERRIDE-ZZ saved analyst text.",
  fuelRegionalHighlights: "ZZ-FUEL-REGIONAL-READ-OVERRIDE-ZZ saved analyst text.",
};

export const FUEL_HARD_NUMBERS = {
  prices: [
    { label: "Brent crude", value: 78.2, unit: "USD/bbl", asOf: "2026-06-19" },
    { label: "WTI crude", value: 74.1, unit: "USD/bbl", asOf: "2026-06-19" },
    { label: "Jet fuel", value: 2.05, unit: "USD/gal", asOf: "2026-06-16" },
  ],
};

export const FUEL_REPORT = {
  id: 1,
  topic: "fuel",
  status: "published",
  issueDate: ISSUE_DATE,
  title: "Fuel Watch",
  situation: "",
  whatHappened: "",
  author: "Test",
  hardNumbers: FUEL_HARD_NUMBERS,
  ...FUEL_SENTINELS,
};

export const FUEL_INCIDENTS = [
  baseInc({
    id: "fu1",
    topic: "fuel",
    country: "Indonesia",
    severity: "high",
    title: "Refinery fire disrupts fuel supply and distribution in Java",
    summary: "A refinery fire disrupted fuel supply and distribution.",
  }),
  baseInc({
    id: "fu2",
    topic: "fuel",
    country: "Philippines",
    severity: "moderate",
    title: "Fuel depot outage delays jet fuel deliveries to the airport",
    summary: "A depot outage delayed jet fuel deliveries to the airport.",
  }),
];

export const ENERGY_INCIDENTS = [
  baseInc({
    id: "e1",
    topic: "energy",
    country: "Indonesia",
    severity: "high",
    title: "Power grid failure causes a rolling blackout in the east",
    summary: "A grid failure cut power across the eastern region.",
  }),
  baseInc({
    id: "e2",
    topic: "energy",
    country: "Philippines",
    severity: "moderate",
    title: "Substation fire causes a rolling blackout across the grid",
    summary: "A substation fire forced rolling blackouts on the grid.",
  }),
];
