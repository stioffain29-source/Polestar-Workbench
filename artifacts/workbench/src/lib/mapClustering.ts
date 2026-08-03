// Zoom-aware map marker clustering.
//
// The map used to collapse markers into a cluster ONLY when two incidents
// shared the exact same lat/lng (rounded to ~11m) — almost always an
// unresolved geocoding fallback (e.g. a country centroid). That grouping key
// never changes with zoom, so once a stack formed it could never visually
// split apart, even for genuinely distinct, well-resolved coordinates that
// merely happened to render close together on screen at the current zoom.
// The analyst explicitly wants clusters to decompose into individual markers
// as they zoom in — the standard behaviour of any pixel-radius-based map
// clustering (e.g. supercluster, leaflet.markercluster).
//
// This module replaces the exact-match grouping with real pixel-distance
// clustering computed at the CURRENT zoom level: markers within `pixelRadius`
// screen pixels of each other collapse into one cluster marker; as the user
// zooms in, the same geographic separation maps to a larger pixel distance,
// so the cluster naturally decomposes once members clear the radius.
//
// Geographic integrity is preserved: clustering only ever decides whether to
// draw ONE combined marker or several INDIVIDUAL markers at each member's own
// true coordinate — it never fabricates a position (no ring fan-out, no
// jitter). Two incidents sharing the exact same fallback coordinate (0px
// apart at every zoom) will always stay clustered, because there is no real,
// distinct position to split them into — that is the honest representation,
// not a bug.

const TILE_SIZE = 256;

/**
 * Standard Web Mercator slippy-map pixel projection (matches Leaflet's
 * default CRS, EPSG:3857, at the given zoom level). Pure function — used both
 * by clustering and by its tests, independent of any live Leaflet map
 * instance so clustering can be unit-tested without a DOM/map.
 */
export function projectLatLngToPixel(
  lat: number,
  lng: number,
  zoom: number,
): { x: number; y: number } {
  const scale = 2 ** zoom * TILE_SIZE;
  const x = ((lng + 180) / 360) * scale;
  const latRad = (lat * Math.PI) / 180;
  const y =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * scale;
  return { x, y };
}

function pixelDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function severityRank(rating: string, order: readonly string[]): number {
  const idx = order.indexOf(rating);
  return idx === -1 ? 0 : idx;
}

export type Clusterable = { id: string; lat: number; lng: number; rating: string };
export type ClusteredPoint<T extends Clusterable> = T & {
  clusterSize?: number;
  clusterMembers?: T[];
};

// Default screen-pixel radius within which markers collapse into one cluster
// — roughly the footprint of the cluster/marker circles themselves, so a
// cluster only forms when individual markers would visually overlap.
export const DEFAULT_CLUSTER_PIXEL_RADIUS = 40;

/**
 * Group points into clusters based on their pixel distance from each other at
 * the given zoom level. Greedy single-pass: each point joins the first
 * existing cluster whose ANCHOR (first member) is within `pixelRadius`, else
 * starts a new cluster. This mirrors how the previous exact-match version
 * grouped by a shared key, just with a pixel-distance key that depends on
 * zoom instead of a fixed lat/lng string — so identical coordinates (distance
 * 0) still always merge, and near-but-distinct coordinates merge only while
 * visually overlapping at the current zoom.
 */
export function clusterPointsByZoom<T extends Clusterable>(
  points: T[],
  zoom: number,
  pixelRadius: number = DEFAULT_CLUSTER_PIXEL_RADIUS,
  severityOrder: readonly string[] = ["insignificant", "low", "moderate", "high", "extreme"],
): ClusteredPoint<T>[] {
  type Bucket = { anchor: { x: number; y: number }; members: T[] };
  const buckets: Bucket[] = [];

  for (const p of points) {
    const px = projectLatLngToPixel(p.lat, p.lng, zoom);
    const bucket = buckets.find((b) => pixelDistance(b.anchor, px) <= pixelRadius);
    if (bucket) bucket.members.push(p);
    else buckets.push({ anchor: px, members: [p] });
  }

  return buckets.map((b) => {
    if (b.members.length === 1) return b.members[0];
    const highest = b.members.reduce((best, p) =>
      severityRank(p.rating, severityOrder) > severityRank(best.rating, severityOrder) ? p : best,
    );
    return {
      ...highest,
      id: `cluster-${b.members.map((m) => m.id).sort().join("|")}`,
      clusterSize: b.members.length,
      clusterMembers: b.members,
    };
  });
}
