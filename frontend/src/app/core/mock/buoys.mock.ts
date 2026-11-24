import { Buoy } from '../models/buoy.models';
import { MOCK_STATIONS } from './mock-backend';

const [atoyac, alseseca, valsequillo] = MOCK_STATIONS;

/**
 * Demo buoys (prototype data, not real deployments).
 * Placed a few dozen meters from each mock station so the markers don't overlap.
 */
export const MOCK_BUOYS: Buoy[] = [
  { id: 'boya-1', code: 'B-01', name: 'Boya 1', river: atoyac.river, latitude: atoyac.latitude + 0.0006, longitude: atoyac.longitude - 0.0008, status: 'active', design: 'anclada', stationId: atoyac.id, installedAt: '2026-09-15' },
  { id: 'boya-2', code: 'B-02', name: 'Boya 2', river: alseseca.river, latitude: alseseca.latitude - 0.0005, longitude: alseseca.longitude + 0.0007, status: 'active', design: 'anclada', stationId: alseseca.id, installedAt: '2026-10-02' },
  { id: 'boya-3', code: 'B-03', name: 'Boya 3', river: valsequillo.river, latitude: valsequillo.latitude + 0.0007, longitude: valsequillo.longitude + 0.0006, status: 'maintenance', design: 'anclada', stationId: valsequillo.id, installedAt: '2026-10-20' },
];
