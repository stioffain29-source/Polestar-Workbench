// Pure page-break geometry for the DOM-rasterise PDF export
// (`exportElementToPdf` in `exportPdf.ts`). These helpers are deliberately
// free of DOM / jsPDF / asset imports so they can be unit-tested in the node
// jest setup. `exportPdf.ts` measures the live DOM and then delegates the
// break-candidate refinement and page slicing to the functions here, so this
// module is the single source of truth for WHERE each page breaks.
//
// The invariants a regression here would silently break (and which the tests
// pin) are:
//   - a slice may only END on a break candidate (or the document end), so an
//     atomic card / section is never cut in half; and
//   - a page is never left with a large empty remainder when a valid break
//     candidate exists further down.

export const MIN_PAGE_FILL = 0.45;
export const PAGE_BREAK_GUARD_PX = 24;

// A block that must never be sliced across a page boundary (e.g. the Jakarta
// operational map + legend + operating-zone cards). `top`/`bottom` are offsets
// from the document top, matching the break-candidate coordinate space.
export interface KeepRange {
  top: number;
  bottom: number;
}

// Refine the raw element/line tops gathered from the DOM into the final ordered
// list of legal break offsets. Always includes 0 and the document end. De-dupes
// candidates that sit within PAGE_BREAK_GUARD_PX of the previous KEPT one (not
// the immediate predecessor) so a run of evenly-spaced prose line tops isn't
// cascade-dropped down to a single point, then drops anything in the top 15% of
// a page (too small a remainder to be worth a break).
export function refineBreakCandidates(
  rawTops: number[],
  scrollHeight: number,
  pageCssHeight: number,
): number[] {
  const candidates = new Set<number>([0, scrollHeight]);
  for (const raw of rawTops) {
    const top = Math.round(raw);
    if (top > 0 && top < scrollHeight) candidates.add(top);
  }

  const sorted = Array.from(candidates)
    .filter((y) => y >= 0 && y <= scrollHeight)
    .sort((a, b) => a - b);

  const kept: number[] = [];
  for (const y of sorted) {
    if (kept.length === 0 || y - kept[kept.length - 1] > PAGE_BREAK_GUARD_PX) {
      kept.push(y);
    }
  }

  return kept.filter(
    (y) => y === 0 || y === scrollHeight || y > pageCssHeight * 0.15,
  );
}

// Carve the body into page-height slices, preferring to END each page on the
// lowest-impact legal break candidate that still fills at least MIN_PAGE_FILL of
// the page. `initialStart` lets the cover page reserve the top of the document
// (page 1) so body pagination begins below it.
export function buildPageSlices(
  totalHeight: number,
  pageCssHeight: number,
  candidates: number[],
  initialStart = 0,
  keepRanges: KeepRange[] = [],
): Array<{ start: number; end: number }> {
  // Normalise the keep-together blocks (valid, rounded, ascending).
  const ranges = keepRanges
    .filter((r) => r.bottom > r.top)
    .map((r) => ({ top: Math.round(r.top), bottom: Math.round(r.bottom) }))
    .sort((a, b) => a.top - b.top);

  // Effective candidate list: union each range's TOP in (so a page may legally
  // break BEFORE a kept block) and drop any candidate that sits strictly INSIDE
  // a kept block (so a page can never END mid-block). With no ranges this is
  // exactly the input candidate set, so default behaviour is unchanged.
  const isInsideRange = (y: number) =>
    ranges.some((r) => y > r.top && y < r.bottom);
  const effective = Array.from(
    new Set<number>([...candidates, ...ranges.map((r) => r.top)]),
  )
    .filter((y) => !isInsideRange(y))
    .sort((a, b) => a - b);
  const rangeContaining = (y: number) =>
    ranges.find((r) => y > r.top && y < r.bottom) ?? null;

  const pages: Array<{ start: number; end: number }> = [];
  let start = initialStart;

  while (start < totalHeight - 1) {
    const target = Math.min(start + pageCssHeight, totalHeight);
    let end = target;

    if (target < totalHeight) {
      const minUsefulBreak = start + pageCssHeight * MIN_PAGE_FILL;
      const useful = effective.filter(
        (y) =>
          y > start + PAGE_BREAK_GUARD_PX &&
          y <= target - PAGE_BREAK_GUARD_PX &&
          y >= minUsefulBreak,
      );
      if (useful.length > 0) {
        end = useful[useful.length - 1];
      }
    }

    if (end <= start + PAGE_BREAK_GUARD_PX) {
      end = target;
    }

    // Keep-together guard: a forced target cut must never land inside an atomic
    // block. Pull the page end back to the block's top so it starts whole on the
    // next page — unless the block already began at/above this page's start or is
    // taller than a full page, in which case a clean break is impossible and we
    // accept the cut to guarantee forward progress.
    const hit = rangeContaining(end);
    if (hit) {
      const fitsOnAPage = hit.bottom - hit.top <= pageCssHeight;
      end =
        hit.top > start + PAGE_BREAK_GUARD_PX && fitsOnAPage ? hit.top : target;
    }

    pages.push({ start, end });
    start = end;
  }

  // Rebalance a runt final page: the forward scan can leave the trailing page
  // far under-filled when the true remaining content overflows the previous
  // page's budget by only a small margin (e.g. a short closing paragraph plus
  // a footer disclaimer, spilling onto an otherwise near-empty page). Re-split
  // the last TWO pages together at the effective candidate closest to their
  // combined midpoint — but only when both halves still fit within one page
  // height each, so this can never introduce an overflow or a cut the forward
  // scan itself would not have produced.
  if (pages.length >= 2) {
    const lastPage = pages[pages.length - 1];
    const prevPage = pages[pages.length - 2];
    const lastFill = (lastPage.end - lastPage.start) / pageCssHeight;
    if (lastFill < MIN_PAGE_FILL) {
      const rangeStart = prevPage.start;
      const rangeEnd = lastPage.end;
      const midpoint = (rangeStart + rangeEnd) / 2;
      const rebalanceCandidates = effective.filter(
        (y) =>
          y > rangeStart + PAGE_BREAK_GUARD_PX &&
          y < rangeEnd - PAGE_BREAK_GUARD_PX &&
          y - rangeStart <= pageCssHeight &&
          rangeEnd - y <= pageCssHeight,
      );
      if (rebalanceCandidates.length > 0) {
        let best = rebalanceCandidates[0];
        for (const c of rebalanceCandidates) {
          if (Math.abs(c - midpoint) < Math.abs(best - midpoint)) best = c;
        }
        prevPage.end = best;
        lastPage.start = best;
      }
    }
  }

  return pages;
}
