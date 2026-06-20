import { renderToStaticMarkup } from "react-dom/server";

import ReportPreview from "../../artifacts/workbench/src/components/ReportPreview";
import ShippingReportPreview from "../../artifacts/workbench/src/components/ShippingReportPreview";
import ConflictReportPreview from "../../artifacts/workbench/src/components/ConflictReportPreview";
import { deterministicIncidentSummary } from "../../artifacts/workbench/src/lib/incidentSummary";
import type { TopicFastFactsIncident } from "../../artifacts/workbench/src/lib/topicFastFacts";
import type { ShippingReportIncident } from "../../artifacts/workbench/src/lib/shippingReportDataset";
import type { ConflictReportIncident } from "../../artifacts/workbench/src/lib/conflictReportDataset";

// Task #146 unit-tested resolveIncidentSummary / deterministicIncidentSummary as
// PURE functions. This sibling guards the WIRING: each report family
// (cargo_watch, energy, fertiliser, conflict, shipping) builds its own Related
// Incidents set — selection, dedupe and the per-topic cap — and then renders
// each row through resolveIncidentSummary keyed by String(incident.id). A
// regression in how a specific report passes the summaries map to its rendered
// rows (wrong key, dropped map, summaries built off a different id set than the
// rendered/capped rows) would NOT be caught by the pure-function tests because
// it lives in the preview component, not the resolver.
//
// For every family this asserts, against the SAME rendered HTML the analyst and
// the PDF rasteriser see:
//   1. a rendered row whose id IS in the summaries map shows the AI/edited
//      summary (preferred over the deterministic line),
//   2. a rendered row whose id is NOT in the map shows the deterministic
//      fallback (computed here via the shared deterministicIncidentSummary so a
//      drift in either surface fails the test), and
//   3. a summary keyed by an id that is NOT among the rendered rows never leaks
//      into the table — proving the map is consumed by rendered incident id, not
//      by row position or some other key.
//
// renderToStaticMarkup is enough — no DOM/layout engine needed. The jest
// moduleNameMapper chart/map/asset stubs (jest.config.js) keep the heavy chart
// children inert so only the table bodies render.

const report = { id: 1, title: "Test Report", issueDate: "2026-06-15" };

// A summary keyed by an id that no family renders. It must never appear in any
// table — if it does, the row→summary mapping is not keyed by rendered id.
const PHANTOM_ID = "no-such-incident-id";
const PHANTOM_SUMMARY = "PHANTOM summary that must never render in any table.";

// ---------------------------------------------------------------------------
// Generic shared ReportPreview path — energy & fertiliser. Both flow through
// filterTopicReportIncidents -> selectRelatedIncidents -> resolveIncidentSummary
// keyed by String(id). Three in-window rows sit below the strong-row floor so
// the weak-fallback keeps them all and every id is rendered.
// ---------------------------------------------------------------------------

function genericTopicCase(topic: string, incidents: TopicFastFactsIncident[]) {
  describe(`ReportPreview (${topic}) Related Incidents summary wiring`, () => {
    const [aiRow, fallbackRow] = incidents;
    const aiSummary = `Vetted AI summary for the ${topic} lead incident.`;
    const summaries: Record<string, string> = {
      [String(aiRow.id)]: aiSummary,
      [PHANTOM_ID]: PHANTOM_SUMMARY,
    };
    const html = renderToStaticMarkup(
      <ReportPreview
        report={{ ...report, topic }}
        incidents={incidents}
        incidentSummaries={summaries}
      />,
    );

    it("renders the table body with every in-window incident title", () => {
      for (const i of incidents) expect(html).toContain(i.title);
    });

    it("shows the AI summary for the row whose id is in the map", () => {
      expect(html).toContain(aiSummary);
    });

    it("shows the deterministic fallback for a row absent from the map", () => {
      const expected = deterministicIncidentSummary(fallbackRow);
      expect(html).toContain(expected);
      expect(expected).not.toBe(aiSummary);
    });

    it("never renders a summary keyed by a non-rendered incident id", () => {
      expect(html).not.toContain(PHANTOM_SUMMARY);
    });
  });
}

