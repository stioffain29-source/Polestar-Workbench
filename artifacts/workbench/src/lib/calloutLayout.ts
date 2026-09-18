export interface CalloutInput {
  id: string;
  px: number;
  py: number;
  boxW: number;
  boxH: number;
}

export interface CalloutPlacement {
  id: string;
  boxX: number;
  boxY: number;
  leaderX1: number;
  leaderY1: number;
  leaderX2: number;
  leaderY2: number;
}

export function layoutCallouts(
  mapW: number,
  mapH: number,
  inputs: CalloutInput[],
  padding = 4
): CalloutPlacement[] {
  const placements: CalloutPlacement[] = [];
  const rects: Array<{ left: number; top: number; right: number; bottom: number }> = [];

  const overlaps = (left: number, top: number, w: number, h: number) => {
    return rects.some((r) =>
      left < r.right + padding &&
      left + w + padding > r.left &&
      top < r.bottom + padding &&
      top + h + padding > r.top
    );
  };

  for (const input of inputs) {
    const { px, py, boxW, boxH } = input;

    // Default offset: slightly to the right, or left if we're on the right edge
    let left = px + 18;
    if (px > mapW * 0.6) {
      left = px - boxW - 18;
    }
    let top = py - boxH / 2;

    left = Math.min(Math.max(left, padding), mapW - boxW - padding);
    top = Math.min(Math.max(top, padding), mapH - boxH - padding);

    if (overlaps(left, top, boxW, boxH)) {
      // scan vertically
      let candidateTop = top;
      while (overlaps(left, candidateTop, boxW, boxH) && candidateTop + boxH + 6 <= mapH - padding) {
        candidateTop += 6;
      }
      if (overlaps(left, candidateTop, boxW, boxH)) {
        // scan up
        candidateTop = top;
        while (overlaps(left, candidateTop, boxW, boxH) && candidateTop - 6 >= padding) {
          candidateTop -= 6;
        }
      }
      if (overlaps(left, candidateTop, boxW, boxH)) {
        // flip side
        left = px < mapW / 2 ? px + 18 : px - boxW - 18;
        // if it was on the right, now we flipped to left, etc.
        // Actually, just try the other side
        left = px > left ? px + 18 : px - boxW - 18;
        left = Math.min(Math.max(left, padding), mapW - boxW - padding);
        candidateTop = top;
        while (overlaps(left, candidateTop, boxW, boxH) && candidateTop + boxH + 6 <= mapH - padding) {
          candidateTop += 6;
        }
        if (overlaps(left, candidateTop, boxW, boxH)) {
          candidateTop = top;
          while (overlaps(left, candidateTop, boxW, boxH) && candidateTop - 6 >= padding) {
            candidateTop -= 6;
          }
        }
      }
      top = candidateTop;
    }

    const right = left + boxW;
    const bottom = top + boxH;
    rects.push({ left, top, right, bottom });

    const anchorX = px < left ? left : px > right ? right : Math.min(Math.max(px, left + 6), right - 6);
    const anchorY = py < top ? top : py > bottom ? bottom : Math.min(Math.max(py, top + 5), bottom - 5);

    placements.push({
      id: input.id,
      boxX: left,
      boxY: top,
      leaderX1: px,
      leaderY1: py,
      leaderX2: anchorX,
      leaderY2: anchorY,
    });
  }

  return placements;
}
