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
): Array<{ start: number; end: number }> {
  const pages: Array<{ start: number; end: number }> = [];
  let start = initialStart;

  while (start < totalHeight - 1) {
    const target = Math.min(start + pageCssHeight, totalHeight);
    let end = target;

    if (target < totalHeight) {
      const minUsefulBreak = start + pageCssHeight * MIN_PAGE_FILL;
      const useful = candidates.filter(
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

    pages.push({ start, end });
    start = end;
  }

  return pages;
}
