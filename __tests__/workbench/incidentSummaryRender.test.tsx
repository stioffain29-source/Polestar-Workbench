import { renderToStaticMarkup } from "react-dom/server";

import ConflictReportPreview from "../../artifacts/workbench/src/components/ConflictReportPreview";
import ShippingReportPreview from "../../artifacts/workbench/src/components/ShippingReportPreview";
import ReportPreview from "../../artifacts/workbench/src/components/ReportPreview";
import {
  resolveIncidentSummary,
  deterministicIncidentSummary,
} from "../../artifacts/workbench/src/lib/incidentSummary";
import type { ConflictReportIncident } from "../../artifacts/workbench/src/lib/conflictReportDataset";
import type { ShippingReportIncident } from "../../artifacts/workbench/src/lib/shippingReportDataset";
import type { TopicFastFactsIncident } from "../../artifacts/workbench/src/lib/topicFastFacts";

// Render-parity guard for the per-incident summary line under each Related
// Incidents row. The editor preview and EVERY PDF exporter render that line
// through the SAME shared selector (`resolveIncidentSummary`), so this proves
// the on-screen experience the route test cannot:
//   - a generated AI summary renders under its row,
//   - an analyst's saved EDIT wins over the generated line (the editor feeds the
//     component its effective map = edited ?? generated, so an edited override in
//     the map is what the reader sees),
//   - a row with no summary falls back to the deterministic, source-free line
//     (never a blank cell).
// renderToStaticMarkup is enough — we assert the text is present in the markup,
// not where it lands geometrically. The heavy chart/map children are stubbed via
// jest.config moduleNameMapper.

const ISSUE_DATE = "2026-06-15";

// Conflict-relevant titles (unambiguous armed-actor cues) so the incidents
// survive the dataset's relevance/window filter and reach relatedIncidents.
function inc(
  over: Partial<ConflictReportIncident> & {
    id: number | string;
    severity: string;
    country: string;
    title: string;
  },
): ConflictReportIncident {
  return {
    topic: "conflict",
    occurredAt: "2026-06-14T08:00:00+00:00",
    summary: null,
    source: "Test Wire",
    sourceUrl: `https://example.com/${over.id}`,
    location: null,
    ...over,
  };
}

const REPORT = {
  id: 1,
  title: "Conflict Watch",
  topic: "conflict" as const,
  issueDate: ISSUE_DATE,
};

const INCIDENTS: ConflictReportIncident[] = [
  inc({
    id: 1,
    country: "Philippines",
    severity: "high",
    title: "Armed clashes between troops and militants near the outpost",
  }),
  inc({
    id: 2,
    country: "Myanmar",
    severity: "moderate",
    title: "Militants ambush an army patrol on the highway",
  }),
  inc({
    id: 3,
    country: "India",
    severity: "low",
    title: "Armed clashes between troops and militants reported overnight",
  }),
];

function render(summaries: Record<string, string>): string {
  return renderToStaticMarkup(
    <ConflictReportPreview
      report={REPORT as never}
      incidents={INCIDENTS}
      incidentSummaries={summaries}
    />,
  );
}

describe("Related Incidents summary line — render parity", () => {
  it("renders the generated AI summary under each related incident row", () => {
    const summaries = {
      "1": "Troops exchanged fire with militants near the outpost.",
      "2": "An army patrol was ambushed on the highway.",
      "3": "Overnight clashes were reported between troops and militants.",
    };
    const html = render(summaries);
    // Every generated line appears in the markup — one summary under each row.
    for (const text of Object.values(summaries)) {
      expect(html).toContain(text);
    }
  });

  it("shows the analyst's saved EDIT in place of the generated line", () => {
    // The editor passes its EFFECTIVE map (edited overrides folded in), so an
    // edited override is simply the value the component renders for that row.
    const edited = {
      "1": "ANALYST EDIT: militants and troops clashed at the outpost overnight.",
      "2": "An army patrol was ambushed on the highway.",
      "3": "Overnight clashes were reported between troops and militants.",
    };
    const html = render(edited);
    expect(html).toContain(edited["1"]);
    // The edited row's text is exactly what resolveIncidentSummary returns for it.
    expect(resolveIncidentSummary(INCIDENTS[0] as never, edited)).toBe(edited["1"]);
  });

  it("falls back to the deterministic line when a row has no summary", () => {
    // Only rows 1 and 2 are summarised; row 3 must render its deterministic,
    // source-free fallback rather than an empty cell.
    const partial = {
      "1": "Troops exchanged fire with militants near the outpost.",
      "2": "An army patrol was ambushed on the highway.",
    };
    const html = render(partial);

    const fallback = deterministicIncidentSummary(INCIDENTS[2] as never);
    expect(fallback.length).toBeGreaterThan(0);
    expect(html).toContain(fallback);
    // The fallback is exactly what the shared selector resolves for the unsummarised row.
    expect(resolveIncidentSummary(INCIDENTS[2] as never, partial)).toBe(fallback);
  });
});

// ---------------------------------------------------------------------------
// ShippingReportPreview — the SAME summary line renders under each Related
// Incidents row of the Shipping Watch report (and its PDF, via the shared
// selector). Maritime-security titles with named chokepoints so the rows
// survive buildShippingReportDataset's relevance/window filter and reach
// `ds.relatedIncidents` (mirrors bespokeReportChartTables.test.tsx).
// ---------------------------------------------------------------------------

