import type { Ctx } from "../pdfChrome";

jest.mock("../pdfChrome", () => {
  const sanitize = (value: string | null | undefined) =>
    String(value ?? "")
      .replace(/\u2018|\u2019|\u02BC/g, "'")
      .replace(/\u201C|\u201D/g, '"')
      .replace(/\u2013|\u2014/g, "-")
      .replace(/\u2026/g, "...")
      .replace(/\u00A0/g, " ")
      .replace(/\u2022/g, "-")
      .replace(/[^\x09\x0A\x0D\x20-\xFF]/g, "");

  function newPage(ctx: any) {
    ctx.pdf.addPage();
    ctx.y = ctx.TOP;
  }

  return {
    DUSK: "#363636",
    sanitize,
    setRoboto: jest.fn(),
    setText: jest.fn(),
    newPage: jest.fn(newPage),
    ensureSpace: jest.fn((ctx: any, height: number) => {
      if (ctx.y + height > ctx.H - ctx.BOTTOM) newPage(ctx);
    }),
    drawSectionHeading: jest.fn((ctx: any, title: string) => {
      if (ctx.y > ctx.TOP + 4) ctx.y += 20;
      ctx.pdf.text(sanitize(title).toUpperCase(), ctx.MX, ctx.y);
      ctx.y += 30;
    }),
    drawSubtitle: jest.fn((ctx: any, title: string) => {
      if (ctx.y > ctx.TOP + 4) ctx.y += 10;
      ctx.pdf.text(sanitize(title).toUpperCase(), ctx.MX, ctx.y);
      ctx.y += 6;
    }),
  };
});

import { drawEnergyProse } from "../energyPdfFlow";

type DrawnText = { value: string; page: number };

function wrapDeterministically(value: string, width: number): string[] {
  const words = value.split(/\s+/).filter(Boolean);
  const maxCharacters = Math.max(8, Math.floor(width / 10));
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && candidate.length > maxCharacters) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function makeContext() {
  const drawn: DrawnText[] = [];
  const pdf = {
    pageNo: 1,
    addPage: jest.fn(function (this: { pageNo: number }) {
      this.pageNo += 1;
    }),
    splitTextToSize: jest.fn((value: string, width: number) =>
      wrapDeterministically(value, width),
    ),
    setFontSize: jest.fn(),
    text: jest.fn(function (this: { pageNo: number }, value: string) {
      drawn.push({ value, page: this.pageNo });
    }),
  };
  const ctx = {
    pdf,
    W: 600,
    H: 800,
    MX: 40,
    TOP: 80,
    BOTTOM: 40,
    CW: 520,
    y: 80,
    header: { kind: "Test", issueDate: "2026-01-01" },
  } as unknown as Ctx;
  return { ctx, pdf, drawn };
}

describe("drawEnergyProse pagination", () => {
  it("moves a short What Matters section to a fresh page as a whole", () => {
    const { ctx, pdf, drawn } = makeContext();
    ctx.y = 760;

    drawEnergyProse(ctx, "What Matters", "A short, decision-relevant assessment.");

    expect(pdf.addPage).toHaveBeenCalledTimes(1);
    expect(drawn.find((entry) => entry.value === "WHAT MATTERS")?.page).toBe(2);
    expect(drawn.some((entry) => entry.value.includes("decision-relevant"))).toBe(true);
  });

  it("keeps a multi-paragraph Polestar section atomic", () => {
    const { ctx, pdf, drawn } = makeContext();
    ctx.y = 760;

    drawEnergyProse(
      ctx,
      "Polestar View",
      "First judgement paragraph remains intact.\n\nSecond judgement paragraph remains intact.",
      { atomic: true },
    );

    expect(pdf.addPage).toHaveBeenCalledTimes(1);
    const bodyPages = drawn
      .filter((entry) => entry.value.includes("judgement"))
      .map((entry) => entry.page);
    expect(bodyPages.length).toBeGreaterThan(0);
    expect(new Set(bodyPages)).toEqual(new Set([2]));
  });

  it("fails explicitly when an atomic Polestar section exceeds one page", () => {
    const { ctx, pdf, drawn } = makeContext();
    const oversized = Array.from({ length: 300 }, (_, index) => `Long judgement line ${index}`).join(" ");

    expect(() =>
      drawEnergyProse(ctx, "Polestar View", oversized, { atomic: true }),
    ).toThrow("longer than one readable page");
    expect(pdf.addPage).not.toHaveBeenCalled();
    expect(drawn).toEqual([]);
  });

  it("expands a long situation across pages without leaving its heading orphaned", () => {
    const { ctx, pdf, drawn } = makeContext();
    ctx.y = 730;
    const situation = Array.from({ length: 150 }, (_, index) => `Situation detail ${index}`).join(" ");

    drawEnergyProse(ctx, "Situation", situation);

    expect(pdf.addPage.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(drawn.find((entry) => entry.value === "SITUATION")?.page).toBe(2);
    expect(drawn.some((entry) => entry.value.includes("Situation detail 149"))).toBe(true);
  });

  it("renders every recommendation when there are more than eight bullets", () => {
    const { ctx, pdf, drawn } = makeContext();
    const recommendations = Array.from(
      { length: 10 },
      (_, index) => `- Recommendation ${index + 1} remains visible`,
    ).join("\n");

    drawEnergyProse(ctx, "Recommendations", recommendations, { bullets: true });

    for (let index = 1; index <= 10; index += 1) {
      expect(drawn.some((entry) => entry.value === `Recommendation ${index} remains visible`)).toBe(true);
    }
    expect(pdf.splitTextToSize).toHaveBeenCalledTimes(10);
  });

  it("creates no pages for an empty section", () => {
    const { ctx, pdf, drawn } = makeContext();

    drawEnergyProse(ctx, "Empty", " \n\n  ");

    expect(pdf.addPage).not.toHaveBeenCalled();
    expect(drawn).toEqual([]);
  });
});