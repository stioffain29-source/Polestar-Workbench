/**
 * Rendered-markup proof for Task: owner-editable TOPIC report surfaces.
 * Owner-gated `/api` means no live screenshots, so per
 * `.agents/memory/owner-gated-ui-verification.md` we verify with
 * `renderToStaticMarkup`:
 *   1. Fast Facts tile overrides (label/value/note, keyed by AUTO label) show
 *      in every topic preview, and CLEARING the override reverts to auto.
 *   2. (retired) The fuel Gulf & Hormuz read was a separately-editable panel;
 *      it is now folded into the canonical Operational Read, so the
 *      panelReads machinery and its tests were removed.
 *   3. Energy Market Prices row overrides replace value/change; a non-numeric
 *      value override is ignored (no garbage in the card).
 *   4. pruneTopicSectionOverrides drops blank entries so cleared overrides are
 *      never persisted.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  applyFastFactOverrides,
  applyMarketPriceOverrides,
  pruneTopicSectionOverrides,
  type TopicSectionOverrides,
} from "../../artifacts/workbench/src/lib/topicSectionOverrides";
import FlashpointReportPreview from "../../artifacts/workbench/src/components/FlashpointReportPreview";
import ShippingReportPreview from "../../artifacts/workbench/src/components/ShippingReportPreview";
import ConflictReportPreview from "../../artifacts/workbench/src/components/ConflictReportPreview";
import CargoReportPreview from "../../artifacts/workbench/src/components/CargoReportPreview";
import ReportPreview from "../../artifacts/workbench/src/components/ReportPreview";

const ISSUE_DATE = "2026-06-20";
const OV_VALUE = "ZZOVERRIDDENVALUEZZ";
const OV_LABEL = "ZZOVERRIDDENLABELZZ";

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

// Every topic's Fast Facts includes a "Total Records"-style count tile; the
// stable cross-topic tile is "Reporting Period" (generic) / dataset-specific
// labels elsewhere. Rather than hard-code labels per topic, override by the
// FIRST auto label found in the base render is not possible from markup — so
// each test names the known auto label for its topic dataset builder.
describe("Fast Facts tile overrides render in preview and clearing reverts", () => {
  function run(
    Component: unknown,
    props: Record<string, unknown>,
    autoLabel: string,
  ) {
    const el = (ov?: TopicSectionOverrides) =>
      createElement(Component as never, {
        ...props,
        sectionOverrides: ov,
      } as never);
    const base = renderToStaticMarkup(el());
    expect(base).not.toContain(OV_VALUE);
    const withOv = renderToStaticMarkup(
      el({
        fastFactOverrides: {
          [autoLabel]: { label: OV_LABEL, value: OV_VALUE },
        },
      }),
    );
    expect(withOv).toContain(OV_VALUE);
    expect(withOv.toUpperCase()).toContain(OV_LABEL);
    // Clearing (blank fields) reverts to auto — identical to base render.
    const cleared = renderToStaticMarkup(
      el({ fastFactOverrides: { [autoLabel]: { label: "", value: "" } } }),
    );
    expect(cleared).toBe(base);
  }

  it("flashpoint", () => {
    const report = { title: "Flashpoint Watch", topic: "flashpoint", issueDate: ISSUE_DATE, ...PROSE_FIELDS };
    const incidents = [
      baseInc({ id: "f1", topic: "flashpoint", country: "Indonesia", severity: "high", title: "Mass protest demonstrators clash with police", summary: "Demonstrators clashed with police." }),
    ];
    run(FlashpointReportPreview, { report, incidents }, "Reporting Period");
  });

  it("shipping", () => {
    const report = { title: "Shipping Watch", topic: "shipping", issueDate: ISSUE_DATE, ...PROSE_FIELDS };
    const incidents = [
      baseInc({ id: "s1", topic: "shipping", country: "Yemen", severity: "high", location: "Red Sea", title: "Tanker attacked by armed skiffs in the Gulf of Aden", summary: "Armed men attacked a tanker." }),
    ];
    run(ShippingReportPreview, { report, incidents }, "Reporting Period");
  });

  it("conflict", () => {
    const report = { title: "Conflict Watch", topic: "conflict", issueDate: ISSUE_DATE, ...PROSE_FIELDS };
    const incidents = [
      baseInc({ id: "c1", topic: "conflict", country: "Philippines", severity: "high", title: "Armed clashes between troops and militants near the outpost", summary: "Troops exchanged fire with militants." }),
    ];
    run(ConflictReportPreview, { report, incidents }, "Total Records");
  });

  it("cargo", () => {
    const report = { title: "Cargo Watch", topic: "cargo_watch", issueDate: ISSUE_DATE, ...PROSE_FIELDS };
    const incidents = [
      baseInc({ id: "g1", topic: "cargo_watch", country: "Indonesia", severity: "moderate", title: "Truck hijacking of an electronics consignment on the toll road", summary: "A cargo truck carrying electronics was hijacked." }),
    ];
    run(CargoReportPreview, { report, incidents }, "Total Incidents");
  });

  it("generic energy", () => {
    const report = { title: "Energy Watch", topic: "energy", issueDate: ISSUE_DATE, ...PROSE_FIELDS };
    const incidents = [
      baseInc({ id: "e1", topic: "energy", country: "Indonesia", severity: "high", title: "Power grid failure causes a rolling blackout in the east", summary: "A grid failure cut power in the east." }),
    ];
    run(ReportPreview, { report, incidents }, "Total Records");
  });
});

describe("energy Market Prices row overrides", () => {
  const rows = [
    {
      group: "energy",
      key: "brent",
      label: "Brent Crude",
      value: 82.4,
      unit: "USD/bbl",
      change: "+1.2%",
      date: "2026-06-19",
      trajectory: [],
    },
  ];

  it("numeric value + change override apply; non-numeric value ignored", () => {
    const out = applyMarketPriceOverrides(rows as never[] as typeof rows, {
      "energy:brent": { value: "99.9", change: "flat on the week" },
    });
    expect(out[0].value).toBe(99.9);
    expect(out[0].change).toBe("flat on the week");
    const bad = applyMarketPriceOverrides(rows, {
      "energy:brent": { value: "not-a-number" },
    });
    expect(bad[0].value).toBe(82.4);
  });

  it("override renders in the generic energy preview", () => {
    const report = { title: "Energy Watch", topic: "energy", issueDate: ISSUE_DATE, ...PROSE_FIELDS };
    const el = (ov?: TopicSectionOverrides) =>
      createElement(ReportPreview as never, {
        report,
        incidents: [],
        marketPrices: rows,
        sectionOverrides: ov,
      } as never);
    const base = renderToStaticMarkup(el());
    expect(base).toContain("82.4");
    const withOv = renderToStaticMarkup(
      el({ marketPriceOverrides: { "energy:brent": { value: "99.9" } } }),
    );
    expect(withOv).toContain("99.9");
    expect(withOv).not.toContain("82.4");
  });

  it("override renders in the fertiliser preview (same path as energy)", () => {
    const fertRows = [
      {
        group: "fertiliser",
        key: "urea",
        label: "Urea (Middle East)",
        value: 411.5,
        unit: "USD/t",
        change: "-0.8%",
        date: "2026-06-19",
        trajectory: [],
      },
    ];
    const report = { title: "Fertiliser Watch", topic: "fertiliser", issueDate: ISSUE_DATE, ...PROSE_FIELDS };
    const el = (ov?: TopicSectionOverrides) =>
      createElement(ReportPreview as never, {
        report,
        incidents: [],
        marketPrices: fertRows,
        sectionOverrides: ov,
      } as never);
    const base = renderToStaticMarkup(el());
    expect(base).toContain("Market Prices");
    expect(base).toContain("411.5");
    const withOv = renderToStaticMarkup(
      el({
        marketPriceOverrides: {
          "fertiliser:urea": { value: "395", change: "steady" },
        },
      }),
    );
    expect(withOv).toContain("395");
    expect(withOv).toContain("steady");
    expect(withOv).not.toContain("411.5");
    // Clearing the override reverts byte-identically to auto.
    const cleared = renderToStaticMarkup(
      el({ marketPriceOverrides: { "fertiliser:urea": { value: "", change: "" } } }),
    );
    expect(cleared).toBe(base);
  });
});

describe("pruneTopicSectionOverrides drops blank entries", () => {
  it("keeps genuine overrides, drops cleared ones", () => {
    const pruned = pruneTopicSectionOverrides({
      hiddenSections: [],
      excludedIncidentIds: ["7"],
      fastFactOverrides: {
        "Total Records": { label: "", value: "  ", note: "" },
        "Highest Severity": { value: "High" },
      },
      marketPriceOverrides: {
        "energy:brent": { value: "", change: "" },
        "energy:wti": { change: "steady" },
      },
    });
    expect(pruned).toEqual({
      excludedIncidentIds: ["7"],
      fastFactOverrides: { "Highest Severity": { value: "High" } },
      marketPriceOverrides: { "energy:wti": { change: "steady" } },
    });
  });

  it("applyFastFactOverrides matches by auto label and passes extras through", () => {
    const cards = [
      { label: "Total Records", value: "12", note: "last 7 days", severity: "high" },
    ];
    const out = applyFastFactOverrides(cards, {
      "Total Records": { value: "10" },
    });
    expect(out[0]).toEqual({
      label: "Total Records",
      value: "10",
      note: "last 7 days",
      severity: "high",
    });
    expect(
      applyFastFactOverrides(cards, { "Total Records": { value: " " } }),
    ).toEqual(cards);
  });
});
