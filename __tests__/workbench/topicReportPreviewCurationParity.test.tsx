/**
 * Preview-side companion to `topicReportSectionCurationParity.test.ts`.
 *
 * Owner-gated `/api` means no live screenshots, so per
 * `.agents/memory/owner-gated-ui-verification.md` we verify the on-screen
 * previews with `renderToStaticMarkup`. This file proves that:
 *   1. a HIDDEN section's heading vanishes from the rendered HTML (the shared
 *      `Section` component returns null when `hidden`), and
 *   2. an EXCLUDED incident's title vanishes once `applyIncidentCurations`
 *      removes it from the pool the preview renders from.
 *
 * The PDF companion asserts the same two invariants on every topic exporter,
 * so together they prove preview == PDF for section-hiding + incident curation.
 *
 * This file is DELIBERATELY separate from the PDF test: the PDF test mocks the
 * whole `pdfChrome` module (a recording stub), but the preview components import
 * REAL values from `pdfChrome` (SEV_COLOR / DISCLAIMER_TEXT / …), so they must
 * run against the un-mocked module.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { applyIncidentCurations } from "../../artifacts/workbench/src/lib/topicSectionOverrides";
import FlashpointReportPreview from "../../artifacts/workbench/src/components/FlashpointReportPreview";
import ShippingReportPreview from "../../artifacts/workbench/src/components/ShippingReportPreview";
import ConflictReportPreview from "../../artifacts/workbench/src/components/ConflictReportPreview";
import ReportPreview from "../../artifacts/workbench/src/components/ReportPreview";

const ISSUE_DATE = "2026-06-20";
const EXCL_TOKEN = "ZZEXCLUDEDZZ";

function baseInc(over: {
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

// Empty-string prose scaffold — the generic `ReportPreview` runs its narrative
// fields through `resolveSimpleProse`, which expects strings.
const PROSE_FIELDS = {
  riskRating: "",
  situation: "",
  whatHappened: "",
  whatMatters: "",
  implications: "",
  polestarView: "",
  watchNext: "",
  author: "",
};

describe("topic report preview — hidden sections & curated incidents disappear", () => {
  it("flashpoint preview", () => {
    const report = { title: "Flashpoint Watch", topic: "flashpoint", issueDate: ISSUE_DATE, ...PROSE_FIELDS };
    const incidents = [
      baseInc({ id: "f1", topic: "flashpoint", country: "Indonesia", severity: "high", title: `Mass protest ${EXCL_TOKEN} demonstrators clash with police`, summary: "Demonstrators clashed with police." }),
      baseInc({ id: "f2", topic: "flashpoint", country: "Philippines", severity: "high", title: "Protesters rally against a fuel price hike in the capital", summary: "A street rally protested fuel prices." }),
    ];
    const el = (inc: unknown[], hidden?: string[]) =>
      createElement(FlashpointReportPreview, { report, incidents: inc, hiddenSections: hidden } as never);
    const base = renderToStaticMarkup(el(incidents));
    expect(base).toContain("Fast Facts");
    expect(base).toContain(EXCL_TOKEN);
    expect(renderToStaticMarkup(el(incidents, ["fast-facts"]))).not.toContain("Fast Facts");
    const curated = applyIncidentCurations(incidents as never, { excludedIncidentIds: ["f1"] });
    expect(renderToStaticMarkup(el(curated as never))).not.toContain(EXCL_TOKEN);
  });

  it("shipping preview", () => {
    const report = { title: "Shipping Watch", topic: "shipping", issueDate: ISSUE_DATE, ...PROSE_FIELDS };
    const incidents = [
      baseInc({ id: "s1", topic: "shipping", country: "Yemen", severity: "high", location: "Red Sea", title: `Tanker ${EXCL_TOKEN} attacked by armed skiffs in the Gulf of Aden`, summary: "Armed men in skiffs attacked a tanker." }),
      baseInc({ id: "s2", topic: "shipping", country: "Singapore", severity: "moderate", title: "Cargo vessel boarded and crew robbed in the Singapore Strait", summary: "Robbers boarded a bulk carrier." }),
    ];
    const el = (inc: unknown[], hidden?: string[]) =>
      createElement(ShippingReportPreview, { report, incidents: inc, hiddenSections: hidden } as never);
    const base = renderToStaticMarkup(el(incidents));
    expect(base).toContain("Fast Facts");
    expect(base).toContain(EXCL_TOKEN);
    expect(renderToStaticMarkup(el(incidents, ["fast-facts"]))).not.toContain("Fast Facts");
    const curated = applyIncidentCurations(incidents as never, { excludedIncidentIds: ["s1"] });
    expect(renderToStaticMarkup(el(curated as never))).not.toContain(EXCL_TOKEN);
  });

  it("conflict preview", () => {
    const report = { title: "Conflict Watch", topic: "conflict", issueDate: ISSUE_DATE, ...PROSE_FIELDS };
    const incidents = [
      baseInc({ id: "c1", topic: "conflict", country: "Philippines", severity: "high", title: `Armed clashes ${EXCL_TOKEN} between troops and militants near the outpost`, summary: "Troops exchanged fire with militants." }),
      baseInc({ id: "c2", topic: "conflict", country: "Myanmar", severity: "moderate", title: "Militants ambush an army patrol on the highway", summary: "An army patrol was ambushed." }),
    ];
    const el = (inc: unknown[], hidden?: string[]) =>
      createElement(ConflictReportPreview, { report, incidents: inc, hiddenSections: hidden } as never);
    const base = renderToStaticMarkup(el(incidents));
    expect(base).toContain("Fast Facts");
    expect(base).toContain(EXCL_TOKEN);
    expect(renderToStaticMarkup(el(incidents, ["fast-facts"]))).not.toContain("Fast Facts");
    const curated = applyIncidentCurations(incidents as never, { excludedIncidentIds: ["c1"] });
    expect(renderToStaticMarkup(el(curated as never))).not.toContain(EXCL_TOKEN);
  });

  it("generic energy preview", () => {
    const report = { title: "Energy Watch", topic: "energy", issueDate: ISSUE_DATE, ...PROSE_FIELDS };
    const incidents = [
      baseInc({ id: "e1", topic: "energy", country: "Indonesia", severity: "high", title: `Power grid failure causes a rolling blackout in the east ${EXCL_TOKEN}`, summary: "A grid failure cut power in the east." }),
      baseInc({ id: "e2", topic: "energy", country: "Philippines", severity: "moderate", title: "Substation fire causes a rolling blackout across the grid", summary: "A substation fire forced blackouts." }),
    ];
    const el = (inc: unknown[], hidden?: string[]) =>
      createElement(ReportPreview, { report, incidents: inc, hiddenSections: hidden } as never);
    const base = renderToStaticMarkup(el(incidents));
    expect(base).toContain("Related Incidents");
    expect(base).toContain(EXCL_TOKEN);
    expect(renderToStaticMarkup(el(incidents, ["related-incidents"]))).not.toContain("Related Incidents");
    const curated = applyIncidentCurations(incidents as never, { excludedIncidentIds: ["e1"] });
    expect(renderToStaticMarkup(el(curated as never))).not.toContain(EXCL_TOKEN);
  });
});
