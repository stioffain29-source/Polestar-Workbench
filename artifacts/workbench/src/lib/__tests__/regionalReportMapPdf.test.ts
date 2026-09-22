/** @jest-environment node */

import type { Ctx } from "../pdfChrome";

const drawSectionHeading = jest.fn();

jest.mock("../pdfChrome", () => ({
  drawSectionHeading,
  ensureSpace: jest.fn(),
}));

import { drawRegionalReportMap } from "../regionalReportMapPdf";

describe("drawRegionalReportMap headless export", () => {
  it("retains the documented visual skip without inventing a fallback map", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const addImage = jest.fn();
    const ctx = { pdf: { addImage } } as unknown as Ctx;

    await expect(drawRegionalReportMap(ctx, [], "apac_weekly")).resolves.toBe(false);

    expect(drawSectionHeading).toHaveBeenCalledWith(ctx, "Regional Hotspot Map");
    expect(addImage).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("requires a browser DOM"));
    warn.mockRestore();
  });
});