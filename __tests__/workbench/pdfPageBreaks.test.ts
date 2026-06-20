import {
  buildPageSlices,
  refineBreakCandidates,
  MIN_PAGE_FILL,
  PAGE_BREAK_GUARD_PX,
} from "../../artifacts/workbench/src/lib/pdfPageBreaks";

// Guards the DOM-rasterise PDF export's page-break geometry
// (`exportElementToPdf` in `exportPdf.ts`). A regression here silently
// reintroduces the exact bug fixed for the Papua/PNG country PDFs: content
// sliced mid-card, or a page left with a large empty remainder when a valid
// break exists further down. `exportPdf.ts` measures the live DOM and then
// delegates to these two pure helpers, so the invariants proven here are the
// invariants the real export obeys.

type Slice = { start: number; end: number };

// Slices must tile the body with no gaps or overlaps: each page begins exactly
// where the previous one ended, and the run covers [initialStart, totalHeight].
function assertSlicesAreContiguous(
  slices: Slice[],
  initialStart: number,
  totalHeight: number,
) {
  expect(slices.length).toBeGreaterThan(0);
  expect(slices[0].start).toBe(initialStart);
  expect(slices[slices.length - 1].end).toBe(totalHeight);
  for (let i = 0; i < slices.length; i++) {
    expect(slices[i].end).toBeGreaterThan(slices[i].start);
    if (i > 0) expect(slices[i].start).toBe(slices[i - 1].end);
  }
}

// The core guard. For every page the slicer must have made the OPTIMAL legal
// choice given the candidates (assumed sorted ascending):
//   - if at least one candidate falls inside the usable window, the page MUST
//     end on the LOWEST such candidate (atomic card boundary + maximum fill);
//   - otherwise the card is taller than the page remainder, so a hard cut at
//     the page target is the only option.
// A regression that overflows past a valid break (mid-card cut) or breaks too
// early (large empty remainder) diverges from this and fails.
function assertOptimalBreaks(
  slices: Slice[],
  candidates: number[],
  totalHeight: number,
  pageCssHeight: number,
) {
  for (const { start, end } of slices) {
    const target = Math.min(start + pageCssHeight, totalHeight);
    if (target >= totalHeight) {
      expect(end).toBe(totalHeight);
      continue;
    }
    const minUsefulBreak = start + pageCssHeight * MIN_PAGE_FILL;
    const useful = candidates.filter(
      (y) =>
        y > start + PAGE_BREAK_GUARD_PX &&
        y <= target - PAGE_BREAK_GUARD_PX &&
        y >= minUsefulBreak,
    );
    if (useful.length > 0) {
      // ended exactly on a real candidate => the card stayed atomic
      expect(end).toBe(useful[useful.length - 1]);
      expect(candidates).toContain(end);
    } else {
      // unavoidable forced cut at the page target
      expect(end).toBe(target);
    }
  }
}

describe("buildPageSlices — atomic cards (no mid-card cuts)", () => {
  it("breaks on a card boundary rather than the raw page target", () => {
    const pageCssHeight = 1000;
    const totalHeight = 2500;
    const candidates = [0, 900, 1850, totalHeight];

    const slices = buildPageSlices(totalHeight, pageCssHeight, candidates);

    assertSlicesAreContiguous(slices, 0, totalHeight);
    assertOptimalBreaks(slices, candidates, totalHeight, pageCssHeight);
    expect(slices.map((s) => s.end)).toEqual([900, 1850, 2500]);
  });

  it("ends every page on a candidate when each window has a usable break", () => {
    const pageCssHeight = 800;
    const totalHeight = 3000;
    // Boundaries spaced so each 800px window contains a usable break.
    const candidates = [0, 700, 1400, 2100, 2800, totalHeight];

    const slices = buildPageSlices(totalHeight, pageCssHeight, candidates);

    assertSlicesAreContiguous(slices, 0, totalHeight);
    assertOptimalBreaks(slices, candidates, totalHeight, pageCssHeight);
    // No forced cuts: every slice end is an actual card boundary.
    const legal = new Set(candidates);
    for (const s of slices) expect(legal.has(s.end)).toBe(true);
  });

  it("chooses the LOWEST candidate that still fills the page (max fill)", () => {
    const pageCssHeight = 1000;
    const totalHeight = 3000;
    // 600 and 950 both fit; the slicer must pick 950 to fill the page most.
    const candidates = [0, 600, 950, 1900, totalHeight];

    const slices = buildPageSlices(totalHeight, pageCssHeight, candidates);

    expect(slices[0].end).toBe(950);
    assertOptimalBreaks(slices, candidates, totalHeight, pageCssHeight);
  });
});

