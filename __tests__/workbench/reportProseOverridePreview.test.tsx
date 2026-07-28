/**
 * Preview side of the prose-override parity guard (task 448).
 *
 * Renders each topic's on-screen preview component with the SAME sentinel-laden
 * report fixtures the PDF companion (`reportProseOverridePdf.test.ts`) feeds
 * the jsPDF exporters, and asserts every saved override sentinel appears in
 * the rendered HTML. Both suites passing proves preview text == PDF text for
 * each editable section: the same saved value renders on both surfaces.
 *
 * Separate file because the preview components need the REAL pdfChrome module
 * (SEV_COLOR / DISCLAIMER_TEXT / …) while the PDF suite mocks it with a
 * recording stub — the same split the curation parity suites use.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import FlashpointReportPreview from "../../artifacts/workbench/src/components/FlashpointReportPreview";
import ShippingReportPreview from "../../artifacts/workbench/src/components/ShippingReportPreview";
import ConflictReportPreview from "../../artifacts/workbench/src/components/ConflictReportPreview";
import ReportPreview from "../../artifacts/workbench/src/components/ReportPreview";
import {
  FLASHPOINT_REPORT,
  FLASHPOINT_INCIDENTS,
  FLASHPOINT_SENTINELS,
  SHIPPING_REPORT,
  SHIPPING_INCIDENTS,
  SHIPPING_SENTINELS,
  CONFLICT_REPORT,
  CONFLICT_INCIDENTS,
  CONFLICT_SENTINELS,
  ENERGY_REPORT,
  ENERGY_INCIDENTS,
  ENERGY_SENTINELS,
} from "./prosePassthroughTestHelpers";

function expectAllSentinels(html: string, sentinels: Record<string, string>) {
  for (const [field, sentinel] of Object.entries(sentinels)) {
    const token = sentinel.split(" ")[0];
    if (!html.includes(token)) {
      throw new Error(
        `Saved override for "${field}" (token ${token}) did not reach the on-screen preview markup.`,
      );
    }
  }
}

describe("saved prose overrides reach the on-screen preview", () => {
  it("flashpoint preview renders every saved override", () => {
    const html = renderToStaticMarkup(
      createElement(FlashpointReportPreview, {
        report: FLASHPOINT_REPORT,
        incidents: FLASHPOINT_INCIDENTS,
      } as never),
    );
    expectAllSentinels(html, FLASHPOINT_SENTINELS);
  });

  it("shipping preview renders every saved section read", () => {
    const html = renderToStaticMarkup(
      createElement(ShippingReportPreview, {
        report: SHIPPING_REPORT,
        incidents: SHIPPING_INCIDENTS,
      } as never),
    );
    expectAllSentinels(html, SHIPPING_SENTINELS);
  });

  it("conflict preview renders the saved Other Watched Theatres read", () => {
    const html = renderToStaticMarkup(
      createElement(ConflictReportPreview, {
        report: CONFLICT_REPORT,
        incidents: CONFLICT_INCIDENTS,
      } as never),
    );
    expectAllSentinels(html, CONFLICT_SENTINELS);
  });

  it("generic energy preview renders every saved core narrative field", () => {
    const html = renderToStaticMarkup(
      createElement(ReportPreview, {
        report: ENERGY_REPORT,
        incidents: ENERGY_INCIDENTS,
      } as never),
    );
    expectAllSentinels(html, ENERGY_SENTINELS);
  });
});
