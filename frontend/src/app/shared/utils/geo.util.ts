/** `[lat, lng]` pair, as stored in `features/satellite/basin.ts`. */
export type LatLng = [number, number];

const M_PER_DEG_LAT = 110_540;
const M_PER_DEG_LNG_EQ = 111_320;

/**
 * Shortest distance (metres) from a point to a set of polylines (e.g. the river traces).
 * Local equirectangular projection around the point: accurate to ~1 % at basin scale.
 * Returns `Infinity` when there are no segments.
 */
export function distanceToPolylinesM(point: LatLng, lines: LatLng[][]): number {
  const [lat0, lng0] = point;
  const kx = M_PER_DEG_LNG_EQ * Math.cos((lat0 * Math.PI) / 180);
  const xy = ([lat, lng]: LatLng): [number, number] => [(lng - lng0) * kx, (lat - lat0) * M_PER_DEG_LAT];
  let best = Infinity;
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const [ax, ay] = xy(line[i - 1]);
      const [bx, by] = xy(line[i]);
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      // Projection of the origin (the point) onto the segment, clamped to its ends.
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
      best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
    }
  }
  return best;
}

/** «~350 m» / «~1.4 km», rounded: the river trace is approximate. */
export function formatApproxDistance(m: number): string {
  if (!Number.isFinite(m)) return '—';
  return m < 1000 ? `~${Math.max(10, Math.round(m / 10) * 10)} m` : `~${(m / 1000).toFixed(1)} km`;
}
