/**
 * @jest-environment jsdom
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import {
  buildJakartaIncidentThemes,
} from "../../artifacts/workbench/src/lib/jakartaBrief";
import {
  buildJakartaReportDataset,
  type PngReportItem,
  type PngCategory,
  type PngSourceIncident,
} from "../../artifacts/workbench/src/lib/pngReportDataset";
import PngCountryReportBody from "../../artifacts/workbench/src/components/PngCountryReportBody";

// ---------------------------------------------------------------------------
// Jakarta assessed-trajectory proof (owner-gated pages can't be screenshotted,
// so this is a direct unit + render assertion per the owner-gated-ui-verification
// memory).
//
// Two things are locked here:
//
//  1. TRAJECTORY CORRECTNESS. buildJakartaIncidentThemes appends a count-free
//     week-on-week trajectory clause to each present theme paragraph, chosen by
//     jakartaThemeTrajectory: nobasis / new / rising / easing / steady. This
//     block drives all five branches with hand-built items and pins the exact
//     sentence each produces.
//
//  2. PREVIEW == PDF for the trajectory-carrying prose. The Jakarta trajectory
//     rides on the dataset's `incidentThemesOverride` field. That single field
//     is the ONLY source both surfaces render: the on-screen preview
//     (PngCountryReportBody: `d.incidentThemesOverride ?? buildCountryIncidentThemes(...)`)
//     and the exported PDF (exportCountryReportPdf renderStructuredBrief: the
//     byte-identical `d.incidentThemesOverride ?? buildCountryIncidentThemes(...)`)
//     both read it and draw `g.heading` + `g.paragraph`. Because it is ONE shared
//     field rendered verbatim by both, the preview body and the PDF cannot
//     disagree. This block proves (a) the preview renders each override
//     paragraph — trajectory clause included — byte-for-byte, and (b) neither
//     surface re-derives the themes independently (source-contract guard,
//     mirroring maritimeReportParity.test.ts).
// ---------------------------------------------------------------------------

// The exact trajectory clauses (JAKARTA_TRAJECTORY_SENTENCE in jakartaBrief.ts).
// Pinned here so a wording drift on either side fails the build.
const RISING = "Against the previous week this theme is rising.";
const EASING = "Against the previous week this theme is easing.";
const STEADY = "Against the previous week this theme is broadly steady.";
const NEW =
  "It was not reported a week earlier, so it reads as newly prominent this period.";
const NOBASIS =
  "With no prior-week baseline, no week-on-week trend is asserted.";

// A crime item with a concrete anchor (a CRIME_GROUPS token in the title +
// a resolved province) so themeParagraph returns a non-null paragraph rather
// than dropping the theme. severityRank drives the trajectory comparison.
function crimeItem(
  id: string,
  severityRank: number,
  over: Partial<PngReportItem> = {},
): PngReportItem {
  return {
    id,
    title: "Theft reported at a shop",
    summary: "A theft was reported in the area.",
    province: "Central Jakarta",
    location: "Central Jakarta",
    category: "Theft / break-in" as PngCategory,
    displayCategory: "Theft / break-in",
    businessImpact: "",
    severity: "moderate",
    severityLabel: "Moderate",
    severityRank,
    reportedDate: new Date("2026-06-27T08:00:00.000Z"),
    incidentDate: new Date("2026-06-27T08:00:00.000Z"),
    occurredEarlier: false,
    source: "Test Wire",
    url: "https://example.test/" + id,
    confidence: "medium",
    ...over,
  };
}

describe("Jakarta theme trajectory (assessed week-on-week judgement)", () => {
  it("reads 'nobasis' when no prior-week baseline is supplied", () => {
    const themes = buildJakartaIncidentThemes([crimeItem("c1", 3)], [], false);
    expect(themes).toHaveLength(1);
    expect(themes[0]!.paragraph.endsWith(NOBASIS)).toBe(true);
  });

  it("reads 'new' when a baseline exists but the prior window was empty", () => {
    const themes = buildJakartaIncidentThemes([crimeItem("c1", 3)], [], true);
    expect(themes).toHaveLength(1);
    expect(themes[0]!.paragraph.endsWith(NEW)).toBe(true);
  });

  it("reads 'rising' when this week's worst severity exceeds the prior week", () => {
    const themes = buildJakartaIncidentThemes(
      [crimeItem("c1", 4)],
      [crimeItem("b1", 2)],
      true,
    );
    expect(themes).toHaveLength(1);
    expect(themes[0]!.paragraph.endsWith(RISING)).toBe(true);
  });

  it("reads 'easing' when this week's worst severity is below the prior week", () => {
    const themes = buildJakartaIncidentThemes(
      [crimeItem("c1", 2)],
      [crimeItem("b1", 4)],
      true,
    );
    expect(themes).toHaveLength(1);
    expect(themes[0]!.paragraph.endsWith(EASING)).toBe(true);
  });

  it("reads 'steady' when severity and volume are broadly unchanged", () => {
    const themes = buildJakartaIncidentThemes(
      [crimeItem("c1", 3)],
      [crimeItem("b1", 3)],
      true,
    );
    expect(themes).toHaveLength(1);
    expect(themes[0]!.paragraph.endsWith(STEADY)).toBe(true);
  });

  it("breaks a severity tie by volume: +2 items reads 'rising'", () => {
    const themes = buildJakartaIncidentThemes(
      [crimeItem("c1", 3), crimeItem("c2", 3), crimeItem("c3", 3)],
      [crimeItem("b1", 3)],
      true,
    );
    expect(themes).toHaveLength(1);
    expect(themes[0]!.paragraph.endsWith(RISING)).toBe(true);
  });

  it("breaks a severity tie by volume: -2 items reads 'easing'", () => {
    const themes = buildJakartaIncidentThemes(
      [crimeItem("c1", 3)],
      [crimeItem("b1", 3), crimeItem("b2", 3), crimeItem("b3", 3)],
      true,
    );
    expect(themes).toHaveLength(1);
    expect(themes[0]!.paragraph.endsWith(EASING)).toBe(true);
  });

  it("appends the trajectory clause to EVERY present theme, not just the first", () => {
    const protest = crimeItem("p1", 3, {
      title: "Thousands join a street protest over fuel subsidy cuts",
      summary: "A demonstration blocked roads in the government district.",
      category: "Civil unrest / protest" as PngCategory,
      displayCategory: "Civil unrest / protest",
    });
    const themes = buildJakartaIncidentThemes(
      [protest, crimeItem("c1", 3)],
      [],
      false,
    );
    expect(themes.length).toBeGreaterThanOrEqual(2);
    for (const t of themes) {
      expect(t.paragraph.endsWith(NOBASIS)).toBe(true);
    }
  });
});

// A Jakarta window whose leftover (non-Top-3) incidents categorise into at least
// one Incident Details theme, so the dataset's incidentThemesOverride is
// non-empty and carries a trajectory clause. previousWindowIncidents: [] makes
// hasBaseline true with an empty prior window → deterministic "new" trajectory.
function jkt(
  over: Partial<PngSourceIncident> & { id: string; title: string; severity: string },
): PngSourceIncident {
  return {
    occurredAt: "2026-06-27T08:00:00+00:00",
    summary: null,
    source: "Test Wire",
    sourceUrl: "https://example.test/" + over.id,
    country: "Indonesia",
    location: "Central Jakarta",
    ...over,
  };
}

describe("Jakarta Incident Details override — preview == PDF parity", () => {
  const dataset = buildJakartaReportDataset({
    // Six distinct stories across distinct themes so at least three leftover
    // incidents survive the Top-3 promotion into the Incident Details themes.
    windowIncidents: [
      jkt({
        id: "j1",
        title: "Thousands join a street protest over fuel subsidy cuts",
        severity: "High",
        summary: "A demonstration blocked roads in the Central Jakarta district.",
      }),
      jkt({
        id: "j2",
        title: "Armed robbery wounds a guard at a bank branch",
        severity: "High",
        location: "South Jakarta",
        summary: "A robbery was reported.",
      }),
      jkt({
        id: "j3",
        title: "Seasonal flooding shuts terminal access roads at Tanjung Priok",
        severity: "Moderate",
        location: "North Jakarta",
        summary: "Flooding closed roads.",
      }),
      jkt({
        id: "j4",
        title: "Fire guts a warehouse in an industrial district",
        severity: "Moderate",
        location: "East Jakarta",
        summary: "A fire damaged a warehouse.",
      }),
      jkt({
        id: "j5",
        title: "Pickpocketing spike reported around a transport station",
        severity: "Low",
        location: "West Jakarta",
        summary: "Pickpocketing incidents reported around the station.",
      }),
      jkt({
        id: "j6",
        title: "Police raid a narcotics den in a residential block",
        severity: "Low",
        location: "Central Jakarta",
        summary: "A police raid took place.",
      }),
    ],
    previousWindowIncidents: [],
    thirtyDay: [],
    ninetyDay: [],
    baselineWatchlist: [],
    periodLabel: "23–29 June 2026",
  });

  it("populates incidentThemesOverride carrying a trajectory clause", () => {
    const override = dataset.incidentThemesOverride;
    expect(override).toBeTruthy();
    expect(override!.length).toBeGreaterThan(0);
    // Empty prior window supplied → every present theme reads 'new'.
    for (const g of override!) {
      expect(g.paragraph.endsWith(NEW)).toBe(true);
    }
  });

  it("renders each override paragraph byte-identically in the preview body", () => {
    const html = renderToStaticMarkup(
      createElement(PngCountryReportBody, { dataset }),
    );
    const esc = (s: string) =>
      s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#x27;");
    const override = dataset.incidentThemesOverride!;
    expect(override.length).toBeGreaterThan(0);
    const start = html.indexOf("Current Situation");
    expect(start).toBeGreaterThanOrEqual(0);
    for (const g of override) {
      expect(html.indexOf(esc(g.heading), start)).toBeGreaterThanOrEqual(0);
      // The FULL paragraph, trajectory clause included, appears verbatim.
      expect(html.indexOf(esc(g.paragraph), start)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("Both surfaces render incidentThemesOverride from the shared field", () => {
  const root = resolve(__dirname, "../../artifacts/workbench/src");
  const pdfSrc = readFileSync(
    resolve(root, "lib/exportCountryReportPdf.ts"),
    "utf8",
  );
  const previewSrc = readFileSync(
    resolve(root, "components/PngCountryReportBody.tsx"),
    "utf8",
  );

  it("the PDF exporter reads d.incidentThemesOverride and draws g.paragraph", () => {
    expect(pdfSrc).toContain("d.incidentThemesOverride ??");
    expect(pdfSrc).toContain("renderProse(ctx, g.paragraph)");
    expect(pdfSrc).toContain("drawJakartaStrandLabel(ctx, g.heading)");
  });

  it("the preview body reads d.incidentThemesOverride and draws g.paragraph", () => {
    expect(previewSrc).toContain("d.incidentThemesOverride ??");
    expect(previewSrc).toContain("g.paragraph");
    expect(previewSrc).toContain("g.heading");
  });
});
