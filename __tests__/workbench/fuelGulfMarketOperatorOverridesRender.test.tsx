/**
 * Rendered-markup proof for Fuel Watch report structure:
 *   1. Gulf/Hormuz developments flow through the normal sections — there is
 *      no standalone "Gulf and Hormuz Chokepoint Watch" heading.
 *   2. A Market and Operator Responses row override (keyed by
 *      date|actor|action) replaces the rendered cells; suppressing every row
 *      removes the section entirely; blank fields revert byte-identically.
 *   3. pruneTopicSectionOverrides drops cleared entries for both maps.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  applyGulfBulletOverrides,
  applyMarketOperatorOverrides,
  marketOperatorRowKey,
  pruneTopicSectionOverrides,
  type TopicSectionOverrides,
} from "../../artifacts/workbench/src/lib/topicSectionOverrides";
import { buildFuelWatchReportData } from "../../artifacts/workbench/src/lib/fuelWatchReport";
import ReportPreview from "../../artifacts/workbench/src/components/ReportPreview";

const ISSUE_DATE = "2026-06-20";
const OV_TEXT = "ZZOVERRIDDENBULLETZZ";
const OV_CELL = "ZZOVERRIDDENCELLZZ";

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

const report = {
  title: "Fuel Watch",
  topic: "fuel",
  issueDate: ISSUE_DATE,
  hardNumbers: null,
  ...PROSE_FIELDS,
};

const incidents = [
  {
    id: "u1",
    topic: "fuel",
    country: "Iran",
    severity: "high",
    location: "Strait of Hormuz",
    title: "Tanker transit disrupted near the Strait of Hormuz",
    summary: "Transit through the Strait of Hormuz was disrupted.",
    occurredAt: "2026-06-16T08:00:00+00:00",
    source: "Test Wire",
    sourceUrl: "https://example.com/u1",
  },
  {
    id: "u2",
    topic: "fuel",
    country: "Saudi Arabia",
    severity: "moderate",
    location: "Riyadh",
    title: "Saudi Aramco announces output increase to stabilise supply",
    summary:
      "Saudi Aramco said it will increase crude output to stabilise regional fuel supply.",
    occurredAt: "2026-06-17T08:00:00+00:00",
    source: "Test Wire",
    sourceUrl: "https://example.com/u2",
  },
];

// The SAME canonical builder the editor/preview/PDF use — so the test keys
// its overrides exactly the way the editor does.
const fuelData = buildFuelWatchReportData(
  { issueDate: ISSUE_DATE, hardNumbers: null },
  incidents as never,
);
const gulf = fuelData.incidentData.gulfChokepointWatch;
const gulfLines = gulf
  ? [...gulf.currentItemLines, ...gulf.standingItemLines]
  : [];
const producerRows = fuelData.incidentData.producerBuyerActions;

const el = (ov?: TopicSectionOverrides) =>
  createElement(ReportPreview as never, {
    report,
    incidents,
    sectionOverrides: ov,
  } as never);

describe("fuel Gulf & Hormuz is not a separate report section", () => {
  it("dataset still derives Gulf/Hormuz items for the lead narrative", () => {
    expect(gulfLines.length).toBeGreaterThan(0);
  });

  it("does not render a standalone Gulf and Hormuz Chokepoint Watch heading", () => {
    const html = renderToStaticMarkup(el());
    expect(html).not.toContain("Gulf and Hormuz Chokepoint Watch");
  });

  it("still carries the Hormuz development in the normal report flow", () => {
    const html = renderToStaticMarkup(el());
    expect(html).toMatch(/Tanker transit disrupted near the Strait of Hormuz/i);
  });

  it("Gulf bullet overrides no longer change the rendered report", () => {
    const target = gulfLines[0];
    const base = renderToStaticMarkup(el());
    const withOv = renderToStaticMarkup(
      el({ gulfBulletOverrides: { [target]: { text: OV_TEXT } } }),
    );
    expect(withOv).not.toContain(OV_TEXT);
    expect(withOv).toBe(base);
  });

  it("apply helper is pure and order-preserving", () => {
    const lines = ["a", "b", "c"];
    expect(applyGulfBulletOverrides(lines, undefined)).toEqual(lines);
    expect(
      applyGulfBulletOverrides(lines, {
        b: { text: "B2" },
        c: { suppressed: true },
      }),
    ).toEqual(["a", "B2"]);
  });
});

describe("fuel Market and Operator Responses row overrides", () => {
  it("dataset produces at least one producer row to override", () => {
    expect(producerRows.length).toBeGreaterThan(0);
  });

  it("cell override renders; suppressing all rows removes the section; blank reverts", () => {
    const row = producerRows[0];
    const key = marketOperatorRowKey(row);
    const base = renderToStaticMarkup(el());
    expect(base).toContain("Market and Operator Responses");
    expect(base).not.toContain(OV_CELL);

    const withOv = renderToStaticMarkup(
      el({ marketOperatorOverrides: { [key]: { action: OV_CELL } } }),
    );
    expect(withOv).toContain(OV_CELL);

    const allSuppressed = renderToStaticMarkup(
      el({
        marketOperatorOverrides: Object.fromEntries(
          producerRows.map((r) => [
            marketOperatorRowKey(r),
            { suppressed: true },
          ]),
        ),
      }),
    );
    expect(allSuppressed).not.toContain("Market and Operator Responses");

    const cleared = renderToStaticMarkup(
      el({
        marketOperatorOverrides: {
          [key]: { actor: "", category: "", action: " ", read: "", date: "" },
        },
      }),
    );
    expect(cleared).toBe(base);
  });

  it("apply helper replaces only non-blank fields and drops suppressed rows", () => {
    const row = producerRows[0];
    const key = marketOperatorRowKey(row);
    const out = applyMarketOperatorOverrides(producerRows, {
      [key]: { actor: OV_CELL, action: "" },
    });
    expect(out[0].actor).toBe(OV_CELL);
    expect(out[0].action).toBe(row.action);
    expect(
      applyMarketOperatorOverrides(producerRows, {
        [key]: { suppressed: true },
      }).length,
    ).toBe(producerRows.length - 1);
  });
});

describe("pruneTopicSectionOverrides handles the new maps", () => {
  it("keeps genuine overrides, drops cleared ones", () => {
    const pruned = pruneTopicSectionOverrides({
      gulfBulletOverrides: {
        "line-a": { text: "  ", suppressed: false },
        "line-b": { suppressed: true },
        "line-c": { text: "Rewritten" },
      },
      marketOperatorOverrides: {
        k1: { actor: "", action: " ", suppressed: false },
        k2: { read: "Edited read" },
        k3: { suppressed: true },
      },
    });
    expect(pruned).toEqual({
      gulfBulletOverrides: {
        "line-b": { suppressed: true },
        "line-c": { text: "Rewritten" },
      },
      marketOperatorOverrides: {
        k2: { read: "Edited read" },
        k3: { suppressed: true },
      },
    });
  });
});
