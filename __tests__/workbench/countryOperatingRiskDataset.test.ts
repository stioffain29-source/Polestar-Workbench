import {
  buildCountryOperatingRiskDataset,
} from "../../artifacts/workbench/src/lib/countryOperatingRiskDataset";
import type {
  PngSourceIncident,
  PngReportDataset,
} from "../../artifacts/workbench/src/lib/pngReportDataset";

// Guards the GENERIC operating-risk builder that gives every country WITHOUT a
// curated structured-theatre config (i.e. all slugs other than PNG / West Papua
// / Indonesia / Jakarta) the same deterministic, business-voice brief the
// structured theatres render. PngCountryReportBody renders straight off this
// dataset, so the grouping, section fields and prose hygiene proven here are
// exactly what the screen and the DOM-rasterised PDF show.
//
// Three invariants are pinned:
//  - Key Developments GROUPING: incidents are themed by their client-facing
//    display category — same theme co-locates, distinct themes split, and the
//    grouping partitions the window.
//  - NO-COUNT prose: no narrative section carries a record/incident count
//    annotation (replit.md: counts belong only on Fast Facts / chart captions).
//  - HEADING / RENDER invariants: the dataset exposes every section field the
//    shared renderer consumes, tagged operating-risk, with strict 5-tier
//    severity vocabulary and honest empty-window caveats (no fabrication).

const PERIOD = "23–29 June 2026";

function inc(
  over: Partial<PngSourceIncident> & {
    id: number | string;
    title: string;
    severity: string;
  },
): PngSourceIncident {
  return {
    occurredAt: "2026-06-27T08:00:00+00:00",
    summary: null,
    source: "Test Wire",
    sourceUrl: `https://example.test/${over.id}`,
    country: "Philippines",
    location: null,
    ...over,
  };
}

function build(
  incidents: PngSourceIncident[],
  country = "Philippines",
): PngReportDataset {
  return buildCountryOperatingRiskDataset(
    {
      windowIncidents: incidents,
      thirtyDay: incidents,
      ninetyDay: incidents,
      baselineWatchlist: [],
      periodLabel: PERIOD,
    },
    country,
  );
}

// Titles chosen so the shared @workspace/ingest classifier resolves three
// distinct display themes: two protests (one theme), one labour action, one
// power/utilities disruption. Each title carries an unambiguous category cue.
const PROTEST_A = inc({
  id: "p1",
  title: "Thousands join a street protest in Manila over fuel price rises",
  severity: "Moderate",
  location: "Manila",
});
const PROTEST_B = inc({
  id: "p2",
  title: "Police disperse a large demonstration and rally in Cebu",
  severity: "Low",
  location: "Cebu",
});
const LABOUR = inc({
  id: "l1",
  title: "Factory workers strike as the trade union calls industrial action in Davao",
  severity: "Moderate",
  location: "Davao",
});
const POWER = inc({
  id: "u1",
  title: "A power blackout hits Quezon City after a grid failure",
  severity: "High",
  location: "Quezon City",
});

const POPULATED = [PROTEST_A, PROTEST_B, LABOUR, POWER];

const FIVE_TIER = new Set([
  "Insignificant",
  "Low",
  "Moderate",
  "High",
  "Extreme",
]);

// Every narrative string the renderer prints, in one flat list.
function narrativeOf(ds: PngReportDataset): string[] {
  return [
    ds.bluf,
    ds.executiveSummary,
    ds.outlook,
    ds.polestarView,
    ds.reportingConfidence.rationale,
    ...ds.escalationIndicators,
    ...ds.businessImpact,
    ...ds.locationWatchlist.flatMap((w) => [w.location, w.why, w.action]),
  ];
}