genericTopicCase("energy", [
  {
    id: "e1",
    topic: "energy",
    title: "Power grid blackout disrupts Jakarta",
    severity: "high",
    occurredAt: "2026-06-14T00:00:00.000Z",
    country: "Indonesia",
    location: "Jakarta",
    summary: "A power outage hit the capital.",
    source: "Test Source",
  },
  {
    id: "e2",
    topic: "energy",
    title: "Substation fire causes rolling blackout in Manila",
    severity: "moderate",
    occurredAt: "2026-06-12T00:00:00.000Z",
    country: "Philippines",
    location: "Manila",
    summary: "Rolling blackouts followed a substation failure.",
    source: "Test Source",
  },
  {
    id: "e3",
    topic: "energy",
    title: "Gas shortage triggers power rationing in Indonesia",
    severity: "low",
    occurredAt: "2026-06-10T00:00:00.000Z",
    country: "Indonesia",
    location: "Surabaya",
    summary: "Energy rationing introduced amid a gas shortage.",
    source: "Test Source",
  },
]);

genericTopicCase("fertiliser", [
  {
    id: "fe1",
    topic: "fertiliser",
    title: "Fertiliser plant explosion halts urea output in Surabaya",
    severity: "high",
    occurredAt: "2026-06-14T00:00:00.000Z",
    country: "Indonesia",
    location: "Surabaya",
    summary: "An explosion stopped production at a urea plant.",
    source: "Test Source",
  },
  {
    id: "fe2",
    topic: "fertiliser",
    title: "Fertiliser shortage drives up rice farming costs in Vietnam",
    severity: "moderate",
    occurredAt: "2026-06-12T00:00:00.000Z",
    country: "Vietnam",
    location: "Hanoi",
    summary: "Farmers faced higher costs amid a supply squeeze.",
    source: "Test Source",
  },
  {
    id: "fe3",
    topic: "fertiliser",
    title: "Nitrogen fertiliser export curbs announced in Malaysia",
    severity: "low",
    occurredAt: "2026-06-10T00:00:00.000Z",
    country: "Malaysia",
    location: "Kuala Lumpur",
    summary: "New curbs limited nitrogen fertiliser exports.",
    source: "Test Source",
  },
]);

// ---------------------------------------------------------------------------
// Cargo Watch — the shared ReportPreview cargo branch builds its Related
// Incidents set from the in-scope cargo window (its own selection path), then
// resolves summaries keyed by String(id). Both titles classify strong so
// neither is hard-excluded by the cargo selector.
// ---------------------------------------------------------------------------

describe("ReportPreview (cargo_watch) Related Incidents summary wiring", () => {
  const incidents: TopicFastFactsIncident[] = [
    {
      id: "c1",
      topic: "cargo_watch",
      title: "Cargo truck hijacked near Jakarta warehouse",
      severity: "high",
      occurredAt: "2026-06-10T00:00:00.000Z",
      country: "Indonesia",
      location: "Jakarta",
      summary: "Armed men hijacked a freight truck.",
      source: "Test Source",
    },
    {
      id: "c2",
      topic: "cargo_watch",
      title: "Electronics container stolen from Singapore depot",
      severity: "moderate",
      occurredAt: "2026-05-28T00:00:00.000Z",
      country: "Singapore",
      location: "Singapore",
      summary: "Thieves stole a container of electronics.",
      source: "Test Source",
    },
  ];
  const aiSummary = "Vetted AI summary for the cargo hijack lead.";
  const summaries: Record<string, string> = {
    c1: aiSummary,
    [PHANTOM_ID]: PHANTOM_SUMMARY,
  };
  const html = renderToStaticMarkup(
    <ReportPreview
      report={{ ...report, topic: "cargo_watch" }}
      incidents={incidents}
      incidentSummaries={summaries}
    />,
  );

  it("renders both in-scope cargo titles in the table body", () => {
    expect(html).toContain("Cargo truck hijacked near Jakarta warehouse");
    expect(html).toContain("Electronics container stolen from Singapore depot");
  });

  it("shows the AI summary for the row whose id is in the map", () => {
    expect(html).toContain(aiSummary);
  });

  it("shows the deterministic fallback for the row absent from the map", () => {
    const expected = deterministicIncidentSummary(incidents[1]);
    expect(html).toContain(expected);
    expect(expected).not.toBe(aiSummary);
  });

  it("never renders a summary keyed by a non-rendered incident id", () => {
    expect(html).not.toContain(PHANTOM_SUMMARY);
  });
});

// ---------------------------------------------------------------------------
// Conflict — ConflictReportPreview builds ds.relatedIncidents internally
// (selectRelatedIncidents over the conflict-enriched, relevance-gated set) and
// passes incidentSummaries straight to the table. Rows are ENRICHED clones, so
// this proves the enrichment preserves the id the summaries map is keyed on.
// Titles mirror conflictReportDataset.test.ts so they survive the gate.
// ---------------------------------------------------------------------------

