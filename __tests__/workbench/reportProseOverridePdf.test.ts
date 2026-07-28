/**
 * PDF side of the prose-override parity guard (task 448).
 *
 * The headless exporter (`exportReportPdfHeadless.ts`) now spreads the ENTIRE
 * fetched report row via `buildHeadlessReportData`, so a saved prose override
 * can never silently fall back to auto-prose in the exported PDF (the task-445
 * regression). This suite drives each per-topic jsPDF exporter with report
 * fixtures whose every editable prose/read column carries a distinct sentinel
 * — routed through `buildHeadlessReportData`, exactly as the headless script
 * does — and asserts every sentinel reaches the PDF text stream.
 *
 * The preview companion (`reportProseOverridePreview.test.tsx`) renders the
 * SAME report fixtures with `renderToStaticMarkup` and asserts the same
 * sentinels appear in the on-screen HTML, so together the two suites prove
 * preview text == PDF text for each editable section. (Two files because this
 * one mocks `pdfChrome` with a recording stub while the preview components
 * need the real module — same split as the curation parity suites.)
 */

// Recording pdfChrome stub — identical technique to
// topicReportSectionCurationParity.test.ts: capture every pdf.text() string.
jest.mock("../../artifacts/workbench/src/lib/pdfChrome", () => {
  const textCalls: string[] = [];
  const record = (arg: unknown) => {
    if (Array.isArray(arg)) for (const s of arg) textCalls.push(String(s));
    else if (arg != null) textCalls.push(String(arg));
  };
  const pdf = new Proxy(
    {},
    {
      get(_t, prop) {
        if (typeof prop === "symbol") return undefined;
        switch (prop) {
          case "splitTextToSize":
            return (txt: unknown) => (Array.isArray(txt) ? txt : [String(txt)]);
          case "text":
            return (arg: unknown) => record(arg);
          case "getTextWidth":
          case "getStringUnitWidth":
            return () => 10;
          case "getNumberOfPages":
            return () => 1;
          case "internal":
            return { pageSize: { getWidth: () => 595, getHeight: () => 842 } };
          default:
            return () => undefined;
        }
      },
    },
  );
  const sevLabel: Record<string, string> = {
    insignificant: "Insignificant",
    low: "Low",
    moderate: "Moderate",
    high: "High",
    extreme: "Extreme",
  };
  const sevColor: Record<string, string> = {
    insignificant: "#9AA0A6",
    low: "#4655FF",
    moderate: "#F2A900",
    high: "#E8731C",
    extreme: "#A33232",
  };
  const api: Record<string, unknown> = {
    __esModule: true,
    __textCalls: textCalls,
    __reset: () => {
      textCalls.length = 0;
    },
    createCtx: () => ({
      pdf,
      MX: 40,
      CW: 515,
      W: 595,
      H: 100000,
      TOP: 40,
      BOTTOM: 40,
      y: 40,
    }),
    drawSectionHeading: (ctx: { y: number }) => {
      if (ctx && typeof ctx.y === "number") ctx.y += 10;
    },
    // Prose reaches the page through these chrome helpers (not raw pdf.text),
    // so RECORD their bodies too — otherwise every override looks missing.
    renderProse: (_ctx: unknown, body: unknown) => record(body),
    drawSectionWithProse: (ctx: { y: number }, _title: unknown, body: unknown) => {
      record(body);
      if (ctx && typeof ctx.y === "number") ctx.y += 10;
    },
    drawBulletSection: (
      ctx: { y: number },
      _title: unknown,
      body: unknown,
    ) => {
      record(body);
      if (ctx && typeof ctx.y === "number") ctx.y += 10;
    },
    sanitize: (s: unknown) => s,
    sevKey: (s: unknown) => String(s ?? "").toLowerCase(),
    SEV_LABEL: sevLabel,
    SEV_COLOR: sevColor,
    ensureRobotoLoaded: async () => {},
    prepareCoverImage: async () => undefined,
    NAVY: "#0B0B3D",
    POLAR: "#E2E2E2",
    DUSK: "#303030",
    WHITE: "#FFFFFF",
    ELECTRIC: "#4655FF",
    COVER_TOP_BAND_H: 100,
    COVER_BOTTOM_BLOCK_H: 100,
  };
  return new Proxy(api, {
    get(target, prop) {
      if (prop === "__esModule") return true;
      if (typeof prop === "symbol") return undefined;
      if (prop in target) return (target as Record<string, unknown>)[prop];
      return () => undefined;
    },
  });
});

import { exportFlashpointReportPdf } from "../../artifacts/workbench/src/lib/exportFlashpointReportPdf";
import { exportShippingReportPdf } from "../../artifacts/workbench/src/lib/exportShippingReportPdf";
import { exportConflictReportPdf } from "../../artifacts/workbench/src/lib/exportConflictReportPdf";
import { exportTopicReportPdf } from "../../artifacts/workbench/src/lib/exportTopicReportPdf";
import { buildHeadlessReportData } from "../../artifacts/workbench/scripts/headlessReportData";
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

const pdfChromeMock = jest.requireMock(
  "../../artifacts/workbench/src/lib/pdfChrome",
) as { __textCalls: string[]; __reset: () => void };

async function captureText(run: () => Promise<unknown>): Promise<string> {
  pdfChromeMock.__reset();
  await run();
  return pdfChromeMock.__textCalls.join("\n");
}

function expectAllSentinels(text: string, sentinels: Record<string, string>) {
  for (const [field, sentinel] of Object.entries(sentinels)) {
    // Match on the unique token prefix (long prose may be wrapped/split).
    const token = sentinel.split(" ")[0];
    if (!text.includes(token)) {
      throw new Error(
        `Saved override for "${field}" (token ${token}) did not reach the PDF text stream — headless PDF would diverge from the on-screen preview.`,
      );
    }
  }
}

describe("saved prose overrides reach the exported PDF (headless pass-through)", () => {
  it("flashpoint: every editable section renders the saved override", async () => {
    const data = buildHeadlessReportData(FLASHPOINT_REPORT);
    const text = await captureText(() =>
      exportFlashpointReportPdf(
        data as never,
        FLASHPOINT_INCIDENTS as never,
        "flashpoint.pdf",
        null,
      ),
    );
    expectAllSentinels(text, FLASHPOINT_SENTINELS);
  });

  it("shipping: every editable section read renders the saved override", async () => {
    const data = buildHeadlessReportData(SHIPPING_REPORT);
    const text = await captureText(() =>
      exportShippingReportPdf(
        data as never,
        SHIPPING_INCIDENTS as never,
        "shipping.pdf",
        [],
        [],
        {},
      ),
    );
    expectAllSentinels(text, SHIPPING_SENTINELS);
  });

  it("conflict: the Other Watched Theatres read renders the saved override", async () => {
    const data = buildHeadlessReportData(CONFLICT_REPORT);
    const text = await captureText(() =>
      exportConflictReportPdf(
        data as never,
        CONFLICT_INCIDENTS as never,
        "conflict.pdf",
        null,
        {},
        null,
      ),
    );
    expectAllSentinels(text, CONFLICT_SENTINELS);
  });

  it("generic energy: every core narrative field renders the saved override", async () => {
    const data = buildHeadlessReportData(ENERGY_REPORT);
    const text = await captureText(() =>
      exportTopicReportPdf(
        data as never,
        ENERGY_INCIDENTS as never,
        { energy: "Energy" },
        "energy.pdf",
        {},
      ),
    );
    expectAllSentinels(text, ENERGY_SENTINELS);
  });
});