describe("buildCountryOperatingRiskDataset — no-count prose", () => {
  // Populated AND quiet windows; neither may leak a count into narrative prose.
  for (const [label, ds] of [
    ["populated window", build(POPULATED)],
    ["quiet window", build([])],
  ] as Array<[string, PngReportDataset]>) {
    it(`carries no record/incident count annotation — ${label}`, () => {
      for (const text of narrativeOf(ds)) {
        // No parenthesised number, e.g. "(3)" or "(2 of 5 incidents)".
        expect(text).not.toMatch(/\(\s*\d/);
        // No "<n> incidents/records/events" phrasing inline.
        expect(text).not.toMatch(/\b\d+\s+(records?|incidents?|events?)\b/i);
      }
    });
  }
});

describe("buildCountryOperatingRiskDataset — operational recommendations", () => {
  const ds = build(POPULATED);

  it("keys each recommended action to a location and an action, with each escalation trigger stated once", () => {
    expect(ds.businessImpact.length).toBeGreaterThan(0);
    const marker = "Escalation trigger —";
    const seenTriggers = new Set<string>();
    let triggerLines = 0;
    for (const line of ds.businessImpact) {
      // Shape: "<Location>: <action>[ Escalation trigger — <trigger>.]" — the
      // trigger clause appears on the FIRST line carrying that trigger and is
      // omitted on verbatim repeats (repetition guard).
      expect(line).toMatch(/^.+?: .+/);
      const loc = line.slice(0, line.indexOf(":")).trim();
      expect(loc.length).toBeGreaterThan(0);
      if (line.includes(marker)) {
        triggerLines++;
        const trigger = line.slice(line.indexOf(marker) + marker.length).trim();
        expect(trigger.length).toBeGreaterThan(10); // a real forward-looking condition
        expect(seenTriggers.has(trigger)).toBe(false); // never repeated verbatim
        seenTriggers.add(trigger);
      }
    }
    expect(triggerLines).toBeGreaterThan(0); // at least one trigger is stated
  });

  it("carries no incident-count annotation in the recommendations", () => {
    for (const line of ds.businessImpact) {
      expect(line).not.toMatch(/\(\s*\d/);
      expect(line).not.toMatch(/\b\d+\s+(records?|incidents?|events?)\b/i);
    }
  });
});

describe("buildCountryOperatingRiskDataset — heading / render invariants", () => {
  const ds = build(POPULATED);

  it("is tagged operating-risk so the shared renderer takes the brief layout", () => {
    expect(ds.proseVariant).toBe("operating-risk");
  });

  it("exposes every section field the renderer consumes, populated", () => {
    expect(ds.bluf.trim().length).toBeGreaterThan(0);
    expect(ds.outlook.trim().length).toBeGreaterThan(0);
    expect(ds.polestarView.trim().length).toBeGreaterThan(0);
    expect(ds.escalationIndicators.length).toBeGreaterThan(0);
    expect(ds.businessImpact.length).toBeGreaterThan(0);
    expect(ds.locationWatchlist.length).toBeGreaterThan(0);
  });

  it("labels severity with the 5-tier vocabulary only", () => {
    expect(["High", "Moderate", "Low"]).toContain(
      ds.reportingConfidence.level,
    );
    for (const it of ds.windowItems) {
      expect(FIVE_TIER.has(it.severityLabel)).toBe(true);
    }
  });

  it("derives the Location Watchlist from each incident's locality", () => {
    const locs = ds.locationWatchlist.map((w) => w.location);
    // The country itself is never a sub-national watchlist row.
    expect(locs).not.toContain("Philippines");
    expect(locs.some((l) => ["Manila", "Cebu", "Davao", "Quezon City"].includes(l))).toBe(
      true,
    );
  });
});

describe("buildCountryOperatingRiskDataset — empty window (no fabrication)", () => {
  const ds = build([]);

  it("yields an empty window without fabricated items", () => {
    expect(ds.windowItems).toHaveLength(0);
  });

  it("flags low reporting confidence and an honest quiet-period brief", () => {
    expect(ds.reportingConfidence.level).toBe("Low");
    // §27: on a sparse week the shared engine returns a short report rather than
    // padding the analytical sections. The honest quiet-period statement now
    // sits in the BLUF (short report); Outlook is omitted (empty), not filled.
    expect(ds.bluf.toLowerCase()).toMatch(/limited|no fresh|quiet|not.*genuine improvement/);
    expect(ds.outlook).toBe("");
    expect(ds.escalationIndicators.length).toBeGreaterThan(0);
    expect(ds.escalationIndicators.join(" ")).toMatch(
      /return of open-source reporting/i,
    );
  });

  it("stays operating-risk even when quiet", () => {
    expect(ds.proseVariant).toBe("operating-risk");
  });
});

describe("buildCountryOperatingRiskDataset — Reporting Confidence (§16)", () => {
  // Four clearly-relevant protest incidents, each from a DISTINCT outlet and
  // carrying a resolved province, so the outlet-count and location-share gates
  // both clear High. Only the PRECISION of the location text (and any major
  // fire's cause clarity) is varied per case, isolating the §16 gates: a High
  // rating must additionally require precise, plottable map points AND no major
  // incident whose cause the source has not stated.
  const TITLES = [
    "Thousands protest in the capital over rising fuel prices",
    "Demonstrators rally against new transport fares",
    "Residents stage a protest over prolonged power cuts",
    "Activists march over wage disputes",
  ];
  function set(
    locations: string[],
    fire?: { title: string; severity: string; location: string },
  ): PngSourceIncident[] {
    const rows = TITLES.map((title, idx) =>
      inc({
        id: `c${idx}`,
        title,
        severity: "Moderate",
        source: `Outlet ${idx}`,
        province: "Metro Manila",
        location: locations[idx],
      }),
    );
    if (fire) {
      rows[0] = inc({
        id: "fire",
        title: fire.title,
        severity: fire.severity,
        source: "Outlet 0",
        province: "Metro Manila",
        location: fire.location,
      });
    }
    return rows;
  }

  const PRECISE = [
    "Roxas Boulevard, Manila",
    "EDSA highway, Quezon City",
    "Barangay 134, Cebu",
    "near the seaport terminal, Davao",
  ];

  it("rates High when outlets, locations and precise map points all hold", () => {
    const ds = build(set(PRECISE));
    expect(ds.windowItems.length).toBeGreaterThanOrEqual(4);
    expect(ds.reportingConfidence.level).toBe("High");
  });

  it("never rates High when the map points are too vague to plot (no false precision)", () => {
    const ds = build(set(["Manila", "Cebu", "Davao", "Iloilo"]));
    expect(ds.reportingConfidence.level).not.toBe("High");
    expect(ds.reportingConfidence.rationale).toMatch(/too broad to map/i);
  });

  it("never rates High when a major incident's cause is not yet reported", () => {
    const ds = build(
      set(PRECISE, {
        title: "Massive fire engulfs a warehouse",
        severity: "High",
        location: "Roxas Boulevard, Manila",
      }),
    );
    expect(ds.reportingConfidence.level).not.toBe("High");
    expect(ds.reportingConfidence.rationale).toMatch(/cause is not yet reported/i);
  });
});
