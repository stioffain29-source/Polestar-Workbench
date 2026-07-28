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