describe("buildPageSlices — no large empty remainder when a break exists", () => {
  it("skips a too-early candidate and uses one nearer the page target", () => {
    const pageCssHeight = 1000;
    const totalHeight = 2400;
    // 200 sits below MIN_PAGE_FILL (0.45*1000=450) — breaking there would waste
    // 80% of the page. The slicer must skip it and use 960 instead.
    const candidates = [0, 200, 960, totalHeight];

    const slices = buildPageSlices(totalHeight, pageCssHeight, candidates);

    expect(slices[0].end).toBe(960);
    // Every non-final page is filled to at least MIN_PAGE_FILL.
    for (let i = 0; i < slices.length - 1; i++) {
      const filled = slices[i].end - slices[i].start;
      expect(filled).toBeGreaterThanOrEqual(pageCssHeight * MIN_PAGE_FILL);
    }
    assertSlicesAreContiguous(slices, 0, totalHeight);
    assertOptimalBreaks(slices, candidates, totalHeight, pageCssHeight);
  });

  it("falls back to a full-height cut when no candidate is usable", () => {
    const pageCssHeight = 1000;
    const totalHeight = 2400;
    // A single card taller than the page: no interior candidate, so the slicer
    // must still make progress by cutting at the page target.
    const candidates = [0, totalHeight];

    const slices = buildPageSlices(totalHeight, pageCssHeight, candidates);

    expect(slices.map((s) => s.end)).toEqual([1000, 2000, 2400]);
    assertSlicesAreContiguous(slices, 0, totalHeight);
  });

  it("terminates and tiles fully even with pathological candidate spacing", () => {
    const pageCssHeight = 600;
    const totalHeight = 5000;
    const candidates = [
      0, 10, 20, 30, 590, 1180, 1700, 2400, 3100, 4800, totalHeight,
    ];

    const slices = buildPageSlices(totalHeight, pageCssHeight, candidates);

    assertSlicesAreContiguous(slices, 0, totalHeight);
    assertOptimalBreaks(slices, candidates, totalHeight, pageCssHeight);
  });
});

describe("buildPageSlices — cover page (page 1) stays intact", () => {
  it("reserves the cover via initialStart and never re-slices it", () => {
    const pageCssHeight = 1000;
    const totalHeight = 3000;
    const coverEnd = 1100; // cover occupies [0, 1100] as its own page-1 slice
    const candidates = [0, coverEnd, 2000, totalHeight];

    const bodySlices = buildPageSlices(
      totalHeight,
      pageCssHeight,
      candidates,
      coverEnd,
    );

    // Body pagination begins exactly at the cover boundary — the cover slice
    // [0, coverEnd] is produced separately and must not be touched here.
    expect(bodySlices[0].start).toBe(coverEnd);
    assertSlicesAreContiguous(bodySlices, coverEnd, totalHeight);
    assertOptimalBreaks(bodySlices, candidates, totalHeight, pageCssHeight);
  });

  it("body fits on one page when the post-cover remainder is short", () => {
    const pageCssHeight = 1000;
    const totalHeight = 1600;
    const coverEnd = 800;
    const candidates = [0, coverEnd, totalHeight];

    const bodySlices = buildPageSlices(
      totalHeight,
      pageCssHeight,
      candidates,
      coverEnd,
    );

    expect(bodySlices).toHaveLength(1);
    expect(bodySlices[0]).toEqual({ start: coverEnd, end: totalHeight });
  });
});

describe("refineBreakCandidates", () => {
  it("always anchors 0 and the document end", () => {
    const refined = refineBreakCandidates([400, 800], 2000, 1000);
    expect(refined[0]).toBe(0);
    expect(refined[refined.length - 1]).toBe(2000);
  });

  it("drops candidates within the guard distance of the previous KEPT one", () => {
    // 405 and 410 sit within PAGE_BREAK_GUARD_PX (24) of 400, so only 400 keeps.
    const refined = refineBreakCandidates([400, 405, 410, 800], 2000, 1000);
    expect(refined).toContain(400);
    expect(refined).not.toContain(405);
    expect(refined).not.toContain(410);
    expect(refined).toContain(800);
  });

  it("de-dupes against the KEPT candidate, not the immediate predecessor", () => {
    // Tops 18px apart. A predecessor-keyed filter would cascade-drop the whole
    // run to just 300. Keying off the last KEPT one re-anchors, so 336 (36px
    // from kept 300, but only 18px from its dropped predecessor 318) survives.
    const refined = refineBreakCandidates([300, 318, 336], 4000, 1000);
    expect(refined).toContain(300);
    expect(refined).not.toContain(318);
    expect(refined).toContain(336);
  });

  it("drops tiny top-of-page candidates (< 15% of a page height)", () => {
    // 100 is below 0.15*1000=150 and is neither 0 nor the end, so it is filtered
    // out as too small a remainder to be worth a break.
    const refined = refineBreakCandidates([100, 600], 2000, 1000);
    expect(refined).not.toContain(100);
    expect(refined).toContain(600);
  });

  it("rounds tops, drops out-of-range values, and sorts ascending", () => {
    const refined = refineBreakCandidates(
      [400.6, -50, 2500, 700.2],
      2000,
      1000,
    );
    // 400.6→401, 700.2→700; -50 (<0) and 2500 (>scrollHeight) are dropped.
    expect(refined).toEqual([0, 401, 700, 2000]);
  });

  it("produces candidates that buildPageSlices consumes without mid-card cuts", () => {
    const totalHeight = 4000;
    const pageCssHeight = 1000;
    const refined = refineBreakCandidates(
      [320, 980, 1500, 1505, 2300, 3100, 3700],
      totalHeight,
      pageCssHeight,
    );
    const slices = buildPageSlices(totalHeight, pageCssHeight, refined);
    assertSlicesAreContiguous(slices, 0, totalHeight);
    assertOptimalBreaks(slices, refined, totalHeight, pageCssHeight);
  });
});

describe("exported tuning constants", () => {
  it("keeps the guard and fill ratio within sane bounds", () => {
    expect(PAGE_BREAK_GUARD_PX).toBeGreaterThan(0);
    expect(MIN_PAGE_FILL).toBeGreaterThan(0);
    expect(MIN_PAGE_FILL).toBeLessThan(1);
  });
});
