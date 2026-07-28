import { renderToStaticMarkup } from "react-dom/server";

import PngCountryReportBody from "../../artifacts/workbench/src/components/PngCountryReportBody";
import ShippingReportPreview from "../../artifacts/workbench/src/components/ShippingReportPreview";
import { buildCountryOperatingRiskDataset } from "../../artifacts/workbench/src/lib/countryOperatingRiskDataset";
import {
  COUNTRY_INCIDENT_THEMES,
  buildCountryIncidentThemes,
} from "../../artifacts/workbench/src/lib/countryIncidentThemes";
import { DISCLAIMER_TEXT } from "../../artifacts/workbench/src/lib/pdfChrome";
import type {
  PngSourceIncident,
  PngReportDataset,
} from "../../artifacts/workbench/src/lib/pngReportDataset";

// Render-level sibling to `countryOperatingRiskDataset.test.ts` (which pins the
// DATASET the generic builder emits). That test proves the data is well-formed;
// this one proves the SHARED renderer turns it into the country brief the screen
// and the DOM-rasterised PDF actually show — same component, so screen == PDF.
// The dataset test alone could pass while the renderer dropped a section,
// reordered the brief or leaked a count into narrative.
//
// Pins the rebuilt render contract (one renderer for every country):
//  - SECTION ORDER: the brief sections render in the fixed order, opening with
//    Bottom Line Up Front and closing with Polestar View. (The Reporting
//    Confidence and Customer Relevance sections were removed in the trim.)
//  - INCIDENT DETAILS: only the themes actually present in the window render, in
//    the fixed theme order; absent themes are OMITTED entirely (present-only
//    analytical groups, no fabricated "Not reported this period." filler theme).
//  - NO MARITIME SECURITY: country reports no longer carry a Maritime Security
//    block (topic/shipping reports keep it, out of scope here).
//  - Top 3 Developments renders real tile cards with the window's localities.
//  - NO-COUNT brief: the rendered narrative carries no record/incident/event
//    count annotation.
//  - PLACEMENT ANCHORS: the analyst-placed map/photo nodes inject at the chosen
//    inline slot and are omitted otherwise.

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

const POPULATED: PngSourceIncident[] = [
  inc({
    id: "p1",
    title: "Thousands join a street protest in Manila over fuel price rises",
    severity: "Moderate",
    location: "Manila",
  }),
  inc({
    id: "p2",
    title: "Police disperse a large demonstration and rally in Cebu",
    severity: "Moderate",
    location: "Cebu",
  }),
  inc({
    id: "l1",
    title: "Factory workers strike as the trade union calls industrial action in Davao",
    severity: "Moderate",
    location: "Davao",
  }),
  inc({
    id: "u1",
    title: "A power blackout hits Quezon City after a grid failure",
    severity: "High",
    location: "Quezon City",
  }),
];

function build(incidents: PngSourceIncident[]): PngReportDataset {
  return buildCountryOperatingRiskDataset(
    {
      windowIncidents: incidents,
      thirtyDay: incidents,
      ninetyDay: incidents,
      baselineWatchlist: [],
      periodLabel: PERIOD,
    },
    "Philippines",
  );
}

// renderToStaticMarkup emits attributes (inline styles, widths, hex colours)
// that carry digits, so the no-count assertion must run on TEXT only. Strip all
// tags first, then collapse whitespace.
function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// The trimmed brief sections, in fixed render order; Polestar View closes.
// (The Disclaimer + analytics block are appended by the page, not this body.)
const SECTION_ORDER = [
  "Bottom Line Up Front",
  "Top 3 Developments",
  "Current Situation",
  "Operational Impact",
  "Recommended Actions",
  "Outlook: Next Seven Days",
  "Polestar View",
];