describe("ConflictReportPreview Related Incidents summary wiring", () => {
  const incidents: ConflictReportIncident[] = [
    {
      id: "k1",
      topic: "conflict",
      title: "Armed clashes between troops and militants left five soldiers killed",
      severity: "extreme",
      occurredAt: "2026-06-14T08:00:00+00:00",
      country: "Myanmar",
      location: "Shan State",
      summary: null,
      source: "Test Wire",
      sourceUrl: "https://example.com/k1",
    },
    {
      id: "k2",
      topic: "conflict",
      title: "Insurgents ambush an army convoy in a roadside attack",
      severity: "high",
      occurredAt: "2026-06-12T08:00:00+00:00",
      country: "Philippines",
      location: "Mindanao",
      summary: null,
      source: "Test Wire",
      sourceUrl: "https://example.com/k2",
    },
  ];
  const aiSummary = "Vetted AI summary for the armed-clash lead.";
  const summaries: Record<string, string> = {
    k1: aiSummary,
    [PHANTOM_ID]: PHANTOM_SUMMARY,
  };
  const html = renderToStaticMarkup(
    <ConflictReportPreview
      report={{ ...report, topic: "conflict" } as never}
      incidents={incidents}
      incidentSummaries={summaries}
    />,
  );

  it("renders the Related Incidents table body with the real titles", () => {
    expect(html).toContain(
      "Armed clashes between troops and militants left five soldiers killed",
    );
    expect(html).toContain("Insurgents ambush an army convoy in a roadside attack");
  });

  it("shows the AI summary for the enriched row whose id is in the map", () => {
    expect(html).toContain(aiSummary);
  });

  it("shows the deterministic fallback for the row absent from the map", () => {
    const expected = deterministicIncidentSummary(incidents[1]);
    expect(html).toContain(expected);
    expect(expected).not.toBe(aiSummary);
  });

  it("never renders a summary keyed by a non-rendered incident id", () => {
    expect(html).not.toContain(PHANTOM_SUMMARY);
  });
});

// ---------------------------------------------------------------------------
// Shipping — ShippingReportPreview builds ds.relatedIncidents internally
// (prioritiseRelated over the maritime-security enriched set) and passes
// incidentSummaries to the table. Titles carry maritime cues + named
// chokepoints so the dataset keeps them (mirrors bespokeReportChartTables).
// ---------------------------------------------------------------------------

describe("ShippingReportPreview Related Incidents summary wiring", () => {
  const incidents: ShippingReportIncident[] = [
    {
      id: "sh1",
      topic: "shipping",
      title: "Tanker attacked by armed skiffs in the Gulf of Aden",
      severity: "high",
      occurredAt: "2026-06-14T08:00:00+00:00",
      country: "Yemen",
      location: "Gulf of Aden",
      summary: "Armed men in skiffs attacked a tanker underway.",
      source: "Test Wire",
      sourceUrl: "https://example.com/sh1",
    },
    {
      id: "sh2",
      topic: "shipping",
      title: "Cargo vessel boarded and crew robbed in the Singapore Strait",
      severity: "moderate",
      occurredAt: "2026-06-12T08:00:00+00:00",
      country: "Singapore",
      location: "Singapore Strait",
      summary: "Robbers boarded a bulk carrier and stole stores.",
      source: "Test Wire",
      sourceUrl: "https://example.com/sh2",
    },
  ];
  const aiSummary = "Vetted AI summary for the tanker-attack lead.";
  const summaries: Record<string, string> = {
    sh1: aiSummary,
    [PHANTOM_ID]: PHANTOM_SUMMARY,
  };
  const html = renderToStaticMarkup(
    <ShippingReportPreview
      report={{ ...report, topic: "shipping" } as never}
      incidents={incidents}
      incidentSummaries={summaries}
    />,
  );

  it("renders the Related Incidents table body with the real titles", () => {
    expect(html).toContain("Tanker attacked by armed skiffs in the Gulf of Aden");
    expect(html).toContain(
      "Cargo vessel boarded and crew robbed in the Singapore Strait",
    );
  });

  it("shows the AI summary for the enriched row whose id is in the map", () => {
    expect(html).toContain(aiSummary);
  });

  it("shows the deterministic fallback for the row absent from the map", () => {
    const expected = deterministicIncidentSummary(incidents[1]);
    expect(html).toContain(expected);
    expect(expected).not.toBe(aiSummary);
  });

  it("never renders a summary keyed by a non-rendered incident id", () => {
    expect(html).not.toContain(PHANTOM_SUMMARY);
  });
});
