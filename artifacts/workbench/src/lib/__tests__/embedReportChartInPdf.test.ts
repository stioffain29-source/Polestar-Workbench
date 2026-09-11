/**
 * @jest-environment jsdom
 */

import type { Ctx } from "../pdfChrome";

const html2canvasMock = jest.fn();

jest.mock("html2canvas", () => ({
  __esModule: true,
  default: html2canvasMock,
}));

jest.mock("../pdfChrome", () => ({
  ensureSpace: jest.fn(),
  drawSectionHeading: jest.fn(),
  setRoboto: jest.fn(),
  setText: jest.fn(),
}));

import { embedChartMarkupInPdf } from "../embedReportChartInPdf";

type Html2CanvasOptions = {
  width?: number;
  windowWidth?: number;
};

function makeCanvas(options: Html2CanvasOptions) {
  return {
    width: (options.width ?? 0) * 4,
    height: 200 * 4,
    getContext: jest.fn(() => ({
      getImageData: jest.fn(() => ({
        data: new Uint8ClampedArray(64 * 64 * 4),
      })),
    })),
    toDataURL: jest.fn(() => "data:image/png;base64,chart"),
  };
}

function makeContext() {
  return {
    pdf: {
      addImage: jest.fn(),
    },
    W: 440,
    H: 800,
    MX: 20,
    TOP: 40,
    BOTTOM: 40,
    CW: 400,
    y: 40,
  } as unknown as Ctx;
}

describe("embedChartMarkupInPdf CSS pixel sizing", () => {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  let capturedHost: HTMLElement | undefined;

  beforeEach(() => {
    capturedHost = undefined;
    html2canvasMock.mockImplementation(
      async (host: HTMLElement, options: Html2CanvasOptions) => {
        capturedHost = host;
        return makeCanvas(options);
      },
    );
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    }) as typeof globalThis.requestAnimationFrame;
  });

  afterEach(() => {
    html2canvasMock.mockReset();
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    document.body.innerHTML = "";
  });

  it("uses CSS pixels for the Energy opt-in while keeping the PDF image 400pt wide", async () => {
    const ctx = makeContext();
    const cssWidth = (400 * 96) / 72;

    await expect(
      embedChartMarkupInPdf(
        ctx,
        '<div data-report-raster-scale><div>Energy chart</div></div>',
        { useCssPixelUnits: true },
      ),
    ).resolves.toBe(true);

    const captureOptions = html2canvasMock.mock.calls[0][1] as Html2CanvasOptions;
    expect(captureOptions.width).toBeCloseTo(cssWidth);
    expect(captureOptions.windowWidth).toBeCloseTo(cssWidth);
    expect(parseFloat(capturedHost?.style.width ?? "")).toBeCloseTo(cssWidth);
    expect(ctx.pdf.addImage).toHaveBeenCalledWith(
      "data:image/png;base64,chart",
      "PNG",
      20,
      40,
      400,
      150,
      undefined,
      "FAST",
    );
  });

  it("keeps the default capture and image dimensions for other topics", async () => {
    const ctx = makeContext();

    await expect(
      embedChartMarkupInPdf(
        ctx,
        '<div data-report-raster-scale><div>Other topic chart</div></div>',
      ),
    ).resolves.toBe(true);

    const captureOptions = html2canvasMock.mock.calls[0][1] as Html2CanvasOptions;
    expect(captureOptions.width).toBe(400);
    expect(captureOptions.windowWidth).toBe(400);
    expect(parseFloat(capturedHost?.style.width ?? "")).toBe(400);
    expect(ctx.pdf.addImage).toHaveBeenCalledWith(
      "data:image/png;base64,chart",
      "PNG",
      20,
      40,
      400,
      200,
      undefined,
      "FAST",
    );
  });
});