describe("PngCountryReportBody — country brief render", () => {
  const html = renderToStaticMarkup(
    <PngCountryReportBody dataset={build(POPULATED)} />,
  );

  it("renders the brief sections in the fixed order", () => {
    const positions = SECTION_ORDER.map((title) => ({
      title,
      at: html.indexOf(title),
    }));
    for (const p of positions) {
      expect(p.at).toBeGreaterThanOrEqual(0); // every section present
    }
    const ats = positions.map((p) => p.at);
    const sorted = [...ats].sort((a, b) => a - b);
    expect(ats).toEqual(sorted); // strictly in order, none reordered
  });

  it("drops a canonical section from the rendered brief when hidden", () => {
    // Analyst hides Polestar View and Outlook — both must vanish from the
    // rendered markup (preview AND PDF, same component) while every other
    // section stays. No other section title is affected.
    const hiddenHtml = renderToStaticMarkup(
      <PngCountryReportBody
        dataset={build(POPULATED)}
        hiddenSections={["polestar-view", "outlook"]}
      />,
    );
    expect(hiddenHtml).not.toContain("Polestar View");
    expect(hiddenHtml).not.toContain("Outlook: Next Seven Days");
    expect(hiddenHtml).toContain("Bottom Line Up Front");
    expect(hiddenHtml).toContain("Top 3 Developments");
    expect(hiddenHtml).toContain("Current Situation");
    // The unhidden default render still carries them, proving the gate is what
    // removed them (not a build/data issue).
    expect(html).toContain("Polestar View");
    expect(html).toContain("Outlook: Next Seven Days");
  });

  it("renders only the present incident themes inside Current Situation, in fixed order", () => {
    // The body builds its themed groups from the SAME dataset field the render
    // uses (d.incidentDetailsItems), so derive the expected present themes the
    // same way and assert the render matches exactly.
    const present = buildCountryIncidentThemes(build(POPULATED).incidentDetailsItems);
    expect(present.length).toBeGreaterThan(0); // populated window has themes
    // Scope to the Incident Details SECTION only: theme headings are reused as
    // the Operational Impact bullet prefixes (built from the full window), so a
    // whole-document search would wrongly find an absent theme there. The slice
    // runs from the Incident Details heading to the next section.
    const detailsStart = html.indexOf("Current Situation");
    const detailsEnd = html.indexOf("Operational Impact");
    expect(detailsStart).toBeGreaterThanOrEqual(0);
    expect(detailsEnd).toBeGreaterThan(detailsStart);
    const section = html.slice(detailsStart, detailsEnd);
    // renderToStaticMarkup escapes "&" to "&amp;", so match the escaped heading.
    const positions = present.map((g) =>
      section.indexOf(g.heading.replace(/&/g, "&amp;")),
    );
    for (const at of positions) {
      expect(at).toBeGreaterThanOrEqual(0); // every PRESENT theme renders
    }
    expect(positions).toEqual([...positions].sort((a, b) => a - b)); // fixed order
    // Absent themes are OMITTED entirely — no always-on six-theme scaffold and no
    // fabricated "Not reported this period." filler.
    const presentKeys = new Set(present.map((g) => g.key));
    for (const t of COUNTRY_INCIDENT_THEMES) {
      if (!presentKeys.has(t.key)) {
        expect(section.indexOf(t.heading.replace(/&/g, "&amp;"))).toBe(-1);
      }
    }
    expect(section).not.toContain("Not reported this period.");
  });

  it("does NOT render a Maritime Security block on country reports", () => {
    expect(html).not.toContain("Maritime Security");
  });

  it("renders Top 3 Developments tile cards carrying the window's localities", () => {
    expect(html).toContain("Top 3 Developments");
    const text = textOf(html);
    expect(
      ["Manila", "Cebu", "Davao", "Quezon City"].some((l) => text.includes(l)),
    ).toBe(true);
  });

  it("caps Top 3 Developments at three tiles even with more incidents", () => {
    // Only the Top 3 tile cards carry a severity chip (the Incident Details
    // themed groups render prose, no chips), so the chip count is the tile
    // count. The window here has four incidents; the section must still show at
    // most three tiles (the remainder flows into the themed Incident Details).
    const chips = (html.match(/data-sev-chip="true"/g) ?? []).length;
    expect(chips).toBeGreaterThan(0);
    expect(chips).toBeLessThanOrEqual(3);
  });

  it("leaks no record/incident/event count into the narrative brief", () => {
    const text = textOf(html);
    expect(text).not.toMatch(/\b\d+\s+(records?|incidents?|events?)\b/i);
    expect(text).not.toMatch(/\(\s*\d+\s*\)/); // bare "(3)"
    expect(text).not.toMatch(
      /\(\s*\d+\s+(of\s+\d+\s+)?(records?|incidents?|events?)/i,
    ); // "(2 of 5 incidents)"
  });
});

describe("PngCountryReportBody — analyst map/photo placement anchors", () => {
  const MAP_MARKER = "MAP_PLACEHOLDER_NODE";
  const PHOTO_MARKER = "PHOTO_PLACEHOLDER_NODE";

  it("injects the map and photo nodes at the chosen inline slots", () => {
    const html = renderToStaticMarkup(
      <PngCountryReportBody
        dataset={build(POPULATED)}
        mapPlacement="after-bluf"
        mapNode={<div>{MAP_MARKER}</div>}
        photoPlacement="inside-incident-details"
        photoNode={<div>{PHOTO_MARKER}</div>}
      />,
    );
    expect(html).toContain(MAP_MARKER);
    expect(html).toContain(PHOTO_MARKER);
    // after-bluf: the map sits after Bottom Line Up Front, before Top 3.
    expect(html.indexOf("Bottom Line Up Front")).toBeLessThan(
      html.indexOf(MAP_MARKER),
    );
    expect(html.indexOf(MAP_MARKER)).toBeLessThan(
      html.indexOf("Top 3 Developments"),
    );
    // inside-incident-details: the photo sits within the Current Situation section.
    expect(html.indexOf("Current Situation")).toBeLessThan(
      html.indexOf(PHOTO_MARKER),
    );
  });

  it("omits the map node when its placement is handled off-body", () => {
    // "none"/"end"/"cover" are rendered by the page, not this body — the inline
    // injector must not also emit the node.
    const html = renderToStaticMarkup(
      <PngCountryReportBody
        dataset={build(POPULATED)}
        mapPlacement="none"
        mapNode={<div>{MAP_MARKER}</div>}
        photoPlacement="cover"
        photoNode={<div>{PHOTO_MARKER}</div>}
      />,
    );
    expect(html).not.toContain(MAP_MARKER);
    expect(html).not.toContain(PHOTO_MARKER);
  });
});

describe("PngCountryReportBody — country brief render, quiet window", () => {
  const html = renderToStaticMarkup(<PngCountryReportBody dataset={build([])} />);

  // §27: a sparse (quiet) week returns a short report. The framing sections
  // (Bottom Line, Top 3, Incident Details) still render honest empty notes, but
  // the analytical sections (Current Situation, Operational Impact, Recommended
  // Actions, Outlook, Polestar View) are OMITTED rather than padded with filler.
  const RETAINED = ["Bottom Line Up Front", "Top 3 Developments"];
  const OMITTED = [
    "Current Situation",
    "Operational Impact",
    "Recommended Actions",
    "Outlook: Next Seven Days",
    "Polestar View",
  ];

  it("renders the framing sections and omits the analytical ones (no fabrication)", () => {
    for (const title of RETAINED) {
      expect(html.indexOf(title)).toBeGreaterThanOrEqual(0);
    }
    for (const title of OMITTED) {
      expect(html.indexOf(title)).toBe(-1);
    }
    const text = textOf(html);
    // The engine's short-report BLUF states the quiet period honestly.
    expect(text.toLowerCase()).toMatch(/reporting was limited|no significant validated/i);
    // A quiet week must not invent counts either.
    expect(text).not.toMatch(/\b\d+\s+(records?|incidents?|events?)\b/i);
  });
});

// No-fabrication guard for the Incident Details empty note. When the only
// non-Top-3 leftover is a single low-severity incident, no theme clears the
// meaningfulness gate, so Incident Details renders no themed paragraph. The
// brief must NOT then falsely claim there was "no further incident reporting"
// (a leftover DID exist) — it must say honestly that the remaining reporting
// was immaterial. Three High incidents fill the Top 3; the lone Low break-in is
// the leftover that fails the gate.
describe("PngCountryReportBody — immaterial leftover incidents", () => {
  const LOW_LEFTOVER: PngSourceIncident[] = [
    inc({
      id: "h1",
      title: "Armed robbery wounds a security guard in Manila",
      severity: "High",
      location: "Manila",
    }),
    inc({
      id: "h2",
      title: "A power blackout hits Quezon City after a grid failure",
      severity: "High",
      location: "Quezon City",
    }),
    inc({
      id: "h3",
      title: "Thousands join a street protest in Davao over fuel price rises",
      severity: "High",
      location: "Davao",
    }),
    inc({
      id: "x1",
      title: "Police log a minor break-in at a warehouse in Baguio",
      severity: "Low",
      location: "Baguio",
    }),
  ];
  const dataset = build(LOW_LEFTOVER);
  const html = renderToStaticMarkup(<PngCountryReportBody dataset={dataset} />);

  it("states the leftover was immaterial rather than claiming no further reporting", () => {
    // Precondition: a leftover incident exists but no meaningful theme forms.
    expect(dataset.incidentDetailsItems.length).toBeGreaterThan(0);
    expect(
      buildCountryIncidentThemes(dataset.incidentDetailsItems).length,
    ).toBe(0);
    // Scope to the Current Situation section (which now carries the themes).
    const detailsStart = html.indexOf("Current Situation");
    const detailsEnd = html.indexOf("Operational Impact");
    const section = detailsEnd >= 0 ? html.slice(detailsStart, detailsEnd) : html.slice(detailsStart);
    // The brief must NOT falsely claim there was no further reporting...
    expect(section).not.toContain(
      "No further incident reporting beyond the developments",
    );
    // ...it states the remaining reporting was immaterial instead.
    expect(section).toContain("did not warrant separate detail");
    // Count-free even in the honest fallback.
    expect(textOf(section)).not.toMatch(
      /\b\d+\s+(records?|incidents?|events?)\b/i,
    );
  });
});

// The Disclaimer is the brief's final section, but it is appended by the PAGE
// (CountryReport.tsx) below the body + analytics block — NOT by this body
// component. The fixed brief order this body owns therefore closes on Polestar
// View, and the body must never emit a Disclaimer of its own (which would
// reorder it into the brief). These guards pin that contract without needing the
// data-fetching, owner-gated page to render.
describe("PngCountryReportBody — Disclaimer is page-appended, not in the body", () => {
  const html = renderToStaticMarkup(
    <PngCountryReportBody dataset={build(POPULATED)} />,
  );

  it("closes the body on Polestar View and omits the Disclaimer", () => {
    expect(html).toContain("Polestar View");
    expect(html).not.toContain("Disclaimer");
    // The trim removed these two sections from every country brief.
    expect(html).not.toContain("Reporting Confidence");
    expect(html).not.toContain("Customer Relevance");
    // Polestar View is the last brief section the body emits.
    const last = SECTION_ORDER[SECTION_ORDER.length - 1];
    expect(last).toBe("Polestar View");
    for (const title of SECTION_ORDER.slice(0, -1)) {
      expect(html.indexOf(title)).toBeLessThan(html.indexOf(last));
    }
  });

  it("the page-level Disclaimer text the page appends last stays non-empty", () => {
    expect(typeof DISCLAIMER_TEXT).toBe("string");
    expect(DISCLAIMER_TEXT.trim().length).toBeGreaterThan(0);
  });
});

// The "no Maritime Security on country reports" assertion above is only a
// meaningful guard if that section genuinely STILL exists on the shipping/topic
// reports — i.e. it was removed from country briefs deliberately, not deleted
// everywhere. Pin both halves of that contract here.
describe("Maritime Security — absent on country, present on shipping reports", () => {
  it("country report body never renders a Maritime Security section", () => {
    const html = renderToStaticMarkup(
      <PngCountryReportBody dataset={build(POPULATED)} />,
    );
    expect(html).not.toContain("Maritime Security");
  });

  it("shipping report preview still renders its Maritime Security section", () => {
    const html = renderToStaticMarkup(
      <ShippingReportPreview
        report={
          {
            id: 1,
            title: "Shipping Watch",
            topic: "shipping",
            issueDate: "2026-06-29",
          } as never
        }
        incidents={[]}
      />,
    );
    expect(html).toContain("Maritime Security");
  });
});
