import { Buoy } from '../models/buoy.models';

/**
 * The two buoys of the demo, with the same code, river and coordinates as the device stations of
 * `backend/scripts/seed.py` (DEVICE_STATIONS). Their data comes from Wokwi (`firmware/boya-rm01`).
 */
export const MOCK_BUOYS: Buoy[] = [
  { id: 'rm-01', code: 'RM-01', name: 'Boya RM-01', river: 'Río Atoyac', site: 'Colector Panzacola (aguas abajo de la descarga)', latitude: 19.1561, longitude: -98.2373, design: 'anclada' },
  { id: 'rm-02', code: 'RM-02', name: 'Boya RM-02', river: 'Río Atoyac', site: 'Estación testigo Tlahuapan (aguas arriba)', latitude: 19.3678, longitude: -98.5152, design: 'anclada' },
];
