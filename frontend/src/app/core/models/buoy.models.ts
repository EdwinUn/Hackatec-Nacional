import { StationStatus } from './rio.models';

/** Buoy design (prototype): "patas" (A, digging legs) | "anclada" (B, domed buoy moored with three chains). */
export type BuoyDesign = 'anclada' | 'patas';

/**
 * Río Monitor buoy deployed in a river.
 * There is no endpoint yet: it only lives in frontend mocks (`core/mock/buoys.mock.ts`).
 */
export interface Buoy {
  id: string;
  /** Short code shown on the map, e.g. "B-01". */
  code: string;
  /** Display name, e.g. "Boya 1". */
  name: string;
  river: string;
  latitude: number;
  longitude: number;
  status: StationStatus;
  design: BuoyDesign;
  /** Station whose sensors it reports to (when applicable). */
  stationId?: string;
  /** ISO date (YYYY-MM-DD). */
  installedAt: string;
}

export const BUOY_STATUS_META: Record<StationStatus, { label: string; color: string; bg: string }> = {
  active: { label: 'En operación', color: '#0f7a4d', bg: '#dcf5e8' },
  maintenance: { label: 'Mantenimiento', color: '#a16207', bg: '#fcefc7' },
  offline: { label: 'Sin conexión', color: '#475569', bg: '#e2e8f0' },
};
