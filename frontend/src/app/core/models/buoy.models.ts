/** Buoy design: v8 has a single one, "anclada" (B, domed buoy moored with three lines). */
export type BuoyDesign = 'anclada';

/**
 * Río Monitor buoy. There is no physical prototype: each buoy is the ESP32 of
 * `firmware/boya-rm01` running in Wokwi (or `backend/scripts/buoy.py`), with a backend station of
 * the same `code`. There is no `/buoys` endpoint yet: they live in `core/mock/buoys.mock.ts`, with
 * the same codes and coordinates as `backend/scripts/seed.py`.
 */
export interface Buoy {
  id: string;
  /** Code of its backend station and of the firmware (`BOYA` in sketch.ino), e.g. "RM-01". */
  code: string;
  /** Display name, e.g. "Boya RM-01". */
  name: string;
  river: string;
  /** Where it is, as in the seed's station description. */
  site: string;
  latitude: number;
  longitude: number;
  design: BuoyDesign;
}

/**
 * What the web shows as a buoy's state. It comes from the ESP32's telemetry, not from a
 * deployment status: the buoys only exist as a simulation.
 */
export type BuoyState = 'live' | 'saturated' | 'stale' | 'nodata';

/** Basket fill (%) from which a live buoy shows as «Saturada» (same as the panel's «Casi llena»). */
export const BUOY_SATURATED_AT = 80;

export const BUOY_STATE_META: Record<BuoyState, { label: string; color: string; bg: string }> = {
  live: { label: 'En vivo · Wokwi', color: '#0f7a4d', bg: '#dcf5e8' },
  saturated: { label: 'Saturada', color: '#b91c1c', bg: '#fbdcdc' },
  stale: { label: 'Sin señal', color: '#475569', bg: '#e2e8f0' },
  nodata: { label: 'Sin datos', color: '#64748b', bg: '#f1f5f9' },
};

/** State of a buoy from its last packet and whether that packet is still live. */
export function buoyState(packet: { basket_fill_pct?: number | null } | null, live: boolean): BuoyState {
  if (!packet) return 'nodata';
  if (!live) return 'stale';
  return (packet.basket_fill_pct ?? 0) >= BUOY_SATURATED_AT ? 'saturated' : 'live';
}

/** Where a buoy's data comes from (shown instead of an installation date). */
export const BUOY_SOURCE = 'Simulada en Wokwi (sin boya física)';
