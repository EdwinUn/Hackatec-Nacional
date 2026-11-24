/** Packet of the buoy's ESP32 (`device_telemetry` over `/ws/live`, `GET /devices/{code}/telemetry/latest`). See `API.md`. */
export interface DeviceTelemetryDto {
  code?: string;
  station_id: string;
  ts: string;
  seq: number | null;
  battery_pct: number | null;
  battery_v: number | null;
  gas_v?: number | null;
  device_efficiency_pct?: number | null;
  river_speed_ms: number | null;
  flow_rate_lpm: number | null;
  basket_fill_pct: number | null;
  rssi_dbm: number | null;
  pump_on: boolean | null;
  alarm_on: boolean | null;
  /** Water quality of that packet, with the firmware names: `ph`, `turb_in_ntu`, `temp_c`, `do_mgl`, `tds_ppm`. */
  values: Record<string, number> | null;
}

/** Last packet of a buoy plus when it reached this app. */
export interface TelemetryPacket extends DeviceTelemetryDto {
  receivedAt: number;
}

/** A packet counts as «live» while the next one is expected (the ESP32 sends every ~3 s). */
export const TELEMETRY_LIVE_MS = 15_000;

/** The 3D model and Wokwi call the buoy `B-02` / `BM-02`; the backend station code is `RM-02`. */
export function deviceCodeFor(buoyCode: string): string {
  const c = buoyCode.trim().toUpperCase();
  const m = /^(?:B|BM|RM)-0*(\d+)$/.exec(c);
  return m ? `RM-${m[1].padStart(2, '0')}` : c;
}

export function linkQuality(rssi: number | null): { label: string; color: string } {
  if (rssi === null) return { label: 'Sin dato', color: '#64748b' };
  if (rssi >= -60) return { label: 'Excelente', color: '#0f7a4d' };
  if (rssi >= -75) return { label: 'Buena', color: '#0891b2' };
  if (rssi >= -85) return { label: 'Débil', color: '#a16207' };
  return { label: 'Muy débil', color: '#b91c1c' };
}
