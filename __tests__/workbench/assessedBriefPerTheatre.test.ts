import {
  buildPngReportDataset,
  buildWestPapuaReportDataset,
  buildIndonesiaReportDataset,
  buildThailandReportDataset,
  buildPhilippinesReportDataset,
  buildJakartaReportDataset,
} from "../../artifacts/workbench/src/lib/pngReportDataset";
import type {
  BuildArgs,
  PngSourceIncident,
  PngReportDataset,
} from "../../artifacts/workbench/src/lib/pngReportDataset";
import { operatingRiskDisplayCategory } from "../../artifacts/workbench/src/lib/operatingRiskProse";
import { isForeignSubjectNoHomeAnchor } from "../../artifacts/workbench/src/lib/countryMatch";
import { extractThailandItem } from "../../lib/ingest/src/thailandExtract";
import { extractPhilippinesItem } from "../../lib/ingest/src/philippinesExtract";

// Per-theatre lock for the assessed-brief behaviour. The three focus theatres
// (PNG / West Papua / Indonesia) were already covered piecemeal; this file
// extends the SAME deterministic dataset-builder proof across ALL SIX assessed
// briefs — PNG, West Papua, Indonesia, Thailand, Philippines and Jakarta — so a
// regression in any one theatre is caught. renderToStaticMarkup / live
// screenshots are impossible for these owner-gated (Replit-Auth) pages, so the
// dataset builder + pure guard functions ARE the verification surface (see
// .agents/memory/owner-gated-ui-verification.md).
//
// Four invariants are pinned for every theatre:
//   1. NO foreign-country events surface (the CountryReport foreign-subject
//      guard drops a foreign-subject headline with no home anchor).
//   2. Hazards are classified as hazards (a flood/quake death routes to the
//      "Natural hazard" display category, not violent crime).
//   3. Severity correction is DEMOTE-ONLY: assistance / PR wire is capped at
//      Low, a genuine kinetic High is never touched (never up-rated).
//   4. Trajectory "no trend is asserted" wording is gated on a REAL prior
//      window — present with no prior basis, absent once a real prior window
//      establishes a comparable baseline.

const PERIOD = "23–29 June 2026";
const OCCURRED = "2026-06-27T08:00:00+00:00";

type Builder = (args: BuildArgs) => PngReportDataset;

interface Theatre {
  name: string;
  country: string;
  build: Builder;
  // Jakarta overrides the BLUF/executive-summary via its own bespoke builder
  // (jakartaBrief.ts, windowItems-only, no trajectory), so the shared
  // "no trend is asserted" wording does not apply to it — see invariant 4.
  hasTrajectoryWording: boolean;
}

const THEATRES: Theatre[] = [
  { name: "PNG", country: "Papua New Guinea", build: buildPngReportDataset, hasTrajectoryWording: true },
  { name: "West Papua", country: "West Papua", build: buildWestPapuaReportDataset, hasTrajectoryWording: true },
  { name: "Indonesia", country: "Indonesia", build: buildIndonesiaReportDataset, hasTrajectoryWording: true },
  { name: "Thailand", country: "Thailand", build: buildThailandReportDataset, hasTrajectoryWording: true },
  { name: "Philippines", country: "Philippines", build: buildPhilippinesReportDataset, hasTrajectoryWording: true },
  { name: "Jakarta", country: "Jakarta", build: buildJakartaReportDataset, hasTrajectoryWording: false },
];

function inc(
  over: Partial<PngSourceIncident> & {
    id: number | string;
    title: string;
    severity: string;
  },
): PngSourceIncident {
  return {
    occurredAt: OCCURRED,
    summary: null,
    source: "Test Wire",
    sourceUrl: `https://example.test/${over.id}`,
    country: "Papua New Guinea",
    location: null,
    ...over,
  };
}

// Build with an explicit previous window (undefined => "no comparable prior
// period"). category + businessImpact are supplied together so toItem trusts
// them directly and the classification is deterministic across theatres.
function build(
  theatre: Theatre,
  windowIncidents: PngSourceIncident[],
  previousWindowIncidents?: PngSourceIncident[],
): PngReportDataset {
  return theatre.build({
    windowIncidents,
    previousWindowIncidents,
    thirtyDay: windowIncidents,
    ninetyDay: windowIncidents,
    baselineWatchlist: [],
    periodLabel: PERIOD,
  });
}

// A consequential single development (fatalities) vs a pile of low-value petty
// crime. Assessed-value ranking must float the fatal theme to the top.
const FATAL = inc({
  id: "fatal",
  title: "Gunmen shoot dead three people in an armed robbery at a store",
  category: "Homicide / violent crime",
  businessImpact: "Direct exposure to violent crime at commercial premises.",
  severity: "Moderate",
});
const PETTY = (n: number): PngSourceIncident =>
  inc({
    id: `petty-${n}`,
    title: `Pickpocketing reported at a suburban stall number ${n}`,
    category: "Other security",
    businessImpact: "Incidental low-level crime exposure.",
    severity: "Low",
  });

// A natural-hazard fatality — must classify as a hazard, never violent crime.
const HAZARD = inc({
  id: "hazard",
  title: "Flash flooding kills four and forces evacuations in a coastal town",
  category: "Natural hazard",
  businessImpact: "Transport and site disruption from flooding.",
  severity: "Moderate",
});