const SHIP_INCIDENTS: ShippingReportIncident[] = [
  {
    id: "s1",
    topic: "shipping",
    title: "Tanker attacked by armed skiffs in the Gulf of Aden",
    severity: "high",
    occurredAt: "2026-06-14T08:00:00+00:00",
    country: "Yemen",
    summary: "Armed men in skiffs attacked a tanker underway.",
    source: "Test Wire",
    sourceUrl: "https://example.com/s1",
    location: null,
  },
  {
    id: "s2",
    topic: "shipping",
    title: "Cargo vessel boarded and crew robbed in the Singapore Strait",
    severity: "moderate",
    occurredAt: "2026-06-12T08:00:00+00:00",
    country: "Singapore",
    summary: "Robbers boarded a bulk carrier and stole stores.",
    source: "Test Wire",
    sourceUrl: "https://example.com/s2",
    location: null,
  },
];

function renderShipping(summaries: Record<string, string>): string {
  return renderToStaticMarkup(
    <ShippingReportPreview
      report={{ id: 2, title: "Shipping Watch", topic: "shipping", issueDate: ISSUE_DATE } as never}
      incidents={SHIP_INCIDENTS}
      incidentSummaries={summaries}
    />,
  );
}

describe("ShippingReportPreview — Related Incidents summary line render parity", () => {
  it("renders the generated AI summary under each related incident row", () => {
    const summaries = {
      s1: "A tanker came under skiff attack in the Gulf of Aden.",
      s2: "Robbers boarded a cargo vessel in the Singapore Strait.",
    };
    const html = renderShipping(summaries);
    for (const text of Object.values(summaries)) {
      expect(html).toContain(text);
    }
  });

  it("shows the analyst's saved EDIT in place of the generated line", () => {
    const edited = {
      s1: "ANALYST EDIT: a laden tanker was fired on by skiffs off Yemen.",
      s2: "Robbers boarded a cargo vessel in the Singapore Strait.",
    };
    const html = renderShipping(edited);
    expect(html).toContain(edited.s1);
    // The edited row's text is exactly what the shared selector returns for it.
    expect(resolveIncidentSummary(SHIP_INCIDENTS[0] as never, edited)).toBe(edited.s1);
  });

  it("falls back to the deterministic line when a row has no summary", () => {
    // Only s1 is summarised; s2 must render its deterministic, source-free
    // fallback rather than an empty cell.
    const partial = {
      s1: "A tanker came under skiff attack in the Gulf of Aden.",
    };
    const html = renderShipping(partial);

    const fallback = deterministicIncidentSummary(SHIP_INCIDENTS[1] as never);
    expect(fallback.length).toBeGreaterThan(0);
    expect(html).toContain(fallback);
    expect(resolveIncidentSummary(SHIP_INCIDENTS[1] as never, partial)).toBe(fallback);
  });
});

// ---------------------------------------------------------------------------
// ReportPreview (topic) — the SAME summary line renders under each Related
// Incidents row of the shared topic report (energy/cargo etc.) and its PDF.
// Three in-window energy incidents (below the strong-row floor) all survive
// selectRelatedIncidents (mirrors sharedReportChartTables.test.tsx).
// ---------------------------------------------------------------------------

const TOPIC_INCIDENTS: TopicFastFactsIncident[] = [
  {
    id: "e1",
    topic: "energy",
    title: "Power grid blackout disrupts Jakarta",
    severity: "high",
    occurredAt: "2026-06-14T00:00:00.000Z",
    country: "Indonesia",
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
    summary: "Energy rationing introduced amid a gas shortage.",
    source: "Test Source",
  },
];

function renderTopic(summaries: Record<string, string>): string {
  return renderToStaticMarkup(
    <ReportPreview
      report={{ id: 3, title: "Energy Watch", topic: "energy", issueDate: ISSUE_DATE }}
      incidents={TOPIC_INCIDENTS}
      incidentSummaries={summaries}
    />,
  );
}

describe("ReportPreview (topic) — Related Incidents summary line render parity", () => {
  it("renders the generated AI summary under each related incident row", () => {
    const summaries = {
      e1: "A blackout cut power across Jakarta.",
      e2: "A substation fire forced rolling blackouts in Manila.",
      e3: "Gas shortfalls triggered power rationing in Indonesia.",
    };
    const html = renderTopic(summaries);
    for (const text of Object.values(summaries)) {
      expect(html).toContain(text);
    }
  });

  it("shows the analyst's saved EDIT in place of the generated line", () => {
    const edited = {
      e1: "ANALYST EDIT: a grid failure left Jakarta without power.",
      e2: "A substation fire forced rolling blackouts in Manila.",
      e3: "Gas shortfalls triggered power rationing in Indonesia.",
    };
    const html = renderTopic(edited);
    expect(html).toContain(edited.e1);
    expect(resolveIncidentSummary(TOPIC_INCIDENTS[0] as never, edited)).toBe(edited.e1);
  });

  it("falls back to the deterministic line when a row has no summary", () => {
    // Only e1 and e2 are summarised; e3 must render its deterministic,
    // source-free fallback rather than an empty cell.
    const partial = {
      e1: "A blackout cut power across Jakarta.",
      e2: "A substation fire forced rolling blackouts in Manila.",
    };
    const html = renderTopic(partial);

    const fallback = deterministicIncidentSummary(TOPIC_INCIDENTS[2] as never);
    expect(fallback.length).toBeGreaterThan(0);
    expect(html).toContain(fallback);
    expect(resolveIncidentSummary(TOPIC_INCIDENTS[2] as never, partial)).toBe(fallback);
  });
});
