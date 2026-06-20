import { renderToStaticMarkup } from "react-dom/server";

import ConflictReportPreview from "../../artifacts/workbench/src/components/ConflictReportPreview";
import {
  resolveIncidentSummary,
  deterministicIncidentSummary,
} from "../../artifacts/workbench/src/lib/incidentSummary";
import type { ConflictReportIncident } from "../../artifacts/workbench/src/lib/conflictReportDataset";

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