// Assistance / PR wire stored as High — must be demoted to Low (never up-rated).
const ASSISTANCE = inc({
  id: "assist",
  title: "Community leaders trained to help stop sorcery-accusation violence",
  category: "Other security",
  businessImpact: "Community engagement activity.",
  severity: "High",
});
// A genuine kinetic High — must be preserved (demote-only never touches it).
const KINETIC = inc({
  id: "kinetic",
  title: "Armed clash between rival groups leaves several dead and wounded",
  category: "Homicide / violent crime",
  businessImpact: "Direct exposure to lethal violence.",
  severity: "High",
});

describe.each(THEATRES)("assessed brief — $name", (theatre) => {
  test("invariant 2: a hazard fatality is classified as a natural hazard, not violent crime", () => {
    const ds = build(theatre, [HAZARD, ...[1, 2].map(PETTY)]);
    const headings = ds.keyDevelopments.map((g) => g.heading);
    expect(headings).toContain("Natural hazard");
    // The hazard headline never lands under a violent-crime theme.
    const hazardGroup = ds.keyDevelopments.find((g) => g.heading === "Natural hazard");
    expect(hazardGroup?.items.some((i) => /flash flooding/i.test(i.title))).toBe(true);
    for (const g of ds.keyDevelopments) {
      if (g.heading !== "Natural hazard") {
        expect(g.items.some((i) => /flash flooding/i.test(i.title))).toBe(false);
      }
    }
  });

  test("invariant 3: severity correction is demote-only — assistance PR capped at Low, kinetic High preserved", () => {
    const ds = build(theatre, [ASSISTANCE, KINETIC]);
    const items = ds.keyDevelopments.flatMap((g) => g.items);
    const assist = items.find((i) => /trained to help stop/i.test(i.title));
    const kinetic = items.find((i) => /armed clash/i.test(i.title));
    expect(assist?.severityLabel).toBe("Low");
    // Never up-rated: the genuine kinetic High is untouched.
    expect(kinetic?.severityLabel).toBe("High");
  });

  test("assessed value ranks a single consequential development above a pile of low-value items", () => {
    const ds = build(theatre, [FATAL, ...[1, 2, 3].map(PETTY)]);
    expect(ds.keyDevelopments.length).toBeGreaterThan(0);
    expect(ds.keyDevelopments[0].heading).toBe(
      operatingRiskDisplayCategory("Homicide / violent crime"),
    );
  });

  test("invariant 4: trajectory wording is gated on a real prior window", () => {
    const noPrior = build(theatre, [FATAL, HAZARD]);
    const withPrior = build(theatre, [FATAL, HAZARD], [PETTY(9)]);
    if (theatre.hasTrajectoryWording) {
      // No comparable prior period => the brief explicitly declines to assert a
      // week-on-week trend.
      expect(/no (?:week-on-week )?trend is asserted/i.test(noPrior.bluf)).toBe(true);
      // A real prior window establishes a basis => the "no trend" hedge is gone.
      expect(/no (?:week-on-week )?trend is asserted/i.test(withPrior.bluf)).toBe(false);
    } else {
      // Jakarta's bespoke BLUF is windowItems-only and never fabricates a
      // week-on-week trend claim in either case.
      expect(/no (?:week-on-week )?trend is asserted/i.test(noPrior.bluf)).toBe(false);
      expect(/no (?:week-on-week )?trend is asserted/i.test(withPrior.bluf)).toBe(false);
      expect(noPrior.bluf.length).toBeGreaterThan(0);
    }
  });
});

// Invariant 1: no foreign-country events reach a brief. Filtering happens
// UPSTREAM in CountryReport via the foreign-subject guard (the generic Thailand
// / Philippines theatres use isForeignSubjectNoHomeAnchor); PNG / West Papua /
// Indonesia / Jakarta have their own dedicated guards covered elsewhere. This
// locks the generic branch that Thailand and Philippines depend on.
describe("invariant 1: foreign-subject events are dropped (generic theatres)", () => {
  test.each([
    ["thailand", "Explosion at a Bangkok market injures five commuters", "Bangkok"],
    ["philippines", "Grenade attack in a Manila district wounds three", "Manila"],
  ])("%s keeps a domestic event with a home anchor", (report, title, loc) => {
    expect(isForeignSubjectNoHomeAnchor(title, null, loc, report)).toBe(false);
  });

  test.each([
    ["thailand"],
    ["philippines"],
  ])("%s drops a foreign-subject headline with no home anchor", (report) => {
    const foreign = "Iran launches missile strikes on Israel amid rising tensions";
    expect(isForeignSubjectNoHomeAnchor(foreign, null, null, report)).toBe(true);
  });
});

// Invariant 2 (classification source): the per-theatre extractors delegate to
// the shared structured rulebook, so a hazard death routes to "natural hazard"
// at the ingest layer for both generic theatres too.
describe("invariant 2 (source): per-theatre extractors classify hazards as hazards", () => {
  test("Thailand extractor routes a flood death to natural hazard", () => {
    const ext = extractThailandItem(
      "Flash flooding kills four in a northern province",
      "",
      null,
    );
    expect(ext.category).toBe("Natural hazard");
  });
  test("Philippines extractor routes an earthquake death to natural hazard", () => {
    const ext = extractPhilippinesItem(
      "Earthquake kills three and topples buildings in a coastal town",
      "",
      null,
    );
    expect(ext.category).toBe("Natural hazard");
  });
});
