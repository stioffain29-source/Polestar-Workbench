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

export interface CalloutObstacle {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function layoutCallouts(
  mapW: number,
  mapH: number,
  inputs: CalloutInput[],
  padding = 12,
  obstacles: CalloutObstacle[] = [],
): CalloutPlacement[] {
  const placements: CalloutPlacement[] = [];
  const rects: Array<{ left: number; top: number; right: number; bottom: number }> = [];

  const overlapArea = (
    left: number,
    top: number,
    w: number,
    h: number,
    rect: CalloutObstacle,
  ) => Math.max(0, Math.min(left + w, rect.right) - Math.max(left, rect.left))
    * Math.max(0, Math.min(top + h, rect.bottom) - Math.max(top, rect.top));

  for (const input of inputs) {
    const { px, py, boxW, boxH } = input;

    // Keep enough clear leader-line length between each incident marker and
    // its callout for the relationship to remain obvious on pale basemaps.
    const gap = 64;
    const candidates = [
      [px + gap, py - boxH / 2],
      [px - boxW - gap, py - boxH / 2],
      [px + gap, py - boxH - gap / 2],
      [px - boxW - gap, py - boxH - gap / 2],
      [px + gap, py + gap / 2],
      [px - boxW - gap, py + gap / 2],
    ].map(([candidateLeft, candidateTop]) => {
      const left = Math.min(Math.max(candidateLeft, padding), mapW - boxW - padding);
      const top = Math.min(Math.max(candidateTop, padding), mapH - boxH - padding);
      const calloutOverlap = rects.reduce((sum, rect) => sum + overlapArea(left, top, boxW, boxH, rect), 0);
      const obstacleOverlap = obstacles.reduce((sum, rect) => sum + overlapArea(left, top, boxW, boxH, rect), 0);
      const coversOwnPin = px >= left && px <= left + boxW && py >= top && py <= top + boxH;
      const clampedDistance = Math.abs(left - candidateLeft) + Math.abs(top - candidateTop);
      return {
        left,
        top,
        score: calloutOverlap * 1000 + obstacleOverlap * 20 + (coversOwnPin ? 1_000_000 : 0) + clampedDistance,
      };
    });
    candidates.sort((a, b) => a.score - b.score);
    const { left, top } = candidates[0];

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
